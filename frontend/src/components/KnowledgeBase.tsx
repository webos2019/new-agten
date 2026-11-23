import React, { useState, useEffect, useCallback, useRef } from 'react'

interface KBDocument {
    docId: string
    title: string
    sourceType: string
    sourcePath: string
    chunkCount: number
    charCount: number
    createdAt: number
}

interface KBSearchResult {
    docId: string
    docTitle: string
    chunkIndex: number
    text: string
    score: number
}

interface KBChunk {
    chunkIndex: number
    text: string
}

interface PreviewMeta {
    sourceType: string
    pageCount: number
    charCount: number
    truncated: boolean
}

interface QACitation {
    index: number
    docId: string
    docTitle: string
    chunkIndex: number
    text: string
    score: number
}

interface QAResult {
    answer: string
    grounded: boolean
    reason: string
    gate: string
    topScore: number
    citations: QACitation[]
}

interface Props {
    sessionId: string
}

const KnowledgeBase: React.FC<Props> = ({ sessionId }) => {
    const [documents, setDocuments] = useState<KBDocument[]>([])
    const [loading, setLoading] = useState(false)
    const [uploadMode, setUploadMode] = useState<'text' | 'file' | 'url'>('text')
    const [title, setTitle] = useState('')
    const [textContent, setTextContent] = useState('')
    const [filePath, setFilePath] = useState('')
    const [url, setUrl] = useState('')
    const [uploading, setUploading] = useState(false)
    const [uploadMsg, setUploadMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

    // 搜索
    const [searchQuery, setSearchQuery] = useState('')
    const [searchResults, setSearchResults] = useState<KBSearchResult[]>([])
    const [searching, setSearching] = useState(false)

    // 查看文档内容
    const [viewingDoc, setViewingDoc] = useState<KBDocument | null>(null)
    const [docChunks, setDocChunks] = useState<KBChunk[]>([])
    const [loadingChunks, setLoadingChunks] = useState(false)

    // ── 右侧文字预览 ──
    const [previewMode, setPreviewMode] = useState<'upload' | 'path' | 'url' | 'text'>('upload')
    const [previewPath, setPreviewPath] = useState('')
    const [previewUrl, setPreviewUrl] = useState('')
    const [previewText, setPreviewText] = useState('')
    const [previewResult, setPreviewResult] = useState('')
    const [previewMeta, setPreviewMeta] = useState<PreviewMeta | null>(null)
    const [previewName, setPreviewName] = useState('')
    const [previewLoading, setPreviewLoading] = useState(false)
    const [previewError, setPreviewError] = useState('')
    const fileInputRef = useRef<HTMLInputElement>(null)

    // ── 受控问答 ──
    const [qaQuestion, setQaQuestion] = useState('')
    const [qaResult, setQaResult] = useState<QAResult | null>(null)
    const [qaAsking, setQaAsking] = useState(false)
    const [qaError, setQaError] = useState('')

    // 加载文档列表
    const loadDocuments = useCallback(async () => {
        try {
            const resp = await fetch('/api/kb/documents')
            const data = await resp.json()
            if (data.documents) setDocuments(data.documents)
        } catch { /* ignore */ }
    }, [])

    useEffect(() => {
        loadDocuments()
    }, [loadDocuments])

    // 上传文档
    const handleUpload = async () => {
        if (!sessionId) return
        setUploading(true)
        setUploadMsg(null)
        try {
            const body: Record<string, string> = { sessionId, title: title || '未命名文档' }
            if (uploadMode === 'text') {
                if (!textContent.trim()) { setUploadMsg({ type: 'error', text: '请输入文本内容' }); return }
                body.text = textContent
            } else if (uploadMode === 'file') {
                if (!filePath.trim()) { setUploadMsg({ type: 'error', text: '请输入文件路径' }); return }
                body.filePath = filePath
            } else if (uploadMode === 'url') {
                if (!url.trim()) { setUploadMsg({ type: 'error', text: '请输入URL' }); return }
                body.url = url
            }
            const resp = await fetch('/api/kb/upload', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            })
            const data = await resp.json()
            if (!resp.ok) {
                setUploadMsg({ type: 'error', text: data.error || '上传失败' })
            } else {
                setUploadMsg({ type: 'success', text: `上传成功: ${data.document.chunkCount} 个分块, ${data.document.charCount} 字` })
                setTitle(''); setTextContent(''); setFilePath(''); setUrl('')
                await loadDocuments()
            }
        } catch {
            setUploadMsg({ type: 'error', text: '网络错误' })
        } finally {
            setUploading(false)
        }
    }

    // 删除文档
    const handleDelete = async (docId: string) => {
        try {
            await fetch(`/api/kb/documents/${docId}`, { method: 'DELETE' })
            await loadDocuments()
        } catch { /* ignore */ }
    }

    // 搜索知识库
    const handleSearch = async () => {
        if (!sessionId || !searchQuery.trim()) return
        setSearching(true)
        try {
            const resp = await fetch('/api/kb/search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId, query: searchQuery }),
            })
            const data = await resp.json()
            setSearchResults(data.results || [])
        } catch { /* ignore */ }
        finally { setSearching(false) }
    }

    // 查看文档内容
    const handleViewDoc = async (doc: KBDocument) => {
        setViewingDoc(doc)
        setDocChunks([])
        setLoadingChunks(true)
        try {
            const resp = await fetch(`/api/kb/documents/${doc.docId}/chunks`)
            const data = await resp.json()
            if (data.chunks) setDocChunks(data.chunks)
        } catch { /* ignore */ }
        finally { setLoadingChunks(false) }
    }

    const handleCloseViewer = () => {
        setViewingDoc(null)
        setDocChunks([])
    }

    // ── 右侧预览: 统一请求 ──
    const runPreview = async (body: Record<string, string>, name: string) => {
        setPreviewLoading(true)
        setPreviewError('')
        setPreviewResult('')
        setPreviewMeta(null)
        setPreviewName(name)
        try {
            const resp = await fetch('/api/kb/preview', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            })
            const data = await resp.json()
            if (!resp.ok) {
                setPreviewError(data.error || '解析失败')
            } else {
                setPreviewResult(data.text || '')
                setPreviewMeta({
                    sourceType: data.sourceType,
                    pageCount: data.pageCount,
                    charCount: data.charCount,
                    truncated: data.truncated,
                })
            }
        } catch {
            setPreviewError('网络错误')
        } finally {
            setPreviewLoading(false)
        }
    }

    // 本地文件 → base64
    const handleFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return
        const reader = new FileReader()
        reader.onload = () => {
            const b64 = String(reader.result || '')
            runPreview({ fileName: file.name, fileBase64: b64 }, file.name)
        }
        reader.onerror = () => setPreviewError('读取本地文件失败')
        reader.readAsDataURL(file)
        // 允许重复选同一文件
        e.target.value = ''
    }

    const handlePreviewByPath = () => {
        if (!previewPath.trim()) { setPreviewError('请输入文件路径'); return }
        runPreview({ filePath: previewPath.trim() }, previewPath.trim())
    }

    const handlePreviewByUrl = () => {
        if (!previewUrl.trim()) { setPreviewError('请输入 URL'); return }
        runPreview({ url: previewUrl.trim() }, previewUrl.trim())
    }

    const handlePreviewByText = () => {
        if (!previewText.trim()) { setPreviewError('请输入文本'); return }
        runPreview({ text: previewText }, '粘贴文本')
    }

    // 受控问答: 只答知识库里有的
    const handleAsk = async () => {
        if (!sessionId || !qaQuestion.trim()) return
        setQaAsking(true)
        setQaError('')
        setQaResult(null)
        try {
            const resp = await fetch('/api/kb/ask', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId, question: qaQuestion }),
            })
            const data = await resp.json()
            if (!resp.ok) {
                setQaError(data.error || '问答失败')
            } else {
                setQaResult(data as QAResult)
            }
        } catch {
            setQaError('网络错误')
        } finally {
            setQaAsking(false)
        }
    }

    const sourceIcon = (type: string) => {
        switch (type) {
            case 'pdf': return '📄'
            case 'url': return '🌐'
            case 'markdown': return '📝'
            case 'docx': return '📘'
            case 'xlsx': return '📊'
            case 'html': return '🌐'
            default: return '📃'
        }
    }

    return (
        <div className="kb-layout">
            {/* ═══ 左栏: 原有知识库管理 ═══ */}
            <div className="kb-page kb-main-col">
                <div className="kb-header">
                    <h2 className="kb-title">📚 知识库管理</h2>
                    <span className="kb-count">{documents.length} 个文档</span>
                </div>

                {/* 上传区域 */}
                <div className="kb-card">
                    <div className="kb-section-title">添加文档</div>
                    <div className="kb-tabs">
                        <button className={`kb-tab ${uploadMode === 'text' ? 'active' : ''}`} onClick={() => setUploadMode('text')}>📝 粘贴文本</button>
                        <button className={`kb-tab ${uploadMode === 'file' ? 'active' : ''}`} onClick={() => setUploadMode('file')}>📁 本地文件</button>
                        <button className={`kb-tab ${uploadMode === 'url' ? 'active' : ''}`} onClick={() => setUploadMode('url')}>🌐 URL</button>
                    </div>

                    <input
                        type="text"
                        className="kb-input"
                        placeholder="文档标题（如：产品说明书）"
                        value={title}
                        onChange={e => setTitle(e.target.value)}
                    />

                    {uploadMode === 'text' && (
                        <textarea
                            className="kb-textarea"
                            placeholder="粘贴文档内容..."
                            value={textContent}
                            onChange={e => setTextContent(e.target.value)}
                            rows={6}
                        />
                    )}
                    {uploadMode === 'file' && (
                        <input
                            type="text"
                            className="kb-input"
                            placeholder="本地文件路径（如：c:\\docs\\manual.pdf）"
                            value={filePath}
                            onChange={e => setFilePath(e.target.value)}
                        />
                    )}
                    {uploadMode === 'url' && (
                        <input
                            type="text"
                            className="kb-input"
                            placeholder="https://example.com/article.html"
                            value={url}
                            onChange={e => setUrl(e.target.value)}
                        />
                    )}

                    <button className="kb-btn-primary" onClick={handleUpload} disabled={uploading}>
                        {uploading ? '上传中...' : '🚀 上传到知识库'}
                    </button>

                    {uploadMsg && (
                        <div className={`kb-alert ${uploadMsg.type}`}>{uploadMsg.text}</div>
                    )}
                </div>

                {/* 文档列表 */}
                <div className="kb-card">
                    <div className="kb-section-title">已上传文档</div>
                    {documents.length === 0 ? (
                        <div className="kb-empty">暂无文档，请上传</div>
                    ) : (
                        <div className="kb-doc-list">
                            {documents.map(doc => (
                                <div key={doc.docId} className="kb-doc-item">
                                    <div className="kb-doc-icon" onClick={() => handleViewDoc(doc)} style={{ cursor: 'pointer' }}>{sourceIcon(doc.sourceType)}</div>
                                    <div className="kb-doc-info" onClick={() => handleViewDoc(doc)} style={{ cursor: 'pointer' }}>
                                        <div className="kb-doc-name">{doc.title}</div>
                                        <div className="kb-doc-meta">
                                            {doc.chunkCount} 块 · {doc.charCount} 字 · {doc.sourceType}
                                        </div>
                                    </div>
                                    <button
                                        className="kb-doc-view-btn"
                                        onClick={() => handleViewDoc(doc)}
                                        title="查看内容"
                                    >
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                                            <circle cx="12" cy="12" r="3"/>
                                        </svg>
                                    </button>
                                    <button
                                        className="kb-doc-delete"
                                        onClick={() => handleDelete(doc.docId)}
                                        title="删除"
                                    >
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                                        </svg>
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* 受控问答 */}
                <div className="kb-card kb-qa-card">
                    <div className="kb-section-title">🎯 知识库问答（只答库内内容）</div>
                    <div className="kb-search-row">
                        <input
                            type="text"
                            className="kb-input"
                            placeholder="提问，知识库里没有会明确告知不存在..."
                            value={qaQuestion}
                            onChange={e => setQaQuestion(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') handleAsk() }}
                        />
                        <button className="kb-btn-primary" onClick={handleAsk} disabled={qaAsking}>
                            {qaAsking ? '思考中...' : '💬 提问'}
                        </button>
                    </div>

                    {qaError && <div className="kb-alert error">{qaError}</div>}

                    {qaResult && (
                        qaResult.grounded ? (
                            <div className="kb-qa-answer">
                                <div className="kb-qa-answer-head">
                                    <span className="kb-qa-badge ok">✓ 有依据</span>
                                    <span className="kb-qa-score">top {qaResult.topScore.toFixed(3)}</span>
                                </div>
                                <div className="kb-qa-answer-text">{qaResult.answer}</div>
                                {qaResult.citations.length > 0 && (
                                    <div className="kb-qa-citations">
                                        <div className="kb-qa-citations-title">引用来源</div>
                                        {qaResult.citations.map(c => (
                                            <div key={c.index} className="kb-qa-citation">
                                                <span className="kb-qa-citation-idx">[{c.index}]</span>
                                                <span className="kb-qa-citation-doc">{c.docTitle} · 片段{c.chunkIndex + 1}</span>
                                                <div className="kb-qa-citation-text">{c.text}</div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="kb-qa-abstain">
                                <div className="kb-qa-answer-head">
                                    <span className="kb-qa-badge no">✕ 无法回答</span>
                                    <span className="kb-qa-gate">{qaResult.gate}</span>
                                </div>
                                <div className="kb-qa-abstain-text">{qaResult.answer}</div>
                                <div className="kb-qa-reason">{qaResult.reason}</div>
                            </div>
                        )
                    )}
                </div>

                {/* 搜索测试 */}
                <div className="kb-card">
                    <div className="kb-section-title">搜索测试</div>
                    <div className="kb-search-row">
                        <input
                            type="text"
                            className="kb-input"
                            placeholder="输入问题测试召回..."
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') handleSearch() }}
                        />
                        <button className="kb-btn-primary" onClick={handleSearch} disabled={searching}>
                            {searching ? '搜索中...' : '🔍 搜索'}
                        </button>
                    </div>
                    {searchResults.length > 0 && (
                        <div className="kb-search-results">
                            {searchResults.map((r, i) => (
                                <div key={i} className="kb-search-item">
                                    <div className="kb-search-header">
                                        <span className="kb-search-doc">{r.docTitle} · 片段{r.chunkIndex + 1}</span>
                                        <span className="kb-search-score">score: {r.score}</span>
                                    </div>
                                    <div className="kb-search-text">{r.text}</div>
                                </div>
                            ))}
                        </div>
                    )}
                    {searchResults.length === 0 && searchQuery && !searching && (
                        <div className="kb-empty">无匹配结果</div>
                    )}
                </div>
            </div>

            {/* ═══ 右栏: 文字预览 ═══ */}
            <div className="kb-preview-col">
                <div className="kb-card kb-preview-card">
                    <div className="kb-preview-head">
                        <h3 className="kb-preview-title">📖 文字预览</h3>
                        <span className="kb-preview-hint">只读取文字，不入库</span>
                    </div>

                    <div className="kb-tabs kb-preview-tabs">
                        <button className={`kb-tab ${previewMode === 'upload' ? 'active' : ''}`} onClick={() => setPreviewMode('upload')}>📤 选文件</button>
                        <button className={`kb-tab ${previewMode === 'path' ? 'active' : ''}`} onClick={() => setPreviewMode('path')}>📁 路径</button>
                        <button className={`kb-tab ${previewMode === 'url' ? 'active' : ''}`} onClick={() => setPreviewMode('url')}>🌐 URL</button>
                        <button className={`kb-tab ${previewMode === 'text' ? 'active' : ''}`} onClick={() => setPreviewMode('text')}>📝 文本</button>
                    </div>

                    {previewMode === 'upload' && (
                        <div className="kb-preview-upload-area">
                            <input
                                ref={fileInputRef}
                                type="file"
                                style={{ display: 'none' }}
                                onChange={handleFilePick}
                                accept=".pdf,.docx,.xlsx,.xlsm,.md,.txt,.html,.htm,.csv,.json,.log,.yaml,.yml,.py"
                            />
                            <button
                                className="kb-btn-primary kb-preview-pick"
                                onClick={() => fileInputRef.current?.click()}
                                disabled={previewLoading}
                            >
                                {previewLoading ? '解析中...' : '📂 选择本地文件'}
                            </button>
                            <div className="kb-preview-formats">
                                支持 PDF / DOCX / XLSX / MD / TXT / HTML / CSV / JSON
                            </div>
                        </div>
                    )}

                    {previewMode === 'path' && (
                        <div className="kb-preview-input-row">
                            <input
                                type="text"
                                className="kb-input"
                                placeholder="服务器本地路径，如 c:\\docs\\manual.pdf"
                                value={previewPath}
                                onChange={e => setPreviewPath(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') handlePreviewByPath() }}
                            />
                            <button className="kb-btn-primary" onClick={handlePreviewByPath} disabled={previewLoading}>
                                {previewLoading ? '解析中...' : '解析'}
                            </button>
                        </div>
                    )}

                    {previewMode === 'url' && (
                        <div className="kb-preview-input-row">
                            <input
                                type="text"
                                className="kb-input"
                                placeholder="https://example.com/doc.pdf"
                                value={previewUrl}
                                onChange={e => setPreviewUrl(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') handlePreviewByUrl() }}
                            />
                            <button className="kb-btn-primary" onClick={handlePreviewByUrl} disabled={previewLoading}>
                                {previewLoading ? '解析中...' : '解析'}
                            </button>
                        </div>
                    )}

                    {previewMode === 'text' && (
                        <div className="kb-preview-text-wrap">
                            <textarea
                                className="kb-textarea"
                                placeholder="粘贴要预览的文字..."
                                value={previewText}
                                onChange={e => setPreviewText(e.target.value)}
                                rows={4}
                            />
                            <button className="kb-btn-primary" onClick={handlePreviewByText} disabled={previewLoading}>
                                {previewLoading ? '解析中...' : '预览'}
                            </button>
                        </div>
                    )}

                    {previewError && <div className="kb-alert error">{previewError}</div>}

                    {previewMeta && (
                        <div className="kb-preview-meta">
                            <span className="kb-preview-badge">{sourceIcon(previewMeta.sourceType)} {previewMeta.sourceType}</span>
                            {previewMeta.pageCount > 0 && <span>· {previewMeta.pageCount} 页</span>}
                            <span>· {previewMeta.charCount.toLocaleString()} 字</span>
                            {previewMeta.truncated && <span className="kb-preview-trunc">· 已截断</span>}
                        </div>
                    )}

                    <div className="kb-preview-body">
                        {previewLoading ? (
                            <div className="kb-preview-placeholder">正在解析文件...</div>
                        ) : previewResult ? (
                            <pre className="kb-preview-text">{previewResult}</pre>
                        ) : (
                            <div className="kb-preview-placeholder">
                                {previewName ? '无内容' : '选择文件或输入来源后，这里显示提取出的文字'}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* 文档内容查看器 */}
            {viewingDoc && (
                <div className="kb-doc-viewer-overlay" onClick={handleCloseViewer}>
                    <div className="kb-doc-viewer" onClick={e => e.stopPropagation()}>
                        <div className="kb-doc-viewer-header">
                            <div className="kb-doc-viewer-title">
                                {sourceIcon(viewingDoc.sourceType)} {viewingDoc.title}
                            </div>
                            <button className="kb-doc-viewer-close" onClick={handleCloseViewer} title="关闭">✕</button>
                        </div>
                        <div className="kb-doc-viewer-meta">
                            {viewingDoc.chunkCount} 块 · {viewingDoc.charCount} 字 · {viewingDoc.sourceType}
                        </div>
                        <div className="kb-doc-viewer-body">
                            {loadingChunks ? (
                                <div className="kb-doc-viewer-loading">加载中...</div>
                            ) : docChunks.length === 0 ? (
                                <div className="kb-doc-viewer-empty">文档无内容</div>
                            ) : (
                                docChunks.map((chunk, i) => (
                                    <div key={i} className="kb-chunk-block">
                                        <div className="kb-chunk-index">片段 {chunk.chunkIndex + 1}</div>
                                        <div className="kb-chunk-text">{chunk.text}</div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

export default KnowledgeBase
