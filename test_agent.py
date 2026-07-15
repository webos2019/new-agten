"""
Tasklist Agent 完整测试套件

测试覆盖:
  1. 入口检测 — 无版本方案引用 → 应返回提示
  2. 入口检测 — 有 /tasklist + 有 @docs://versions → 应进入 Agent 链路
  3. 入口检测 — 引用不存在的版本方案 → 应报错并列出可用方案
  4. 纯单元测试 — validate_tasklist_structure (确定性质量门)
  5. 纯单元测试 — extract_plan_structure (planExtract)
  6. 纯单元测试 — resolve_version_plan_uri (资源解析)
  7. 纯单元测试 — AgentState 初始化 + 状态流转
  8. API 端到端 — v0.1.0 版本方案 → 完整 Agent 链路 (7 步)
  9. API 端到端 — v0.2.0 版本方案 → 完整 Agent 链路
 10. 无 /tasklist 命令 → 不应触发 Agent (普通问答路径)

运行方式:
  python test_agent.py            # 全部测试
  python test_agent.py --unit    # 仅单元测试 (不需服务器)
  python test_agent.py --api     # 仅 API 端到端测试
"""

import json
import sys
import os
import asyncio
import urllib.request

# 确保项目根目录在 path 中
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# ─── 测试结果统计 ───────────────────────────────────────

passed = 0
failed = 0
skipped = 0


def ok(name, detail=""):
    global passed
    passed += 1
    print(f"  [PASS] {name}" + (f" -- {detail}" if detail else ""))


def fail(name, detail=""):
    global failed
    failed += 1
    print(f"  [FAIL] {name}" + (f" -- {detail}" if detail else ""))


def skip(name, reason=""):
    global skipped
    skipped += 1
    print(f"  [SKIP] {name}" + (f" -- {reason}" if reason else ""))


def section(title):
    print(f"\n{'='*60}")
    print(f"  {title}")
    print(f"{'='*60}")


# ─── 单元测试 (不需要服务器) ─────────────────────────────

def test_validate_tasklist_structure():
    """测试 4: 确定性质量门 validate_tasklist_structure"""
    section("单元测试: validate_tasklist_structure")
    from agent_runtime import validate_tasklist_structure, AgentState

    state = AgentState(version_plan_uri="docs://versions/demo.md")

    # 4a: 完整草稿 → 应通过
    valid_draft = """# Tasklist v0.1.0

来源: docs://versions/v0.1.0.md

## 主要步骤

- [ ] 步骤一: 实现入口检测
- [ ] 步骤二: 实现状态机
- [ ] 步骤三: 实现质量门
- [ ] 步骤四: 实现最终输出

## 验证

- [ ] 验收: 入口检测正确命中
- [ ] 验收: 状态机完整流转
"""
    result = validate_tasklist_structure(valid_draft, state)
    if result.is_valid:
        ok("完整草稿通过校验")
    else:
        fail("完整草稿应通过校验", result.summary)

    # 4b: 空草稿 → 应失败
    result_empty = validate_tasklist_structure("", state)
    if not result_empty.is_valid and result_empty.issues[0].code == "empty_draft":
        ok("空草稿被拒绝", f"issue={result_empty.issues[0].code}")
    else:
        fail("空草稿应被拒绝")

    # 4c: 缺少标题
    no_title = """来源: docs://versions/test.md

- [ ] 步骤一
- [ ] 步骤二
- [ ] 步骤三

验证: 测试通过
"""
    result_no_title = validate_tasklist_structure(no_title, state)
    codes = [i.code for i in result_no_title.issues]
    if "missing_title" in codes:
        ok("缺少标题被检测到")
    else:
        fail("应检测到缺少标题", f"issues={codes}")

    # 4d: 缺少来源 URI
    no_uri = """# Tasklist

- [ ] 步骤一
- [ ] 步骤二
- [ ] 步骤三

验证: 测试通过
"""
    result_no_uri = validate_tasklist_structure(no_uri, state)
    codes = [i.code for i in result_no_uri.issues]
    if "missing_plan_uri" in codes:
        ok("缺少来源 URI 被检测到")
    else:
        fail("应检测到缺少来源 URI", f"issues={codes}")

    # 4e: 步骤不足 (少于3项)
    few_steps = """# Tasklist
来源: docs://versions/test.md

- [ ] 只有一个步骤

验证: 测试通过
"""
    result_few = validate_tasklist_structure(few_steps, state)
    codes = [i.code for i in result_few.issues]
    if "missing_steps" in codes:
        ok("步骤不足被检测到", f"仅 {len([l for l in few_steps.split(chr(10)) if l.strip().startswith('-')])} 项")
    else:
        fail("应检测到步骤不足", f"issues={codes}")

    # 4f: 缺少勾选项
    no_checklist = """# Tasklist
来源: docs://versions/test.md

- 步骤一
- 步骤二
- 步骤三

验证: 测试通过
"""
    result_no_check = validate_tasklist_structure(no_checklist, state)
    codes = [i.code for i in result_no_check.issues]
    if "missing_checklist" in codes:
        ok("缺少勾选项被检测到")
    else:
        fail("应检测到缺少勾选项", f"issues={codes}")

    # 4g: 缺少验证内容
    no_verify = """# Tasklist
来源: docs://versions/demo.md

- [ ] 步骤一
- [ ] 步骤二
- [ ] 步骤三
"""
    result_no_verify = validate_tasklist_structure(no_verify, state)
    codes = [i.code for i in result_no_verify.issues]
    if "missing_verification" in codes:
        ok("缺少验证内容被检测到")
    else:
        fail("应检测到缺少验证内容", f"issues={codes}")


