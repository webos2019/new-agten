/**
 * mathText — 数学 LaTeX → 可读文本转换 (语音聊天专用)
 *
 * LLM 回复中的数学公式通常是 LaTeX 源码, 例如 $$\int_a^b g(x)\,dx$$。
 * 语音气泡直接显示源码、TTS 直接朗读源码都是灾难, 这里做两层纯字符串转换
 * (不引入 KaTeX/MathJax 依赖):
 * - latexToUnicodeMath: 显示用 — LaTeX → Unicode 数学符号 (∫ₐᵇ g(x) dx)
 * - latexToSpeechText:  朗读用 — LaTeX → 中文口语文本 ("从a到b的定积分 g(x)dx")
 *                       顺带把范围波浪线折成"到" (21~28℃ → 21到28℃, 见 tildeRangeToSpeech)
 *
 * 单独的 $5 这类货币金额不会被误当公式 (开 $ 后首位必须是非空白非数字)。
 */

// ─── 符号表 ────────────────────────────────────────────

const GREEK: Record<string, string> = {
    alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε',
    zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ',
    lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', varpi: 'ϖ', rho: 'ρ',
    sigma: 'σ', varsigma: 'ς', tau: 'τ', upsilon: 'υ', phi: 'φ', varphi: 'φ',
    chi: 'χ', psi: 'ψ', omega: 'ω', Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ',
    Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
}

const GREEK_SPEECH: Record<string, string> = {
    alpha: '阿尔法', beta: '贝塔', gamma: '伽马', delta: '德尔塔', epsilon: '艾普西隆',
    theta: '西塔', lambda: '拉姆达', mu: '缪', nu: '纽', xi: '克西',
    pi: '派', rho: '柔', sigma: '西格玛', tau: '套', phi: '斐', varphi: '斐',
    omega: '欧米伽', Delta: '德尔塔', Sigma: '西格玛', Omega: '欧米伽', Omega_: '欧米伽',
}

const SYMBOLS: Record<string, string> = {
    times: '×', cdot: '·', div: '÷', pm: '±', mp: '∓', ast: '∗',
    leq: '≤', le: '≤', geq: '≥', ge: '≥', neq: '≠', ne: '≠', approx: '≈',
    equiv: '≡', sim: '∼', simeq: '≃', cong: '≅', propto: '∝',
    infty: '∞', partial: '∂', nabla: '∇', forall: '∀', exists: '∃', neg: '¬',
    in: '∈', notin: '∉', ni: '∋', subset: '⊂', subseteq: '⊆', supset: '⊃',
    cup: '∪', cap: '∩', emptyset: '∅', varnothing: '∅',
    to: '→', rightarrow: '→', leftarrow: '←', Rightarrow: '⇒', Leftrightarrow: '⇔',
    mapsto: '↦', uparrow: '↑', downarrow: '↓',
    circ: '∘', bullet: '∙', oplus: '⊕', otimes: '⊗', perp: '⊥', parallel: '∥',
    angle: '∠', triangle: '△', square: '□', degree: '°', prime: '′',
    quad: '  ', qquad: '    ', ',': ' ', ';': ' ', ':': ' ', '!': '',
    left: '', right: '', displaystyle: '', textstyle: '', scriptstyle: '',
    limits: '', nolimits: '', ldots: '…', cdots: '⋯', vdots: '⋮', ddots: '⋱',
    langle: '⟨', rangle: '⟩', lbrace: '{', rbrace: '}', lbrack: '[', rbrack: ']',
    hbar: 'ℏ', ell: 'ℓ', Re: 'ℜ', Im: 'ℑ', aleph: 'ℵ',
}

const SYMBOL_SPEECH: Record<string, string> = {
    times: '乘', cdot: '点', div: '除以', pm: '正负', mp: '负正',
    leq: '小于等于', le: '小于等于', geq: '大于等于', ge: '大于等于',
    neq: '不等于', ne: '不等于', approx: '约等于', equiv: '恒等于',
    infty: '无穷大', partial: '偏导数', nabla: '纳布拉',
    in: '属于', notin: '不属于', subset: '包含于', cup: '并集', cap: '交集',
    to: '到', rightarrow: '箭头到', Rightarrow: '推出', mapsto: '映射到',
    degree: '度', ldots: '等等', cdots: '等等',
    left: '', right: '', quad: ' ', qquad: ' ', ',': ' ', ';': ' ', ':': ' ', '!': '',
    limits: '', nolimits: '', displaystyle: '', textstyle: '',
}

