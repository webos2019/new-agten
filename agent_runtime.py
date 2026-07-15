"""
Agent Runtime — 受控 Tasklist Agent

实现文章中描述的受控 Agent 链路:
  入口检测 -> read_resource -> planExtract -> draft v1 -> validate -> (revise v2 -> validate) -> final_answer

关键设计:
- 入口必须显式: /tasklist + @docs://versions/*.md 二者缺一不可
- 状态机: AgentState 保存草稿/校验/修正次数, 仅本轮内存
- 确定性质量门: validate_tasklist_structure 用规则检查结构完整性
- 最多一次自动修正: 不会无限循环
- 最终输出: 可复制草稿 + 校验结论 + 人工确认点
"""

from __future__ import annotations

import os
import re
import time
import json
from dataclasses import dataclass, field
from typing import Any

from stream import (
    StreamWriter,
    StreamLifecycle,
    create_id,
    create_text_chunk,
    create_resource_start_chunk,
    create_resource_end_chunk,
    create_agent_step_start_chunk,
    create_agent_step_end_chunk,
)
from deepseek import chat_completion


# ─── 资源路径 ─────────────────────────────────────────
DOCS_DIR = os.path.join(os.path.dirname(__file__), "docs", "versions")
VERSION_PLAN_URI_PATTERN = re.compile(r"^docs://versions/([^/\\]+\.md)$", re.IGNORECASE)


def resolve_version_plan_uri(uri: str) -> tuple[str | None, str | None]:
    """将 docs://versions/xxx.md 解析为 (文件名, 文件路径)"""
    match = VERSION_PLAN_URI_PATTERN.match(uri)
    if not match:
        return None, None
    filename = match.group(1)
    filepath = os.path.join(DOCS_DIR, filename)
    if os.path.isfile(filepath):
        return filename, filepath
    return filename, None


def list_available_version_plans() -> list[dict[str, str]]:
    """列出所有可用版本方案"""
    plans = []
    if os.path.isdir(DOCS_DIR):
        for f in sorted(os.listdir(DOCS_DIR)):
            if f.endswith(".md"):
                plans.append({
                    "uri": f"docs://versions/{f}",
                    "name": f,
                })
    return plans


# ─── AgentState ────────────────────────────────────────

@dataclass
class ValidationIssue:
    code: str
    message: str


@dataclass
class ValidationResult:
    is_valid: bool
    issues: list[ValidationIssue] = field(default_factory=list)
    summary: str = ""


@dataclass
class AgentState:
    """Agent 本轮状态 — 仅存在于本轮请求内，不持久化"""
    run_id: str = ""
    version_plan_uri: str = ""
    version_plan_content: str = ""
    version_plan_filename: str = ""

    # planExtract 结果
    plan_extract: dict[str, Any] = field(default_factory=dict)

    # 草稿
    tasklist_draft_v1: str = ""
    tasklist_draft_v2: str = ""
    current_draft: str = ""  # 指向当前版本

    # 校验
    validation_v1: ValidationResult | None = None
    validation_v2: ValidationResult | None = None
    revision_count: int = 0  # 0 或 1

    # 最终
    final_answer: str = ""
    step_index: int = 0


# ─── 确定性质量门: validate_tasklist_structure ─────────

