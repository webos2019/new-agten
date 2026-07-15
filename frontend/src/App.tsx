import { useState, useEffect, useCallback, useRef } from 'react'
import Header from './components/Header'
import ChatBody from './components/ChatBody'
import Footer from './components/Footer'
import { useChat } from './hooks/useChat'
import { slashCommands, atReferences } from './types'
import type { UploadedFile, StructuredRequest, AtReference } from './types'

export default function App() {
    const [mode, setMode] = useState('utility-skill')
    const [clientIP, setClientIP] = useState<string | null>(null)
    const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([])
    const [atRefs, setAtRefs] = useState<AtReference[]>(atReferences)
    const editorRef = useRef<{ clear: () => void; setValue: (text: string) => void }>(null)

    const chat = useChat()

    // Fetch public IP on mount
    useEffect(() => {
        fetch('https://api.ipify.org?format=json')
            .then(r => r.json())
            .then(data => {
                if (data.ip) {
                    setClientIP(data.ip)
                    setAtRefs(prev => [...prev, {
                        label: 'IP: ' + data.ip, type: 'context',
                        desc: '客户端公网IP地址', keywords: ['ip', 'IP', '地址'],
                    }])
                }
            })
            .catch(() => {})
    }, [])

    // Expose setMode and clearMessages for slash commands
    useEffect(() => {
        ;(window as any).__setMode = setMode
        ;(window as any).__clearMessages = chat.clearMessages
    }, [chat.clearMessages])

    const handleSend = useCallback((rawText: string, structured: StructuredRequest) => {
        chat.sendMessage(rawText, structured, mode, clientIP, uploadedFiles)
        setUploadedFiles([])
    }, [chat, mode, clientIP, uploadedFiles])

    const handleFileDrop = useCallback((files: FileList) => {
        for (let i = 0; i < files.length; i++) {
            const file = files[i]
            const ext = '.' + file.name.split('.').pop()?.toLowerCase()
            const allowed = ['.py','.js','.ts','.jsx','.tsx','.go','.rs','.java','.md','.json','.yaml','.yml','.css','.scss','.sql','.sh','.bash','.toml','.xml','.html','.vue','.svelte','.c','.cpp','.h','.hpp','.rb','.php','.swift','.kt','.dart','.txt']
            if (!allowed.includes(ext) || file.size > 1024 * 1024) continue
            const reader = new FileReader()
            reader.onload = (e) => {
                const content = e.target?.result as string
                setUploadedFiles(prev => [...prev, { name: file.name, size: file.size, type: ext.slice(1), content }])
                setAtRefs(prev => [...prev, { label: file.name, type: 'file', desc: '已上传的文件', data: { file: file.name, content } }])
            }
            reader.readAsText(file)
        }
    }, [])

    const handleFileSelect = useCallback((files: FileList) => {
        handleFileDrop(files)
    }, [handleFileDrop])

    const handleFileRemove = useCallback((index: number) => {
        setUploadedFiles(prev => prev.filter((_, i) => i !== index))
    }, [])

    const handleRegenerate = useCallback(() => {
        const result = chat.regenerate()
        if (result) {
            setUploadedFiles(result.files)
            chat.sendMessage(result.text, null, mode, clientIP, result.files)
        }
    }, [chat, mode, clientIP])

    const handleRetry = useCallback(() => {
        const result = chat.retry()
        if (result) {
            setUploadedFiles(result.files)
            chat.sendMessage(result.text, null, mode, clientIP, result.files)
        }
    }, [chat, mode, clientIP])

    const isRetrying = chat.status === 'retrying'

    return (
        <div className="container">
            <Header
                mode={mode}
                onSetMode={setMode}
                hasMessages={chat.messages.length > 0}
                onRegenerate={handleRegenerate}
                onClear={chat.clearMessages}
            />
            <ChatBody
                messages={chat.messages}
                isStreaming={chat.isStreaming}
                streamingText={chat.streamingText}
                streamingBlocks={chat.streamingBlocks}
                error={chat.error}
                mode={mode}
            />
            <Footer
                isStreaming={chat.isStreaming}
                isRetrying={isRetrying}
                slashCommands={slashCommands}
                atReferences={atRefs}
                onSend={handleSend}
                onFileDrop={handleFileDrop}
                onFileSelect={handleFileSelect}
                onFileRemove={handleFileRemove}
                uploadedFiles={uploadedFiles}
                onCancel={chat.cancelStream}
            />
        </div>
    )
}
