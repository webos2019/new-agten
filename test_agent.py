"""测试 Agent 入口检测"""
import json
import urllib.request

# Test 1: /tasklist without version plan reference → should get hint
body = json.dumps({
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
}).encode()

req = urllib.request.Request(
    "http://localhost:8000/api/chat",
    data=body,
    headers={"Content-Type": "application/json"},
)
try:
    r = urllib.request.urlopen(req, timeout=15)
    data = r.read().decode("utf-8")
    lines = data.strip().split("\n")
    for line in lines:
        chunk = json.loads(line)
        if chunk.get("type") == "text":
            print("[Test 1 - Missing plan] OK: got text hint")
            print("  Content preview:", (chunk.get("content") or "")[:100])
            break
        if chunk.get("type") == "done":
            print("[Test 1 - Missing plan] OK: got done without error")
            break
except Exception as e:
    print(f"[Test 1] FAIL: {e}")

print()

# Test 2: /tasklist + @docs://versions/v0.1.0 → should enter Agent path
body2 = json.dumps({
    "messages": [{
        "role": "user",
        "content": "/tasklist @docs://versions/v0.1.0-controlled-tasklist-agent.md",
        "structured": {
            "rawText": "/tasklist",
            "segments": [
                {"type": "chip", "chipType": "skill", "label": "tasklist", "data": {"skillName": "tasklist"}},
                {"type": "chip", "chipType": "doc", "label": "docs://versions/v0.1.0-controlled-tasklist-agent.md", "data": {"uri": "docs://versions/v0.1.0-controlled-tasklist-agent.md"}},
            ],
            "chips": [
                {"type": "skill", "label": "tasklist", "data": {"skillName": "tasklist"}},
                {"type": "doc", "label": "docs://versions/v0.1.0-controlled-tasklist-agent.md", "data": {"uri": "docs://versions/v0.1.0-controlled-tasklist-agent.md"}},
            ],
        }
    }],
    "skill": "utility-skill",
}).encode()

req2 = urllib.request.Request(
    "http://localhost:8000/api/chat",
    data=body2,
    headers={"Content-Type": "application/json"},
)
try:
    r2 = urllib.request.urlopen(req2, timeout=60)
    data2 = r2.read().decode("utf-8")
    lines2 = data2.strip().split("\n")
    found_agent_step = False
    found_resource = False
    found_done = False
    for line in lines2:
        chunk = json.loads(line)
        ctype = chunk.get("type", "")
        if ctype == "agent_step_start":
            found_agent_step = True
            print(f"[Test 2] Agent step start: {chunk.get('title')} ({chunk.get('actionType')})")
        elif ctype == "agent_step_end":
            print(f"[Test 2] Agent step end: {chunk.get('status')} - {chunk.get('summary','')[:60]}")
        elif ctype == "resource_start":
            found_resource = True
            print(f"[Test 2] Resource start: {chunk.get('resourceName')}")
        elif ctype == "resource_end":
            print(f"[Test 2] Resource end: truncated={chunk.get('isTruncated')}")
        elif ctype == "done":
            found_done = True
            print(f"[Test 2] Done")
        elif ctype == "error":
            print(f"[Test 2] Error: {chunk.get('error','')[:100]}")

    if found_agent_step:
        print("[Test 2 - Agent entry] OK: Agent path triggered")
    else:
        print("[Test 2 - Agent entry] WARN: No agent_step_start found")
    if found_resource:
        print("[Test 2 - Resource read] OK: Resource was read")
    if found_done:
        print("[Test 2 - Complete] OK: Agent finished")
except Exception as e:
    print(f"[Test 2] FAIL: {e}")
