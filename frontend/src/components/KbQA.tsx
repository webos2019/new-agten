import React, { useState, useEffect, useRef, useCallback } from 'react'

/**
 * KbQA — 知识库对话式问答界面
 *
 * 与 KnowledgeBase.tsx 里的简易问答卡片不同, 这里是一套完整的对话界面:
 * 多轮消息流、逐条答案带门控标识与引用溯源、会话内历史、一键清空。
 *
 * 后端仍走 POST /api/kb/ask, 每次提问是独立的受控问答 (不带上下文),
 * 因为知识库问答的"只答库内内容"约束下, 多轮上下文反而会引入幻觉。
 */

interface KBDoc {
    docId: string
    title: string
    sourceType: string
    chunkCount: number
    charCount: number
}

interface Citation {
    index: number
    docId: string
    docTitle: string
    chunkIndex: number
    text: string
    score: number
}

interface QAResponse {
    answer: string
    grounded: boolean
    reason: string
    gate: string
    topScore: number
    citations: Citation[]
}

interface Turn {
    id: number
    question: string
    result: QAResponse | null
    error: string
    loading: boolean
    ts: number
}

interface Props {
    sessionId: string
}

const GATE_LABEL: Record<string, string> = {
    G1: '未检索到相关内容',
    G2: '相关度过低',
    G3: '证据不足以回答',
    G4: '答案缺少出处',
    PASS: '有依据',
}

const SUGGESTIONS = [
    '知识库里有哪些文档？',
    '这个系统的端口是多少？',
    '文档里提到的部署方式是什么？',
]

