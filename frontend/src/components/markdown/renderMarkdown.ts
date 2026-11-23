import { normalizeMarkdownCodeBlocks } from './codeDetect'
import { escapeHtml } from './escapeHtml'
import { highlightElement as miniHighlightElement } from '../../lib/miniHighlight'

/**
 * 给一个 <code> 元素着色。
 *
 * 优先用 window.hljs；但 /highlight-common.min.js 实测是 highlight.js 的
 * CommonJS 入口（首句 var hljs=require("./core")），浏览器里没有 require，
 * 该 script 加载即抛 ReferenceError → window.hljs 永远 undefined，
 * 只判 typeof hljs 会让聊天代码块整条不着色。
 * 因此这里退回仓库自带的 lib/miniHighlight：它输出的 class 与 highlight.js
 * 同名（hljs-keyword/hljs-string/…），故现有 highlight-vs2015.min.css 直接生效。
 */
export function applyHighlight(el: HTMLElement): void {
    const hljs = (window as any).hljs
    if (hljs && typeof hljs.highlightElement === 'function') {
        try {
            hljs.highlightElement(el)
            if (el.dataset.highlighted) return
        } catch { /* hljs 不可用时继续走兜底 */ }
    }
    miniHighlightElement(el)
}

export function renderMarkdown(content: string): string {
    if (!content) return ''
    const prepared = normalizeMarkdownCodeBlocks(content)
    if (typeof (window as any).marked !== 'undefined') {
        ;(window as any).marked.setOptions({ breaks: true, gfm: true })
        let html = (window as any).marked.parse(prepared)
        const div = document.createElement('div')
        div.innerHTML = html
        div.querySelectorAll('pre').forEach((pre: any) => {
            pre.classList.add('code-block-pre')
            const code = pre.querySelector('code')
            if (code) {
                code.classList.add('code-block-code')
                try { applyHighlight(code) } catch { /* skip */ }
            }
            const existingWrapper = pre.parentElement?.classList.contains('code-block-wrapper') ? pre.parentElement : null
            if (existingWrapper) return
            const wrapper = document.createElement('div')
            wrapper.className = 'code-block-wrapper'
            const header = document.createElement('div')
            header.className = 'code-block-header'
            const lang = code?.className.match(/language-(\w+)/)
            header.innerHTML = '<span>' + (lang ? lang[1] : 'text') + '</span>'
            const copyBtn = document.createElement('button')
            copyBtn.className = 'code-block-copy'
            copyBtn.textContent = '📋 复制'
            copyBtn.onclick = () => { navigator.clipboard.writeText(code?.textContent || '').then(() => { copyBtn.textContent = '✓ 已复制'; setTimeout(() => { copyBtn.textContent = '📋 复制' }, 2000) }) }
            header.appendChild(copyBtn)
            pre.parentNode.insertBefore(wrapper, pre)
            wrapper.appendChild(header)
            wrapper.appendChild(pre)
        })
        let result = div.innerHTML
        result = result.replace(/&nbsp;/g, ' ')
        return result
    }
    return escapeHtml(prepared)
}

export { escapeHtml }