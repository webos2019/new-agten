import React, { useEffect, useRef } from 'react'
import type { ChatMessage, ChatBlock } from '../types'

interface Props {
    messages: ChatMessage[]
    isStreaming: boolean
    streamingText: string
    streamingBlocks: ChatBlock[]
    error: string | null
    mode: string
}

// ─── Markdown render ─────────────────────────────────
function renderMarkdown(content: string): string {
    if (!content) return ''
    if (typeof (window as any).marked !== 'undefined') {
        ;(window as any).marked.setOptions({ breaks: true, gfm: true })
        let html = (window as any).marked.parse(content)
        const div = document.createElement('div')
        div.innerHTML = html
        div.querySelectorAll('pre code').forEach((block: any) => {
            if (typeof (window as any).hljs !== 'undefined') try { (window as any).hljs.highlightElement(block) } catch { /* skip */ }
        })
        div.querySelectorAll('pre').forEach((pre: any) => {
            const code = pre.querySelector('code')
            if (!code) return
            const wrapper = document.createElement('div')
            wrapper.className = 'code-block-wrapper'
            const header = document.createElement('div')
            header.className = 'code-block-header'
            const lang = code.className.match(/language-(\w+)/)
            header.innerHTML = '<span>' + (lang ? lang[1] : 'text') + '</span>'
            const copyBtn = document.createElement('button')
            copyBtn.className = 'code-block-copy'
            copyBtn.textContent = '📋 复制'
            copyBtn.onclick = () => { navigator.clipboard.writeText(code.textContent).then(() => { copyBtn.textContent = '✓ 已复制'; setTimeout(() => { copyBtn.textContent = '📋 复制' }, 2000) }) }
            header.appendChild(copyBtn)
            pre.parentNode.insertBefore(wrapper, pre)
            wrapper.appendChild(header)
            wrapper.appendChild(pre)
        })
        return div.innerHTML
    }
    return escapeHtml(content)
}

function escapeHtml(text: string): string {
    if (!text) return ''
    const div = document.createElement('div')
    div.textContent = String(text)
    return div.innerHTML
}

