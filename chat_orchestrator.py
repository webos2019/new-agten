"""聊天编排器 - 核心对话流程"""

import json
import asyncio
from typing import Any

from chat_session import ChatSession
from tool_registry import tool_registry
from skill_registry import skill_registry
from stream import (
    StreamLifecycle,
    StreamWriter,
    create_id,
    create_text_chunk,
    create_tool_call_chunk,
    create_tool_result_chunk,
    create_recovering_chunk,
    create_recovery_fallback_chunk,
)

MAX_TOOL_CALLS = 5
MAX_RETRY_ATTEMPTS = 3
RETRY_DELAY_MS = 2.0  # seconds


async def orchestrate_chat(
    session: ChatSession,
    writer: StreamWriter,
    context: dict[str, Any],
) -> None:
    """主编排函数 - 带错误恢复"""
    lifecycle = StreamLifecycle(writer)
    message_id = create_id()
    lifecycle.emit_start_once(message_id)

    recovery_attempts = 0

    while recovery_attempts <= MAX_RETRY_ATTEMPTS:
        try:
            await _do_orchestrate(session, writer, context, lifecycle)
            lifecycle.close()
            return
        except Exception as err:
            error_msg = str(err) if str(err) else "未知错误"

            if recovery_attempts < MAX_RETRY_ATTEMPTS:
                recovery_attempts += 1
                lifecycle.write_chunk(create_recovering_chunk(
                    f"服务遇到问题，正在尝试恢复... ({recovery_attempts}/{MAX_RETRY_ATTEMPTS})",
                    recovery_attempts,
                    MAX_RETRY_ATTEMPTS,
                ))
                await asyncio.sleep(RETRY_DELAY_MS * recovery_attempts)
            else:
                lifecycle.write_chunk(create_recovery_fallback_chunk(
                    "多次尝试恢复失败，将尝试直接回答",
                    "direct-answer",
                ))
                try:
                    await _fallback_to_direct_answer(session, lifecycle)
                except Exception as fallback_err:
                    lifecycle.emit_error_once(
                        str(fallback_err) if str(fallback_err) else "服务不可用"
                    )
                lifecycle.close()
                return


async def _do_orchestrate(
    session: ChatSession,
    writer: StreamWriter,
    context: dict[str, Any],
    lifecycle: StreamLifecycle,
) -> None:
    """执行编排逻辑"""
    current_messages = list(session.get_messages())
    skill = skill_registry.get(session.get_skill_id())
    result_policy = skill.result_policy if skill else "auto"
    output_policy = skill.output_policy if skill else "concise-utility"
    tool_names = skill.tool_names if skill else []

    tool_call_count = 0
    has_tool_calls = False
    has_authoritative_result = False
    tool_results: list[dict[str, Any]] = []

    while tool_call_count < MAX_TOOL_CALLS:
        # 调用模型
        response = await session.invoke_model(messages=current_messages)
        choice = response.choices[0]
        message = choice.message

        # 解析工具调用
        tool_calls = message.tool_calls or []

        if not tool_calls:
            if not has_tool_calls:
                content = message.content or ""
                if content:
                    lifecycle.write_chunk(create_text_chunk(content))
            break

        has_tool_calls = True

        # 将 AI 消息加入上下文
        ai_msg: dict[str, Any] = {"role": "assistant", "content": message.content or ""}
        ai_msg["tool_calls"] = [
            {
                "id": tc.id,
                "type": "function",
                "function": {"name": tc.function.name, "arguments": tc.function.arguments},
            }
            for tc in tool_calls
        ]
        current_messages.append(ai_msg)

        # 执行每个工具调用
        for tc in tool_calls:
            tool_name = tc.function.name
            tool_args_str = tc.function.arguments

            # 解析参数
            try:
                tool_args = json.loads(tool_args_str) if tool_args_str else {}
            except json.JSONDecodeError:
                tool_args = {}

            # 检查工具是否在技能范围内
            if tool_name not in tool_names:
                lifecycle.write_chunk(create_text_chunk(
                    f"⚠️ 工具 {tool_name} 不在当前技能的能力范围内"
                ))
                current_messages.append({
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": json.dumps({"error": f"工具 {tool_name} 不在技能范围内"}),
                })
                continue

            # 发送工具调用 chunk
            lifecycle.write_chunk(create_tool_call_chunk(tc.id, tool_name, tool_args))

            # 执行工具（带重试）
            tool_result_str = await _execute_tool_with_retry(
                tc.id, tool_name, tool_args, context, lifecycle
            )

            tool_def = tool_registry.get(tool_name)
            is_authoritative = tool_def.result_is_authoritative if tool_def else False

            if is_authoritative:
                has_authoritative_result = True

            tool_results.append({
                "toolName": tool_name,
                "result": tool_result_str,
                "isAuthoritative": is_authoritative,
            })

            # 发送工具结果 chunk
            lifecycle.write_chunk(create_tool_result_chunk(
                tc.id, tool_name, tool_result_str,
                is_valid=True,
                is_authoritative=is_authoritative,
            ))

            # 将工具结果加入上下文
            current_messages.append({
                "role": "tool",
                "tool_call_id": tc.id,
                "content": tool_result_str,
            })

            tool_call_count += 1

        if tool_call_count >= MAX_TOOL_CALLS:
            break

    # 后处理
    if has_tool_calls:
        if tool_results:
            if result_policy == "tool-first" and has_authoritative_result:
                authoritative_results = [r for r in tool_results if r["isAuthoritative"]]
                for tr in authoritative_results:
                    formatted = _format_tool_result_for_text(tr["result"], tr["toolName"])
                    lifecycle.write_chunk(create_text_chunk(formatted))
            else:
                await _generate_summary_answer(session, current_messages, lifecycle, output_policy)
        else:
            lifecycle.write_chunk(create_text_chunk("抱歉，工具调用失败，请稍后重试。"))

    lifecycle.emit_done_once()