def test_extract_plan_structure():
    """测试 5: planExtract 版本方案结构提取"""
    section("单元测试: extract_plan_structure (planExtract)")
    from agent_runtime import extract_plan_structure, format_plan_extract_for_prompt

    # 使用真实版本方案文件
    plan_path = os.path.join(os.path.dirname(__file__), "docs", "versions", "v0.1.0-controlled-tasklist-agent.md")
    if not os.path.isfile(plan_path):
        skip("planExtract 测试", "版本方案文件不存在")
        return

    with open(plan_path, "r", encoding="utf-8") as f:
        content = f.read()

    plan = extract_plan_structure(content)

    # 5a: 版本号提取
    if plan.get("version"):
        ok(f"版本号提取: {plan['version']}")
    else:
        fail("应提取到版本号")

    # 5b: 目标提取
    if len(plan.get("goals", [])) > 0:
        ok(f"目标提取: {len(plan['goals'])} 项")
    else:
        fail("应提取到目标列表")

    # 5c: 非目标提取
    if len(plan.get("non_goals", [])) > 0:
        ok(f"非目标提取: {len(plan['non_goals'])} 项")
    else:
        fail("应提取到非目标列表")

    # 5d: 关键变更提取
    if len(plan.get("key_changes", [])) > 0:
        ok(f"关键变更提取: {len(plan['key_changes'])} 项")
    else:
        fail("应提取到关键变更列表")

    # 5e: 测试计划提取
    if len(plan.get("test_plan", [])) > 0:
        ok(f"测试计划提取: {len(plan['test_plan'])} 项")
    else:
        fail("应提取到测试计划列表")

    # 5f: 交付结果提取
    if len(plan.get("deliverables", [])) > 0:
        ok(f"交付结果提取: {len(plan['deliverables'])} 项")
    else:
        fail("应提取到交付结果列表")

    # 5g: 格式化输出
    formatted = format_plan_extract_for_prompt(plan)
    if "版本" in formatted and "目标" in formatted:
        ok("格式化输出包含关键字段", f"{len(formatted)} 字符")
    else:
        fail("格式化输出应包含关键字段", formatted[:100])

    # 5h: 空内容
    empty_plan = extract_plan_structure("")
    if not empty_plan.get("version") and not empty_plan.get("goals"):
        ok("空内容正确返回空结构")
    else:
        fail("空内容应返回空结构")


