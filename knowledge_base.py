"""
KnowledgeBase — 知识库向量存储 + 文档分块 + 语义搜索

存储分工:
- Chroma (chroma_store.py): 分块文本 + 向量 (HNSW cosine ANN 检索), 落盘 data/chroma
- SQLite (sqlite_store.py): 文档元数据 (kb_documents) + namespace embedding 模型标识

隔离:
- namespace = kb:{session_id}
- 每个工作区（公司）有独立的知识库

设计要点:
- 文档分块: 按字符数滑窗切割 (chunk_size=500, overlap=50)
- 向量化: embedding.py 批量转向量 (hash 模式默认, 零 API key)
- 搜索: 混合检索 = Chroma 向量召回 (HNSW ANN)
        + 关键词召回 (中英分词重合度) 加权融合, 补足纯向量在中文场景的漏召
- 持久化: 内存缓存 + Write-Through (Chroma 向量 / SQLite 元数据)
- 降级: embedding 未配置时静默返回空结果
"""

from __future__ import annotations

import re
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

from embedding import (
    embed_documents,
    embed_query,
    is_embedding_configured,
    get_embedding_model_id,
)
from sqlite_store import SQLitePersistence
from chroma_store import ChromaKBStore


# ─── 常量 ──────────────────────────────────────────────

DEFAULT_CHUNK_SIZE = 500        # 每块最大字符数
DEFAULT_CHUNK_OVERLAP = 50      # 滑窗重叠字符数
MAX_SEARCH_RESULTS = 5          # 搜索返回上限
HYBRID_ALPHA = 0.65             # 混合检索: 向量分权重 (关键词权重 = 1 - alpha)
KEYWORD_CANDIDATE_SCORE = 0.30  # 关键词候选门槛 (补召回向量漏掉的强匹配块)
FUSED_THRESHOLD = 0.15          # 融合分最终门控 (加权融合天然低于单路分, 独立设定)
MAX_INJECT_RESULTS = 3          # 注入模型上下文的上限
MAX_INJECT_CHARS = 500          # 单条注入文本上限


# ─── 数据结构 ──────────────────────────────────────────

@dataclass
class KnowledgeChunk:
    """文档分块"""
    chunk_id: str
    doc_id: str
    chunk_index: int
    text: str
    embedding: list[float] | None = None
    created_at: float = field(default_factory=time.time)

    def to_dict(self) -> dict[str, Any]:
        return {
            "chunk_id": self.chunk_id,
            "doc_id": self.doc_id,
            "chunk_index": self.chunk_index,
            "text": self.text,
            "embedding": self.embedding,
            "created_at": self.created_at,
        }


@dataclass
class KnowledgeDocument:
    """文档元数据"""
    doc_id: str
    title: str
    source_type: str        # text / pdf / markdown / url
    source_path: str
    chunk_count: int = 0
    char_count: int = 0
    created_at: float = field(default_factory=time.time)

    def to_dto(self) -> dict[str, Any]:
        return {
            "doc_id": self.doc_id,
            "title": self.title,
            "source_type": self.source_type,
            "source_path": self.source_path,
            "chunk_count": self.chunk_count,
            "char_count": self.char_count,
            "created_at": self.created_at,
        }

    def to_api(self) -> dict[str, Any]:
        """前端 API 格式 (camelCase)"""
        return {
            "docId": self.doc_id,
            "title": self.title,
            "sourceType": self.source_type,
            "sourcePath": self.source_path,
            "chunkCount": self.chunk_count,
            "charCount": self.char_count,
            "createdAt": self.created_at,
        }


@dataclass
class KnowledgeSearchResult:
    """搜索结果"""
    chunk: KnowledgeChunk
    score: float
    doc_title: str = ""


