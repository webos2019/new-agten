"""
KbQA — 知识库受控问答 (grounded QA with abstention)

核心约束: 只允许用知识库里检索到的内容回答, 检索不到就明确说"不存在",
绝不允许模型用自己的参数化知识补全。

四层拒答门控 (任一不过即拒答, 顺序执行、越早越省成本):
  G1 检索无结果            → 直接拒答, 不调 LLM
  G2 最高分 < MIN_SCORE    → 直接拒答, 不调 LLM (噪声问题在此拦截)
  G3 LLM 自评 grounded=false → 拒答 (证据不足以支撑回答)
  G4 LLM 未引用任何片段      → 拒答 (答案无出处, 视为幻觉)

为什么需要 G3+G4 两层:
  G2 只能挡住"字面完全不相关"的问题。用户问的词汇与知识库有重合、
  但语义上问的是另一件事时, 检索分可能不低 (如库里讲"苹果手机",
  用户问"苹果好吃吗")。这类必须靠 LLM 读证据后自评, 再由 G4 兜底
  校验引用合法性 —— 单靠 prompt 说"不确定就说不知道"并不可靠。

输出永远包含: answer / grounded / citations / reason / top_score
拒答时 grounded=false, answer 为统一话术, reason 说明卡在哪一层。
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any

from knowledge_base import kb_store, get_kb_namespace
from deepseek import chat_completion


# ─── 配置 ──────────────────────────────────────────────

# 检索层: 取多少候选给 LLM 做证据
RETRIEVAL_TOP_K = 5

# G2 门控: 检索最高分低于此值直接拒答, 不走 LLM (省成本)
# 0.18 是混合检索下的经验值: 低于它基本是纯噪声匹配
# 高于它的灰区 (词面有重合但语义存疑) 交给 LLM 二次裁决, 比一刀切更准
GRAY_ZONE_SCORE = 0.18

# 单条证据送进 LLM 的字符上限 (控制 context 膨胀)
MAX_EVIDENCE_CHARS = 800

# 答案里允许引用的最多片段数
MAX_CITATIONS = 3

# 拒答统一话术
ABSTAIN_ANSWER = "知识库中不存在相关信息。"


# ─── 数据结构 ──────────────────────────────────────────

@dataclass
class Citation:
    """答案引用的知识库片段"""
    index: int          # 证据编号 (1-based, 对应 prompt 里的 [1])
    doc_id: str
    doc_title: str
    chunk_index: int
    text: str
    score: float

    def to_api(self) -> dict[str, Any]:
        return {
            "index": self.index,
            "docId": self.doc_id,
            "docTitle": self.doc_title,
            "chunkIndex": self.chunk_index,
            "text": self.text,
            "score": round(self.score, 4),
        }


@dataclass
class QAResult:
    """受控问答结果"""
    answer: str
    grounded: bool                      # True = 有知识库依据; False = 拒答
    reason: str                         # 判定说明 (拒答时指明卡在哪一层)
    citations: list[Citation] = field(default_factory=list)
    top_score: float = 0.0              # 检索最高分 (便于调阈值)
    gate: str = ""                      # 命中的门控: G1/G2/G3/G4/PASS

    def to_api(self) -> dict[str, Any]:
        return {
            "answer": self.answer,
            "grounded": self.grounded,
            "reason": self.reason,
            "gate": self.gate,
            "topScore": round(self.top_score, 4),
            "citations": [c.to_api() for c in self.citations],
        }


# ─── Prompt ────────────────────────────────────────────

SYSTEM_PROMPT = """你是一个严格受控的知识库问答助手。你唯一的信息来源是用户消息中给出的【知识库片段】。

铁律:
1. 只能使用【知识库片段】中的内容回答, 严禁使用你自己的任何先验知识、常识或推测。
2. 如果片段中没有直接回答问题的信息, 必须判定为无法回答, 不得拼凑、不得推断、不得"根据常识补充"。
3. 即使片段提到相关主题, 但没有正面回答用户所问的具体点, 也算无法回答。
4. 回答中每个事实性陈述都必须来自片段, 并在句末标注来源编号, 如 [1] 或 [1][2]。
5. 不要输出片段编号之外的引用, 不要编造片段编号。

输出格式: 必须是且仅是一个 JSON 对象, 不要包裹 markdown 代码块, 不要有任何额外文字。
{
  "grounded": true 或 false,
  "answer": "回答正文; grounded 为 false 时填空字符串",
  "used": [用到的片段编号, 整数数组; grounded 为 false 时填空数组]
}