// ─── Structured block render ─────────────────────────
function renderBlock(block: ChatBlock, key: number): React.ReactNode {
    switch (block.type) {
        case 'reasoning':
            return (
                <div key={key} className="my-2 overflow-hidden rounded-xl border border-amber-200 bg-amber-50/80">
                    <details className="group" open>
                        <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-xs font-medium text-amber-700">⚡ 推理过程 <span className="ml-auto text-amber-500">点击展开/收起</span></summary>
                        <div className="border-t border-amber-200/50 px-3 py-2 text-xs leading-relaxed text-amber-800" dangerouslySetInnerHTML={{ __html: renderMarkdown(block.content || '') }} />
                    </details>
                </div>
            )
        case 'tool_call': {
            const argsStr = block.toolArgs ? Object.entries(block.toolArgs).map(([k, v]) => k + '=' + v).join(', ') : ''
            return (
                <div key={key} className="tool-call-block">
                    <div className="tool-call-header">
                        <span className="tool-call-name">🔧 {escapeHtml(block.toolName || '')}</span>
                        <span className="tool-result-badge success">执行中</span>
                    </div>
                    {argsStr && (
                        <div className="tool-call-args">
                            <div className="tool-call-args-label">输入</div>
                            <div className="tool-call-args-value">{escapeHtml(argsStr)}</div>
                        </div>
                    )}
                </div>
            )
        }
        case 'tool_result': {
            let displayResult = block.toolResult || ''
            let isError = false
            let weatherData: any = null
            try {
                const parsed = JSON.parse(displayResult)
                if (parsed.error) { displayResult = parsed.error; isError = true }
                else if (parsed.city && parsed.temperature !== undefined) weatherData = parsed
            } catch { /* not JSON */ }

            if (weatherData) {
                const rows: React.ReactNode[] = []
                if (weatherData.city) rows.push(<div key="city" className="weather-row"><span className="weather-label">城市</span><span className="weather-value">{weatherData.city}</span></div>)
                if (weatherData.weather) rows.push(<div key="w" className="weather-row"><span className="weather-label">天气</span><span className="weather-value">{weatherData.weather}</span></div>)
                if (weatherData.temperature != null) rows.push(<div key="t" className="weather-row"><span className="weather-label">温度</span><span className="weather-value">{weatherData.temperature}°C</span></div>)
                if (weatherData.humidity) rows.push(<div key="h" className="weather-row"><span className="weather-label">湿度</span><span className="weather-value">{weatherData.humidity}%</span></div>)
                return (
                    <div key={key} className="tool-result-block">
                        <div className="tool-result-header"><span className="tool-result-label">天气结果</span></div>
                        <div className="weather-result">{rows}</div>
                    </div>
                )
            }

            const success = !isError && block.isValid !== false
            return (
                <div key={key} className="tool-result-block" style={isError ? { borderColor: '#fecaca', background: 'rgba(254,242,242,0.5)' } : success ? { borderColor: '#bbf7d0', background: 'rgba(240,253,244,0.5)' } : {}}>
                    <div className="tool-result-header">
                        <span className="tool-result-label" style={isError ? { color: '#ef4444' } : success ? { color: '#22c55e' } : {}}>结果</span>
                        <span className={`tool-result-badge ${isError ? 'error' : 'success'}`}>{isError ? '✗ 失败' : '✓ 成功'}</span>
                    </div>
                    <div className="tool-result-content" style={isError ? { color: '#dc2626' } : {}}>
                        <pre>{escapeHtml(displayResult)}</pre>
                    </div>
                </div>
            )
        }
        case 'resource_start':
            return (
                <div key={key} className="resource-block">
                    <div className="resource-header">
                        <span className="resource-name">📖 {escapeHtml(block.resourceName || '')}</span>
                        <span className="tool-result-badge success">读取中</span>
                    </div>
                </div>
            )
        case 'resource_end':
            return (
                <div key={key} className="resource-block" style={{ borderColor: '#c7d2fe', background: '#fff' }}>
                    <div className="resource-header" style={{ borderColor: '#e0e7ff' }}>
                        <span style={{ color: '#6366f1' }}>资源内容</span>
                        <span className="tool-result-badge success">✓ 已读取</span>
                    </div>
                    <div className="resource-content">
                        <pre>{escapeHtml(block.content || '')}</pre>
                        {block.isTruncated && <div className="mt-2 text-[10px] text-gray-500">内容已截断</div>}
                    </div>
                </div>
            )
        case 'resource_error':
            return (
                <div key={key} className="tool-result-block" style={{ borderColor: '#fecaca', background: 'rgba(254,242,242,0.5)' }}>
                    <div className="tool-result-header" style={{ borderColor: '#fecaca' }}>
                        <span className="tool-result-label" style={{ color: '#ef4444' }}>读取失败</span>
                        <span className="tool-result-badge error">✗ 错误</span>
                    </div>
                    <div className="tool-result-content" style={{ color: '#dc2626' }}>
                        <pre>{escapeHtml(block.content || '')}</pre>
                    </div>
                </div>
            )
        case 'agent_step': {
            const stepIcon = block.status === 'success' ? '✓' : block.status === 'error' ? '✗' : block.status === 'pending' ? '⟳' : '•'
            const stepColor = block.status === 'success' ? 'var(--green-ok)' : block.status === 'error' ? 'var(--red-err)' : 'var(--cyan)'
            return (
                <div key={key} className="agent-step-block">
                    <div className="agent-step-header">
                        <span className="agent-step-icon" style={{ color: stepColor }}>{stepIcon}</span>
                        <span className="agent-step-title">{block.title || block.actionType || 'Agent 步骤'}</span>
                        {block.durationMs != null && (
                            <span className="agent-step-duration">{block.durationMs}ms</span>
                        )}
                        {block.status === 'pending' && (
                            <span className="agent-step-badge pending">执行中</span>
                        )}
                        {block.status === 'success' && (
                            <span className="agent-step-badge success">完成</span>
                        )}
                        {block.status === 'error' && (
                            <span className="agent-step-badge error">失败</span>
                        )}
                    </div>
                    {block.summary && (
                        <div className="agent-step-summary">{block.summary}</div>
                    )}
                </div>
            )
        }
        case 'text':
            return <div key={key} className="text-block" dangerouslySetInnerHTML={{ __html: renderMarkdown(block.content || '') }} />
        default:
            return null
    }
}

