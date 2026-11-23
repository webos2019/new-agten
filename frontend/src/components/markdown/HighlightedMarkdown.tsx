import React, { useEffect, useRef, memo } from 'react'
import { renderMarkdown, applyHighlight } from './renderMarkdown'

export const HighlightedMarkdown = memo(function HighlightedMarkdown({ content }: { content: string }) {
    const ref = useRef<HTMLDivElement>(null)
    const highlightScheduledRef = useRef(false)

    useEffect(() => {
        const root = ref.current
        if (!root) return

        if (highlightScheduledRef.current) return
        highlightScheduledRef.current = true

        requestAnimationFrame(() => {
            highlightScheduledRef.current = false
            if (!ref.current) return
            try {
                ref.current.querySelectorAll('pre code').forEach((block: Element) => {
                    if (!(block as HTMLElement).dataset.highlighted) {
                        try { applyHighlight(block as HTMLElement) } catch { /* ignore */ }
                    }
                })
            } catch { /* ignore */ }
        })
    }, [content])

    return <div ref={ref} dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }} />
})