class KnowledgeBaseStore:
    """
    知识库存储 — 服务端单例。

    - 按 namespace（kb:{session_id}）隔离
    - 文档分块后批量向量化
    - 向量搜索: Chroma HNSW cosine ANN (score = 1 - distance)
    - 关键词召回: 内存 token 缓存, 中英分词重合度
    - 持久化: 内存缓存 + Write-Through (Chroma 向量 / SQLite 元数据)
    - 服务重启后自动从持久层恢复
    """

    def __init__(
        self,
        persistence: SQLitePersistence | None = None,
        chroma: ChromaKBStore | None = None,
    ):
        # namespace -> { chunk_id -> KnowledgeChunk }
        self._namespaces: dict[str, dict[str, KnowledgeChunk]] = {}
        # namespace -> { doc_id -> KnowledgeDocument }
        self._docs: dict[str, dict[str, KnowledgeDocument]] = {}
        self._persistence = persistence
        self._chroma = chroma
        self._loaded_namespaces: set[str] = set()
        # namespace -> 入库时使用的 embedding 模型标识 (模型切换 → 自动重嵌入迁移)
        self._ns_embedding_model: dict[str, str | None] = {}
        # chunk_id -> 关键词 token 集合 (混合检索用, 分块文本不变可安全复用)
        self._token_cache: dict[str, set[str]] = {}

    # ─── Namespace 模型标识追踪 ────────────────────────

    def _get_namespace_model_id(self, namespace: str) -> str:
        """读取 namespace 入库时的 embedding 模型标识 ('' = 未知/旧数据)"""
        mid = self._ns_embedding_model.get(namespace)
        if mid is not None:
            return mid
        stored = ""
        if self._persistence and self._persistence.is_enabled:
            stored = self._persistence.get_kb_namespace_meta(namespace)
        self._ns_embedding_model[namespace] = stored
        return stored

    def _set_namespace_model_id(self, namespace: str, model_id: str) -> None:
        """记录 namespace 当前使用的 embedding 模型标识"""
        self._ns_embedding_model[namespace] = model_id
        if self._persistence and self._persistence.is_enabled:
            self._persistence.save_kb_namespace_meta(namespace, model_id)

    async def _ensure_namespace_embeddings(self, namespace: str) -> None:
        """
        模型漂移迁移: namespace 元数据里的模型 != 当前模型 → 用存储的 chunk 原文
        整体重嵌入 (Chroma 里存有原文, 无需重新上传文档), 并更新元数据。

        - embedding 未配置: 跳过 (等配置后再迁移)
        - 重嵌入失败: 保留旧元数据, 下次检索重试
        - 维度变更 (hash 512 → api 1024): 新向量写入新维度 collection,
          迁移成功后删除旧维度记录
        """
        if not is_embedding_configured():
            return
        current = get_embedding_model_id()
        stored = self._get_namespace_model_id(namespace)
        if stored == current:
            return

        ns = self._get_chunks_namespace(namespace)
        targets = [c for c in ns.values() if c.text]
        if not targets:
            self._set_namespace_model_id(namespace, current)
            return

        print(
            f"[knowledge-base] embedding 模型变更 ({stored or '未知'} → {current}), "
            f"开始重嵌入 {len(targets)} 个分块 (namespace={namespace[:20]}...)"
        )
        try:
            vectors = await embed_documents([c.text for c in targets])
        except Exception as e:
            print(f"[knowledge-base] 重嵌入失败 (下次检索重试): {e}")
            return

        for chunk, vec in zip(targets, vectors):
            chunk.embedding = vec

        # 落盘: 先清旧维度记录, 再整体写入当前模型维度
        if self._chroma and self._chroma.is_enabled:
            self._chroma.delete_chunks(namespace)
            self._chroma.save_chunks(namespace, [c.to_dict() for c in targets])

        self._set_namespace_model_id(namespace, current)
        print(f"[knowledge-base] 重嵌入完成: {len(targets)} 个分块已迁移到 {current}")

    # ─── 内存缓存 (惰性 DB 恢复) ───────────────────────

    def _get_chunks_namespace(self, namespace: str) -> dict[str, KnowledgeChunk]:
        if namespace not in self._namespaces:
            self._namespaces[namespace] = {}
            self._load_namespace_from_db(namespace)
        return self._namespaces[namespace]

    def _get_docs_namespace(self, namespace: str) -> dict[str, KnowledgeDocument]:
        if namespace not in self._docs:
            self._docs[namespace] = {}
        return self._docs[namespace]

    def _load_namespace_from_db(self, namespace: str) -> None:
        """从 Chroma + SQLite 加载 namespace 下的所有分块和文档"""
        if namespace in self._loaded_namespaces:
            return
        self._loaded_namespaces.add(namespace)

        try:
            # 加载分块 (Chroma, 含向量)
            chunk_list: list[dict[str, Any]] = []
            if self._chroma and self._chroma.is_enabled:
                chunk_list = self._chroma.load_chunks(namespace)
            ns = self._namespaces.setdefault(namespace, {})
            for stored in chunk_list:
                chunk = KnowledgeChunk(
                    chunk_id=stored["chunk_id"],
                    doc_id=stored["doc_id"],
                    chunk_index=stored["chunk_index"],
                    text=stored["text"],
                    embedding=stored.get("embedding"),
                    created_at=stored.get("created_at", time.time()),
                )
                ns[chunk.chunk_id] = chunk

            # 加载文档元数据 (SQLite)
            doc_list: list[dict[str, Any]] = []
            if self._persistence and self._persistence.is_enabled:
                doc_list = self._persistence.load_kb_documents(namespace)
            docs = self._docs.setdefault(namespace, {})
            for d in doc_list:
                doc = KnowledgeDocument(
                    doc_id=d["doc_id"],
                    title=d["title"],
                    source_type=d["source_type"],
                    source_path=d["source_path"],
                    chunk_count=d["chunk_count"],
                    char_count=d["char_count"],
                    created_at=d["created_at"],
                )
                docs[doc.doc_id] = doc

            if chunk_list or doc_list:
                print(f"[knowledge-base] 从持久层恢复 {len(doc_list)} 个文档, "
                      f"{len(chunk_list)} 个分块 (namespace={namespace[:20]}...)")
        except Exception as e:
            print(f"[knowledge-base] 从持久层恢复失败: {e}")

    # ─── 关键词检索 (混合召回用) ──────────────────────

    @staticmethod
    def _tokenize(text: str) -> set[str]:
        """中英混合分词: 中文单字 + 双字组, 英文/数字按词 (长度≥2)。"""
        if not text:
            return set()
        tokens: set[str] = set()
        for word in re.findall(r"[a-zA-Z0-9_]+", text.lower()):
            if len(word) >= 2:
                tokens.add(word)
        for seg in re.findall(r"[\u4e00-\u9fff]+", text):
            for i, ch in enumerate(seg):
                tokens.add(ch)
                if i + 1 < len(seg):
                    tokens.add(seg[i:i + 2])
        return tokens

    @staticmethod
    def _keyword_score(query_tokens: set[str], text_tokens: set[str]) -> float:
        """关键词重合度 (0~1): 以 query 覆盖率为主, 文本覆盖率轻微惩罚超长噪声块。"""
        if not query_tokens or not text_tokens:
            return 0.0
        inter = len(query_tokens & text_tokens)
        if inter == 0:
            return 0.0
        q_cov = inter / len(query_tokens)
        t_cov = inter / len(text_tokens)
        return 0.85 * q_cov + 0.15 * t_cov

    def _chunk_tokens(self, chunk: KnowledgeChunk) -> set[str]:
        """获取分块的关键词 token (惰性缓存)"""
        toks = self._token_cache.get(chunk.chunk_id)
        if toks is None:
            toks = self._tokenize(chunk.text)
            self._token_cache[chunk.chunk_id] = toks
        return toks

    @staticmethod
    def _split_sentences(text: str) -> list[str]:
        """按中英文句末标点和换行切句, 标点保留在前一句末尾。"""
        if not text:
            return []
        parts = re.split(r"(?<=[。！？；!?;\n])", text)
        return [p for p in parts if p]

    # ─── 文档分块 ─────────────────────────────────────

    @staticmethod
    def chunk_text(
        text: str,
        chunk_size: int = DEFAULT_CHUNK_SIZE,
        overlap: int = DEFAULT_CHUNK_OVERLAP,
    ) -> list[str]:
        """
        文本分块: 按字符数滑窗切割。

        - 尽量在句子边界（句号、换行）处切割
        - 滑窗重叠保证上下文连续性
        """
        if not text or not text.strip():
            return []

        overlap = max(0, min(overlap, chunk_size // 2))
        chunks: list[str] = []
        current = ""

        # 段落 → 句子逐级下探, 尽量在句子边界收口
        for para in text.split("\n\n"):
            units = KnowledgeBaseStore._split_sentences(para) or [para]
            for unit in units:
                # 单句仍超长: 先收口当前块, 再对该句硬切 (带重叠)
                if len(unit) > chunk_size:
                    if current:
                        chunks.append(current.strip())
                        current = ""
                    start = 0
                    while start < len(unit):
                        end = start + chunk_size
                        chunks.append(unit[start:end].strip())
                        if end >= len(unit):
                            break
                        start = end - overlap
                    continue

                if not current:
                    current = unit
                elif len(current) + len(unit) <= chunk_size:
                    current += unit
                else:
                    chunks.append(current.strip())
                    # 重叠: 从上一块末尾截取, 保持上下文连续
                    tail = current[-overlap:] if overlap else ""
                    current = (tail + unit).strip() if tail else unit

        if current.strip():
            chunks.append(current.strip())

        result = [c for c in chunks if c]
        return result if result else [text[:chunk_size]]

    # ─── 添加文档 ─────────────────────────────────────

    async def add_document(
        self,
        namespace: str,
        title: str,
        source_type: str,
        text: str,
        source_path: str = "",
        chunk_size: int = DEFAULT_CHUNK_SIZE,
        overlap: int = DEFAULT_CHUNK_OVERLAP,
    ) -> KnowledgeDocument:
        """
        添加文档: 分块 → 向量化 → 存储。

        返回: KnowledgeDocument 元数据
        """
        if not text or not text.strip():
            raise ValueError("文档内容不能为空")

        # 1. 分块
        chunks_text = self.chunk_text(text, chunk_size, overlap)
        if not chunks_text:
            raise ValueError("分块后无有效内容")

        # 2. 检查 embedding 是否可用; 先做模型漂移迁移 (旧分块 → 当前模型), 再入新块
        if not is_embedding_configured():
            # embedding 未配置: 只存文本，不向量化
            embeddings: list[list[float] | None] = [None] * len(chunks_text)
            print(f"[knowledge-base] embedding 未配置，仅存储文本 (chunks={len(chunks_text)})")
        else:
            await self._ensure_namespace_embeddings(namespace)
            # 3. 批量向量化
            try:
                embeddings = await embed_documents(chunks_text)
            except Exception as e:
                # 向量化失败: 降级为仅存储文本（仍可后续搜索时用关键词匹配）
                print(f"[knowledge-base] 向量化失败，降级为仅存储文本: {e}")
                embeddings = [None] * len(chunks_text)

        # 4. 生成文档元数据
        doc_id = f"doc_{uuid.uuid4().hex[:12]}"
        total_chars = len(text)
        doc = KnowledgeDocument(
            doc_id=doc_id,
            title=title or "未命名文档",
            source_type=source_type,
            source_path=source_path,
            chunk_count=len(chunks_text),
            char_count=total_chars,
        )

        # 5. 存储分块 (内存 + Chroma 批量落盘)
        ns = self._get_chunks_namespace(namespace)
        docs = self._get_docs_namespace(namespace)

        new_chunks: list[KnowledgeChunk] = []
        for i, (chunk_text_val, emb) in enumerate(zip(chunks_text, embeddings)):
            chunk_id = f"chunk_{doc_id}_{i}"
            chunk = KnowledgeChunk(
                chunk_id=chunk_id,
                doc_id=doc_id,
                chunk_index=i,
                text=chunk_text_val,
                embedding=emb,
            )
            ns[chunk_id] = chunk
            new_chunks.append(chunk)

        if self._chroma and self._chroma.is_enabled:
            # 无向量的降级分块不落盘 (Chroma 必须带向量), 仅内存保留
            self._chroma.save_chunks(namespace, [c.to_dict() for c in new_chunks])

        # 6. 存储文档元数据 (内存 + SQLite)
        docs[doc_id] = doc
        if self._persistence and self._persistence.is_enabled:
            self._persistence.save_kb_document(namespace, doc.to_dto())

        print(f"[knowledge-base] 文档已添加: '{doc.title}' ({len(chunks_text)} 块, "
              f"{total_chars} 字, namespace={namespace[:20]}...)")
        # 新块全部带向量时才记录当前模型 (有降级块时保持旧元数据, 让下次检索重试迁移)
        if is_embedding_configured() and embeddings and all(embeddings):
            self._set_namespace_model_id(namespace, get_embedding_model_id())
        return doc

    # ─── 语义搜索 ─────────────────────────────────────

    async def search(
        self,
        namespace: str,
        query: str,
        limit: int = MAX_SEARCH_RESULTS,
    ) -> list[KnowledgeSearchResult]:
        """
        混合语义搜索: 向量召回 + 关键词召回加权融合。

        - 向量召回: Chroma HNSW cosine ANN (score = 1 - distance)
        - 关键词召回: 与 query 有强词面重合的分块 (补足纯向量在中文场景的漏召)
        - 两路候选按 HYBRID_ALPHA 加权融合, 融合分 >= FUSED_THRESHOLD 才返回
        - embedding 不可用或失败时自动降级为纯关键词检索
        """
        if not query or not query.strip():
            return []

        ns = self._get_chunks_namespace(namespace)
        if not ns:
            return []

        docs = self._get_docs_namespace(namespace)
        vector_scores: dict[str, float] = {}

        # ── 路线 1: 向量召回 (Chroma ANN) ──
        if is_embedding_configured():
            try:
                query_embedding = await embed_query(query)
            except Exception as e:
                print(f"[knowledge-base] embed_query 失败, 降级为纯关键词检索: {e}")
                query_embedding = None

            if query_embedding is not None:
                # 模型漂移检测: embedding 模型变更 → 先迁移旧分块再检索
                await self._ensure_namespace_embeddings(namespace)
                if self._chroma and self._chroma.is_enabled:
                    # 候选池放宽, 给融合排序留余量
                    pool = max(limit * 4, 20)
                    hits = self._chroma.query(namespace, query_embedding, pool)
                    for hit in hits:
                        # 以内存中的 chunk 为准 (文本/归属一致), 只取 Chroma 的分数
                        vector_scores[hit["chunk_id"]] = hit["score"]

        # ── 路线 2: 关键词召回 ──
        query_tokens = self._tokenize(query)
        keyword_scores: dict[str, float] = {}
        for chunk in ns.values():
            if not chunk.text:
                continue
            ks = self._keyword_score(query_tokens, self._chunk_tokens(chunk))
            if ks >= KEYWORD_CANDIDATE_SCORE:
                keyword_scores[chunk.chunk_id] = ks

        # ── 融合排序 ──
        # 按 namespace 插入顺序遍历候选: 同分时顺序稳定可复现 (set 遍历顺序随机)
        candidate_ids = set(vector_scores) | set(keyword_scores)
        fused: list[tuple[KnowledgeChunk, float]] = []
        for cid, chunk in ns.items():
            if cid not in candidate_ids:
                continue
            fused_score = (
                HYBRID_ALPHA * vector_scores.get(cid, 0.0)
                + (1.0 - HYBRID_ALPHA) * keyword_scores.get(cid, 0.0)
            )
            if fused_score >= FUSED_THRESHOLD:
                fused.append((chunk, fused_score))

        # 稳定排序: 同分保留 namespace 插入顺序
        fused.sort(key=lambda pair: pair[1], reverse=True)
        results: list[KnowledgeSearchResult] = []
        for chunk, score in fused[:limit]:
            doc = docs.get(chunk.doc_id)
            results.append(KnowledgeSearchResult(
                chunk=chunk,
                score=score,
                doc_title=doc.title if doc else "",
            ))
        return results

    # ─── 列出文档 ─────────────────────────────────────

    def list_documents(self, namespace: str) -> list[KnowledgeDocument]:
        """列出 namespace 下所有文档"""
        docs = self._get_docs_namespace(namespace)
        return sorted(docs.values(), key=lambda d: d.created_at, reverse=True)

    def list_all_documents(self) -> list[tuple[str, KnowledgeDocument]]:
        """列出所有 namespace 下的所有文档

        返回: [(namespace, document), ...] 按 created_at 降序
        用于知识库管理页面跨工作区展示全部文档。
        """
        result: list[tuple[str, KnowledgeDocument]] = []
        # 触发所有 namespace 从 DB 加载
        if self._persistence and self._persistence.is_enabled:
            all_ns = self._persistence.list_kb_namespaces()
            for ns in all_ns:
                self._get_chunks_namespace(ns)  # 触发加载
                self._get_docs_namespace(ns)
        for ns, docs in self._docs.items():
            for doc in docs.values():
                result.append((ns, doc))
        result.sort(key=lambda x: x[1].created_at, reverse=True)
        return result

    # ─── 获取文档分块内容 ─────────────────────────────

    def get_document_chunks(self, namespace: str, doc_id: str) -> list[KnowledgeChunk]:
        """获取指定文档的所有分块（按 chunk_index 排序）"""
        ns = self._get_chunks_namespace(namespace)
        chunks = [c for c in ns.values() if c.doc_id == doc_id]
        chunks.sort(key=lambda c: c.chunk_index)
        return chunks

    def get_document_chunks_cross_ns(self, doc_id: str) -> list[KnowledgeChunk]:
        """跨 namespace 获取文档分块（用于管理页面按 doc_id 查看）"""
        # 先从 SQLite 查找 doc_id 所在的 namespace
        if self._persistence and self._persistence.is_enabled:
            ns = self._persistence.find_kb_namespace_by_doc(doc_id)
            if ns:
                return self.get_document_chunks(ns, doc_id)
        # 降级: 遍历内存中所有 namespace
        for ns in self._namespaces:
            chunks = self.get_document_chunks(ns, doc_id)
            if chunks:
                return chunks
        return []

    def delete_document_cross_ns(self, doc_id: str) -> bool:
        """跨 namespace 删除文档"""
        # 先从 SQLite 查找 doc_id 所在的 namespace
        if self._persistence and self._persistence.is_enabled:
            ns = self._persistence.find_kb_namespace_by_doc(doc_id)
            if ns:
                return self.delete_document(ns, doc_id)
        # 降级: 遍历内存
        for ns in list(self._docs.keys()):
            if self.delete_document(ns, doc_id):
                return True
        return False

    # ─── 删除文档 ─────────────────────────────────────

    def delete_document(self, namespace: str, doc_id: str) -> bool:
        """删除文档及其所有分块"""
        ns = self._get_chunks_namespace(namespace)
        docs = self._get_docs_namespace(namespace)

        if doc_id not in docs:
            return False

        # 删除分块
        to_remove = [cid for cid, chunk in ns.items() if chunk.doc_id == doc_id]
        for cid in to_remove:
            del ns[cid]
            self._token_cache.pop(cid, None)

        # 删除文档元数据
        del docs[doc_id]

        # 持久化删除
        if self._chroma and self._chroma.is_enabled:
            self._chroma.delete_chunks(namespace, doc_id)
        if self._persistence and self._persistence.is_enabled:
            self._persistence.delete_kb_document(namespace, doc_id)

        print(f"[knowledge-base] 文档已删除: {doc_id} (namespace={namespace[:20]}...)")
        return True

    # ─── 统计 ─────────────────────────────────────────

    def get_stats(self, namespace: str) -> dict[str, int]:
        """获取知识库统计"""
        ns = self._get_chunks_namespace(namespace)
        docs = self._get_docs_namespace(namespace)
        return {
            "documents": len(docs),
            "chunks": len(ns),
        }


# ─── 全局单例 ──────────────────────────────────────────

from sqlite_store import get_persistence
from chroma_store import get_chroma_store

kb_store = KnowledgeBaseStore(
    persistence=get_persistence(),
    chroma=get_chroma_store(),
)


# ─── Namespace 工具 ────────────────────────────────────

def get_kb_namespace(session_id: str) -> str:
    """
    根据 session_id 生成知识库 namespace。

    结构: kb:{session_id}
    """
    return f"kb:{session_id}"
