"""知识库 API - 文档上传、预览、搜索、受控问答、统计、录入"""
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
import os
import re

from knowledge_base import kb_store, get_kb_namespace

router = APIRouter(prefix="/api/kb", tags=["知识库"])


async def _fetch_url_text(url: str) -> str:
    """抓取 URL 并抽取纯文本 (PDF 走 pypdf, HTML 去标签), 供 upload/ingest 共用。"""
    import tempfile

    import httpx

    async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
        resp = await client.get(url, headers={"User-Agent": "Mozilla/5.0"})
    if resp.status_code != 200:
        raise RuntimeError(f"HTTP {resp.status_code}")

    if url.lower().endswith(".pdf"):
        fd, tmp_path = tempfile.mkstemp(suffix=".pdf")
        try:
            with os.fdopen(fd, "wb") as f:
                f.write(resp.content)
            from pypdf import PdfReader

            reader = PdfReader(tmp_path)
            return "\n\n".join(page.extract_text() or "" for page in reader.pages)
        finally:
            os.remove(tmp_path)

    raw = resp.text
    raw = re.sub(r"<script[^>]*>[\s\S]*?</script>", "", raw, flags=re.IGNORECASE)
    raw = re.sub(r"<style[^>]*>[\s\S]*?</style>", "", raw, flags=re.IGNORECASE)
    raw = re.sub(r"<[^>]+>", "", raw)
    return re.sub(r"\s+", " ", raw).strip()


def _kb_extract_text_from_bytes(file_name: str, data: bytes) -> tuple[str, str, int]:
    """按扩展名从字节内容抽取纯文本。返回 (text, source_type, page_count)。"""
    import io

    lower = (file_name or "").lower()

    if lower.endswith(".pdf"):
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(data))
        pages = [p.extract_text() or "" for p in reader.pages]
        return "\n\n".join(pages), "pdf", len(reader.pages)

    if lower.endswith(".docx"):
        # docx 本质是 zip: 直接读 word/document.xml 去标签, 免装 python-docx
        import html as _html
        import zipfile
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            xml = zf.read("word/document.xml").decode("utf-8", errors="ignore")
        xml = re.sub(r"</w:p>", "\n", xml)
        xml = re.sub(r"<w:tab[^>]*/>", "\t", xml)
        xml = re.sub(r"<w:br[^>]*/>", "\n", xml)
        xml = re.sub(r"<w:t[^>]*>", "", xml)
        text = re.sub(r"<[^>]+>", "", xml)
        return _html.unescape(text).strip(), "docx", 1

    if lower.endswith((".xlsx", ".xlsm")):
        import openpyxl
        wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
        lines: list[str] = []
        try:
            for ws in wb.worksheets:
                lines.append(f"# Sheet: {ws.title}")
                for row in ws.iter_rows(values_only=True):
                    cells = [str(c) for c in row if c is not None]
                    if cells:
                        lines.append("\t".join(cells))
            sheet_count = len(wb.worksheets)
        finally:
            try:
                wb.close()
            except Exception:
                pass
        return "\n".join(lines), "xlsx", sheet_count

    if lower.endswith((".html", ".htm")):
        raw = data.decode("utf-8", errors="ignore")
        try:
            from bs4 import BeautifulSoup
            soup = BeautifulSoup(raw, "html.parser")
            for tag in soup(["script", "style"]):
                tag.decompose()
            return soup.get_text("\n").strip(), "html", 1
        except Exception:
            raw = re.sub(r"<script[^>]*>[\s\S]*?</script>", "", raw, flags=re.IGNORECASE)
            raw = re.sub(r"<style[^>]*>[\s\S]*?</style>", "", raw, flags=re.IGNORECASE)
            raw = re.sub(r"<[^>]+>", "", raw)
            return re.sub(r"\s+", " ", raw).strip(), "html", 1

    if lower.endswith(".md"):
        kind = "markdown"
    elif lower.endswith((".csv", ".json", ".log", ".txt", ".py", ".yaml", ".yml")):
        kind = "text"
    else:
        kind = "text"

    for enc in ("utf-8-sig", "utf-8", "gbk", "latin-1"):
        try:
            return data.decode(enc).strip(), kind, 1
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="ignore").strip(), kind, 1