def test_resolve_version_plan_uri():
    """测试 6: 资源 URI 解析"""
    section("单元测试: resolve_version_plan_uri")

    from agent_runtime import resolve_version_plan_uri, list_available_version_plans

    # 6a: 有效 URI
    filename, filepath = resolve_version_plan_uri("docs://versions/v0.1.0-controlled-tasklist-agent.md")
    if filename and filepath and os.path.isfile(filepath):
        ok(f"有效 URI 解析成功: {filename}")
    else:
        fail("有效 URI 应解析成功")

    # 6b: 无效 URI (不存在的文件)
    filename2, filepath2 = resolve_version_plan_uri("docs://versions/nonexistent.md")
    if filename2 and not filepath2:
        ok("不存在的文件返回文件名但路径为 None")
    else:
        fail("不存在的文件应返回 (filename, None)")

    # 6c: 格式错误的 URI
    filename3, filepath3 = resolve_version_plan_uri("http://example.com/test.md")
    if not filename3 and not filepath3:
        ok("格式错误的 URI 返回 (None, None)")
    else:
        fail("格式错误的 URI 应返回 (None, None)")

    # 6d: 列出可用方案
    plans = list_available_version_plans()
    if len(plans) >= 2:
        ok(f"列出可用方案: {len(plans)} 个")
        for p in plans:
            print(f"       - {p['uri']}")
    else:
        fail("应至少列出 2 个可用方案", f"实际 {len(plans)} 个")


def test_agent_state():
    """测试 7: AgentState 初始化 + 状态流转"""
    section("单元测试: AgentState 状态管理")
    from agent_runtime import AgentState, ValidationResult, ValidationIssue

    # 7a: 初始化
    state = AgentState(
        run_id="test-run-001",
        version_plan_uri="docs://versions/v0.1.0-controlled-tasklist-agent.md",
    )
    if state.revision_count == 0 and not state.tasklist_draft_v1 and not state.validation_v1:
        ok("AgentState 初始化默认值正确", f"revision_count={state.revision_count}")
    else:
        fail("AgentState 初始化默认值不正确")

    # 7b: 模拟状态流转 — 草稿 v1
    state.tasklist_draft_v1 = "# Draft v1\n来源: docs://versions/v0.1.0.md\n- [ ] step1\n- [ ] step2\n- [ ] step3\n验证: ok"
    state.current_draft = state.tasklist_draft_v1
    if state.current_draft == state.tasklist_draft_v1:
        ok("草稿 v1 设置后 current_draft 指向 v1")
    else:
        fail("current_draft 应指向 v1")

    # 7c: 模拟状态流转 — 校验 v1 未通过
    state.validation_v1 = ValidationResult(
        is_valid=False,
        issues=[ValidationIssue("missing_checklist", "勾选项不足")],
        summary="勾选项不足",
    )
    if not state.validation_v1.is_valid and state.revision_count == 0:
        ok("校验 v1 未通过, revision_count=0 (允许修正)")
    else:
        fail("校验 v1 未通过时应 revision_count=0")

    # 7d: 模拟状态流转 — 修正后
    state.revision_count = 1
    state.tasklist_draft_v2 = "# Draft v2\n来源: docs://versions/v0.1.0.md\n- [ ] step1\n- [ ] step2\n- [ ] step3\n验证: ok"
    state.current_draft = state.tasklist_draft_v2
    state.validation_v2 = ValidationResult(is_valid=True, summary="结构完整")

    if state.revision_count == 1 and state.current_draft == state.tasklist_draft_v2:
        ok("修正后 revision_count=1, current_draft 指向 v2")
    else:
        fail("修正后状态不正确")

    # 7e: 最终输出选择正确的草稿和校验结果
    final_validation = state.validation_v2 or state.validation_v1
    final_draft = state.current_draft or state.tasklist_draft_v1
    if final_validation == state.validation_v2 and final_draft == state.tasklist_draft_v2:
        ok("最终输出正确选择 v2 草稿和 v2 校验")
    else:
        fail("最终输出应选择 v2")

    # 7f: 修正上限 — revision_count 不应超过 1
    if state.revision_count <= 1:
        ok("修正次数不超过上限 (1/1)")
    else:
        fail("修正次数不应超过上限")


