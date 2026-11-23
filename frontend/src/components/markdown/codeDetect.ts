/**
 * "整条消息其实是代码"兜底判定 —— 只在模型忘记写 ``` 围栏时把正文包成代码块。
 *
 * 两级信号 (修复 2026-09-21 误判):
 *   硬信号 hardSignals —— 几乎不可能出现在自然语言里的语法结构
 *       (def f( / from x import / console.log( / SELECT … FROM / </div> …)
 *   软信号 softSignals —— 与散文同形的线索，如 `# 注释` 行、yaml 风格键、`$x =`
 *       中文长回答里的 `## 二级标题` 和 python 注释 `# 说明` 行形状完全一样，
 *       旧实现把 `^\s*#\s*.*$` 当成独立判据，导致带二级标题的散文被整段包成
 *       代码块（标题不再渲染、消息大纲随之消失）。
 *
 * 规则：只有硬信号命中才包装；软信号只能在已有硬信号时参与语言判定。
 */

// ─── 硬信号：命中即可判定为代码 ──────────────────────────────

interface LangRule {
    lang: string
    patterns: RegExp[]
}

const hardRules: LangRule[] = [
    {
        lang: 'bash',
        patterns: [
            /^\s*(curl\s+['"]|wget\s+\S|ssh\s+\S+@|chmod\s+\d|sudo\s+\w|apt-get\s+install|pip3?\s+install|npm\s+(install|run)\s|yarn\s+add\s|git\s+(clone|push|pull)\s)/m,
        ],
    },
    {
        lang: 'python',
        patterns: [
            // 关键字必须小写且带代码上下文: 自然语言里的 "Return the value" 不算
            /^\s*(from\s+[\w.]+\s+import\s+|import\s+[\w.]+\s*$|def\s+\w+\s*\(|async\s+def\s+\w+\s*\(|class\s+\w+\s*[(:]|if\s+.{1,80}:\s*$|elif\s+.{1,80}:\s*$|else\s*:\s*$|for\s+\w+\s+in\s+.+:\s*$|while\s+.+:\s*$|try\s*:\s*$|except[^:]*:\s*$|finally\s*:\s*$|with\s+.+:\s*$|print\s*\(|return\s+\S|await\s+\w+\s*\()/m,
            /\bself\.\w+|__init__\s*\(|@app\.route\(|@bot\.command\(|lambda\s+\w+\s*:/m,
        ],
    },
    {
        lang: 'javascript',
        patterns: [
            /\b(function\s+\w+\s*\(|const\s+\w+\s*=|let\s+\w+\s*=|var\s+\w+\s*=|console\.log\s*\(|=>\s*[{(]|await\s+fetch\s*\()/m,
            /\bimport\s+.*\s+from\s+['"][^'"]+['"];?/m,
        ],
    },
    {
        lang: 'java',
        patterns: [
            /\b(System\.out\.println\s*\(|public\s+(static\s+)?[\w<>\[\]]+\s+\w+\s*\(|private\s+\w+\s+\w+\s*[;=]|package\s+[\w.]+\s*;)/m,
        ],
    },
    {
        lang: 'cpp',
        patterns: [
            /^\s*#include\s*[<"]|\bstd::|\bprintf\s*\(|cout\s*<<|\bint\s+main\s*\(/m,
        ],
    },
    {
        lang: 'php',
        patterns: [/^\s*<\?php/m],
    },
    {
        lang: 'sql',
        patterns: [
            // 要求成句 (SELECT…FROM / INSERT INTO…)，避免散文里出现单个大写词就判码
            /\bSELECT\b[\s\S]{0,400}?\bFROM\b|\bINSERT\s+INTO\b|\bUPDATE\s+\w+\s+SET\b|\bDELETE\s+FROM\b|\bCREATE\s+(TABLE|INDEX|VIEW)\b|\bALTER\s+TABLE\b|\bDROP\s+TABLE\b/i,
        ],
    },
    {
        lang: 'yaml',
        patterns: [
            // 只保留 k8s 风格强特征; name:/steps:/spec: 这类键在说明文里太常见
            /^\s*(apiVersion|kind)\s*:\s*\S/m,
        ],
    },
    {
        lang: 'html',
        patterns: [
            /<\/[a-zA-Z][a-zA-Z0-9-]*>/m,                 // 闭合标签
            /^\s*<(html|head|body|div|span|table|tr|td|th|ul|ol|li|h[1-6]|p|a|img|script|style|form|input|button|svg)\b[^>]*>/im,
            /^\s*<(!DOCTYPE\?|\?xml)\b/im,
        ],
    },
]

// ─── 软信号：单独出现不足以判码，只参与语言判定 ──────────────

const softRules: LangRule[] = [
    { lang: 'python', patterns: [/^\s*#\s+\S/m] },                  // 注释行 (与 ## 标题同形)
    { lang: 'php', patterns: [/^\s*\$\w+\s*=/m] },
    { lang: 'yaml', patterns: [/^\s*(name|description|version|author|steps|spec)\s*:\s*\S/m] },
]

function matchCount(patterns: RegExp[], text: string): number {
    let n = 0
    for (const p of patterns) {
        if (p.test(text)) n += 1
    }
    return n
}

/**
 * 返回判定出的语言; 返回 null 表示"不是代码"，调用方应保持原文不包装。
 */
export function classifyCodeLanguage(content: string): string | null {
    const text = (content || '').trim()
    if (!text) return null

    // 先找命中的硬信号语言，取命中规则最多者
    let bestLang: string | null = null
    let bestHits = 0
    for (const rule of hardRules) {
        const hits = matchCount(rule.patterns, text)
        if (hits > bestHits) {
            bestHits = hits
            bestLang = rule.lang
        }
    }
    if (!bestLang) return null

    // 已有硬信号时，再用软信号纠偏 (例如 python 代码里的 `# 注释` 也命中 python)
    let bestScore = bestHits
    for (const rule of softRules) {
        const score = matchCount(rule.patterns, text)
        // 软信号只有在与硬信号同语言时才算加分项，避免把 html 代码判成 yaml
        if (rule.lang === bestLang && score > bestScore) bestScore = score
    }
    return bestLang
}

export function detectCodeLanguage(content: string): string {
    return classifyCodeLanguage(content) || 'text'
}

export function normalizeMarkdownCodeBlocks(content: string): string {
    if (!content || content.includes('```')) return content
    const trimmed = content.trim()
    if (!trimmed) return content

    const lang = classifyCodeLanguage(trimmed)
    if (!lang) return content

    return `\n\`\`\`${lang}\n${content}\n\`\`\`\n`
}