@router.post("/upload")
async def kb_upload(request: Request):
    """上传文档到知识库"""
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "请求解析失败"}, status_code=400)

    session_id = body.get("sessionId", "")
    if not session_id:
        return JSONResponse({"error": "sessionId 必填"}, status_code=400)

    namespace = get_kb_namespace(session_id)
    title = body.get("title", "未命名文档")
    source_type = "text"
    source_path = ""
    text = ""

    if body.get("text"):
        text = body["text"]
        source_type = "text"
    elif body.get("filePath"):
        file_path = body["filePath"]
        source_path = file_path
        if file_path.lower().endswith(".pdf"):
            source_type = "pdf"
            try:
                from pypdf import PdfReader
                reader = PdfReader(file_path)
                pages = []
                for page in reader.pages:
                    pages.append(page.extract_text() or "")
                text = "\n\n".join(pages)
            except Exception as e:
                return JSONResponse({"error": f"PDF 解析失败: {e}"}, status_code=500)
        else:
            source_type = "markdown"
            try:
                with open(file_path, "r", encoding="utf-8") as f:
                    text = f.read()
            except Exception as e:
                return JSONResponse({"error": f"文件读取失败: {e}"}, status_code=500)
    elif body.get("url"):
        url = body["url"]
        source_path = url
        source_type = "url"
        try:
            text = await _fetch_url_text(url)
        except Exception as e:
            return JSONResponse({"error": f"URL 抓取失败: {e}"}, status_code=500)
        if url.lower().endswith(".pdf"):
            source_type = "pdf"
    else:
        return JSONResponse({"error": "需要提供 text / filePath / url 之一"}, status_code=400)

    if not text or not text.strip():
        return JSONResponse({"error": "文档内容为空"}, status_code=400)

    max_chars = 100000
    if len(text) > max_chars:
        text = text[:max_chars]
        print(f"[knowledge-base] 文档超长，截断到 {max_chars} 字")

    try:
        doc = await kb_store.add_document(
            namespace=namespace,
            title=title,
            source_type=source_type,
            text=text,
            source_path=source_path,
        )
        return {"ok": True, "document": doc.to_api()}
    except Exception as e:
        return JSONResponse({"error": f"文档处理失败: {e}"}, status_code=500)


@router.post("/preview")
async def kb_preview(request: Request):
    """预览文档文字 (只解析不入库)

    请求体任选其一:
      {"text": "..."}
      {"filePath": "c:\\docs\\manual.pdf"}
      {"url": "https://example.com/doc.pdf"}
      {"fileName": "a.pdf", "fileBase64": "data:application/pdf;base64,..."}
    """
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "请求解析失败"}, status_code=400)

    text = ""
    source_type = "text"
    page_count = 0

    try:
        if body.get("text"):
            text = body["text"]
            source_type = "text"
        elif body.get("fileBase64"):
            import base64
            file_name = body.get("fileName", "upload.txt")
            raw_b64 = body["fileBase64"]
            if "," in raw_b64:
                raw_b64 = raw_b64.split(",", 1)[1]
            data = base64.b64decode(raw_b64)
            text, source_type, page_count = _kb_extract_text_from_bytes(file_name, data)
        elif body.get("filePath"):
            file_path = body["filePath"]
            if not os.path.isfile(file_path):
                return JSONResponse({"error": f"文件不存在: {file_path}"}, status_code=400)
            with open(file_path, "rb") as f:
                data = f.read()
            text, source_type, page_count = _kb_extract_text_from_bytes(file_path, data)
        elif body.get("url"):
            import httpx
            url = body["url"]
            async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
                resp = await client.get(url, headers={"User-Agent": "Mozilla/5.0"})
            if resp.status_code != 200:
                return JSONResponse({"error": f"URL 请求失败: HTTP {resp.status_code}"}, status_code=500)
            name = url.split("?", 1)[0]
            text, source_type, page_count = _kb_extract_text_from_bytes(name, resp.content)
        else:
            return JSONResponse(
                {"error": "需要提供 text / filePath / url / fileBase64 之一"}, status_code=400
            )
    except Exception as e:
        return JSONResponse({"error": f"解析失败: {e}"}, status_code=500)

    if not text or not text.strip():
        return JSONResponse(
            {"error": "未提取到文字内容 (可能是扫描版图片文件, 需 OCR)"}, status_code=422
        )

    truncated = False
    if len(text) > 200000:
        text = text[:200000]
        truncated = True

    return {
        "ok": True,
        "sourceType": source_type,
        "pageCount": page_count,
        "charCount": len(text),
        "truncated": truncated,
        "text": text,
    }


@router.get("/documents")
async def kb_list_documents(session_id: str = ""):
    """列出知识库文档"""
    if session_id:
        namespace = get_kb_namespace(session_id)
        docs = kb_store.list_documents(namespace)
        return {
            "documents": [d.to_api() for d in docs],
            "count": len(docs),
        }
    else:
        all_docs = kb_store.list_all_documents()
        return {
            "documents": [
                {**doc.to_api(), "namespace": ns}
                for ns, doc in all_docs
            ],
            "count": len(all_docs),
        }


