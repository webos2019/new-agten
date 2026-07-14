"""流式协议 - NDJSON chunk 定义"""

import time
import random
import uuid
from typing import Any


def create_id() -> str:
    """生成唯一 ID"""
    return f"{int(time.time() * 1000)}-{uuid.uuid4().hex[:12]}"


def create_start_chunk(message_id: str) -> dict[str, Any]:
    return {"type": "start", "messageId": message_id}


def create_text_chunk(content: str) -> dict[str, Any]:
    return {"type": "text", "content": content}


def create_reasoning_chunk(content: str) -> dict[str, Any]:
    return {"type": "reasoning", "content": content}


def create_tool_call_chunk(
    tool_call_id: str,
    tool_name: str,
    tool_args: dict[str, Any],
    server_id: str | None = None,
    source: str | None = None,
) -> dict[str, Any]:
    chunk: dict[str, Any] = {
        "type": "tool_call",
        "toolCallId": tool_call_id,
        "toolName": tool_name,
        "toolArgs": tool_args,
    }
    if server_id:
        chunk["serverId"] = server_id
    if source:
        chunk["source"] = source
    return chunk


def create_tool_result_chunk(
    tool_call_id: str,
    tool_name: str,
    tool_result: str,
    is_valid: bool = True,
    is_authoritative: bool = False,
    server_id: str | None = None,
    source: str | None = None,
) -> dict[str, Any]:
    chunk: dict[str, Any] = {
        "type": "tool_result",
        "toolCallId": tool_call_id,
        "toolName": tool_name,
        "toolResult": tool_result,
        "isValid": is_valid,
        "isAuthoritative": is_authoritative,
    }
    if server_id:
        chunk["serverId"] = server_id
    if source:
        chunk["source"] = source
    return chunk


def create_resource_start_chunk(
    resource_name: str,
    resource_uri: str,
    server_id: str | None = None,
) -> dict[str, Any]:
    chunk: dict[str, Any] = {
        "type": "resource_start",
        "resourceName": resource_name,
        "resourceUri": resource_uri,
    }
    if server_id:
        chunk["serverId"] = server_id
    return chunk


def create_resource_end_chunk(
    resource_name: str,
    resource_uri: str,
    server_id: str | None = None,
    content_preview: str | None = None,
    is_truncated: bool = False,
    preview_chars: int | None = None,
) -> dict[str, Any]:
    chunk: dict[str, Any] = {
        "type": "resource_end",
        "resourceName": resource_name,
        "resourceUri": resource_uri,
    }
    if server_id:
        chunk["serverId"] = server_id
    if content_preview is not None:
        chunk["contentPreview"] = content_preview
    chunk["isTruncated"] = is_truncated
    if preview_chars is not None:
        chunk["previewChars"] = preview_chars
    return chunk


def create_resource_error_chunk(
    resource_name: str,
    resource_uri: str,
    error: str,
    server_id: str | None = None,
) -> dict[str, Any]:
    chunk: dict[str, Any] = {
        "type": "resource_error",
        "resourceName": resource_name,
        "resourceUri": resource_uri,
        "error": error,
    }
    if server_id:
        chunk["serverId"] = server_id
    return chunk


def create_error_chunk(
    error: str,
    retryable: bool | None = None,
    retry_delay: int | None = None,
) -> dict[str, Any]:
    chunk: dict[str, Any] = {"type": "error", "error": error}
    if retryable is not None:
        chunk["retryable"] = retryable
    if retry_delay is not None:
        chunk["retryDelay"] = retry_delay
    return chunk


def create_recovering_chunk(
    message: str,
    attempt: int,
    max_attempts: int,
) -> dict[str, Any]:
    return {
        "type": "recovering",
        "message": message,
        "attempt": attempt,
        "maxAttempts": max_attempts,
    }


def create_recovery_fallback_chunk(
    message: str,
    fallback_method: str,
) -> dict[str, Any]:
    return {
        "type": "recovery_fallback",
        "message": message,
        "fallbackMethod": fallback_method,
    }


def create_done_chunk() -> dict[str, Any]:
    return {"type": "done"}