const KbQA: React.FC<Props> = ({ sessionId }) => {
    const [turns, setTurns] = useState<Turn[]>([])
    const [input, setInput] = useState('')
    const [asking, setAsking] = useState(false)
    const [docs, setDocs] = useState<KBDoc[]>([])
    const [stats, setStats] = useState<{ documents: number; chunks: number } | null>(null)
    const turnIdRef = useRef(0)
    const listRef = useRef<HTMLDivElement>(null)

    // 加载知识库概况
    const loadOverview = useCallback(async () => {
        try {
            const resp = await fetch('/api/kb/documents')
            const data = await resp.json()
            const all: KBDoc[] = data.documents || []
            // 只统计属于当前 session 的文档
            const mine = all.filter((d: any) =>
                !d.namespace || d.namespace === `kb:${sessionId}`
            )
            setDocs(mine)
            setStats({ documents: mine.length, chunks: mine.reduce((s, d) => s + d.chunkCount, 0) })
        } catch { /* ignore */ }
    }, [sessionId])

    useEffect(() => {
        loadOverview()
    }, [loadOverview])

    // 新消息滚到底
    useEffect(() => {
        if (listRef.current) {
            listRef.current.scrollTop = listRef.current.scrollHeight
        }
    }, [turns])

    const ask = async (question: string) => {
        const q = question.trim()
        if (!q || !sessionId || asking) return

        const id = ++turnIdRef.current
        const turn: Turn = { id, question: q, result: null, error: '', loading: true, ts: Date.now() }
        setTurns(prev => [...prev, turn])
        setInput('')
        setAsking(true)

        try {
            const resp = await fetch('/api/kb/ask', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId, question: q }),
            })
            const data = await resp.json()
            setTurns(prev => prev.map(t =>
                t.id === id
                    ? { ...t, loading: false, result: resp.ok ? (data as QAResponse) : null, error: resp.ok ? '' : (data.error || '问答失败') }
                    : t
            ))
        } catch {
            setTurns(prev => prev.map(t =>
                t.id === id ? { ...t, loading: false, error: '网络错误' } : t
            ))
        } finally {
            setAsking(false)
        }
    }

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            ask(input)
        }
    }

    const clearAll = () => {
        if (turns.length === 0) return
        if (confirm('清空当前问答记录？')) setTurns([])
    }

    return (
        <div className="kbqa-page">
            {/* 顶部概况栏 */}
            <div className="kbqa-topbar">
                <div className="kbqa-topbar-left">
                    <h2 className="kbqa-title">知识库问答</h2>
                    <span className="kbqa-subtitle">只依据知识库内容作答，无依据时明确告知不存在</span>
                </div>
                <div className="kbqa-topbar-right">
                    {stats && (
                        <div className="kbqa-stats">
                            <span className="kbqa-stat"><b>{stats.documents}</b> 文档</span>
                            <span className="kbqa-stat"><b>{stats.chunks}</b> 片段</span>
                        </div>
                    )}
                    <button className="kbqa-clear-btn" onClick={clearAll} disabled={turns.length === 0}>
                        清空记录
                    </button>
                </div>
            </div>

            {/* 消息流 */}
            <div className="kbqa-list" ref={listRef}>
                {turns.length === 0 ? (
                    <div className="kbqa-empty">
                        <div className="kbqa-empty-icon">Q</div>
                        <div className="kbqa-empty-title">向知识库提问</div>
                        <div className="kbqa-empty-desc">
                            {docs.length === 0
                                ? '知识库还是空的，请先到「知识库」页面上传文档'
                                : '答案只会来自知识库内容；找不到依据时会直接告知不存在'}
                        </div>
                        {docs.length > 0 && (
                            <div className="kbqa-suggestions">
                                {SUGGESTIONS.map((s, i) => (
                                    <button key={i} className="kbqa-suggestion" onClick={() => ask(s)}>
                                        {s}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                ) : (
                    turns.map(turn => (
                        <div key={turn.id} className="kbqa-turn">
                            {/* 用户问题 */}
                            <div className="kbqa-question-row">
                                <div className="kbqa-question-bubble">{turn.question}</div>
                            </div>

                            {/* 助手回答 */}
                            <div className="kbqa-answer-row">
                                {turn.loading ? (
                                    <div className="kbqa-loading">
                                        <span className="kbqa-dot" />
                                        <span className="kbqa-dot" />
                                        <span className="kbqa-dot" />
                                        <span className="kbqa-loading-text">检索知识库中...</span>
                                    </div>
                                ) : turn.error ? (
                                    <div className="kbqa-answer-card error">
                                        <div className="kbqa-answer-status">
                                            <span className="kbqa-badge err">请求失败</span>
                                        </div>
                                        <div className="kbqa-answer-text">{turn.error}</div>
                                    </div>
                                ) : turn.result ? (
                                    turn.result.grounded ? (
                                        <div className="kbqa-answer-card ok">
                                            <div className="kbqa-answer-status">
                                                <span className="kbqa-badge ok">有依据</span>
                                                <span className="kbqa-meta">匹配度 {turn.result.topScore.toFixed(3)}</span>
                                            </div>
                                            <div className="kbqa-answer-text">{turn.result.answer}</div>
                                            {turn.result.citations.length > 0 && (
                                                <div className="kbqa-citations">
                                                    <div className="kbqa-citations-label">引用来源</div>
                                                    {turn.result.citations.map(c => (
                                                        <div key={c.index} className="kbqa-citation">
                                                            <div className="kbqa-citation-head">
                                                                <span className="kbqa-citation-idx">[{c.index}]</span>
                                                                <span className="kbqa-citation-doc">{c.docTitle}</span>
                                                                <span className="kbqa-citation-chunk">片段 {c.chunkIndex + 1}</span>
                                                                <span className="kbqa-citation-score">{c.score.toFixed(3)}</span>
                                                            </div>
                                                            <div className="kbqa-citation-text">{c.text}</div>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    ) : (
                                        <div className="kbqa-answer-card no">
                                            <div className="kbqa-answer-status">
                                                <span className="kbqa-badge no">不存在</span>
                                                <span className="kbqa-meta">
                                                    {GATE_LABEL[turn.result.gate] || turn.result.gate}
                                                </span>
                                            </div>
                                            <div className="kbqa-answer-text">{turn.result.answer}</div>
                                            <div className="kbqa-answer-reason">{turn.result.reason}</div>
                                        </div>
                                    )
                                ) : null}
                            </div>
                        </div>
                    ))
                )}
            </div>

            {/* 输入区 */}
            <div className="kbqa-inputbar">
                <textarea
                    className="kbqa-input"
                    placeholder="输入问题，Enter 发送，Shift+Enter 换行"
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    rows={1}
                    disabled={asking}
                />
                <button
                    className="kbqa-send-btn"
                    onClick={() => ask(input)}
                    disabled={asking || !input.trim()}
                >
                    {asking ? '思考中' : '提问'}
                </button>
            </div>
        </div>
    )
}

export default KbQA
