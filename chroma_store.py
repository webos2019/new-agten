"""Chroma 向量持久化层 — 知识库分块向量存储

- chromadb PersistentClient: 落盘 + HNSW 近似最近邻 (cosine 空间)
- 按 embedding 维度分 collection (kb_chunks_d{dims}):
  Chroma 要求同一 collection 内维度一致, 模型切换 (hash 512 → api 1024) 时
  新维度走新 collection, 旧数据由 knowledge_base._ensure_namespace_embeddings 迁移
- namespace 用 metadata where 过滤 (collection 名不允许 ':', 不做 namespace collection)
- 分块的文档元数据 (kb_documents) 和 namespace 模型标识仍走 SQLite (sqlite_store.py)

配置 (.env):
  CHROMA_PATH=data/chroma   # 默认开启; 留空则不启用 (纯内存, 重启丢失)
"""

from __future__ import annotations

import os
from typing import Any

from dotenv import load_dotenv

load_dotenv()

CHROMA_PATH = os.getenv("CHROMA_PATH", "data/chroma")

COLLECTION_PREFIX = "kb_chunks_d"


class ChromaKBStore:
    """
    知识库分块向量存储 — Chroma 持久化客户端。

    - 初始化失败自动降级纯内存 (is_enabled=False, 只影响重启恢复)
    - score = 1 - cosine_distance, 与余弦相似度同尺度
    """

    def __init__(self, path: str):
        self._client: Any = None
        self._initialized = False

        if not path:
            return

        try:
            import chromadb

            self._client = chromadb.PersistentClient(path=path)
            self._initialized = True
            print(f"[chroma] 知识库向量持久化已启用: {path}")
        except Exception as e:
            print(f"[chroma] 初始化失败，降级为纯内存模式: {e}")
            self._client = None
            self._initialized = False

    @property
    def is_enabled(self) -> bool:
        return self._initialized and self._client is not None

    # ─── Collection 管理 ────────────────────────────────

    def _collection(self, dims: int) -> Any:
        """按维度获取 (或创建) collection — cosine 空间"""
        return self._client.get_or_create_collection(
            name=f"{COLLECTION_PREFIX}{dims}",
            metadata={"hnsw:space": "cosine"},
        )

    def _all_collections(self) -> list[Any]:
        """列出所有 kb_chunks_d* collection (跨维度遍历用)"""
        if not self.is_enabled:
            return []
        out: list[Any] = []
        try:
            for col in self._client.list_collections():
                name = col.name if hasattr(col, "name") else str(col)
                if name.startswith(COLLECTION_PREFIX):
                    out.append(self._client.get_or_create_collection(name=name))
        except Exception as e:
            print(f"[chroma] list_collections 失败: {e}")
        return out

    # ─── 写入 ───────────────────────────────────────────

    def save_chunks(self, namespace: str, chunks: list[dict[str, Any]]) -> None:
        """
        批量 upsert 分块 (含向量)。

        只写入带 embedding 的分块 (无向量的降级分块留在内存, 不落盘);
        按 embedding 维度分组写入对应 collection。
        """
        if not self.is_enabled or not chunks:
            return

        by_dims: dict[int, list[dict[str, Any]]] = {}
        for c in chunks:
            emb = c.get("embedding")
            if not emb:
                continue
            by_dims.setdefault(len(emb), []).append(c)

        for dims, group in by_dims.items():
            try:
                col = self._collection(dims)
                col.upsert(
                    ids=[c["chunk_id"] for c in group],
                    embeddings=[c["embedding"] for c in group],
                    documents=[c.get("text", "") for c in group],
                    metadatas=[
                        {
                            "namespace": namespace,
                            "doc_id": c.get("doc_id", ""),
                            "chunk_index": int(c.get("chunk_index", 0)),
                            "created_at": float(c.get("created_at", 0.0)),
                        }
                        for c in group
                    ],
                )
            except Exception as e:
                print(f"[chroma] save_chunks 失败 (dims={dims}, n={len(group)}): {e}")

    # ─── 读取 ───────────────────────────────────────────

    def load_chunks(self, namespace: str) -> list[dict[str, Any]]:
        """加载 namespace 下所有分块 (跨所有维度 collection, 含向量)"""
        if not self.is_enabled:
            return []

        out: list[dict[str, Any]] = []
        for col in self._all_collections():
            try:
                got = col.get(
                    where={"namespace": namespace},
                    include=["documents", "metadatas", "embeddings"],
                )
            except Exception as e:
                print(f"[chroma] load_chunks 失败 ({col.name if hasattr(col, 'name') else '?'}): {e}")
                continue

            ids = got.get("ids") or []
            docs = got.get("documents") or []
            metas = got.get("metadatas") or []
            embs_raw = got.get("embeddings")
            # numpy (n, d) → list[list[float]]; 其他情形统一转 list
            if embs_raw is None:
                embs: list[Any] = []
            elif hasattr(embs_raw, "tolist"):
                embs = embs_raw.tolist()
            else:
                embs = list(embs_raw)

            for i, cid in enumerate(ids):
                meta = metas[i] if i < len(metas) else {}
                emb = embs[i] if i < len(embs) else None
                out.append({
                    "chunk_id": cid,
                    "doc_id": meta.get("doc_id", ""),
                    "chunk_index": int(meta.get("chunk_index", 0)),
                    "text": docs[i] if i < len(docs) else "",
                    "embedding": list(emb) if emb is not None else None,
                    "created_at": float(meta.get("created_at", 0.0)),
                })
        return out

    # ─── 删除 ───────────────────────────────────────────

    def delete_chunks(self, namespace: str, doc_id: str | None = None) -> None:
        """删除 namespace 下 (可选限定 doc_id) 的所有分块, 跨所有维度 collection"""
        if not self.is_enabled:
            return

        for col in self._all_collections():
            try:
                if doc_id:
                    col.delete(where={"$and": [
                        {"namespace": namespace},
                        {"doc_id": doc_id},
                    ]})
                else:
                    col.delete(where={"namespace": namespace})
            except Exception as e:
                print(f"[chroma] delete_chunks 失败: {e}")

    # ─── 相似度查询 ─────────────────────────────────────

    def query(
        self,
        namespace: str,
        query_embedding: list[float],
        limit: int,
    ) -> list[dict[str, Any]]:
        """
        向量相似度查询 (HNSW ANN, cosine 空间)。

        返回 [{chunk_id, doc_id, chunk_index, text, created_at, score}] 按分数降序,
        score = 1 - cosine_distance ∈ [-1, 1], 与余弦相似度同尺度。
        查询维度无对应 collection (模型切换后旧维度) → 空结果。
        """
        if not self.is_enabled or not query_embedding:
            return []

        try:
            col = self._collection(len(query_embedding))
        except Exception as e:
            print(f"[chroma] query 获取 collection 失败: {e}")
            return []

        try:
            # n_results 不能超过 collection 内元素数
            n = max(1, min(limit, col.count()))
            if n == 0:
                return []
            res = col.query(
                query_embeddings=[query_embedding],
                n_results=n,
                where={"namespace": namespace},
                include=["documents", "metadatas", "distances"],
            )
        except Exception as e:
            print(f"[chroma] query 失败: {e}")
            return []

        out: list[dict[str, Any]] = []
        ids = (res.get("ids") or [[]])[0]
        docs = (res.get("documents") or [[]])[0]
        metas = (res.get("metadatas") or [[]])[0]
        dists = (res.get("distances") or [[]])[0]
        for i, cid in enumerate(ids):
            meta = metas[i] if i < len(metas) else {}
            dist = float(dists[i]) if i < len(dists) else 1.0
            out.append({
                "chunk_id": cid,
                "doc_id": meta.get("doc_id", ""),
                "chunk_index": int(meta.get("chunk_index", 0)),
                "text": docs[i] if i < len(docs) else "",
                "created_at": float(meta.get("created_at", 0.0)),
                "score": 1.0 - dist,
            })
        return out


# ─── 全局单例 ──────────────────────────────────────────

_chroma_store: ChromaKBStore | None = None


def get_chroma_store() -> ChromaKBStore:
    global _chroma_store
    if _chroma_store is None:
        _chroma_store = ChromaKBStore(CHROMA_PATH)
    return _chroma_store


def reset_chroma_store() -> None:
    global _chroma_store
    _chroma_store = None
