import React from 'react'

interface Props {
    mode: string
    onSetMode: (mode: string) => void
    hasMessages: boolean
    onRegenerate: () => void
    onClear: () => void
}

const Header: React.FC<Props> = ({ mode, onSetMode, hasMessages, onRegenerate, onClear }) => {
    const subtitle = mode === 'utility-skill' ? '实用工具模式' : '文件与天气模式'
    return (
        <header className="header">
            <div className="header-left">
                <div className="header-icon">&lt;/&gt;</div>
                <div>
                    <h1 className="header-title">AI 助手</h1>
                    <p className="header-subtitle">{subtitle}</p>
                </div>
            </div>
            <div className="header-right">
                <div className="mode-selector">
                    <button
                        className={`mode-btn ${mode === 'utility-skill' ? 'active' : ''}`}
                        onClick={() => onSetMode('utility-skill')}
                    >工具</button>
                    <button
                        className={`mode-btn ${mode === 'reader-skill' ? 'active' : ''}`}
                        onClick={() => onSetMode('reader-skill')}
                    >文件</button>
                </div>
                {hasMessages && (
                    <div className="action-buttons">
                        <button className="action-btn" onClick={onRegenerate} title="重新生成上一个回答">
                            <svg className="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                            重新生成
                        </button>
                        <button className="action-btn" onClick={onClear} title="清空对话">
                            <svg className="icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                            清空
                        </button>
                    </div>
                )}
            </div>
        </header>
    )
}

export default Header
