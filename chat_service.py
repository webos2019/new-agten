"""聊天服务"""

import json
from typing import Any, AsyncIterator

from chat_session import create_chat_session
from chat_orchestrator import orchestrate_chat
from stream import StreamWriter, create_ndjson_stream


def resolve_skill(explicit_skill: str | None, user_message: str) -> str:
    """根据用户消息自动检测技能"""
    if explicit_skill:
        return explicit_skill

    utility_keywords = ["计算", "时间", "日期", "换算", "convert", "datetime",
                        "calculator", "math", "unit", "天气", "weather", "city"]
    reader_keywords = ["文件", "读取", "目录", "read", "file", "directory", "location"]

    lower_msg = user_message.lower()
    utility_matches = sum(1 for k in utility_keywords if k in lower_msg)
    reader_matches = sum(1 for k in reader_keywords if k in lower_msg)

    if reader_matches > utility_matches or reader_matches > 0:
        return "reader-skill"
    return "utility-skill"


class ChatService:
    """聊天服务"""

    async def stream_chat(
        self,
        request_body: dict[str, Any],
        client_ip: str = "127.0.0.1",
    ) -> AsyncIterator[str]:
        """
        处理聊天请求，返回 NDJSON 流
        """
        messages = request_body.get("messages", [])
        skill = request_body.get("skill")
        client_ip_req = request_body.get("clientIP") or client_ip

        if not isinstance(messages, list):
            raise ValueError("messages 必须是数组")

        # 提取结构化请求 (Composer chips/segments)
        user_message = ""
        structured = None
        if messages:
            user_message = messages[-1].get("content", "")
            structured = messages[-1].get("structured")

        resolved_skill = resolve_skill(skill, user_message)

        session = create_chat_session(resolved_skill, messages)

        # 将结构化请求传入 context，供 Agent Runtime 检测
        agent_context = {"clientIP": client_ip_req}
        if structured:
            agent_context["structured"] = structured

        async def on_start(writer: StreamWriter) -> None:
            await orchestrate_chat(session, writer, agent_context)

        async for chunk_line in create_ndjson_stream(on_start):
            yield chunk_line


def create_chat_service() -> ChatService:
    """创建聊天服务实例"""
    return ChatService()