@router.get("/documents/{doc_id}/chunks")
async def kb_get_document_chunks(doc_id: str, session_id: str = ""):
    """获取文档的所有分块内容"""
    if session_id:
        namespace = get_kb_namespace(session_id)
        chunks = kb_store.get_document_chunks(namespace, doc_id)
    else:
        chunks = kb_store.get_document_chunks_cross_ns(doc_id)
    if not chunks:
        return JSONResponse({"error": "文档不存在或无内容"}, status_code=404)
    return {
        "docId": doc_id,
        "chunks": [
            {
                "chunkIndex": c.chunk_index,
                "text": c.text,
            }
            for c in chunks
        ],
        "count": len(chunks),
    }


@router.delete("/documents/{doc_id}")
async def kb_delete_document(doc_id: str, session_id: str = ""):
    """删除知识库文档及其所有分块"""
    if session_id:
        namespace = get_kb_namespace(session_id)
        deleted = kb_store.delete_document(namespace, doc_id)
    else:
        deleted = kb_store.delete_document_cross_ns(doc_id)
    return {"ok": deleted}


@router.post("/search")
async def kb_search(request: Request):
    """搜索知识库（调试用）"""
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "请求解析失败"}, status_code=400)

    session_id = body.get("sessionId", "")
    query = body.get("query", "")
    if not session_id or not query:
        return JSONResponse({"error": "sessionId 和 query 必填"}, status_code=400)

    namespace = get_kb_namespace(session_id)
    results = await kb_store.search(namespace, query, limit=5)
    return {
        "results": [
            {
                "docId": r.chunk.doc_id,
                "docTitle": r.doc_title,
                "chunkIndex": r.chunk.chunk_index,
                "text": r.chunk.text[:300],
                "score": round(r.score, 4),
            }
            for r in results
        ],
        "count": len(results),
    }


@router.get("/stats")
async def kb_stats(session_id: str = ""):
    """知识库统计"""
    if not session_id:
        return JSONResponse({"error": "session_id 必填"}, status_code=400)
    namespace = get_kb_namespace(session_id)
    stats = kb_store.get_stats(namespace)
    return {"sessionId": session_id, **stats}


@router.post("/ingest")
async def kb_ingest(request: Request):
    """知识库录入接口 — 供外部系统/门户页调用"""
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "请求解析失败"}, status_code=400)

    session_id = body.get("key", "") or body.get("sessionId", "")
    if not session_id:
        return JSONResponse({"error": "key (知识库密钥) 必填"}, status_code=400)

    title = body.get("title", "未命名文档")
    namespace = get_kb_namespace(session_id)

    if body.get("text"):
        text = body["text"]
        source_type = "text"
        source_path = ""
    elif body.get("url"):
        url = body["url"]
        source_path = url
        source_type = "url"
        try:
            text = await _fetch_url_text(url)
        except Exception as e:
            return JSONResponse({"error": f"URL 抓取失败: {e}"}, status_code=500)
        if url.lower().endswith(".pdf"):
            source_type = "pdf"
    else:
        return JSONResponse({"error": "需要提供 text 或 url"}, status_code=400)

    if not text or not text.strip():
        return JSONResponse({"error": "文档内容为空"}, status_code=400)

    max_chars = 100000
    if len(text) > max_chars:
        text = text[:max_chars]

    try:
        doc = await kb_store.add_document(
            namespace=namespace,
            title=title,
            source_type=source_type,
            text=text,
            source_path=source_path,
        )
        return {"ok": True, "document": doc.to_api()}
    except Exception as e:
        return JSONResponse({"error": f"录入失败: {e}"}, status_code=500)


@router.post("/ask")
async def kb_ask(request: Request):
    """知识库受控问答 — 只答知识库里有的, 没有就明确说不存在

    请求体:
      {"sessionId": "sess_xxx", "question": "...", "topK": 5}

    响应:
      {
        "answer": "...",
        "grounded": true/false,   # false = 拒答
        "reason": "判定说明",
        "gate": "G1/G2/G3/G4/PASS",
        "topScore": 0.42,
        "citations": [{index, docId, docTitle, chunkIndex, text, score}]
      }
    """
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "请求解析失败"}, status_code=400)

    session_id = body.get("sessionId", "")
    question = body.get("question", "")
    if not session_id:
        return JSONResponse({"error": "sessionId 必填"}, status_code=400)
    if not question or not question.strip():
        return JSONResponse({"error": "question 必填"}, status_code=400)

    try:
        top_k = int(body.get("topK", 5))
    except Exception:
        top_k = 5
    top_k = max(1, min(top_k, 20))

    try:
        from kb_qa import answer_from_kb
        result = await answer_from_kb(session_id, question, top_k=top_k)
        return result.to_api()
    except Exception as e:
        return JSONResponse({"error": f"问答失败: {e}"}, status_code=500)
