import React, { useRef, useCallback } from 'react'
import AIInputEditor, { AIInputEditorRef } from './AIInputEditor'
import type { SlashCommand, AtReference, UploadedFile, StructuredRequest } from '../types'

interface Props {
    isStreaming: boolean
    isRetrying: boolean
    slashCommands: SlashCommand[]
    atReferences: AtReference[]
    onSend: (rawText: string, structured: StructuredRequest) => void
    onFileDrop: (files: FileList) => void
    onFileSelect: (files: FileList) => void
    onFileRemove: (index: number) => void
    uploadedFiles: UploadedFile[]
    onCancel: () => void
}

function formatSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

const Footer: React.FC<Props> = ({ isStreaming, isRetrying, slashCommands, atReferences, onSend, onFileDrop, onFileSelect, onFileRemove, uploadedFiles, onCancel }) => {
    const editorRef = useRef<AIInputEditorRef>(null)
    const fileInputRef = useRef<HTMLInputElement>(null)

    const handleSend = useCallback(() => {
        if (editorRef.current) {
            const text = editorRef.current.getText()
            if (text.trim()) {
                onSend(text, editorRef.current.getStructuredRequest())
            }
        }
    }, [onSend])

    // Expose send function globally for retry/regenerate
    React.useEffect(() => {
        ;(window as any).__editorClear = () => editorRef.current?.clear()
        ;(window as any).__editorSetValue = (text: string) => editorRef.current?.setValue(text)
    }, [])

    if (isStreaming) {
        return (
            <div className="footer-container">
                {isRetrying ? (
                    <div className="retry-status">
                        <svg className="spinner" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        正在尝试恢复，请稍候...
                    </div>
                ) : (
                    <div className="streaming-controls">
                        <button className="stop-btn" onClick={onCancel}>
                            <svg className="stop-icon" fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="1" /></svg>
                            停止生成
                        </button>
                    </div>
                )}
            </div>
        )
    }

    return (
        <div className="footer-container">
            <div className="input-area">
                {/* File Upload */}
                <div className="file-upload-wrapper">
                    <div className="file-upload-area" onClick={() => fileInputRef.current?.click()}>
                        <input
                            ref={fileInputRef}
                            type="file"
                            multiple
                            style={{ display: 'none' }}
                            onChange={(e) => { if (e.target.files) onFileSelect(e.target.files); e.target.value = '' }}
                            accept=".py,.js,.ts,.jsx,.tsx,.go,.rs,.java,.md,.json,.yaml,.yml,.css,.scss,.sql,.sh,.bash,.html,.vue,.svelte,.c,.cpp,.h,.hpp,.rb,.php,.swift,.kt,.dart,.toml,.xml,.txt"
                        />
                        <svg className="file-upload-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
                        <span className="file-upload-text">拖拽代码文件到此处，或点击选择</span>
                    </div>
                    {uploadedFiles.length > 0 && (
                        <div className="file-list">
                            {uploadedFiles.map((f, i) => (
                                <div key={i} className="file-item">
                                    <svg className="file-item-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                                    <span className="file-item-name">{f.name}</span>
                                    <span className="file-item-size">{formatSize(f.size)}</span>
                                    <button className="file-item-remove" onClick={() => onFileRemove(i)}>
                                        <svg className="file-item-x" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
                {/* Rich Text Editor */}
                <AIInputEditor
                    ref={editorRef}
                    placeholder="输入问题，使用 / 打开命令菜单，@ 引用工具或上下文 (Ctrl+Enter 发送)"
                    slashCommands={slashCommands}
                    atReferences={atReferences}
                    onSend={onSend}
                    onFileDrop={onFileDrop}
                />
                <p className="input-hint">支持 / 斜杠命令、@ 引用工具、Ctrl+Enter 发送</p>
            </div>
        </div>
    )
}

export default Footer
