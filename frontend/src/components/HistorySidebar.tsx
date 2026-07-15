import React from 'react'
import type { HistoryItem } from '../hooks/useInputHistory'

interface Props {
    history: HistoryItem[]
    onLoad: (index: number) => void
    onDelete: (index: number) => void
    onClear: () => void
}

const HistorySidebar: React.FC<Props> = ({ history, onLoad, onDelete, onClear }) => {
    return (
        <aside className="history-sidebar">
            <div className="history-sidebar-header">
                <h3 className="history-sidebar-title">历史记录</h3>
                <button className="history-clear-btn" onClick={onClear} title="清空历史记录">清空</button>
            </div>
            <div className="history-list">
                {history.length === 0 ? (
                    <div className="history-empty">暂无历史记录</div>
                ) : (
                    history.map((item, i) => (
                        <div
                            key={i}
                            className="history-item"
                            onClick={() => onLoad(i)}
                            title="点击载入到输入框"
                        >
                            <button
                                className="history-item-delete"
                                onClick={(e) => { e.stopPropagation(); onDelete(i) }}
                                title="删除"
                            >
                                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="14" height="14">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                            <div className="history-item-text">{item.text}</div>
                            <div className="history-item-time">{item.time}</div>
                        </div>
                    ))
                )}
            </div>
        </aside>
    )
}

export default HistorySidebar
