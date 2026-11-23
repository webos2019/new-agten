import React, { useState, useCallback, useRef, useEffect } from 'react'
import { HighlightedMarkdown } from './markdown/HighlightedMarkdown'
import { latexToSpeechText, latexToUnicodeMath } from '../lib/mathText'
import { collapseRepeatedParagraphs } from '../lib/repeatCollapse'

// ─── Types ────────────────────────────────────────────

interface ChatMsg {
    role: 'user' | 'assistant'
    content: string
    timestamp: string
    loading?: boolean
}

interface VoiceOption {
    name: string
    locale: string
    gender: string
    friendly_name: string
}

// ─── 常量 ─────────────────────────────────────────────

const POPULAR_VOICES = [
    { name: 'zh-CN-XiaoxiaoNeural', label: '晓晓 (女·温柔)', flag: '🇨🇳' },
    { name: 'zh-CN-YunxiNeural', label: '云希 (男·成熟)', flag: '🇨🇳' },
    { name: 'zh-CN-YunyangNeural', label: '云扬 (男·新闻)', flag: '🇨🇳' },
    { name: 'zh-CN-XiaoyiNeural', label: '晓伊 (女·活泼)', flag: '🇨🇳' },
    { name: 'zh-HK-HiuMaanNeural', label: '曉曼 (女·粵語)', flag: '🇭🇰' },
    { name: 'zh-TW-HsiaoChenNeural', label: '曉臻 (女·台灣)', flag: '🇹🇼' },
    { name: 'en-US-JennyNeural', label: 'Jenny (Female)', flag: '🇺🇸' },
    { name: 'en-US-GuyNeural', label: 'Guy (Male)', flag: '🇺🇸' },
]

// ─── 音量 ─────────────────────────────────────────────
// 存 0~100 的整数, 与 <audio>.volume 的 0~1 差一个除法。
export const VOLUME_STORAGE_KEY = 'voice_volume'
export const DEFAULT_VOLUME = 80
export const VOLUME_STEP = 5

/** 只有 0~100 范围内的值才用(取到最近档位); 存坏了/没存过/隐私模式读不到 → 回落默认 */
export function readStoredVolume(): number {
    try {
        const raw = localStorage.getItem(VOLUME_STORAGE_KEY)
        if (raw === null) return DEFAULT_VOLUME
        const n = Number(raw)
        if (!Number.isFinite(n) || n > 100) return DEFAULT_VOLUME
        if (n <= 0) return 0
        return Math.max(VOLUME_STEP, Math.round(n / VOLUME_STEP) * VOLUME_STEP)
    } catch {
        return DEFAULT_VOLUME
    }
}

/** 供其它播放路径复用: 0~100 → HTMLAudioElement.volume 的 0~1 */
export function toAudioVolume(percent: number): number {
    return Math.min(100, Math.max(0, percent)) / 100
}

// ─── 语音通道只要最终结果 ─────────────────────────────
// /api/chat 的流里, 每一轮的文字都是同一种 {"type":"text"} chunk, 前端分不出来:
//   · 带工具调用的那一轮 → 通常只有一句过程旁白
//   · 最后一轮 → 才是结论
// 编排器还会往同一条流里插机制提示(⚠️ 开头那几行),
// 它既不是模型的话也不是答案, 语音里念出来纯属噪音。
// 所以: 遇到 tool_call/tool_result 就把已经攒的这段丢掉, 最后只留末段。
const VOICE_MACHINERY_LINES: RegExp[] = [
    /^⚠️ 请先通过 @ 引用一个/,
]

/** 去掉编排器注入的机制提示行; 顺带收一下它们留下的空行 */
export function stripVoiceMachinery(text: string): string {
    if (!text) return ''
    return text
        .split('\n')
        .filter(ln => !VOICE_MACHINERY_LINES.some(re => re.test(ln.trim())))
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
}

/** 语音气泡/朗读前的统一清洗: 先删机制行, 最后折复读块 */
export function cleanVoiceReply(text: string): string {
    return collapseRepeatedParagraphs(stripVoiceMachinery(text))
}

/**
 * 把一条流的 chunk 收成"该显示/该念的那一句"。
 * text() 攒当前段, toolBoundary() 在工具 chunk 到来时封存当前段,
 * live() 给流式期间的气泡, finish() 给 done 之后。
 * 兜底: 末段为空(答案停在工具调用之后没再出字)时回退到最近一段非空文本。
 */