// ─── Message render ───────────────────────────────────
function renderMessage(msg: ChatMessage, isStreaming: boolean, sText: string | undefined, sBlocks: ChatBlock[] | undefined): React.ReactNode {
    const isUser = msg.role === 'user'
    if (msg.role === 'system') return null

    const allBlocks = isStreaming ? (sBlocks || []) : (msg.blocks || [])
    const textContent = isStreaming && sText !== undefined ? sText : msg.content
    const avatarClass = isUser ? 'user' : 'ai'
    const avatarText = isUser ? 'U' : 'AI'

    let content: React.ReactNode
    if (isUser) {
        let filesHtml: React.ReactNode = null
        if (msg.files && msg.files.length > 0) {
            filesHtml = (
                <div className="mb-2 flex flex-wrap gap-1.5">
                    {msg.files.map((f, i) => (
                        <span key={i} className="inline-flex items-center gap-1 rounded-md bg-white/20 px-2 py-0.5 text-xs">📄 {f.name}</span>
                    ))}
                </div>
            )
        }
        content = (
            <div className="user-bubble">
                {filesHtml}
                <div>{textContent || ''}</div>
            </div>
        )
    } else {
        let inner: React.ReactNode
        if (allBlocks.length > 0) {
            inner = allBlocks.map((b, i) => renderBlock(b, i))
        } else {
            inner = <div className="text-block" dangerouslySetInnerHTML={{ __html: renderMarkdown(textContent || '') }} />
        }
        if (isStreaming) {
            inner = <>{inner}<span className="streaming-cursor" /></>
        }
        content = <div className="ai-bubble">{inner}</div>
    }

    return (
        <div key={Math.random()} className={`msg-row ${isUser ? 'user' : 'assistant'}`}>
            <div className="msg-wrapper">
                <div className={`avatar ${avatarClass}`}>{avatarText}</div>
                <div className="msg-content">{content}</div>
            </div>
        </div>
    )
}

// ─── ChatBody ─────────────────────────────────────────
const ChatBody: React.FC<Props> = ({ messages, isStreaming, streamingText, streamingBlocks, error, mode }) => {
    const chatBodyRef = useRef<HTMLDivElement>(null)
    const isEmpty = messages.length === 0 && !isStreaming

    useEffect(() => {
        if (chatBodyRef.current) chatBodyRef.current.scrollTop = chatBodyRef.current.scrollHeight
    }, [messages, streamingText, streamingBlocks])

    // Feature cards
    const utilityFeatures = [
        { title: '数学计算', desc: '精确计算数学表达式' },
        { title: '日期时间', desc: '获取当前时间和日期' },
        { title: '单位换算', desc: '长度、重量、温度转换' },
        { title: '/ 斜杠命令', desc: '输入 / 调出命令菜单快速操作' },
    ]
    const readerFeatures = [
        { title: '目录列表', desc: '查看项目根目录文件' },
        { title: '文件读取', desc: '读取项目根目录下文本文件' },
        { title: '实时天气', desc: '查询指定城市实时天气' },
        { title: '@ 引用系统', desc: '输入 @ 引用工具、文件或上下文' },
    ]
    const features = mode === 'utility-skill' ? utilityFeatures : readerFeatures

    if (isEmpty) {
        return (
            <div className="chat-body" ref={chatBodyRef}>
                <div className="chat-content">
                    <div className="empty-state">
                        <div className="empty-icon-container">
                            <svg className="empty-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 2L2 7l10 5 10-5-10-5z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2 17l10 5 10-5" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2 12l10 5 10-5" />
                            </svg>
                        </div>
                        <h2 className="empty-title">{mode === 'utility-skill' ? '实用工具助手' : '文件与天气助手'}</h2>
                        <p className="empty-desc">
                            {mode === 'utility-skill'
                                ? '输入 / 查看命令菜单，@ 引用工具。支持数学计算、日期查询、单位换算等工具调用。'
                                : '输入 / 引用工具，@ 引用上下文。支持读取本地文件、查询实时天气、获取地理位置。'}
                        </p>
                        <div className="feature-grid">
                            {features.map((f, i) => (
                                <div key={i} className="feature-card">
                                    <div className={`feature-icon-container ${mode === 'reader-skill' ? 'feature-icon-purple' : ''}`}>
                                        <svg className="feature-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                                    </div>
                                    <h3 className="feature-title">{f.title}</h3>
                                    <p className="feature-desc">{f.desc}</p>
                                </div>
                            ))}
                        </div>
                        <div className="info-box">
                            <svg className="info-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                            支持流式错误自动恢复，始终保障服务可用
                        </div>
                    </div>
                </div>
            </div>
        )
    }

    let lastAssistantIndex = -1
    for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'assistant') { lastAssistantIndex = i; break }
    }

    return (
        <div className="chat-body" ref={chatBodyRef}>
            <div className="chat-content">
                <div className="messages-container">
                    {messages.map((msg, i) => {
                        const isLastAssistant = i === lastAssistantIndex && msg.role === 'assistant'
                        const showStreaming = isStreaming && isLastAssistant
                        return renderMessage(msg, showStreaming, showStreaming ? streamingText : undefined, showStreaming ? streamingBlocks : undefined)
                    })}
                    {isStreaming && lastAssistantIndex < 0 && renderMessage({ role: 'assistant', content: '' }, true, streamingText, streamingBlocks)}
                    {error && (
                        <div className="error-container">
                            <div className="error-content">
                                <svg className="error-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                <div className="error-text">
                                    <p className="error-title">出错了</p>
                                    <p className="error-msg">{error}</p>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}

export default ChatBody