判定 grounded 的标准: 片段中存在能直接支撑答案的明确内容。
仅仅"话题相关"不够, 必须是"问题能被片段直接回答"。
拿不准时一律 grounded=false。"""


def _build_evidence_block(results: list[Any]) -> str:
    """把检索结果拼成带编号的证据块"""
    parts: list[str] = []
    for i, r in enumerate(results, start=1):
        snippet = (r.chunk.text or "").strip()
        if len(snippet) > MAX_EVIDENCE_CHARS:
            snippet = snippet[:MAX_EVIDENCE_CHARS] + "…"
        title = r.doc_title or "未命名文档"
        parts.append(f"[{i}] 《{title}》 第{r.chunk.chunk_index + 1}段\n{snippet}")
    return "\n\n".join(parts)


def _parse_llm_json(raw: str) -> dict[str, Any] | None:
    """从 LLM 输出里稳健地抠出 JSON 对象"""
    if not raw:
        return None
    text = raw.strip()
    # 去掉可能的 ```json 包裹
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    try:
        obj = json.loads(text)
        return obj if isinstance(obj, dict) else None
    except Exception:
        pass
    # 兜底: 抓第一个 {...} 片段
    m = re.search(r"\{.*\}", text, re.DOTALL)
    if m:
        try:
            obj = json.loads(m.group(0))
            return obj if isinstance(obj, dict) else None
        except Exception:
            return None
    return None


# ─── 核心问答 ──────────────────────────────────────────

async def answer_from_kb(
    session_id: str,
    question: str,
    top_k: int = RETRIEVAL_TOP_K,
) -> QAResult:
    """受控问答主入口。

    严格只依据知识库回答; 证据不足则拒答。
    """
    question = (question or "").strip()
    if not question:
        return QAResult(
            answer=ABSTAIN_ANSWER, grounded=False,
            reason="问题为空", gate="G1",
        )

    namespace = get_kb_namespace(session_id)

    # ── 检索 ──
    try:
        results = await kb_store.search(namespace, question, limit=top_k)
    except Exception as e:
        return QAResult(
            answer=ABSTAIN_ANSWER, grounded=False,
            reason=f"检索失败: {e}", gate="G1",
        )

    # ── G1: 无检索结果 ──
    if not results:
        return QAResult(
            answer=ABSTAIN_ANSWER, grounded=False,
            reason="知识库中未检索到任何相关内容", gate="G1",
        )

    top_score = results[0].score

    # ── G2: 分数过低 (灰区以上才继续, 以下直接拒) ──
    if top_score < GRAY_ZONE_SCORE:
        return QAResult(
            answer=ABSTAIN_ANSWER, grounded=False,
            reason=f"检索相关度过低 (最高分 {top_score:.3f} < {GRAY_ZONE_SCORE})",
            top_score=top_score, gate="G2",
        )

    # ── 调 LLM 判定 + 生成 ──
    evidence = _build_evidence_block(results)
    user_msg = (
        f"【知识库片段】\n{evidence}\n\n"
        f"【用户问题】\n{question}\n\n"
        f"请严格按系统要求判断片段是否能直接回答该问题, 并以 JSON 输出。"
    )

    try:
        resp = await chat_completion(
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_msg},
            ],
            temperature=0.0,      # 受控问答要确定性, 不要发散
            max_tokens=1024,
        )
        raw = (resp.choices[0].message.content or "").strip()
    except Exception as e:
        return QAResult(
            answer=ABSTAIN_ANSWER, grounded=False,
            reason=f"模型调用失败: {e}", top_score=top_score, gate="G3",
        )

    parsed = _parse_llm_json(raw)

    # ── 解析失败: 保守拒答 (宁可不答, 不可乱答) ──
    if parsed is None:
        return QAResult(
            answer=ABSTAIN_ANSWER, grounded=False,
            reason="模型输出无法解析, 保守拒答", top_score=top_score, gate="G3",
        )

    # ── G3: 模型自评证据不足 ──
    if not parsed.get("grounded"):
        return QAResult(
            answer=ABSTAIN_ANSWER, grounded=False,
            reason="模型判定知识库片段无法直接回答该问题",
            top_score=top_score, gate="G3",
        )

    answer_text = str(parsed.get("answer") or "").strip()
    used_raw = parsed.get("used") or []

    # ── G4: 没有合法引用 → 视为幻觉 ──
    used: list[int] = []
    for u in used_raw if isinstance(used_raw, list) else []:
        try:
            idx = int(u)
        except Exception:
            continue
        if 1 <= idx <= len(results) and idx not in used:
            used.append(idx)

    if not answer_text or not used:
        return QAResult(
            answer=ABSTAIN_ANSWER, grounded=False,
            reason="模型给出的答案缺少合法片段引用, 判定为无依据",
            top_score=top_score, gate="G4",
        )

    # ── 组装引用 (按 used 顺序, 上限 MAX_CITATIONS) ──
    citations: list[Citation] = []
    for idx in used[:MAX_CITATIONS]:
        r = results[idx - 1]
        snippet = (r.chunk.text or "").strip()
        citations.append(Citation(
            index=idx,
            doc_id=r.chunk.doc_id,
            doc_title=r.doc_title or "未命名文档",
            chunk_index=r.chunk.chunk_index,
            text=snippet[:300] + ("…" if len(snippet) > 300 else ""),
            score=r.score,
        ))

    return QAResult(
        answer=answer_text,
        grounded=True,
        reason="答案有知识库片段支撑",
        citations=citations,
        top_score=top_score,
        gate="PASS",
    )