def validate_tasklist_structure(draft: str, state: AgentState) -> ValidationResult:
    """
    确定性结构校验 — 不依赖模型判断，用规则检查 tasklist 草稿结构完整性。

    校验项:
    - missing_title: 是否有标题
    - missing_plan_uri: 是否标明来源版本方案
    - missing_steps: 是否有主要步骤
    - missing_checklist: 是否有勾选项
    - missing_verification: 是否有验证内容
    """
    issues: list[ValidationIssue] = []

    if not draft or not draft.strip():
        return ValidationResult(
            is_valid=False,
            issues=[ValidationIssue("empty_draft", "草稿为空")],
            summary="草稿为空",
        )

    lines = draft.strip().split("\n")

    # 1. 标题检查 — 首行应为 # 开头的 Markdown 标题
    has_title = any(line.strip().startswith("#") for line in lines[:5])
    if not has_title:
        issues.append(ValidationIssue("missing_title", "缺少标题（# 开头）"))

    # 2. 来源版本方案检查 — 文本中是否包含 docs://versions/
    has_plan_uri = bool(re.search(r"docs://versions/", draft))
    if not has_plan_uri:
        issues.append(ValidationIssue("missing_plan_uri", "未标明来源版本方案 URI"))

    # 3. 主要步骤检查 — 是否有 - 或数字列表项 (至少3个)
    step_items = [line for line in lines if re.match(r"^\s*([-*]|\d+\.)\s", line)]
    if len(step_items) < 3:
        issues.append(ValidationIssue("missing_steps", f"主要步骤不足（仅 {len(step_items)} 项，需至少 3 项）"))

    # 4. 勾选项检查 — 是否有 [ ] 或 [x] 标记
    checklist_items = re.findall(r"\[[ x]\]", draft)
    if len(checklist_items) < 2:
        issues.append(ValidationIssue("missing_checklist", f"勾选项不足（仅 {len(checklist_items)} 项，需至少 2 项）"))

    # 5. 验证内容检查 — 是否包含验收/验证/测试相关关键词
    verification_keywords = ["验收", "验证", "测试", "确认", "verify", "test", "acceptance"]
    has_verification = any(kw in draft.lower() for kw in verification_keywords)
    if not has_verification:
        issues.append(ValidationIssue("missing_verification", "缺少验证/验收内容"))

    blocking = [i for i in issues if i.code.startswith("missing_") or i.code == "empty_draft"]
    is_valid = len(blocking) == 0

    summary_parts = [i.message for i in issues]
    summary = "结构完整" if is_valid else "；".join(summary_parts)

    return ValidationResult(is_valid=is_valid, issues=issues, summary=summary)


# ─── planExtract: 版本方案结构提取 ────────────────────

def extract_plan_structure(content: str) -> dict[str, Any]:
    """
    从版本方案 Markdown 中提取结构化依据:
    - version: 版本号
    - goals: 目标列表
    - non_goals: 非目标列表
    - key_changes: 关键变更列表
    - test_plan: 测试计划列表
    - deliverables: 交付结果列表
    """
    lines = content.strip().split("\n")
    result: dict[str, Any] = {
        "version": "",
        "goals": [],
        "non_goals": [],
        "key_changes": [],
        "test_plan": [],
        "deliverables": [],
    }

    # 提取版本号（从标题）
    title_match = re.search(r"v(\d+\.\d+\.\d+)", content)
    if title_match:
        result["version"] = f"v{title_match.group(1)}"

    # 按段落提取 — 先长后短匹配，避免 "目标" 匹配到 "非目标"
    current_section = None
    # 按长度降序排列，确保 "非目标" 优先于 "目标" 匹配
    section_map = sorted([
        ("非目标", "non_goals"),
        ("目标", "goals"),
        ("关键变更", "key_changes"),
        ("测试计划", "test_plan"),
        ("交付结果", "deliverables"),
    ], key=lambda x: len(x[0]), reverse=True)

    for line in lines:
        stripped = line.strip()

        # 检测段落标题 — 精确匹配 ## 后的文本
        if stripped.startswith("#"):
            header_text = stripped.lstrip("#").strip()
            matched = False
            for cn_name, key in section_map:
                # 用包含 + 长度比较来避免子串误匹配
                if cn_name in header_text and len(cn_name) >= len(header_text) - 2:
                    current_section = key
                    matched = True
                    break
            if not matched:
                # 遇到其他标题时，重置 section
                current_section = None
            continue

        # 列表项
        if current_section and re.match(r"^\s*([-*]|\d+\.)\s", stripped):
            item_text = re.sub(r"^\s*([-*]|\d+\.)\s+", "", stripped).strip()
            if item_text:
                result[current_section].append(item_text)

    return result


def format_plan_extract_for_prompt(plan: dict[str, Any]) -> str:
    """将 planExtract 结果格式化为模型 prompt"""
    parts = []
    if plan.get("version"):
        parts.append(f"版本: {plan['version']}")
    if plan.get("goals"):
        parts.append("目标:\n" + "\n".join(f"  - {g}" for g in plan["goals"]))
    if plan.get("non_goals"):
        parts.append("非目标:\n" + "\n".join(f"  - {g}" for g in plan["non_goals"]))
    if plan.get("key_changes"):
        parts.append("关键变更:\n" + "\n".join(f"  - {c}" for c in plan["key_changes"]))
    if plan.get("test_plan"):
        parts.append("测试计划:\n" + "\n".join(f"  - {t}" for t in plan["test_plan"]))
    if plan.get("deliverables"):
        parts.append("交付结果:\n" + "\n".join(f"  - {d}" for d in plan["deliverables"]))
    return "\n\n".join(parts) if parts else "未能提取到有效结构"


# ─── Agent Runner ──────────────────────────────────────

