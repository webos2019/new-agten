/**
 * 复读折叠：把一条 assistant 正文里"循环块"压成"循环内容走一遍 + 一行说明"。
 *
 * 为什么在前端做（而不是后端或提示词）：
 *   库里实测三条退化行 —— 8012 字/226 段/31 种（199 段是重复段）、
 *   6376 字/658 段/24 种（同一句"全哥哥，我确认。"出现 213 遍）、
 *   最新那条 8012 字/388 段/44 种（"训练还在跑／训练进程仍在／我继续等待"这类
 *   短句轮转）。这种补全退化发生**在一次补全内部**（不是编排器循环：agent_loop 的
 *   max_turns=20 拦不出 213 遍），提示词管不住；后端要改的是整轮焊接
 *   (chat_service 的 TextCollectingWriter)，那条路要重启。前端这一档零重启、
 *   零线上副作用，语音气泡／朗读／文本气泡三条出口一次覆盖。
 *
 * 两条判据（都只比"去掉全部空白后的整段原文"，正常正文凑不出这些分布）：
 *   R1 逐字周期：从某段起，周期 p=1~8 的完整重复 ≥3 遍 ⇒ 折成第一遍 + 标记。
 *   R2 高频游程：连续 ≥8 段，且每段在本条消息里都出现过 ≥5 次 ⇒ 判成循环块，
 *      块内每种说法只保留第一次出现（最多 8 种），其余丢弃并写标记。
 *      R2 是为最新那条准备的：它轮转的是同义短句，逐字周期永远接不住
 *      （实测 period=6 最长连续链只有 3，见 _diag_20261106/seq66_shape.txt）。
 *
 * 边界：
 *   · ``` 围栏内不切段、不参与比较、一个字不改。
 *   · 折叠按原文偏移重建：块与块之间没被折的部分逐字节保持原样
 *     （第一版按 '\n\n' 重拼，把 211/234 条正常行的空行数都改了 —— 那是脏改动）。
 *   · 只动显示与朗读；库里的原文和"复制"按钮走的仍是原文（assistantCopyText）。
 *   · 找不到够格的块时返回传入的那个字符串本身，不破坏 memo 的引用比较。
 */

export interface CollapseStats {
    /** R1 折掉的逐字周期块数 */
    periodBlocks: number
    /** R2 折掉的高频循环块数 */
    frequencyBlocks: number
    /** 实际删掉的段数 */
    removedParas: number
    /** 折叠前／后的自然段数（按空行切，围栏整块算一段） */
    parasBefore: number
    parasAfter: number
}

export interface CollapseResult {
    text: string
    stats: CollapseStats
}

const MAX_PERIOD = 8
const MIN_COPIES = 3
const MIN_TOTAL_OCCURRENCES = 5
const MIN_RUN = 8
const MAX_KEEP_KINDS = 8

interface Unit {
    text: string
    /** 在原文中的字节区间 [start, end)，重建时按它切片，不重拼空白 */
    start: number
    end: number
    /** ``` 围栏内的整块：原子单位，不切、不比、不改 */
    code: boolean
}

/** 比较键：去掉所有空白。刻意不做大小写／标点归一，避免把"看着像"当"一样"。 */
function keyOf(unit: Unit): string {
    return unit.code ? '' : unit.text.replace(/\s+/g, '')
}

/**
 * 切段：空行分隔自然段；``` 围栏整块当成一个原子段，
 * 这样代码块里的空行不会被切开、块内重复行也绝不会被折叠。
 */