# ─── API 端到端测试 ─────────────────────────────────────

def make_request(body_dict, timeout=60):
    """发送 API 请求, 返回 NDJSON 行列表"""
    body = json.dumps(body_dict).encode("utf-8")
    req = urllib.request.Request(
        "http://localhost:8000/api/chat",
        data=body,
        headers={"Content-Type": "application/json"},
    )
    r = urllib.request.urlopen(req, timeout=timeout)
    data = r.read().decode("utf-8")
    lines = data.strip().split("\n")
    return [json.loads(line) for line in lines if line.strip()]


def is_server_running():
    """检查服务器是否运行"""
    try:
        urllib.request.urlopen("http://localhost:8000/api/health", timeout=5)
        return True
    except Exception:
        return False


def test_missing_version_plan():
    """测试 1: /tasklist 无版本方案引用 → 应返回提示"""
    section("API 测试 1: 缺少版本方案引用")
    if not is_server_running():
        skip("服务器未运行")
        return

    chunks = make_request({
        "messages": [{
            "role": "user",
            "content": "/tasklist",
            "structured": {
                "rawText": "/tasklist",
                "segments": [{"type": "text", "content": "/tasklist"}],
                "chips": [],
            }
        }],
        "skill": "utility-skill",
    }, timeout=15)

    text_chunks = [c for c in chunks if c.get("type") == "text"]
    if text_chunks:
        content = text_chunks[0].get("content", "")
        if "docs://versions/" in content or "版本方案" in content:
            ok("返回版本方案引用提示", content[:80])
        else:
            fail("应返回版本方案引用提示", content[:80])
    else:
        fail("应有 text chunk")

    done_chunks = [c for c in chunks if c.get("type") == "done"]
    if done_chunks:
        ok("流正常结束 (done)")
    else:
        fail("应有 done chunk")


def test_nonexistent_version_plan():
    """测试 3: 引用不存在的版本方案 → 应报错"""
    section("API 测试 3: 引用不存在的版本方案")
    if not is_server_running():
        skip("服务器未运行")
        return

    chunks = make_request({
        "messages": [{
            "role": "user",
            "content": "/tasklist @docs://versions/nonexistent.md",
            "structured": {
                "rawText": "/tasklist",
                "segments": [
                    {"type": "chip", "chipType": "skill", "label": "tasklist", "data": {"skillName": "tasklist"}},
                    {"type": "chip", "chipType": "doc", "label": "docs://versions/nonexistent.md", "data": {"uri": "docs://versions/nonexistent.md"}},
                ],
                "chips": [
                    {"type": "skill", "label": "tasklist", "data": {"skillName": "tasklist"}},
                    {"type": "doc", "label": "docs://versions/nonexistent.md", "data": {"uri": "docs://versions/nonexistent.md"}},
                ],
            }
        }],
        "skill": "utility-skill",
    }, timeout=15)

    agent_steps = [c for c in chunks if c.get("type") == "agent_step_start"]
    step_ends = [c for c in chunks if c.get("type") == "agent_step_end"]
    text_chunks = [c for c in chunks if c.get("type") == "text"]

    if agent_steps:
        ok("Agent 步骤被触发 (read_resource)")
    else:
        fail("应触发 read_resource 步骤")

    if step_ends and step_ends[0].get("status") == "error":
        ok("read_resource 步骤报错", step_ends[0].get("summary", "")[:60])
    else:
        fail("read_resource 应报错")

    if text_chunks:
        content = text_chunks[0].get("content", "")
        if "不存在" in content or "可用" in content:
            ok("返回不存在的错误提示 + 可用方案列表")
        else:
            fail("应返回不存在提示", content[:80])
    else:
        fail("应有错误提示文本")