async def run_tasklist_agent(
    state: AgentState,
    writer: StreamWriter,
    lifecycle: StreamLifecycle,
) -> None:
    """
    Agent 主流程:
    read_resource -> planExtract -> draft v1 -> validate -> (revise v2 -> validate) -> final_answer
    """
    step = 0

    # ── Step 1: read_resource ──
    _emit_step_start(lifecycle, state.run_id, step, "read_resource", "读取版本方案")
    t0 = time.time()

    filename, filepath = resolve_version_plan_uri(state.version_plan_uri)
    if not filepath:
        _emit_step_end(lifecycle, state.run_id, step, "error",
                        f"版本方案 {state.version_plan_uri} 不存在")
        lifecycle.write_chunk(create_text_chunk(
            f"❌ 版本方案 `{state.version_plan_uri}` 不存在。\n\n"
            f"可用的版本方案:\n" +
            "\n".join(f"  - `{p['uri']}`" for p in list_available_version_plans())
        ))
        return

    with open(filepath, "r", encoding="utf-8") as f:
        state.version_plan_content = f.read()
    state.version_plan_filename = filename

    # 发送 resource chunk
    lifecycle.write_chunk(create_resource_start_chunk(filename, state.version_plan_uri))
    preview = state.version_plan_content[:500]
    is_truncated = len(state.version_plan_content) > 500
    lifecycle.write_chunk(create_resource_end_chunk(
        filename, state.version_plan_uri,
        content_preview=preview,
        is_truncated=is_truncated,
        preview_chars=500 if is_truncated else None,
    ))

    _emit_step_end(lifecycle, state.run_id, step, "success",
                    f"已读取 {filename} ({len(state.version_plan_content)} 字符)",
                    duration_ms=int((time.time() - t0) * 1000))
    step += 1

    # ── Step 2: planExtract ──
    _emit_step_start(lifecycle, state.run_id, step, "plan_extract", "提取版本方案结构")
    t0 = time.time()

    state.plan_extract = extract_plan_structure(state.version_plan_content)
    plan_text = format_plan_extract_for_prompt(state.plan_extract)

    _emit_step_end(lifecycle, state.run_id, step, "success",
                    f"提取到 {sum(len(v) if isinstance(v, list) else 1 for v in state.plan_extract.values())} 个结构字段",
                    duration_ms=int((time.time() - t0) * 1000))
    step += 1

    # ── Step 3: draft_tasklist v1 ──
    _emit_step_start(lifecycle, state.run_id, step, "draft_tasklist", "生成任务清单草稿 v1")
    t0 = time.time()

    state.tasklist_draft_v1 = await _generate_tasklist_draft(state, plan_text, is_revision=False)
    state.current_draft = state.tasklist_draft_v1

    lifecycle.write_chunk(create_text_chunk("## 任务清单草稿 v1\n\n"))
    lifecycle.write_chunk(create_text_chunk(state.tasklist_draft_v1 + "\n\n"))

    _emit_step_end(lifecycle, state.run_id, step, "success",
                    "草稿 v1 已生成",
                    duration_ms=int((time.time() - t0) * 1000))
    step += 1

    # ── Step 4: validate_tasklist v1 ──
    _emit_step_start(lifecycle, state.run_id, step, "validate_tasklist", "结构校验 v1")
    t0 = time.time()

    state.validation_v1 = validate_tasklist_structure(state.tasklist_draft_v1, state)

    _emit_step_end(lifecycle, state.run_id, step,
                    "success" if state.validation_v1.is_valid else "error",
                    state.validation_v1.summary,
                    duration_ms=int((time.time() - t0) * 1000))
    step += 1

    # ── Step 5: revise_tasklist (如果需要且未修正过) ──
    if not state.validation_v1.is_valid and state.revision_count < 1:
        _emit_step_start(lifecycle, state.run_id, step, "revise_tasklist", "自动修正草稿")
        t0 = time.time()

        state.revision_count = 1
        issues_text = "；".join(i.message for i in state.validation_v1.issues)
        state.tasklist_draft_v2 = await _generate_tasklist_draft(state, plan_text, is_revision=True, issues=issues_text)
        state.current_draft = state.tasklist_draft_v2

        lifecycle.write_chunk(create_text_chunk("## 任务清单草稿 v2（修正后）\n\n"))
        lifecycle.write_chunk(create_text_chunk(state.tasklist_draft_v2 + "\n\n"))

        _emit_step_end(lifecycle, state.run_id, step, "success",
                        "修正版 v2 已生成",
                        duration_ms=int((time.time() - t0) * 1000))
        step += 1

        # ── Step 6: validate_tasklist v2 ──
        _emit_step_start(lifecycle, state.run_id, step, "validate_tasklist", "结构校验 v2")
        t0 = time.time()

        state.validation_v2 = validate_tasklist_structure(state.tasklist_draft_v2, state)

        _emit_step_end(lifecycle, state.run_id, step,
                        "success" if state.validation_v2.is_valid else "error",
                        state.validation_v2.summary,
                        duration_ms=int((time.time() - t0) * 1000))
        step += 1

    # ── Step 7: final_answer ──
    _emit_step_start(lifecycle, state.run_id, step, "final_answer", "生成最终输出")
    t0 = time.time()

    final = _build_final_answer(state)
    state.final_answer = final
    lifecycle.write_chunk(create_text_chunk(final))

    _emit_step_end(lifecycle, state.run_id, step, "success",
                    "最终输出已生成",
                    duration_ms=int((time.time() - t0) * 1000))


