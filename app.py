"""
Code Assistant - Python 版本
基于 FastAPI + DeepSeek API 的智能代码助手
"""

import os
import json
from typing import Any

from fastapi import FastAPI, Request, UploadFile, File
from fastapi.responses import StreamingResponse, JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from dotenv import load_dotenv

# 加载环境变量
load_dotenv()

# 导入工具注册（触发自动注册）
import tools  # noqa: F401
from chat_service import create_chat_service
from validators import validate_message_text, validate_file
from thread_state import thread_store, session_store

app = FastAPI(title="Code Assistant", version="0.1.0")

# 静态文件 - React 构建产物优先，旧版静态文件作为回退
dist_dir = os.path.join(os.path.dirname(__file__), "static", "dist")
static_dir = os.path.join(os.path.dirname(__file__), "static")

# React 构建产物 (npm run build 后生成)
if os.path.isdir(dist_dir):
    app.mount("/assets", StaticFiles(directory=os.path.join(dist_dir, "assets")), name="react-assets")
# 旧版静态文件 (开发模式回退)
if os.path.isdir(static_dir):
    app.mount("/static", StaticFiles(directory=static_dir), name="static")

chat_service = create_chat_service()


def get_client_ip(request: Request) -> str:
    """获取客户端 IP"""
    forwarded_for = request.headers.get("x-forwarded-for")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()
    real_ip = request.headers.get("x-real-ip")
    if real_ip:
        return real_ip
    ip = request.headers.get("x-client-ip")
    if ip:
        return ip
    return "127.0.0.1"


@app.get("/")
async def index():
    """主页 - 优先返回 React 构建产物，回退到旧版"""
    # React 构建产物
    dist_index = os.path.join(dist_dir, "index.html")
    if os.path.isfile(dist_index):
        return FileResponse(dist_index, headers={"Cache-Control": "no-cache, no-store, must-revalidate"})
    # 旧版静态文件
    index_path = os.path.join(static_dir, "index.html")
    if os.path.isfile(index_path):
        return FileResponse(index_path, headers={"Cache-Control": "no-cache, no-store, must-revalidate"})
    return JSONResponse({"error": "index.html not found"}, status_code=404)

@app.get("/assets/{filepath:path}")
async def react_assets(filepath: str):
    """React 构建资源"""
    file_path = os.path.join(dist_dir, "assets", filepath)
    if os.path.isfile(file_path):
        return FileResponse(file_path)
    return JSONResponse({"error": "not found"}, status_code=404)


class ChatRequest(BaseModel):
    messages: list[dict[str, Any]]
    skill: str | None = None
    clientIP: str | None = None


@app.post("/api/chat")
async def chat(request: Request):
    """聊天 API - NDJSON 流式响应"""
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "请求解析失败"}, status_code=400)

    messages = body.get("messages")
    if not isinstance(messages, list) or len(messages) == 0:
        return JSONResponse({"error": "messages 必须为非空数组"}, status_code=400)

    # 验证消息
    for i, msg in enumerate(messages):
        if not isinstance(msg, dict):
            return JSONResponse(
                {"error": f"messages[{i}] 必须是对象"}, status_code=400
            )
        role = msg.get("role")
        if role not in ("user", "assistant", "system"):
            return JSONResponse(
                {"error": f"messages[{i}].role 无效"}, status_code=400
            )
        if not isinstance(msg.get("content", ""), str):
            return JSONResponse(
                {"error": f"messages[{i}].content 必须为字符串"}, status_code=400
            )

    client_ip = get_client_ip(request)

    async def stream_generator():
        try:
            async for chunk_line in chat_service.stream_chat(body, client_ip):
                yield chunk_line.encode("utf-8")
        except Exception as e:
            error_chunk = json.dumps(
                {"type": "error", "error": str(e)},
                ensure_ascii=False,
            )
            yield (error_chunk + "\n").encode("utf-8")

    return StreamingResponse(
        stream_generator(),
        media_type="application/x-ndjson",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        },
    )


# ─── 会话 API (多会话短期记忆容器) ──────────────────────

@app.get("/api/conversations")
async def list_conversations(session_id: str = ""):
    """获取会话注册表 (当前浏览器会话)"""
    if not session_id:
        return JSONResponse({"error": "session_id 必填"}, status_code=400)
    registry = session_store.get_or_create(session_id)
    return registry.to_dto()


@app.post("/api/conversations")
async def create_conversation(request: Request):
    """创建新会话 (正式持久化, 加入注册表)"""
    body = await request.json()
    session_id = body.get("sessionId", "")
    title = body.get("title", "新对话")
    if not session_id:
        return JSONResponse({"error": "sessionId 必填"}, status_code=400)
    registry = session_store.get_or_create(session_id)
    conv = registry.create(title)
    # 创建对应的 ThreadState
    thread_store.get_or_create(conv.thread_id)
    registry.select(conv.conversation_id)
    return {**conv.to_dto(), "threadId": conv.thread_id}


@app.get("/api/conversations/{conversation_id}")
async def get_conversation(conversation_id: str, session_id: str = ""):
    """获取会话详情 + ThreadState hydration (刷新恢复)"""
    if not session_id:
        return JSONResponse({"error": "session_id 必填"}, status_code=400)
    registry = session_store.get(session_id)
    if not registry:
        return {"conversationId": conversation_id, "messages": [], "summary": "", "pinnedDecisions": [], "restored": False}
    conv = registry.get(conversation_id)
    if not conv:
        return JSONResponse({"error": "会话不存在"}, status_code=404)
    state = thread_store.get(conv.thread_id)
    if not state:
        return {"conversationId": conversation_id, "messages": [], "summary": "", "pinnedDecisions": [], "restored": False}
    dto = state.to_hydration_dto()
    dto["conversationId"] = conversation_id
    dto["title"] = conv.title
    return dto


@app.patch("/api/conversations/{conversation_id}")
async def update_conversation(conversation_id: str, request: Request):
    """切换选中会话 / 重命名 / touch 活跃时间"""
    body = await request.json()
    session_id = body.get("sessionId", "")
    if not session_id:
        return JSONResponse({"error": "sessionId 必填"}, status_code=400)
    registry = session_store.get_or_create(session_id)
    # 重命名
    if "title" in body:
        registry.rename(conversation_id, body["title"])
    # 切换选中 + touch 活跃时间
    if body.get("select", False):
        if not registry.select(conversation_id):
            return JSONResponse({"error": "会话不存在"}, status_code=404)
        registry.touch(conversation_id)
    # 单独 touch (发送消息时)
    if body.get("touch", False):
        registry.touch(conversation_id)
    return registry.to_dto()


@app.delete("/api/conversations/{conversation_id}")
async def delete_conversation(conversation_id: str, session_id: str = ""):
    """删除会话"""
    if not session_id:
        return JSONResponse({"error": "session_id 必填"}, status_code=400)
    registry = session_store.get(session_id)
    if not registry:
        return {"ok": True}
    thread_id = registry.delete(conversation_id)
    if thread_id:
        thread_store.delete(thread_id)
    return {"ok": True, "selectedConversationId": registry.selected_conversation_id}


@app.get("/api/health")
async def health():
    """健康检查"""
    return {"status": "ok", "model": os.getenv("DEEPSEEK_MODEL", "deepseek-chat")}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
    )