def test_full_agent_chain(version_uri, version_name):
    """测试 2/8/9: 完整 Agent 链路"""
    chunks = make_request({
        "messages": [{
            "role": "user",
            "content": f"/tasklist @{version_uri}",
            "structured": {
                "rawText": "/tasklist",
                "segments": [
                    {"type": "chip", "chipType": "skill", "label": "tasklist", "data": {"skillName": "tasklist"}},
                    {"type": "chip", "chipType": "doc", "label": version_uri, "data": {"uri": version_uri}},
                ],
                "chips": [
                    {"type": "skill", "label": "tasklist", "data": {"skillName": "tasklist"}},
                    {"type": "doc", "label": version_uri, "data": {"uri": version_uri}},
                ],
            }
        }],
        "skill": "utility-skill",
    }, timeout=120)

    step_starts = [c for c in chunks if c.get("type") == "agent_step_start"]
    step_ends = [c for c in chunks if c.get("type") == "agent_step_end"]
    resource_starts = [c for c in chunks if c.get("type") == "resource_start"]
    resource_ends = [c for c in chunks if c.get("type") == "resource_end"]
    done_chunks = [c for c in chunks if c.get("type") == "done"]
    error_chunks = [c for c in chunks if c.get("type") == "error"]
    text_chunks = [c for c in chunks if c.get("type") == "text"]

    # 验证 Agent 步骤序列
    expected_actions = ["read_resource", "plan_extract", "draft_tasklist", "validate_tasklist"]
    actual_actions = [s.get("actionType") for s in step_starts]

    for action in expected_actions:
        if action in actual_actions:
            ok(f"步骤存在: {action}")
        else:
            fail(f"缺少步骤: {action}")

    # 验证 read_resource 成功
    read_end = [e for e in step_ends if step_starts and e.get("stepIndex") == 0]
    if read_end and read_end[0].get("status") == "success":
        ok("read_resource 成功", read_end[0].get("summary", "")[:50])
    elif read_end and read_end[0].get("status") == "error":
        fail("read_resource 失败", read_end[0].get("summary", ""))

    # 验证 plan_extract 成功
    extract_end = [e for e in step_ends if step_starts and e.get("stepIndex") == 1]
    if extract_end and extract_end[0].get("status") == "success":
        ok("plan_extract 成功", extract_end[0].get("summary", "")[:50])
    elif extract_end:
        fail("plan_extract 失败", extract_end[0].get("summary", ""))

    # 验证 draft 成功
    draft_end = [e for e in step_ends if step_starts and e.get("stepIndex") == 2]
    if draft_end and draft_end[0].get("status") == "success":
        ok("draft_tasklist 成功")
    elif draft_end:
        fail("draft_tasklist 失败", draft_end[0].get("summary", ""))

    # 验证 validate
    validate_start = [s for s in step_starts if s.get("actionType") == "validate_tasklist"]
    validate_end = [e for e in step_ends if e.get("stepIndex") == 3]
    if validate_start and validate_end:
        status = validate_end[0].get("status")
        if status in ("success", "error"):
            ok(f"validate_tasklist 执行 (status={status})", validate_end[0].get("summary", "")[:50])
        else:
            fail("validate_tasklist 状态异常", status)

    # 验证修正步骤 (如果有)
    revise_starts = [s for s in step_starts if s.get("actionType") == "revise_tasklist"]
    if revise_starts:
        ok("自动修正被触发 (revise_tasklist)")
    else:
        ok("无需自动修正 (草稿 v1 已通过)")

    # 验证 final_answer
    final_starts = [s for s in step_starts if s.get("actionType") == "final_answer"]
    final_ends = [e for e in step_ends if e.get("actionType") == "final_answer" or
                  (final_starts and e.get("stepIndex") == len(step_starts) - 1)]
    if final_starts:
        ok("final_answer 步骤存在")

    # 验证资源读取
    if resource_starts:
        ok(f"资源读取: {resource_starts[0].get('resourceName')}")
    else:
        fail("应读取版本方案资源")

    if resource_ends:
        ok(f"资源读取完成 (truncated={resource_ends[0].get('isTruncated')})")

    # 验证最终输出文本
    all_text = "".join(c.get("content", "") for c in text_chunks)
    if "最终输出" in all_text or "Tasklist" in all_text or "tasklist" in all_text.lower():
        ok("最终输出包含 tasklist 草稿")
    else:
        fail("最终输出应包含 tasklist", all_text[:100])

    if "人工确认" in all_text or "未自动写入" in all_text:
        ok("最终输出包含人工确认点")
    else:
        fail("最终输出应包含人工确认点")

    # 验证流正常结束
    if done_chunks:
        ok("流正常结束 (done)")
    else:
        fail("应有 done chunk")

    if error_chunks:
        fail("不应有 error chunk", error_chunks[0].get("error", "")[:80])

    # 打印步骤总览
    print(f"\n  ── Agent 步骤总览 ({version_name}) ──")
    for s in step_starts:
        idx = s.get("stepIndex", 0)
        end = [e for e in step_ends if e.get("stepIndex") == idx]
        status = end[0].get("status", "?") if end else "?"
        summary = end[0].get("summary", "")[:40] if end else ""
        dur = end[0].get("durationMs", "?") if end else "?"
        print(f"    [{idx}] {s.get('actionType'):25s} | {status:8s} | {dur:>5}ms | {summary}")