export function createVoiceReplyTracker() {
    let current = ''
    let lastNonEmpty = ''
    const seal = () => {
        const seg = cleanVoiceReply(current)
        if (seg) lastNonEmpty = seg
        current = ''
    }
    return {
        text(content: string) { current += content },
        toolBoundary() { seal() },
        live(): string { return cleanVoiceReply(current) },
        finish(): string { seal(); return lastNonEmpty },
    }
}

// ─── Component ─────────────────────────────────────────

interface VoiceChatProps {
    /** 使用与主聊天页面相同的 sessionId，确保会话一致 */
    sessionId?: string
}

const VoiceChat: React.FC<VoiceChatProps> = ({ sessionId }) => {
    const [messages, setMessages] = useState<ChatMsg[]>([])
    const [listening, setListening] = useState(false)
    const [speaking, setSpeaking] = useState(false)
    const [thinking, setThinking] = useState(false)
    const [voice, setVoice] = useState('zh-CN-XiaoxiaoNeural')
    const [rate, setRate] = useState(0)  // 纯数字 -50 ~ 100
    // ── 音量 (0~100, 直接映射到 <audio>.volume 的 0~1) ──
    // 与语速不同：语速是每次合成时发给 TTS 的参数，音量是本地播放增益，
    // 所以要落到 audio 元素上，并且记住（音量记在 localStorage，语速没记）。
    const [volume, setVolume] = useState<number>(() => readStoredVolume())
    const prevVolumeRef = useRef<number>(volume > 0 ? volume : DEFAULT_VOLUME)
    const [interimText, setInterimText] = useState('')
    const [autoSpeak, setAutoSpeak] = useState(true)
    const [voices, setVoices] = useState<VoiceOption[]>([])
    const [ttsError, setTtsError] = useState<string | null>(null)
    const lastSpokenTextRef = useRef<string>('')

    // ── 使用与主聊天页面统一的 sessionId ──
    const [voiceSessionId, setVoiceSessionId] = useState<string>(() => {
        if (sessionId) return sessionId
        let sid = localStorage.getItem('voice_session_id')
        if (!sid) {
            sid = 'voice_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
            localStorage.setItem('voice_session_id', sid)
        }
        return sid
    })
    const [voiceConversationId, setVoiceConversationId] = useState<string | null>(
        () => localStorage.getItem('voice_conversation_id') || null,
    )

    const recognitionRef = useRef<any>(null)
    const audioRef = useRef<HTMLAudioElement | null>(null)
    const messagesEndRef = useRef<HTMLDivElement | null>(null)
    const sendMsgRef = useRef<(text: string) => void>(() => {})
    const abortRef = useRef<AbortController | null>(null)  // 中止流式请求

    // ─── 音量：落到那一个 <audio> 元素上，并且记住 ───
    useEffect(() => {
        if (audioRef.current) audioRef.current.volume = toAudioVolume(volume)
        if (volume > 0) prevVolumeRef.current = volume
        try {
            localStorage.setItem(VOLUME_STORAGE_KEY, String(volume))
        } catch { /* 存不下只影响下次进来的记忆, 当前这一屏照样生效 */ }
    }, [volume])

    /** 静音/取消静音：记住静音前的那一格，不是硬弹回 80 */
    const toggleMute = () => {
        if (volume > 0) {
            prevVolumeRef.current = volume
            setVolume(0)
        } else {
            setVolume(prevVolumeRef.current > 0 ? prevVolumeRef.current : DEFAULT_VOLUME)
        }
    }

    // ─── 当父组件传入的 sessionId 变化时 ──
    useEffect(() => {
        if (!sessionId) return
        if (sessionId !== voiceSessionId) {
            setVoiceSessionId(sessionId)
            setVoiceConversationId(null)
            localStorage.removeItem('voice_conversation_id')
            setMessages([])
        }
    }, [sessionId]) // eslint-disable-line react-hooks/exhaustive-deps

    // ─── 挂载时 / sessionId 就绪后加载已有对话历史 ───
    // 本会话里已经自己发过消息 → 不再拿"库里的历史"覆盖本地列表。
    const sentInSessionRef = useRef(false)
    useEffect(() => {
        if (!voiceConversationId || !voiceSessionId) return
        fetch(`/api/conversations/${voiceConversationId}?session_id=${voiceSessionId}`)
            .then(r => {
                if (!r.ok) throw new Error('not found')
                return r.json()
            })
            .then(data => {
                if (sentInSessionRef.current) return
                if (data.messages && data.messages.length > 0) {
                    const loaded: ChatMsg[] = data.messages.map((m: any) => ({
                        role: m.role === 'assistant' ? 'assistant' : 'user',
                        content: cleanVoiceReply(m.text || ''),
                        timestamp: new Date((m.createdAt || Date.now() / 1000) * 1000)
                            .toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
                    }))
                    setMessages(loaded)
                }
            })
            .catch(() => {
                setVoiceConversationId(null)
                localStorage.removeItem('voice_conversation_id')
            })
    }, [voiceSessionId, voiceConversationId])

    // ─── 初始化语音识别 ───
    useEffect(() => {
        const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
        if (SR) {
            const rec = new SR()
            rec.lang = 'zh-CN'
            rec.continuous = false
            rec.interimResults = true

            rec.onresult = (e: any) => {
                let interim = ''
                let final = ''
                for (let i = e.resultIndex; i < e.results.length; i++) {
                    const transcript = e.results[i][0].transcript
                    if (e.results[i].isFinal) {
                        final += transcript
                    } else {
                        interim += transcript
                    }
                }
                if (interim) setInterimText(interim)
                if (final) {
                    setInterimText('')
                    sendMsgRef.current(final.trim())
                }
            }

            rec.onerror = (e: any) => {
                console.error('Speech recognition error:', e.error)
                setListening(false)
            }

            rec.onend = () => {
                setListening(false)
            }

            recognitionRef.current = rec
        }

        return () => {
            try { recognitionRef.current?.abort() } catch {}
        }
    }, [])

    // ─── 加载语音列表 ───
    useEffect(() => {
        fetch('/api/tts/voices')
            .then(r => r.json())
            .then(data => {
                if (data.voices) setVoices(data.voices)
            })
            .catch(() => {})
    }, [])

    // ─── 自动滚动 ───
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [messages, interimText, thinking])

    // ─── 发送消息到 LLM ───
    const sendMsg = useCallback(async (text: string) => {
        if (!text.trim()) return
        // 本地已经有这一轮了 → 之后别再用库里的历史覆盖
        sentInSessionRef.current = true

        const now = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
        const userMsg: ChatMsg = { role: 'user', content: text, timestamp: now }
        setMessages(prev => [...prev, userMsg])
        setThinking(true)

        // 添加 assistant 占位
        const assistantTs = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
        setMessages(prev => [...prev, { role: 'assistant', content: '', timestamp: assistantTs, loading: true }])

        try {
            // ── 确保有 conversation (首次消息时创建) ──
            let convId = voiceConversationId
            let shouldCreate = false
            if (!convId) {
                try {
                    const convResp = await fetch('/api/conversations', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            sessionId: voiceSessionId,
                            title: text.slice(0, 40) || '语音对话',
                        }),
                    })
                    const convData = await convResp.json()
                    if (convData.conversationId) {
                        convId = convData.conversationId as string
                        setVoiceConversationId(convId)
                        localStorage.setItem('voice_conversation_id', convId)
                    }
                } catch {
                    shouldCreate = true
                }
            }

            const requestBody: Record<string, unknown> = {
                messages: [{ role: 'user', content: text }],
                sessionId: voiceSessionId,
                skill: 'utility-skill',
            }
            if (convId) {
                requestBody.conversationId = convId
            } else if (shouldCreate) {
                requestBody.createConversation = true
            }

            // 创建 AbortController 以支持中途停止
            const controller = new AbortController()
            abortRef.current = controller

            const resp = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody),
                signal: controller.signal,
            })

            if (!resp.ok) {
                const errData = await resp.json().catch(() => ({ error: '请求失败' }))
                throw new Error(errData.error || `HTTP ${resp.status}`)
            }

            const reader = resp.body?.getReader()
            if (!reader) return

            const decoder = new TextDecoder()
            let buffer = ''
            const reply = createVoiceReplyTracker()

            while (true) {
                const { done, value } = await reader.read()
                if (done) break

                buffer += decoder.decode(value, { stream: true })
                const lines = buffer.split('\n')
                buffer = lines.pop() || ''

                for (const line of lines) {
                    if (!line.trim()) continue
                    try {
                        const data = JSON.parse(line)
                        if (data.type === 'text' && data.content) {
                            reply.text(data.content)
                            const shown = reply.live()
                            setMessages(prev => prev.map((m, i) =>
                                i === prev.length - 1
                                    ? { ...m, content: shown, loading: shown === '' }
                                    : m
                            ))
                        } else if (data.type === 'tool_call' || data.type === 'tool_result') {
                            // 上一段是"让我查一下"式旁白, 语音窗口不收它, 气泡退回"还在忙"。
                            reply.toolBoundary()
                            setMessages(prev => prev.map((m, i) =>
                                i === prev.length - 1
                                    ? { ...m, content: '', loading: true }
                                    : m
                            ))
                        } else if (data.type === 'done' || data.type === 'end') {
                            const answer = reply.finish()
                            setMessages(prev => prev.map((m, i) =>
                                i === prev.length - 1
                                    ? { ...m, content: answer || '(空回复)', loading: false }
                                    : m
                            ))
                        } else if (data.type === 'error') {
                            setMessages(prev => prev.map((m, i) =>
                                i === prev.length - 1
                                    ? { ...m, content: '❌ ' + (data.error || '未知错误'), loading: false }
                                    : m
                            ))
                        }
                        // 注: 本项目流式协议无 usage chunk, 忽略未知类型即可
                    } catch { /* skip */ }
                }
            }

            // 完成 — 清理 abortRef
            abortRef.current = null
            setThinking(false)
            // 念的是"最终结果"那一段, 不是整条流(过程旁白已在工具边界处丢掉)。
            const spoken = reply.finish()
            if (autoSpeak && spoken) {
                synthesize(spoken)
            }
        } catch (e) {
            abortRef.current = null
            setThinking(false)
            // 用户主动中止 — 不显示错误
            if ((e as Error).name === 'AbortError') {
                setMessages(prev => prev.map((m, i) =>
                    i === prev.length - 1
                        ? { ...m, loading: false }
                        : m
                ))
            } else {
                setMessages(prev => prev.map((m, i) =>
                    i === prev.length - 1
                        ? { ...m, content: '❌ 请求失败: ' + (e as Error).message, loading: false }
                        : m
                ))
            }
        }
    }, [autoSpeak, voice, rate, voiceSessionId, voiceConversationId])

    // 保持 ref 始终指向最新的 sendMsg（避免闭包陷阱）
    // ⚠️ 必须放在 sendMsg 定义之后，否则 const TDZ 报错
    useEffect(() => { sendMsgRef.current = sendMsg }, [sendMsg])

    // ─── 语音合成 (TTS) ───
    const synthesize = useCallback(async (text: string, isRetry = false) => {
        // 数学 LaTeX → 中文口语文本, 再去 markdown 标记
        const spoken = latexToSpeechText(text)
        const clean = spoken.replace(/```[\s\S]*?```/g, '代码块').replace(/[#*`_~\[\]]/g, '').trim()
        if (!clean) return

        // 格式化 rate: 数字 → "+0%" / "-50%" / "+100%"
        const rateStr = `${rate >= 0 ? '+' : ''}${rate}%`

        setSpeaking(true)
        setTtsError(null)
        lastSpokenTextRef.current = clean

        try {
            const resp = await fetch('/api/tts/synthesize', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: clean, voice, rate: rateStr }),
            })

            if (!resp.ok) {
                const err = await resp.json().catch(() => ({ error: '未知错误' }))
                throw new Error(err.error || `HTTP ${resp.status}`)
            }

            const blob = await resp.blob()

            if (blob.size === 0) {
                throw new Error('合成音频为空')
            }

            const url = URL.createObjectURL(blob)

            if (audioRef.current) {
                audioRef.current.src = url
                audioRef.current.onended = () => {
                    setSpeaking(false)
                    URL.revokeObjectURL(url)
                }
                audioRef.current.onerror = (e) => {
                    console.error('Audio playback error:', e)
                    setSpeaking(false)
                    setTtsError('音频播放失败，可能是浏览器不支持该音频格式')
                }
                audioRef.current.play().catch((playErr) => {
                    console.error('Audio play() rejected:', playErr)
                    setSpeaking(false)
                    setTtsError('音频播放被浏览器阻止，请点击页面后重试')
                })
            }
        } catch (e) {
            console.error('TTS error:', e)
            setSpeaking(false)
            setTtsError(isRetry ? `重试失败: ${(e as Error).message}` : `语音合成失败: ${(e as Error).message}`)
        }
    }, [voice, rate])

    // 重试 TTS
    const retryTTS = useCallback(() => {
        if (lastSpokenTextRef.current) {
            synthesize(lastSpokenTextRef.current, true)
        }
    }, [synthesize])

    // ─── 开始/停止语音识别 ───
    const toggleListen = useCallback(() => {
        if (listening) {
            recognitionRef.current?.stop()
            setListening(false)
        } else {
            // 停止当前播放
            if (audioRef.current) {
                audioRef.current.pause()
                setSpeaking(false)
            }
            setInterimText('')
            try {
                recognitionRef.current?.start()
                setListening(true)
            } catch (e) {
                console.error('Failed to start recognition:', e)
            }
        }
    }, [listening])

    // ─── 手动发送 ───
    const [manualText, setManualText] = useState('')
    const handleManualSend = useCallback(() => {
        if (!manualText.trim()) return
        sendMsg(manualText.trim())
        setManualText('')
    }, [manualText, sendMsg])

    // ─── 重播某条消息 ───
    const replayMsg = useCallback((msg: ChatMsg) => {
        synthesize(msg.content)
    }, [synthesize])

    // ─── 停止播放 ───
    const stopSpeaking = useCallback(() => {
        if (audioRef.current) {
            audioRef.current.pause()
            setSpeaking(false)
        }
    }, [])

    // ─── 停止生成 (中止流式请求 + 停止 TTS) ───
    const stopGenerating = useCallback(() => {
        if (abortRef.current) {
            abortRef.current.abort()
            abortRef.current = null
        }
        setThinking(false)
        if (audioRef.current) {
            audioRef.current.pause()
            setSpeaking(false)
        }
        setMessages(prev => prev.map((m, i) =>
            i === prev.length - 1 ? { ...m, loading: false } : m
        ))
    }, [])

    // ─── 开始新对话 (清空当前对话状态) ───
    const startNewConversation = useCallback(() => {
        setVoiceConversationId(null)
        localStorage.removeItem('voice_conversation_id')
        setMessages([])
        if (audioRef.current) {
            audioRef.current.pause()
            setSpeaking(false)
        }
    }, [])

    const srSupported = !!(window as any).SpeechRecognition || !!(window as any).webkitSpeechRecognition

    return (
        <div className="voicechat-page">
            {/* ─── 顶部控制栏 ─── */}
            <div className="voicechat-toolbar">
                <div className="voicechat-voice-select">
                    <label className="voicechat-label">语音角色</label>
                    <select
                        className="voicechat-select"
                        value={voice}
                        onChange={e => setVoice(e.target.value)}
                    >
                        {POPULAR_VOICES.map(v => (
                            <option key={v.name} value={v.name}>
                                {v.flag} {v.label}
                            </option>
                        ))}
                        {voices.length > 0 && <optgroup label="── 全部语音 ──">
                            {voices.filter(v => !POPULAR_VOICES.some(p => p.name === v.name)).map(v => (
                                <option key={v.name} value={v.name}>
                                    {v.locale} · {v.gender === 'Female' ? '女' : '男'} · {v.name}
                                </option>
                            ))}
                        </optgroup>}
                    </select>
                </div>

                <div className="voicechat-rate">
                    <label className="voicechat-label">语速 {rate >= 0 ? '+' : ''}{rate}%</label>
                    <input
                        type="range"
                        min={-50}
                        max={100}
                        step={10}
                        value={rate}
                        onChange={e => setRate(parseInt(e.target.value))}
                        className="voicechat-slider"
                    />
                </div>

                {/* 音量：本地播放增益，跟语速(发给 TTS 的合成参数)是两回事，所以单独一格 */}
                <div className="voicechat-rate voicechat-volume">
                    <label className="voicechat-label">音量 {volume}%</label>
                    <input
                        type="range"
                        min={0}
                        max={100}
                        step={VOLUME_STEP}
                        value={volume}
                        onChange={e => setVolume(parseInt(e.target.value))}
                        className="voicechat-slider"
                        title="拖动调节播报音量"
                        aria-label="播报音量"
                    />
                    <button
                        type="button"
                        className={`voicechat-mute-btn${volume === 0 ? ' muted' : ''}`}
                        onClick={toggleMute}
                        title={volume === 0 ? '取消静音' : '静音'}
                    >
                        {volume === 0 ? '🔇' : volume < 40 ? '🔈' : volume < 75 ? '🔉' : '🔊'}
                    </button>
                </div>

                <label className="voicechat-autospeak">
                    <input
                        type="checkbox"
                        checked={autoSpeak}
                        onChange={e => setAutoSpeak(e.target.checked)}
                    />
                    <span>自动播报</span>
                </label>

                {messages.length > 0 && (
                    <button
                        className="voicechat-new-conv-btn"
                        onClick={startNewConversation}
                        title="开始新对话"
                    >
                        ✨ 新对话
                    </button>
                )}
            </div>

            {/* ─── 消息区域 ─── */}
            <div className="voicechat-messages">
                {messages.length === 0 && (
                    <div className="voicechat-welcome">
                        <div className="voicechat-welcome-icon">🎙️</div>
                        <h2 className="voicechat-welcome-title">语音对话</h2>
                        <p className="voicechat-welcome-sub">
                            点击下方麦克风按钮开始说话，AI 回复后自动语音播报
                        </p>
                        <div className="voicechat-welcome-hint">
                            {!srSupported && '⚠️ 当前浏览器不支持语音识别，可手动输入文字对话'}
                        </div>
                    </div>
                )}

                {messages.map((msg, i) => (
                    <div key={i} className={`voicechat-msg ${msg.role}`}>
                        <div className="voicechat-msg-avatar">
                            {msg.role === 'user' ? '👤' : '🤖'}
                        </div>
                        <div className="voicechat-msg-bubble">
                            {msg.loading ? (
                                <span className="voicechat-typing">
                                    <span className="dot" /> <span className="dot" /> <span className="dot" />
                                </span>
                            ) : (
                                <>
                                    <div className="voicechat-msg-text text-block">
                                        <HighlightedMarkdown
                                            content={msg.role === 'assistant' ? latexToUnicodeMath(msg.content || '') : (msg.content || '')}
                                        />
                                    </div>
                                    <div className="voicechat-msg-footer">
                                        <span className="voicechat-msg-time">{msg.timestamp}</span>
                                        {msg.role === 'assistant' && (
                                            <button
                                                className="voicechat-replay-btn"
                                                onClick={() => replayMsg(msg)}
                                                title="重新播放语音"
                                            >
                                                🔊 播放
                                            </button>
                                        )}
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                ))}

                {/* 语音识别中间结果 */}
                {interimText && (
                    <div className="voicechat-msg user">
                        <div className="voicechat-msg-avatar">👤</div>
                        <div className="voicechat-msg-bubble interim">
                            <div className="voicechat-msg-text">{interimText}...</div>
                        </div>
                    </div>
                )}

                {thinking && !interimText && messages.length > 0 && messages[messages.length - 1].loading && (
                    <div className="voicechat-thinking">AI 正在思考...</div>
                )}

                <div ref={messagesEndRef} />
            </div>

            {/* ─── 底部操作区 ─── */}
            <div className="voicechat-input-area">
                <input
                    type="text"
                    className="voicechat-text-input"
                    placeholder="或在此输入文字..."
                    value={manualText}
                    onChange={e => setManualText(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleManualSend() }}
                />

                {(speaking || thinking) ? (
                    <button
                        className="voicechat-stop-btn"
                        onClick={thinking ? stopGenerating : stopSpeaking}
                        title={thinking ? '停止生成' : '停止播放'}
                    >
                        <span className="voicechat-stop-icon">⏹</span>
                    </button>
                ) : null}

                <button
                    className={`voicechat-mic-btn ${listening ? 'listening' : ''} ${!srSupported ? 'disabled' : ''}`}
                    onClick={toggleListen}
                    disabled={!srSupported}
                    title={listening ? '点击停止' : '点击说话'}
                >
                    {listening ? (
                        <span className="voicechat-mic-pulse">
                            <span className="voicechat-mic-wave" />
                            <span className="voicechat-mic-wave delay1" />
                            <span className="voicechat-mic-wave delay2" />
                        </span>
                    ) : null}
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
                        <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
                    </svg>
                </button>
            </div>

            {/* ─── TTS 错误提示 ─── */}
            {ttsError && (
                <div className="voicechat-tts-error">
                    <span className="voicechat-tts-error-icon">⚠️</span>
                    <span className="voicechat-tts-error-text">{ttsError}</span>
                    <button className="voicechat-tts-retry-btn" onClick={retryTTS} title="重试语音合成">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                            <path d="M1 4v6h6" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                        </svg>
                        重试
                    </button>
                    <button className="voicechat-tts-dismiss-btn" onClick={() => setTtsError(null)} title="关闭">
                        ✕
                    </button>
                </div>
            )}

            <audio ref={audioRef} />
        </div>
    )
}

export default VoiceChat