const FUNCTIONS = new Set([
    'sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan',
    'log', 'ln', 'lg', 'exp', 'min', 'max', 'det', 'deg', 'gcd', 'arg',
])

const SUP: Record<string, string> = {
    '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶',
    '7': '⁷', '8': '⁸', '9': '⁹', '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽',
    ')': '⁾', n: 'ⁿ', i: 'ⁱ', a: 'ᵃ', b: 'ᵇ', c: 'ᶜ', d: 'ᵈ', e: 'ᵉ',
    f: 'ᶠ', g: 'ᵍ', h: 'ʰ', j: 'ʲ', k: 'ᵏ', l: 'ˡ', m: 'ᵐ', o: 'ᵒ',
    p: 'ᵖ', r: 'ʳ', s: 'ˢ', t: 'ᵗ', u: 'ᵘ', v: 'ᵛ', w: 'ʷ', x: 'ˣ',
    y: 'ʸ', z: 'ᶻ', T: 'ᵀ',
}

const SUB: Record<string, string> = {
    '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆',
    '7': '₇', '8': '₈', '9': '₉', '+': '₊', '-': '₋', '=': '₌', '(': '₍',
    ')': '₎', a: 'ₐ', e: 'ₑ', h: 'ₕ', i: 'ᵢ', j: 'ⱼ', k: 'ₖ', l: 'ₗ',
    m: 'ₘ', n: 'ₙ', o: 'ₒ', p: 'ₚ', r: 'ᵣ', s: 'ₛ', t: 'ₜ', u: 'ᵤ',
    v: 'ᵥ', x: 'ₓ',
}

const SPEECH_SUP_NAMES: Record<string, string> = { '2': '平方', '3': '立方' }

function toScript(s: string, map: Record<string, string>): string {
    let out = ''
    for (const ch of s) out += map[ch] ?? ch
    return out
}

// ─── LaTeX body 解析 ───────────────────────────────────

function readGroup(s: string, start: number): { content: string; end: number } | null {
    if (s[start] !== '{') return null
    let depth = 0
    for (let i = start; i < s.length; i++) {
        if (s[i] === '{') depth++
        else if (s[i] === '}') {
            depth--
            if (depth === 0) return { content: s.slice(start + 1, i), end: i + 1 }
        }
    }
    return null
}

/** 读取 ^/_ 后面的参数: {group} 或单字符 */
function readScriptArg(s: string, i: number): { content: string; end: number } {
    if (s[i] === '{') {
        const g = readGroup(s, i)
        if (g) return g
    }
    return { content: s[i] ?? '', end: i + 1 }
}

/** 读取 \int/\sum 等后面的 _{} 与 ^{} (顺序不限), 返回转换后的下标/上标 */
function readLimits(s: string, i: number): { sub: string; sup: string; end: number } {
    let sub = ''
    let sup = ''
    let pos = i
    for (let k = 0; k < 2; k++) {
        const ch = s[pos]
        if (ch !== '_' && ch !== '^') break
        const arg = readScriptArg(s, pos + 1)
        if (ch === '_') sub = arg.content
        else sup = arg.content
        pos = arg.end
    }
    return { sub, sup, end: pos }
}