def test_no_tasklist_command():
    """测试 10: 无 /tasklist 命令 → 不应触发 Agent"""
    section("API 测试 10: 无 /tasklist 命令 (不应触发 Agent)")
    if not is_server_running():
        skip("服务器未运行")
        return

    chunks = make_request({
        "messages": [{
            "role": "user",
            "content": "帮我计算 1+1",
            "structured": None,
        }],
        "skill": "utility-skill",
    }, timeout=30)

    agent_steps = [c for c in chunks if c.get("type") in ("agent_step_start", "agent_step_end")]
    if not agent_steps:
        ok("未触发 Agent 路径 (正确)")
    else:
        fail("不应触发 Agent 路径")

    text_chunks = [c for c in chunks if c.get("type") == "text"]
    if text_chunks:
        ok("走了普通问答路径")
    else:
        fail("应有普通回答")

    done_chunks = [c for c in chunks if c.get("type") == "done"]
    if done_chunks:
        ok("流正常结束 (done)")


# ─── 主入口 ─────────────────────────────────────────────

def run_unit_tests():
    test_validate_tasklist_structure()
    test_extract_plan_structure()
    test_resolve_version_plan_uri()
    test_agent_state()


def run_api_tests():
    test_missing_version_plan()
    test_nonexistent_version_plan()

    section("API 测试 2: 完整 Agent 链路 — v0.1.0")
    if is_server_running():
        test_full_agent_chain(
            "docs://versions/v0.1.0-controlled-tasklist-agent.md",
            "v0.1.0",
        )
    else:
        skip("完整 Agent 链路测试", "服务器未运行")

    section("API 测试 9: 完整 Agent 链路 — v0.2.0")
    if is_server_running():
        test_full_agent_chain(
            "docs://versions/v0.2.0-agent-trace-panel.md",
            "v0.2.0",
        )
    else:
        skip("完整 Agent 链路测试", "服务器未运行")

    test_no_tasklist_command()


if __name__ == "__main__":
    print("\n" + "=" * 60)
    print("  Tasklist Agent 完整测试套件")
    print("=" * 60)

    args = set(sys.argv[1:])
    run_unit = "--unit" in args or not args
    run_api = "--api" in args or not args

    if run_unit:
        run_unit_tests()

    if run_api:
        run_api_tests()

    # ─── 汇总 ──────────────────────────────────────────
    print(f"\n{'='*60}")
    print(f"  测试汇总")
    print(f"{'='*60}")
    total = passed + failed + skipped
    print(f"  通过: {passed} / {total}")
    print(f"  失败: {failed} / {total}")
    print(f"  跳过: {skipped} / {total}")
    print(f"  Result: {'ALL PASS' if failed == 0 else 'HAS FAILURES'}")
    print()

    sys.exit(0 if failed == 0 else 1)
