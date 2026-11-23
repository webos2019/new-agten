type TokenRule = [RegExp, string]

const LANG_RULES: Record<string, TokenRule[]> = {
    python: [
        [/\b(def|class|return|if|elif|else|for|while|break|continue|pass|raise|try|except|finally|with|as|from|import|lambda|yield|async|await|global|nonlocal|assert|del|in|not|and|or|is|True|False|None)\b/g, 'hljs-keyword'],
        [/\b(self|__init__|__name__|__main__|__doc__|__all__|super|print|len|range|int|str|float|list|dict|set|tuple|type|isinstance|hasattr|getattr|setattr|enumerate|zip|map|filter|sorted|reversed|abs|round|min|max|sum|any|all|open|input|format)\b/g, 'hljs-built_in'],
        [/(f|r|b|u)?("""[\s\S]*?"""|'''[\s\S]*?'''|"[^"\\]*(?:\\.[^"\\]*)*"|'[^'\\]*(?:\\.[^'\\]*)*')/g, 'hljs-string'],
        [/#.*$/gm, 'hljs-comment'],
        [/\b\d+\.?\d*([eE][+-]?\d+)?j?\b/g, 'hljs-number'],
        [/@\w+/g, 'hljs-meta'],
        [/\b([A-Z]\w*)\b/g, 'hljs-class'],
    ],
    javascript: [
        [/\b(function|const|let|var|return|if|else|for|while|do|break|continue|switch|case|default|try|catch|finally|throw|new|delete|typeof|instanceof|in|of|void|yield|async|await|export|import|from|class|extends|super|static|get|set)\b/g, 'hljs-keyword'],
        [/\b(true|false|null|undefined|NaN|Infinity|this|arguments)\b/g, 'hljs-literal'],
        [/\b(console|document|window|Math|JSON|Date|Array|Object|String|Number|Boolean|Promise|Map|Set|RegExp|Error|parseInt|parseFloat|setTimeout|setInterval|clearTimeout|clearInterval|fetch|require|module)\b/g, 'hljs-built_in'],
        [/(`[\s\S]*?`|"[^"\\]*(?:\\.[^"\\]*)*"|'[^'\\]*(?:\\.[^'\\]*)*')/g, 'hljs-string'],
        [/(\/\/.*$|\/\*[\s\S]*?\*\/)/gm, 'hljs-comment'],
        [/\b\d+\.?\d*([eE][+-]?\d+)?\b/g, 'hljs-number'],
        [/\b([A-Z]\w*)\b/g, 'hljs-class'],
    ],
    typescript: [
        [/\b(function|const|let|var|return|if|else|for|while|do|break|continue|switch|case|default|try|catch|finally|throw|new|delete|typeof|instanceof|in|of|void|yield|async|await|export|import|from|class|extends|super|static|get|set|type|interface|enum|namespace|declare|abstract|implements|readonly|as|keyof|never|unknown)\b/g, 'hljs-keyword'],
        [/\b(true|false|null|undefined|NaN|Infinity|this|any|void|string|number|boolean|object|symbol|bigint)\b/g, 'hljs-literal'],
        [/\b(console|document|window|Math|JSON|Date|Array|Object|String|Number|Boolean|Promise|Map|Set|RegExp|Error|Record|Partial|Required|Readonly|Pick|Omit|Exclude|Extract|NonNullable|ReturnType|InstanceType)\b/g, 'hljs-built_in'],
        [/(`[\s\S]*?`|"[^"\\]*(?:\\.[^"\\]*)*"|'[^'\\]*(?:\\.[^'\\]*)*')/g, 'hljs-string'],
        [/(\/\/.*$|\/\*[\s\S]*?\*\/)/gm, 'hljs-comment'],
        [/\b\d+\.?\d*([eE][+-]?\d+)?\b/g, 'hljs-number'],
        [/\b([A-Z]\w*)\b/g, 'hljs-class'],
    ],
    bash: [
        [/\b(if|then|else|elif|fi|for|while|do|done|case|esac|in|function|return|exit|break|continue|local|declare|export|source|alias|unset|shift|eval|trap|read|echo|printf|set|true|false)\b/g, 'hljs-keyword'],
        [/(\$\{[^}]+\}|\$\([^)]+\)|\$\w+|\$\?|\$\!|\$@|\$\*|\$#|\$0)/g, 'hljs-variable'],
        [/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g, 'hljs-string'],
        [/(#.*$)/gm, 'hljs-comment'],
    ],
    sql: [
        [/\b(SELECT|FROM|WHERE|INSERT|INTO|VALUES|UPDATE|SET|DELETE|CREATE|TABLE|ALTER|DROP|INDEX|VIEW|JOIN|INNER|LEFT|RIGHT|OUTER|CROSS|ON|AND|OR|NOT|IN|IS|NULL|LIKE|BETWEEN|EXISTS|GROUP|BY|ORDER|ASC|DESC|HAVING|LIMIT|OFFSET|UNION|ALL|AS|DISTINCT|COUNT|SUM|AVG|MIN|MAX|CASE|WHEN|THEN|ELSE|END|PRIMARY|KEY|FOREIGN|REFERENCES|CONSTRAINT|DEFAULT|CHECK|UNIQUE)\b/gi, 'hljs-keyword'],
        [/('[^']*'|"[^"]*")/g, 'hljs-string'],
        [/\b\d+\.?\d*\b/g, 'hljs-number'],
        [/(--.*$|\/\*[\s\S]*?\*\/)/gm, 'hljs-comment'],
    ],
    go: [
        [/\b(func|return|if|else|for|range|switch|case|default|break|continue|go|select|chan|map|struct|interface|package|import|var|const|type|defer|fallthrough|nil|true|false|error|make|new|append|len|cap|copy|delete|close|panic|recover|fmt)\b/g, 'hljs-keyword'],
        [/("[^"\\]*(?:\\.[^"\\]*)*"|`[^`]*`)/g, 'hljs-string'],
        [/(\/\/.*$|\/\*[\s\S]*?\*\/)/gm, 'hljs-comment'],
        [/\b\d+\.?\d*([eE][+-]?\d+)?\b/g, 'hljs-number'],
    ],
    java: [
        [/\b(public|private|protected|static|final|abstract|class|interface|extends|implements|new|return|if|else|for|while|do|switch|case|default|break|continue|try|catch|finally|throw|throws|synchronized|volatile|transient|enum|assert|void|boolean|byte|char|short|int|long|float|double|String|Object|this|super|null|true|false|instanceof|import|package)\b/g, 'hljs-keyword'],
        [/("[^"\\]*(?:\\.[^"\\]*)*")/g, 'hljs-string'],
        [/(\/\/.*$|\/\*[\s\S]*?\*\/)/gm, 'hljs-comment'],
        [/\b\d+\.?\d*([eE][+-]?\d+)?[fFdDlL]?\b/g, 'hljs-number'],
        [/\b([A-Z]\w*)\b/g, 'hljs-class'],
    ],
    json: [
        [/("(?:[^"\\]|\\.)*")\s*:/g, 'hljs-attr'],
        [/:\s*("(?:[^"\\]|\\.)*")/g, 'hljs-string'],
        [/\b(true|false|null)\b/g, 'hljs-literal'],
        [/\b-?\d+\.?\d*([eE][+-]?\d+)?\b/g, 'hljs-number'],
    ],
    yaml: [
        [/(\w[\w-]*)\s*:/g, 'hljs-attr'],
        [/("[^"\\]*(?:\\.[^"\\]*)*"|'[^'\\]*(?:\\.[^'\\]*)*')/g, 'hljs-string'],
        [/(#.*$)/gm, 'hljs-comment'],
        [/\b(true|false|null|yes|no|on|off)\b/gi, 'hljs-literal'],
        [/\b-?\d+\.?\d*([eE][+-]?\d+)?\b/g, 'hljs-number'],
    ],
    css: [
        [/(@\w+|!\s*important)/g, 'hljs-keyword'],
        [/([\w-]+)\s*:/g, 'hljs-attribute'],
        [/(#[0-9a-fA-F]{3,8})\b/g, 'hljs-number'],
        [/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g, 'hljs-string'],
        [/(\/\*[\s\S]*?\*\/)/gm, 'hljs-comment'],
    ],
    html: [
        [/(<\/?)([\w-]+)/g, 'hljs-tag'],
        [/([\w-]+)(=)/g, 'hljs-attribute'],
        [/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g, 'hljs-string'],
        [/(<!--[\s\S]*?-->)/g, 'hljs-comment'],
    ],
}

const LANG_ALIASES: Record<string, string> = {
    js: 'javascript', ts: 'typescript', py: 'python', sh: 'bash', shell: 'bash',
    zsh: 'bash', yml: 'yaml', xml: 'html', jsx: 'javascript', tsx: 'typescript',
}

function detectLang(code: string): string {
    const t = code.trim()
    if (!t) return ''
    if (/\b(def|class|import|from|elif|self|__init__|print\s*\(|lambda\s|True|False|None)\b/.test(t)) return 'python'
    if (/\b(function|const|let|var|console\.log|=>\s*\{|===|typeof|undefined|null)\b/.test(t)) return 'javascript'
    if (/\b(interface|type\s+\w+\s*=|enum|namespace|as\s+\w+|readonly|keyof)\b/.test(t)) return 'typescript'
    if (/\b(func\s|package\s|go\s|chan\s|defer\s|:=|fmt\.|nil\b)\b/.test(t)) return 'go'
    if (/\b(public\s|private\s|protected\s|System\.out|implements|extends\s+Thread|void\s+main)\b/.test(t)) return 'java'
    if (/\b(SELECT|INSERT|UPDATE|DELETE|CREATE\s+TABLE|ALTER\s+TABLE)\b/i.test(t)) return 'sql'
    if (/^\s*(curl|wget|ssh|chmod|sudo|apt-get|pip\s|npm\s|yarn\s|echo\s|export\s)/m.test(t)) return 'bash'
    if (/^\s*\{/.test(t) && /"[^"]*"\s*:/.test(t)) return 'json'
    if (/^\s*(apiVersion|kind|metadata|spec|steps|name):/m.test(t)) return 'yaml'
    if (/<[a-zA-Z][^>]*>/.test(t) && /<\/[a-zA-Z]/.test(t)) return 'html'
    if (/[.#]\w+\s*\{/.test(t)) return 'css'
    return ''
}

function escapeSpan(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function highlightCode(code: string, lang: string): string {
    const resolved = LANG_ALIASES[lang] || lang
    const rules = LANG_RULES[resolved]
    if (!rules) return escapeSpan(code)

    type Segment = { start: number; end: number; cls: string }
    const segments: Segment[] = []

    for (const [re, cls] of rules) {
        const regex = new RegExp(re.source, re.flags)
        let m: RegExpExecArray | null
        while ((m = regex.exec(code)) !== null) {
            segments.push({ start: m.index, end: m.index + m[0].length, cls })
            if (m[0].length === 0) regex.lastIndex++
        }
    }

    segments.sort((a, b) => a.start - b.start || b.end - a.end)

    const filtered: Segment[] = []
    let lastEnd = 0
    for (const seg of segments) {
        if (seg.start >= lastEnd) {
            filtered.push(seg)
            lastEnd = seg.end
        }
    }

    if (filtered.length === 0) return escapeSpan(code)

    let result = ''
    let pos = 0
    for (const seg of filtered) {
        if (seg.start > pos) result += escapeSpan(code.slice(pos, seg.start))
        result += `<span class="${seg.cls}">${escapeSpan(code.slice(seg.start, seg.end))}</span>`
        pos = seg.end
    }
    if (pos < code.length) result += escapeSpan(code.slice(pos))
    return result
}

export function highlightElement(el: HTMLElement): void {
    try {
        if (el.dataset.highlighted) return

        const cls = el.className || ''
        let lang = ''
        const langMatch = cls.match(/language-(\w+)/)
        if (langMatch) {
            lang = langMatch[1]
        } else {
            const code = el.textContent || ''
            lang = detectLang(code)
            if (!lang) return
            el.classList.add('language-' + lang)
        }

        const code = el.textContent || ''
        if (!code.trim()) return

        // 声明的语言未收录 (如 language-rust / language-cpp / language-markdown) 时，
        // 按内容再猜一次；否则 highlightCode 找不到规则会整块不着色。
        let effective = LANG_ALIASES[lang] || lang
        if (!LANG_RULES[effective]) {
            const guess = detectLang(code)
            if (!guess) return
            effective = guess
            el.classList.add('language-' + guess)
        }

        const highlighted = highlightCode(code, effective)
        el.innerHTML = highlighted
        el.dataset.highlighted = '1'
    } catch { /* skip on error */ }
}

export function highlightAll(root?: HTMLElement): void {
    const container = root || document
    const blocks = container.querySelectorAll('pre code')
    blocks.forEach((block) => {
        highlightElement(block as HTMLElement)
    })
}