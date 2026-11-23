export function escapeHtml(text: string): string {
    if (!text) return ''
    const div = document.createElement('div')
    div.textContent = String(text)
    return div.innerHTML
}