function convertBody(src: string, mode: 'display' | 'speech'): string {
    let out = ''
    let i = 0

    const conv = (s: string) => convertBody(s, mode)

    while (i < src.length) {
        const ch = src[i]

        if (ch === '\\') {
            const m = /^\\([a-zA-Z]+|.)/.exec(src.slice(i))
            if (!m) { i++; continue }
            const name = m[1]
            i += m[0].length

            // LaTeX 行分隔符 \\ (两个反斜杠): 上面的正则把第二个反斜杠吃成了 name='\'
            if (name === '\\') {
                out += mode === 'display' ? '\n' : '，'
                continue
            }

            if (name === 'frac' || name === 'dfrac' || name === 'tfrac') {
                const g1 = src[i] === '{' ? readGroup(src, i) : null
                if (!g1) { out += mode === 'display' ? '/' : '除以'; continue }
                let pos = g1.end
                const g2 = src[pos] === '{' ? readGroup(src, pos) : null
                const num = conv(g1.content)
                const den = g2 ? conv(g2.content) : ''
                i = g2 ? g2.end : pos
                if (mode === 'display') {
                    // 简单分数 (单个字母/数字) 直接 a/b, 复杂的加括号
                    const simple = (s: string) => /^[a-zA-Z0-9]$/.test(s)
                    out += simple(num) && simple(den) ? `${num}/${den}` : `(${num})/(${den})`
                } else {
                    out += `${num}分之${den}`
                }
                continue
            }

            if (name === 'sqrt') {
                let root = ''
                if (src[i] === '[') {
                    const close = src.indexOf(']', i)
                    if (close > -1) { root = src.slice(i + 1, close); i = close + 1 }
                }
                const g2 = src[i] === '{' ? readGroup(src, i) : null
                let body = ''
                if (g2) { body = conv(g2.content); i = g2.end }
                else if (i < src.length && src[i] !== ' ') { body = conv(src[i]); i++ }
                const prefix = root ? `${conv(root)}次` : ''
                out += mode === 'display'
                    ? `${prefix}√(${body})`
                    : `${prefix}根号${body}`
                continue
            }

            if (name === 'int' || name === 'oint' || name === 'iint' || name === 'iiint') {
                const sym = name === 'int' ? '∫' : name === 'oint' ? '∮' : name === 'iint' ? '∬' : '∭'
                const { sub, sup, end } = readLimits(src, i)
                i = end
                if (mode === 'display') {
                    out += sym
                    if (sub) out += toScript(conv(sub), SUB)
                    if (sup) out += toScript(conv(sup), SUP)
                } else {
                    if (sub || sup) out += `从${conv(sub || '?')}到${conv(sup || '?')}${sym === '∫' ? '的定积分' : '的积分'} `
                    else out += sym === '∫' ? '定积分 ' : '积分 '
                }
                continue
            }

            if (name === 'sum' || name === 'prod') {
                const { sub, sup, end } = readLimits(src, i)
                i = end
                if (mode === 'display') {
                    out += name === 'sum' ? '∑' : '∏'
                    if (sub) out += toScript(conv(sub), SUB)
                    if (sup) out += toScript(conv(sup), SUP)
                } else {
                    out += name === 'sum'
                        ? `对${conv(sub || '')}到${conv(sup || '')}求和 `
                        : `对${conv(sub || '')}到${conv(sup || '')}求积 `
                }
                continue
            }

            if (name === 'lim') {
                const { sub, end } = readLimits(src, i)
                i = end
                out += mode === 'display'
                    ? 'lim' + (sub ? toScript(conv(sub), SUB) : '')
                    : (sub ? `${conv(sub)}的极限` : '极限')
                continue
            }

            if (name === 'text' || name === 'mathrm' || name === 'mathbf' || name === 'mathit' || name === 'textbf' || name === 'operatorname') {
                const g = src[i] === '{' ? readGroup(src, i) : null
                if (g) { out += conv(g.content); i = g.end }
                continue
            }

            if (GREEK[name] !== undefined) {
                out += mode === 'display' ? GREEK[name] : (GREEK_SPEECH[name] ?? GREEK[name])
                continue
            }
            if (SYMBOLS[name] !== undefined) {
                out += mode === 'display' ? SYMBOLS[name] : (SYMBOL_SPEECH[name] ?? SYMBOLS[name])
                continue
            }
            if (FUNCTIONS.has(name)) {
                out += mode === 'display' ? name : name
                continue
            }
            // 未知命令: 丢弃反斜杠保留单词 (如 \leftmark 之类的脏数据不至于整段消失)
            out += name
            continue
        }

        if (ch === '^') {
            const arg = readScriptArg(src, i + 1)
            i = arg.end
            const body = conv(arg.content)
            if (mode === 'display') out += toScript(body, SUP)
            else out += `的${SPEECH_SUP_NAMES[body] ?? body + '次方'}`
            continue
        }

        if (ch === '_') {
            const arg = readScriptArg(src, i + 1)
            i = arg.end
            const body = conv(arg.content)
            if (mode === 'display') out += toScript(body, SUB)
            else out += `下标${body}`
            continue
        }

        if (ch === '{') {
            const g = readGroup(src, i)
            if (g) { out += conv(g.content); i = g.end; continue }
            out += ch; i++
            continue
        }

        if (ch === '}' ) { i++; continue }  // 多余右括号丢弃
        if (src[i] === '&' ) { out += mode === 'display' ? ' ' : '，'; i++; continue }
        if (ch === '$') { i++; continue }
        out += ch
        i++
    }

    return out
}