async def _execute_tool_with_retry(
    tool_call_id: str,
    tool_name: str,
    tool_args: dict[str, Any],
    context: dict[str, Any],
    lifecycle: StreamLifecycle,
) -> str:
    """执行工具（带重试）"""
    attempts = 0
    max_attempts = 2

    while attempts <= max_attempts:
        try:
            result = await tool_registry.execute(tool_name, tool_args, context)
            return result
        except Exception as e:
            attempts += 1
            if attempts < max_attempts:
                lifecycle.write_chunk(create_recovering_chunk(
                    f"工具 {tool_name} 调用失败，正在重试...",
                    attempts, max_attempts,
                ))
                await asyncio.sleep(1.0)
            else:
                return json.dumps({"error": str(e)}, ensure_ascii=False)
    return json.dumps({"error": "未知错误"}, ensure_ascii=False)


async def _fallback_to_direct_answer(
    session: ChatSession,
    lifecycle: StreamLifecycle,
) -> None:
    """回退到直接回答"""
    messages = session.get_messages()
    response = await session.invoke_model(messages=messages, tools=[])
    choice = response.choices[0]
    content = choice.message.content or ""
    if content:
        lifecycle.write_chunk(create_text_chunk(content))
    lifecycle.emit_done_once()


async def _generate_summary_answer(
    session: ChatSession,
    current_messages: list[dict[str, Any]],
    lifecycle: StreamLifecycle,
    output_policy: str = "concise-utility",
) -> None:
    """生成总结回答"""
    output_instruction = ""
    if output_policy == "detailed-explanation":
        output_instruction = "\n\n请提供详细的解释，包括分析过程和步骤。"

    # 提取工具结果
    tool_messages = [m for m in current_messages if m.get("role") == "tool"]
    tool_result_text = "\n\n".join(
        m.get("content", "") for m in tool_messages
    )

    # 获取用户最后一条消息
    user_messages = [m for m in current_messages if m.get("role") == "user"]
    last_user_content = user_messages[-1]["content"] if user_messages else ""

    summary_messages = [
        {"role": "system", "content": session.get_system_prompt()},
        {
            "role": "user",
            "content": (
                f"用户问：{last_user_content}\n\n"
                f"工具调用结果：\n{tool_result_text}\n\n"
                f"请根据工具结果用自然语言总结回答用户。{output_instruction}"
            ),
        },
    ]

    response = await session.invoke_model(messages=summary_messages, tools=[])
    choice = response.choices[0]
    content = choice.message.content or ""
    if content:
        lifecycle.write_chunk(create_text_chunk(content))


def _format_tool_result_for_text(tool_result: str, tool_name: str) -> str:
    """格式化工具结果为文本"""
    try:
        parsed = json.loads(tool_result)
        if parsed.get("message"):
            return parsed["message"]
        if parsed.get("result") is not None:
            if parsed.get("fromName") and parsed.get("toName"):
                return f"{parsed['value']} {parsed['fromName']} = {parsed['result']} {parsed['toName']}"
            return str(parsed["result"])
        if parsed.get("expression") is not None:
            return f"{parsed['expression']} = {parsed['result']}"
        if parsed.get("currentTime"):
            return f"当前时间：{parsed['currentTime']}"
        return json.dumps(parsed, indent=2, ensure_ascii=False)
    except (json.JSONDecodeError, TypeError):
        return tool_result