function splitUnits(text: string): Unit[] {
    const lines = text.split('\n')
    const units: Unit[] = []
    let buf: string[] = []
    let bufStart = 0
    let pos = 0
    let fence: string | null = null

    const flush = (endPos: number, isCode: boolean) => {
        if (buf.length === 0) return
        const joined = buf.join('\n')
        if (joined.trim()) units.push({ text: joined, start: bufStart, end: endPos, code: isCode })
        buf = []
    }

    // 每行记住"上一行结束于哪个偏移（不含换行）"，段尾一律用它，
    // 免得把段末那个 '\n' 也算进 unit —— 那样重建时段的分隔符会少打一个换行。
    let prevLineEnd = 0
    for (let n = 0; n < lines.length; n++) {
        const ln = lines[n]
        const lineStart = pos
        const lineEnd = lineStart + ln.length
        pos = lineEnd + (n + 1 < lines.length ? 1 : 0)
        if (fence === null) {
            const open = /^\s*(```|~~~)/.exec(ln)
            if (open) {
                flush(prevLineEnd, false)
                fence = open[1]
                bufStart = lineStart
                buf.push(ln)
                prevLineEnd = lineEnd
                continue
            }
            if (/^\s*$/.test(ln)) {
                // 空行 = 段边界（多个连续空行只当一个边界）
                flush(prevLineEnd, false)
                prevLineEnd = lineEnd
                continue
            }
            if (buf.length === 0) bufStart = lineStart
            buf.push(ln)
        } else {
            buf.push(ln)
            if (new RegExp('^\\s*' + fence + '\\s*$').test(ln)) {
                // 先按"围栏内"收尾这个 unit，再把 fence 置空
                flush(lineEnd, true)
                fence = null
            }
        }
        prevLineEnd = lineEnd
    }
    flush(prevLineEnd, fence !== null)
    return units
}

export function collapseRepeatedParagraphsDetailed(text: string): CollapseResult {
    const stats: CollapseStats = {
        periodBlocks: 0, frequencyBlocks: 0, removedParas: 0, parasBefore: 0, parasAfter: 0,
    }
    if (!text || !text.trim()) return { text, stats }

    const units = splitUnits(text)
    stats.parasBefore = units.length
    if (units.length < MIN_COPIES) return { text, stats: { ...stats, parasAfter: units.length } }

    const keys = units.map(keyOf)
    // R2 需要"本条消息内每个键出现几次"，先一次建表
    const counts = new Map<string, number>()
    for (const k of keys) if (k) counts.set(k, (counts.get(k) || 0) + 1)

    // 从左到右一次成型：cursor = 原文已经消费到的位置，段与段之间的空白按原文还原。
    let out = ''
    let cursor = 0
    let swallowSep = false
    let collapsed = false
    const emit = (u: Unit) => {
        out += (swallowSep ? '' : text.slice(cursor, u.start)) + u.text
        swallowSep = false
        cursor = u.end
    }
    const emitMarker = (marker: string, blockEnd: number) => {
        if (out && !/\n\n$/.test(out)) out += '\n\n'
        out += marker + '\n\n'
        cursor = blockEnd
        swallowSep = true
        collapsed = true
    }

    let i = 0
    while (i < units.length) {
        // ── R1 逐字周期 ────────────────────────────────
        let matched = false
        for (let p = 1; p <= MAX_PERIOD; p++) {
            if (i + p >= units.length) break
            if (units[i + p].code || keys[i + p] === '' || keys[i] === '') continue
            if (keys[i + p] !== keys[i]) continue
            let q = i + p
            while (q < units.length && !units[q].code && keys[q] !== '' && keys[q] === keys[q - p]) q++
            const copies = Math.floor((q - i) / p)
            if (copies < MIN_COPIES) continue
            const consumed = copies * p
            for (let n = i; n < i + p; n++) emit(units[n])
            emitMarker(
                `⟲ 以上连续重复 ${copies} 遍，已折叠 ${copies - 1} 遍（省 ${consumed - p} 段）`,
                units[i + consumed - 1].end,
            )
            stats.periodBlocks += 1
            stats.removedParas += consumed - p
            i += consumed
            matched = true
            break
        }
        if (matched) continue

        // ── R2 高频游程 ────────────────────────────────
        const hit = (n: number) =>
            !units[n].code && keys[n] !== '' && (counts.get(keys[n]) || 0) >= MIN_TOTAL_OCCURRENCES
        if (hit(i)) {
            let j = i
            while (j + 1 < units.length && hit(j + 1)) j++
            if (j - i + 1 >= MIN_RUN) {
                const seen = new Set<string>()
                let dropped = 0
                for (let n = i; n <= j; n++) {
                    if (seen.has(keys[n]) || seen.size >= MAX_KEEP_KINDS) { dropped++; continue }
                    seen.add(keys[n])
                    emit(units[n])
                }
                emitMarker(
                    `⟲ 以上 ${seen.size} 种短句各留了一遍，后面 ${dropped} 段是它们在循环，已折叠`,
                    units[j].end,
                )
                stats.frequencyBlocks += 1
                stats.removedParas += dropped
                i = j + 1
                continue
            }
        }

        emit(units[i])
        i++
    }

    stats.parasAfter = units.length - stats.removedParas
    if (!collapsed) return { text, stats }
    out += text.slice(cursor)
    return { text: out.replace(/\n{3,}/g, '\n\n').trim(), stats }
}

/** 只要结果的简写版，供渲染路径直接用。 */
export function collapseRepeatedParagraphs(text: string): string {
    return collapseRepeatedParagraphsDetailed(text).text
}
