import { useState, useRef, useCallback } from 'react'
import type { ChatMessage, ChatBlock, ChatStatus, StructuredRequest, UploadedFile } from '../types'

const MAX_CONTEXT_ROUNDS = 8

export function useChat() {
    const [messages, setMessages] = useState<ChatMessage[]>([])
    const [status, setStatus] = useState<ChatStatus>('idle')
    const [error, setError] = useState<string | null>(null)
    const [streamingBlocks, setStreamingBlocks] = useState<ChatBlock[]>([])
    const [streamingText, setStreamingText] = useState('')
    const abortRef = useRef<AbortController | null>(null)

    const isStreaming = status === 'loading' || status === 'streaming'

    const addChunk = useCallback((chunk: any) => {
        setStreamingBlocks(prev => {
            const next = [...prev]
            switch (chunk.type) {
                case 'reasoning': {
                    const last = next[next.length - 1]
                    if (last && last.type === 'reasoning') last.content = (last.content || '') + (chunk.content || '')
                    else next.push({ type: 'reasoning', content: chunk.content || '' })
                    break
                }
                case 'tool_call':
                    next.push({ type: 'tool_call', toolName: chunk.toolName || '', toolArgs: chunk.toolArgs || {}, serverId: chunk.serverId, content: '' })
                    break
                case 'tool_result':
                    next.push({ type: 'tool_result', toolName: chunk.toolName || '', toolResult: chunk.toolResult || '', isValid: chunk.isValid, serverId: chunk.serverId, content: chunk.toolResult || '' })
                    break
                case 'resource_start':
                    next.push({ type: 'resource_start', resourceName: chunk.resourceName || '', resourceUri: chunk.resourceUri || '', serverId: chunk.serverId, content: '' })
                    break
                case 'resource_end':
                    next.push({ type: 'resource_end', content: chunk.contentPreview || '', resourceName: chunk.resourceName, resourceUri: chunk.resourceUri, serverId: chunk.serverId, isTruncated: chunk.isTruncated, previewChars: chunk.previewChars })
                    break
                case 'resource_error':
                    next.push({ type: 'resource_error', content: chunk.error || '', resourceName: chunk.resourceName, resourceUri: chunk.resourceUri, serverId: chunk.serverId })
                    break
                case 'text': {
                    const text = chunk.content || ''
                    const last = next[next.length - 1]
                    if (last && last.type === 'text') last.content = (last.content || '') + text
                    else next.push({ type: 'text', content: text })
                    break
                }
                case 'error':
                    next.push({ type: 'text', content: '⚠️ 错误：' + (chunk.error || '服务端错误') })
                    break
                case 'recovering':
                    next.push({ type: 'text', content: '🔄 ' + chunk.message })
                    break
                case 'recovery_fallback':
                    next.push({ type: 'text', content: '📌 ' + chunk.message + ' (' + chunk.fallbackMethod + ')' })
                    break
            }
            return next
        })

        if (chunk.type === 'text') setStreamingText(prev => prev + (chunk.content || ''))
        if (chunk.type === 'error') setStatus('retrying')
    }, [])

    const trimMsgs = useCallback((msgs: ChatMessage[]): ChatMessage[] => {
        const indices = msgs.map((m, i) => m.role === 'assistant' ? i : -1).filter(i => i !== -1)
        if (indices.length <= MAX_CONTEXT_ROUNDS) return msgs
        return msgs.slice(indices[indices.length - MAX_CONTEXT_ROUNDS])
    }, [])

    const sendMessage = useCallback(async (
        rawText: string,
        structured: StructuredRequest | null,
        mode: string,
        clientIP: string | null,
        uploadedFiles: UploadedFile[],
    ) => {
        if (!rawText.trim() && uploadedFiles.length === 0) return
        if (status === 'loading' || status === 'streaming') return
        if (abortRef.current) abortRef.current.abort()
        abortRef.current = new AbortController()

        setError(null)
        setStatus('loading')
        setStreamingBlocks([])
        setStreamingText('')

        const userMessage: ChatMessage = {
            role: 'user',
            content: rawText,
            files: uploadedFiles.length > 0 ? [...uploadedFiles] : undefined,
        }
        const updatedMessages = [...messages, userMessage]
        setMessages(updatedMessages)

        const requestPayload = {
            messages: [...messages, {
                role: 'user',
                content: rawText,
                files: uploadedFiles.length > 0 ? [...uploadedFiles] : undefined,
                structured: structured || null,
            }],
            skill: mode,
            clientIP,
        }

        try {
            const resp = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestPayload),
                signal: abortRef.current.signal,
            })

            if (!resp.ok) {
                const errData = await resp.json().catch(() => ({ error: '请求失败' }))
                throw new Error(errData.error || `请求失败 (${resp.status})`)
            }

            setStatus('streaming')
            const reader = resp.body!.getReader()
            const decoder = new TextDecoder()
            let buffer = ''
            let isDone = false
            const collectedBlocks: ChatBlock[] = []
            let collectedText = ''

            while (!isDone) {
                const { done, value } = await reader.read()
                if (done) break
                buffer += decoder.decode(value, { stream: true })
                const lines = buffer.split('\n')
                buffer = lines.pop() || ''

                for (const line of lines) {
                    if (!line.trim()) continue
                    try {
                        const chunk = JSON.parse(line)
                        addChunk(chunk)
                        if (chunk.type === 'text') collectedText += chunk.content || ''
                        collectedBlocks.push({
                            type: chunk.type, content: chunk.content || '',
                            toolCallId: chunk.toolCallId, toolName: chunk.toolName,
                            toolArgs: chunk.toolArgs, toolResult: chunk.toolResult,
                            isValid: chunk.isValid, resourceName: chunk.resourceName,
                            resourceUri: chunk.resourceUri, serverId: chunk.serverId,
                            isTruncated: chunk.isTruncated, previewChars: chunk.previewChars,
                        })
                        if (chunk.type === 'done') isDone = true
                    } catch { /* skip */ }
                    if (isDone) break
                }
                if (isDone) break
            }

            const assistantMessage: ChatMessage = {
                role: 'assistant',
                content: collectedText,
                blocks: collectedBlocks,
            }
            setMessages(prev => trimMsgs([...prev, assistantMessage]))
            setStreamingBlocks([])
            setStreamingText('')
            setStatus('idle')
        } catch (err: any) {
            if (err.name === 'AbortError') { setStatus('idle'); return }
            setError(err.message || '未知错误')
            setStatus('error')
            setMessages(prev => prev.slice(0, -1))
        } finally {
            abortRef.current = null
        }
    }, [messages, status, addChunk, trimMsgs])

    const cancelStream = useCallback(() => {
        if (abortRef.current) { abortRef.current.abort(); abortRef.current = null }
        setStatus('idle')
    }, [])

    const clearMessages = useCallback(() => {
        if (status === 'loading' || status === 'streaming') return
        setMessages([])
        setStreamingBlocks([])
        setStreamingText('')
        setError(null)
        setStatus('idle')
        if (abortRef.current) { abortRef.current.abort(); abortRef.current = null }
    }, [status])

    const regenerate = useCallback(() => {
        if (status === 'loading' || status === 'streaming') return
        let idx = -1
        for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].role === 'user') { idx = i; break }
        }
        if (idx === -1) { setError('没有找到可重新生成的消息'); return }
        const userMsg = messages[idx]
        const remaining = messages.slice(0, idx)
        setMessages(remaining)
        // Return info for App to re-send
        return { text: userMsg.content, files: userMsg.files || [] }
    }, [messages, status])

    const retry = useCallback(() => {
        const lastMsg = messages[messages.length - 1]
        if (lastMsg && lastMsg.role === 'user') {
            const text = lastMsg.content
            const files = lastMsg.files || []
            setMessages(prev => prev.slice(0, -1))
            setError(null)
            return { text, files }
        }
        return null
    }, [messages])

    return {
        messages, status, error, isStreaming,
        streamingBlocks, streamingText,
        sendMessage, cancelStream, clearMessages, regenerate, retry,
        setStatus,
    }
}
