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
        <aside className="history-sidebar fixed right-0 top-0 bottom-0 z-30 hidden w-60 flex-col border-l border-[var(--cyan-border)] bg-gradient-to-b from-[var(--bg-surface)] to-[var(--bg-base)] backdrop-blur-md md:flex">
            <div className="flex items-center justify-between border-b border-[var(--cyan-border)] bg-[rgba(0,229,255,0.03)] px-4 py-3">
                <h3 className="text-xs font-semibold tracking-wide text-[var(--cyan)]" style={{ textShadow: '0 0 6px var(--cyan-glow)' }}>
                    历史记录
                </h3>
                <button
                    className="rounded border border-transparent px-2 py-0.5 text-[11px] text-[var(--text-muted)] transition-colors hover:border-[rgba(255,82,82,0.3)] hover:bg-[rgba(255,82,82,0.05)] hover:text-[var(--red-err)]"
                    onClick={onClear}
                    title="清空历史记录"
                >清空</button>
            </div>
            <div className="flex-1 overflow-y-auto p-2" style={{ scrollbarWidth: 'none' }}>
                {history.length === 0 ? (
                    <div className="px-4 py-8 text-center text-xs text-[var(--text-muted)]">暂无历史记录</div>
                ) : (
                    <div className="flex flex-col gap-1.5">
                        {history.map((item, i) => (
                            <div
                                key={i}
                                className="group relative cursor-pointer rounded-lg border border-[var(--cyan-border)] bg-gradient-to-br from-[rgba(15,22,38,0.8)] to-[rgba(10,15,28,0.6)] px-3 py-2 transition-all hover:border-[var(--cyan-border-bright)] hover:bg-[rgba(0,229,255,0.04)]"
                                onClick={() => onLoad(i)}
                                title="点击载入到输入框"
                            >
                                <button
                                    className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded text-[var(--text-muted)] opacity-0 transition-opacity hover:text-[var(--red-err)] group-hover:opacity-100"
                                    onClick={(e) => { e.stopPropagation(); onDelete(i) }}
                                    title="删除"
                                >
                                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="12" height="12">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                </button>
                                <div className="pr-4 text-xs leading-relaxed text-[var(--text-primary)] line-clamp-2 break-words" style={{ fontFamily: '"SF Mono", monospace' }}>
                                    {item.text}
                                </div>
                                <div className="mt-1 text-[10px] text-[var(--text-muted)]" style={{ fontFamily: '"SF Mono", monospace' }}>
                                    {item.time}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </aside>
    )
}

export default HistorySidebar