// ─── 对外接口 ──────────────────────────────────────────

/** 提取并转换所有数学段: $$..$$ / \$..\$ / \[..\] / \(..\) — 代码围栏/行内代码不转换 */
function convertMathSegments(text: string, mode: 'display' | 'speech'): string {
    // 先按代码围栏 (```...```) 和行内代码 (`...`) 切分, 奇数段是代码原样保留 —
    // 否则 shell 的 $PATH / $$ 会被误当 LaTeX 损坏代码显示
    const parts = text.split(/(```[\s\S]*?```|`[^`\n]*`)/g)
    return parts
        .map((part, i) => (i % 2 === 1 ? part : convertMathInPlain(part, mode)))
        .join('')
}

function convertMathInPlain(text: string, mode: 'display' | 'speech'): string {
    // 单 $ 公式: 开 $ 后首位不能是空白/数字/$ — "$5 和 $10" 这类金额不会被误配
    const re = /(\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|\$[^\s\d$][^$\n]*?\$)/g
    return text.replace(re, (seg) => {
        let body = seg
        if (body.startsWith('$$')) body = body.slice(2, -2)
        else if (body.startsWith('\\[')) body = body.slice(2, -2)
        else if (body.startsWith('\\(')) body = body.slice(2, -2)
        else body = body.slice(1, -1)
        const converted = convertBody(body, mode).replace(/\s+/g, ' ').trim()
        return mode === 'display' ? converted : ` ${converted} `
    })
}

/** 显示用: LaTeX 数学 → Unicode 数学符号 (∫ₐᵇ g(x) dx), 不再出现 $$ 和反斜杠命令 */
export function latexToUnicodeMath(text: string): string {
    if (!text) return ''
    return convertMathSegments(text, 'display')
}

/**
 * 范围波浪线 → 中文"到" (朗读专用).
 *
 * 为什么要单列一步: 播报前 VoiceChat 还会把 markdown 标记(井号、星号、下划线、
 * 波浪线、方括号)一律删掉,
 * 于是"气温21~28℃"被删成"气温2128℃", 念出来是"两千一百二十八度"
 * (2026-11-06 真后端跑语音时抓到过原文)。波浪线先变成"到"就删不掉了。
 *
 * 只认"两边确实是内容"的那一种, 免得把"约~30%"念成"约到30%":
 *   数字/单位 ~ 数字   → 21~28、10%~20%、10:00~18:00
 *   汉字/字母 ~ 汉字/字母 → 南宁~桂林
 * 前面是"约"这类汉字、后面直接跟数字的那种"大约"用法不匹配, 保持原样由后面删掉。
 */
export function tildeRangeToSpeech(text: string): string {
    if (!text) return ''
    return text
        .replace(/([\d%℃])[~～](?=[\d])/g, '$1到')
        .replace(/([一-龥A-Za-z])[~～](?=[一-龥A-Za-z])/g, '$1到')
}

/** 朗读用: LaTeX 数学 → 中文口语文本 ("从a到b的定积分 g(x)dx") */
export function latexToSpeechText(text: string): string {
    if (!text) return ''
    return tildeRangeToSpeech(
        convertMathSegments(text, 'speech')
            .replace(/\$/g, '')
            .replace(/\\[a-zA-Z]+/g, '')
            .replace(/[{}]/g, '')
            .replace(/\s{2,}/g, ' ')
            .trim(),
    )
}