# ─── 内部辅助 ─────────────────────────────────────────

def _emit_step_start(
    lifecycle: StreamLifecycle, run_id: str, step_index: int,
    action_type: str, title: str,
) -> None:
    lifecycle.write_chunk(create_agent_step_start_chunk(
        run_id=run_id,
        step_index=step_index,
        action_type=action_type,
        title=title,
    ))


def _emit_step_end(
    lifecycle: StreamLifecycle, run_id: str, step_index: int,
    status: str, summary: str | None = None,
    duration_ms: int | None = None,
) -> None:
    lifecycle.write_chunk(create_agent_step_end_chunk(
        run_id=run_id,
        step_index=step_index,
        status=status,
        summary=summary,
        duration_ms=duration_ms,
    ))


async def _generate_tasklist_draft(
    state: AgentState,
    plan_text: str,
    is_revision: bool = False,
    issues: str | None = None,
) -> str:
    """调用模型生成 tasklist 草稿"""
    system_prompt = (
        "你是一个任务清单生成助手。根据版本方案的结构化依据，生成一份可执行的任务清单（tasklist）草稿。\n\n"
        "格式要求:\n"
        "- 以 # 标题开头\n"
        "- 在标题后注明来源版本方案 URI（如 docs://versions/xxx.md）\n"
        "- 包含主要步骤（至少 3 项，用 - 或数字列表）\n"
        "- 每个步骤下有勾选项（[ ] 或 [x]，至少 2 个）\n"
        "- 包含验证/验收内容\n"
        "- 包含非目标确认、风险点和暂停确认点\n"
    )

    user_content = f"版本方案结构化依据:\n\n{plan_text}\n\n"
    user_content += f"来源版本方案: {state.version_plan_uri}\n"

    if is_revision and issues:
        user_content += (
            f"\n\n上一版草稿存在以下结构问题，请修正:\n{issues}\n"
            "请确保修正后的草稿通过结构校验。"
        )

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_content},
    ]

    response = await chat_completion(messages=messages, tools=[])
    choice = response.choices[0]
    return choice.message.content or ""


def _build_final_answer(state: AgentState) -> str:
    """构建最终输出: 可复制草稿 + 校验结论 + 人工确认点"""
    draft = state.current_draft or state.tasklist_draft_v1
    final_validation = state.validation_v2 or state.validation_v1
    revision_note = ""
    if state.revision_count > 0:
        revision_note = f"\n- 自动修正次数: {state.revision_count}"

    parts = [
        "---\n",
        "## 📋 最终输出\n",
        f"**来源版本方案**: `{state.version_plan_uri}`\n",
        f"**结构校验状态**: {'✓ 通过' if (final_validation and final_validation.is_valid) else '✗ 未通过'}",
        revision_note + "\n",
        "\n### 可复制 Tasklist 草稿\n",
        "```markdown\n",
        draft,
        "\n```\n",
    ]

    if final_validation and final_validation.issues:
        parts.append("\n### 校验详情\n")
        if final_validation.is_valid:
            parts.append("结构完整，无阻断性问题。\n")
        else:
            parts.append("阻断性问题:\n")
            for issue in final_validation.issues:
                parts.append(f"- `{issue.code}`: {issue.message}\n")

    parts.append("\n### ⚠️ 人工确认点\n")
    parts.append("- 以上草稿由 Agent 生成，**未自动写入任何文件**\n")
    parts.append("- 请人工 review 后再决定是否落地\n")
    parts.append(f"- 本轮修正次数: {state.revision_count} / 1（上限）\n")

    return "".join(parts)
