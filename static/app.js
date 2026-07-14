/**
 * Code Assistant - Frontend App
 */

// ─── State ─────────────────────────────────────────────
let messages = [];
let status = 'idle'; // idle | loading | streaming | retrying | error
let error = null;
let mode = 'utility-skill';
let clientIP = null;
let abortController = null;
let uploadedFiles = [];
let streamingBlocks = [];
let streamingText = '';

const MAX_CONTEXT_ROUNDS = 8;

// ─── Init ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    initFeatures();
    initInputListeners();
    initDragDrop();
    getPublicIP();
    updateSendButton();
});

// ─── Public IP ─────────────────────────────────────────
async function getPublicIP() {
    try {
        const resp = await fetch('https://api.ipify.org?format=json');
        const data = await resp.json();
        if (data.ip) clientIP = data.ip;
    } catch (e) {
        try {
            const resp = await fetch('https://api.ipgeolocation.io/getip');
            const data = await resp.json();
            if (data.ip) clientIP = data.ip;
        } catch (e2) {
            // ignore
        }
    }
}

// ─── Mode Switch ───────────────────────────────────────
function setMode(newMode) {
    mode = newMode;
    document.getElementById('btn-utility').classList.toggle('active', mode === 'utility-skill');
    document.getElementById('btn-reader').classList.toggle('active', mode === 'reader-skill');
    document.getElementById('mode-subtitle').textContent = mode === 'utility-skill' ? '实用工具模式' : '文件与天气模式';
    updateEmptyState();
}

// ─── Features ──────────────────────────────────────────
function initFeatures() {
    updateEmptyState();
}

function updateEmptyState() {
    const grid = document.getElementById('feature-grid');
    const title = document.getElementById('empty-title');
    const desc = document.getElementById('empty-desc');

    if (mode === 'utility-skill') {
        title.textContent = '实用工具助手';
        desc.textContent = '处理确定性实用任务：数学计算、日期查询、文本转换、单位换算。模型会严格使用工具确保结果准确。';
        const features = [
            { title: '数学计算', desc: '精确计算数学表达式', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z' },
            { title: '日期时间', desc: '获取当前时间、日期加减、判断星期', icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z' },
            { title: '文本转换', desc: 'Markdown转文本、提取链接、JSON美化', icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
            { title: '单位换算', desc: '长度、重量、温度单位转换', icon: 'M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3' },
        ];
        grid.innerHTML = features.map(f => `
            <div class="feature-card">
                <div class="feature-icon-container">
                    <svg class="feature-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="${f.icon}"></path></svg>
                </div>
                <h3 class="feature-title">${f.title}</h3>
                <p class="feature-desc">${f.desc}</p>
            </div>
        `).join('');
    } else {
        title.textContent = '文件与天气助手';
        desc.textContent = '接入外部上下文来源：读取本地文件、查询实时天气。这些信息模型无法自行获取，必须通过工具调用。';
        const features = [
            { title: '目录遍历', desc: '查看项目根目录结构（仅根目录）', icon: 'M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z' },
            { title: '文件读取', desc: '读取项目根目录下的文本文件', icon: 'M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z' },
            { title: '地理位置', desc: '通过IP获取用户所在城市', icon: 'M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z' },
            { title: '实时天气', desc: '查询指定城市的实时天气信息', icon: 'M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z' },
        ];
        grid.innerHTML = features.map(f => `
            <div class="feature-card">
                <div class="feature-icon-container feature-icon-purple">
                    <svg class="feature-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="${f.icon}"></path></svg>
                </div>
                <h3 class="feature-title">${f.title}</h3>
                <p class="feature-desc">${f.desc}</p>
            </div>
        `).join('');
    }
}

// ─── Input Listeners ────────────────────────────────────
function initInputListeners() {
    const input = document.getElementById('chat-input');
    input.addEventListener('input', () => {
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 200) + 'px';
        updateSendButton();
    });
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            handleSend();
        }
    });
}

function updateSendButton() {
    const input = document.getElementById('chat-input');
    const btn = document.getElementById('send-btn');
    const hasText = input.value.trim().length > 0;
    const hasFiles = uploadedFiles.length > 0;
    const canSend = (hasText || hasFiles) && status === 'idle';
    btn.classList.toggle('enabled', canSend);
    btn.classList.toggle('disabled', !canSend);
}

// ─── File Upload ────────────────────────────────────────
function initDragDrop() {
    const dropArea = document.getElementById('file-upload-area');
    dropArea.addEventListener('dragover', (e) => { e.preventDefault(); dropArea.classList.add('dragover'); });
    dropArea.addEventListener('dragleave', () => dropArea.classList.remove('dragover'));
    dropArea.addEventListener('drop', (e) => {
        e.preventDefault();
        dropArea.classList.remove('dragover');
        const files = e.dataTransfer.files;
        for (let i = 0; i < files.length; i++) readFile(files[i]);
    });
}

function handleFileSelect(event) {
    const files = event.target.files;
    for (let i = 0; i < files.length; i++) readFile(files[i]);
    event.target.value = '';
}

function readFile(file) {
    const ext = '.' + file.name.split('.').pop()?.toLowerCase();
    const allowed = ['.py','.js','.ts','.jsx','.tsx','.go','.rs','.java','.md','.json','.yaml','.yml','.css','.scss','.sql','.sh','.bash','.toml','.xml','.html','.vue','.svelte','.c','.cpp','.h','.hpp','.rb','.php','.swift','.kt','.dart','.txt'];
    if (!allowed.includes(ext)) { return; }
    if (file.size > 1024 * 1024) { return; }

    const reader = new FileReader();
    reader.onload = (e) => {
        const content = e.target.result;
        uploadedFiles.push({ name: file.name, size: file.size, type: ext.slice(1), content });
        renderFileList();
        updateSendButton();
    };
    reader.readAsText(file);
}

function removeFile(index) {
    uploadedFiles.splice(index, 1);
    renderFileList();
    updateSendButton();
}

function renderFileList() {
    const list = document.getElementById('file-list');
    const langLabels = { py:'Python',js:'JavaScript',ts:'TypeScript',jsx:'React JSX',tsx:'React TSX',go:'Go',rs:'Rust',java:'Java',md:'Markdown',json:'JSON',yaml:'YAML',yml:'YAML',css:'CSS',scss:'SCSS',sql:'SQL',sh:'Shell',bash:'Bash',html:'HTML',vue:'Vue',svelte:'Svelte',c:'C',cpp:'C++',rb:'Ruby',php:'PHP',swift:'Swift',kt:'Kotlin',dart:'Dart',txt:'Text' };
    list.innerHTML = uploadedFiles.map((f, i) => `
        <div class="file-item">
            <svg class="h-4 w-4 flex-shrink-0 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
            <span class="file-item-name">${f.name}</span>
            <span class="text-xs text-gray-400 flex-shrink-0">${formatSize(f.size)}</span>
            <span class="rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-700">${langLabels[f.type] || f.type.toUpperCase()}</span>
            <button class="file-item-remove" onclick="removeFile(${i})" title="删除文件">
                <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
            </button>
        </div>
    `).join('');
}

function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// ─── Send Message ───────────────────────────────────────
async function handleSend() {
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    if (!text && uploadedFiles.length === 0) return;
    if (status === 'loading' || status === 'streaming') return;

    if (abortController) abortController.abort();
    abortController = new AbortController();

    error = null;
    setStatus('loading');
    streamingBlocks = [];
    streamingText = '';

    const userMessage = { role: 'user', content: text, files: uploadedFiles.length > 0 ? [...uploadedFiles] : undefined };
    const updatedMessages = [...messages, userMessage];
    messages = updatedMessages;

    renderMessages();
    input.value = '';
    input.style.height = 'auto';
    uploadedFiles = [];
    renderFileList();
    updateSendButton();

    try {
        const resp = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages: updatedMessages, skill: mode, clientIP }),
            signal: abortController.signal,
        });

        if (!resp.ok) {
            const errData = await resp.json().catch(() => ({ error: '请求失败' }));
            throw new Error(errData.error || '请求失败 (' + resp.status + ')');
        }

        setStatus('streaming');
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let isDone = false;
        const collectedBlocks = [];
        let collectedText = '';

        while (!isDone) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const chunk = JSON.parse(line);
                    addChunkToBuffer(chunk);
                    if (chunk.type === 'text') {
                        collectedText += chunk.content || '';
                    }
                    const block = chunkToBlock(chunk);
                    collectedBlocks.push(block);

                    if (chunk.type === 'error') { setStatus('retrying'); }
                    if (chunk.type === 'done') { isDone = true; }
                } catch (e) { /* parse error skip */ }
                if (isDone) break;
            }
            if (isDone) break;
        }

        const assistantMessage = {
            role: 'assistant',
            content: collectedText || streamingText,
            blocks: collectedBlocks,
        };
        messages = trimMessages([...messages, assistantMessage]);
        streamingBlocks = [];
        streamingText = '';
        setStatus('idle');
        renderMessages();
    } catch (err) {
        if (err.name === 'AbortError') { setStatus('idle'); return; }
        error = err.message || '未知错误';
        setStatus('error');
        messages = messages.slice(0, -1);
        renderMessages();
    } finally {
        abortController = null;
    }
}

// ─── Chunk Processing ───────────────────────────────────
function addChunkToBuffer(chunk) {
    switch (chunk.type) {
        case 'reasoning': {
            const last = streamingBlocks[streamingBlocks.length - 1];
            if (last && last.type === 'reasoning') last.content += chunk.content || '';
            else streamingBlocks.push({ type: 'reasoning', content: chunk.content || '' });
            break;
        }
        case 'tool_call':
            streamingBlocks.push({
                type: 'tool_call', toolName: chunk.toolName || '', toolArgs: chunk.toolArgs || {},
                serverId: chunk.serverId, content: chunk.content || '',
            });
            break;
        case 'tool_result':
            streamingBlocks.push({
                type: 'tool_result', toolName: chunk.toolName || '',
                toolResult: chunk.toolResult || chunk.content || '', isValid: chunk.isValid,
                serverId: chunk.serverId, content: chunk.toolResult || chunk.content || '',
            });
            break;
        case 'resource_start':
            streamingBlocks.push({
                type: 'resource_start', resourceName: chunk.resourceName || '',
                resourceUri: chunk.resourceUri || '', serverId: chunk.serverId, content: chunk.contentPreview || '',
            });
            break;
        case 'resource_end':
            streamingBlocks.push({
                type: 'resource_end', content: chunk.contentPreview || '',
                resourceName: chunk.resourceName, resourceUri: chunk.resourceUri,
                serverId: chunk.serverId, isTruncated: chunk.isTruncated, previewChars: chunk.previewChars,
            });
            break;
        case 'resource_error':
            streamingBlocks.push({
                type: 'resource_error', content: chunk.error || '',
                resourceName: chunk.resourceName, resourceUri: chunk.resourceUri, serverId: chunk.serverId,
            });
            break;
        case 'text': {
            const text = chunk.content || '';
            const last = streamingBlocks[streamingBlocks.length - 1];
            if (last && last.type === 'text') last.content += text;
            else streamingBlocks.push({ type: 'text', content: text });
            streamingText += text;
            break;
        }
        case 'error':
            streamingBlocks.push({ type: 'text', content: '⚠️ 错误：' + (chunk.error || '服务端错误') });
            break;
        case 'recovering':
            streamingBlocks.push({ type: 'text', content: '🔄 ' + chunk.message });
            break;
        case 'recovery_fallback':
            streamingBlocks.push({ type: 'text', content: '📌 ' + chunk.message + '（' + chunk.fallbackMethod + '）' });
            break;
    }
    renderMessages();
}

function chunkToBlock(chunk) {
    return {
        type: chunk.type, content: chunk.content || '',
        toolCallId: chunk.toolCallId, toolName: chunk.toolName, toolArgs: chunk.toolArgs,
        toolResult: chunk.toolResult, isValid: chunk.isValid,
        resourceName: chunk.resourceName, resourceUri: chunk.resourceUri,
        serverId: chunk.serverId, isTruncated: chunk.isTruncated, previewChars: chunk.previewChars,
    };
}

// ─── Render Messages ───────────────────────────────────
function renderMessages() {
    const emptyState = document.getElementById('empty-state');
    const msgContainer = document.getElementById('messages-container');
    const actionBtns = document.getElementById('action-buttons');
    const inputArea = document.getElementById('input-area');
    const streamingControls = document.getElementById('streaming-controls');
    const retryStatus = document.getElementById('retry-status');

    const isStreaming = status === 'loading' || status === 'streaming';
    const isEmpty = messages.length === 0 && !isStreaming;

    emptyState.style.display = isEmpty ? 'flex' : 'none';
    msgContainer.style.display = isEmpty ? 'none' : 'flex';
    actionBtns.style.display = messages.length > 0 ? 'flex' : 'none';

    // Footer state
    inputArea.style.display = isStreaming ? 'none' : (status === 'retrying' ? 'none' : 'block');
    streamingControls.style.display = isStreaming && status !== 'retrying' ? 'flex' : 'none';
    retryStatus.style.display = status === 'retrying' ? 'flex' : 'none';

    if (isEmpty) return;

    // Find last assistant index
    let lastAssistantIndex = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'assistant') { lastAssistantIndex = i; break; }
    }

    let html = '';
    for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        const isLastAssistant = i === lastAssistantIndex && msg.role === 'assistant';
        const showStreaming = isStreaming && isLastAssistant;
        html += renderMessage(msg, showStreaming, showStreaming ? streamingText : undefined, showStreaming ? streamingBlocks : undefined);
    }

    // Show streaming placeholder if no assistant message yet
    if (isStreaming && lastAssistantIndex < 0) {
        html += renderMessage({ role: 'assistant', content: '' }, true, streamingText, streamingBlocks);
    }

    // Error display
    if (error) {
        const lastUserMsg = messages[messages.length - 1];
        html += `
            <div class="error-container">
                <div class="error-content">
                    <svg class="error-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                    <div class="error-text">
                        <p class="error-title">出错了</p>
                        <p class="error-msg">${escapeHtml(error)}</p>
                        <button class="retry-btn" onclick="retryLastMessage()">重试</button>
                    </div>
                </div>
            </div>
        `;
    }

    msgContainer.innerHTML = html;
    scrollToBottom();
}

function renderMessage(msg, isStreaming, sText, sBlocks) {
    const isUser = msg.role === 'user';
    const isSystem = msg.role === 'system';
    if (isSystem) return '';

    const allBlocks = isStreaming ? (sBlocks || []) : (msg.blocks || []);
    const textContent = isStreaming && sText !== undefined ? sText : msg.content;

    const avatarClass = isUser ? 'user' : 'ai';
    const avatarText = isUser ? 'U' : 'AI';

    let contentHtml = '';
    if (isUser) {
        let filesHtml = '';
        if (msg.files && msg.files.length > 0) {
            filesHtml = '<div class="mb-2 flex flex-wrap gap-1.5">' + msg.files.map(f =>
                '<span class="inline-flex items-center gap-1 rounded-md bg-white/20 px-2 py-0.5 text-xs">' +
                '<svg class="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>' +
                escapeHtml(f.name) + '</span>'
            ).join('') + '</div>';
        }
        contentHtml = `<div class="user-bubble">${filesHtml}<div>${escapeHtml(textContent || '')}</div></div>`;
    } else {
        // AI message
        let inner = '';
        if (allBlocks.length > 0) {
            inner = allBlocks.map((b, idx) => renderStructuredBlock(b, idx, allBlocks)).join('');
        } else {
            inner = renderMarkdown(textContent || '');
        }
        if (isStreaming) {
            inner += '<span class="streaming-cursor"></span>';
        }
        contentHtml = `<div class="ai-bubble">${inner}</div>`;
    }

    return `
        <div class="msg-row ${isUser ? 'user' : 'assistant'}">
            <div class="msg-wrapper">
                <div class="avatar ${avatarClass}">${avatarText}</div>
                <div class="msg-content">${contentHtml}</div>
            </div>
        </div>
    `;
}

// ─── Structured Block Render ────────────────────────────
function renderStructuredBlock(block, idx, allBlocks) {
    switch (block.type) {
        case 'reasoning':
            return `<div class="my-2 overflow-hidden rounded-xl border border-amber-200 bg-amber-50/80">
                <details class="group" open>
                    <summary class="flex cursor-pointer items-center gap-2 px-3 py-2 text-xs font-medium text-amber-700 hover:bg-amber-100/50">
                        <svg class="h-3.5 w-3.5 transition-transform group-open:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path></svg>
                        <span>推理过程</span>
                        <span class="ml-auto text-amber-500">点击展开/收起</span>
                    </summary>
                    <div class="border-t border-amber-200/50 px-3 py-2 text-xs leading-relaxed text-amber-800">${renderMarkdown(block.content)}</div>
                </details>
            </div>`;

        case 'tool_call': {
            const argsStr = block.toolArgs ? Object.entries(block.toolArgs).map(([k,v]) => k + '=' + v).join(', ') : '';
            return `<div class="tool-call-block">
                <div class="tool-call-header">
                    <span class="tool-call-name">工具调用: ${escapeHtml(block.toolName || '')}</span>
                    <span class="flex items-center gap-1 rounded-md bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700">
                        <svg class="h-3 w-3 animate-pulse" fill="currentColor" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10"></circle><path class="opacity-75" fill-rule="evenodd" d="M12 2a10 10 0 00-10 10c0 4.42 2.87 8.17 6.84 9.49.5.09.68-.22.68-.48v-1.7c-2.78.61-3.37-1.34-3.37-1.34-.46-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.89 1.53 2.34 1.09 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.26-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02A9.578 9.578 0 0112 6.8c.85 0 1.71.11 2.51.33 1.91-1.29 2.75-1.02 2.75-1.02.55 1.37.2 2.38.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.33 4.68-4.56 4.93.36.31.68.92.68 1.85v2.75c0 .27.18.58.69.48A10.02 10.02 0 0022 12c0-5.52-4.48-10-10-10z" clip-rule="evenodd"></path></svg>
                        执行中
                    </span>
                </div>
                ${argsStr ? `<div class="tool-call-args"><div class="tool-call-args-label">输入</div><div class="tool-call-args-value">${escapeHtml(argsStr)}</div></div>` : ''}
            </div>`;
        }

        case 'tool_result': {
            let displayResult = block.toolResult || block.content || '';
            let isError = false;
            let weatherData = null;

            try {
                const parsed = JSON.parse(displayResult);
                if (parsed.error) { displayResult = parsed.error; isError = true; }
                else if (parsed.city && parsed.temperature !== undefined) { weatherData = parsed; }
            } catch (e) { /* not JSON */ }

            if (weatherData) {
                let rows = '';
                if (weatherData.city) rows += `<div class="weather-row"><span class="weather-label">城市</span><span class="weather-value">${escapeHtml(String(weatherData.city))}</span></div>`;
                if (weatherData.weather) rows += `<div class="weather-row"><span class="weather-label">天气</span><span class="weather-value">${escapeHtml(String(weatherData.weather))}</span></div>`;
                if (weatherData.temperature !== undefined) rows += `<div class="weather-row"><span class="weather-label">温度</span><span class="weather-value">${escapeHtml(String(weatherData.temperature))}°C</span></div>`;
                if (weatherData.feelsLike !== undefined) rows += `<div class="weather-row"><span class="weather-label">体感温度</span><span class="weather-value">${escapeHtml(String(weatherData.feelsLike))}°C</span></div>`;
                if (weatherData.temperatureMin !== undefined || weatherData.temperatureMax !== undefined) rows += `<div class="weather-row"><span class="weather-label">温度范围</span><span class="weather-value">${escapeHtml(String(weatherData.temperatureMin))}°C ~ ${escapeHtml(String(weatherData.temperatureMax))}°C</span></div>`;
                if (weatherData.humidity !== undefined) rows += `<div class="weather-row"><span class="weather-label">湿度</span><span class="weather-value">${escapeHtml(String(weatherData.humidity))}%</span></div>`;
                if (weatherData.windSpeed !== undefined) rows += `<div class="weather-row"><span class="weather-label">风速</span><span class="weather-value">${escapeHtml(String(weatherData.windSpeed))} km/h</span></div>`;
                if (weatherData.source) rows += `<div class="weather-row border-t border-gray-100 pt-2" style="border-top:1px solid #f3f4f6;padding-top:0.5rem;"><span class="weather-label">来源</span><span class="weather-label">${escapeHtml(String(weatherData.source))}</span></div>`;
                return `<div class="tool-result-block"><div class="tool-result-header"><span class="tool-result-label">结果</span></div><div class="weather-result">${rows}</div></div>`;
            }

            const successBadge = !isError && block.isValid !== false;
            return `<div class="tool-result-block" style="${isError ? 'border-color:#fecaca;background:rgba(254,242,242,0.5)' : successBadge ? 'border-color:#bbf7d0;background:rgba(240,253,244,0.5)' : ''}">
                <div class="tool-result-header" style="${isError ? 'border-color:#fecaca' : successBadge ? 'border-color:#bbf7d0' : ''}">
                    <span class="tool-result-label" style="${isError ? 'color:#ef4444' : successBadge ? 'color:#22c55e' : ''}">结果</span>
                    <span class="tool-result-badge ${isError ? 'error' : 'success'}">
                        ${isError ? '✗ 失败' : '✓ 成功'}
                    </span>
                </div>
                <div class="tool-result-content" style="${isError ? 'color:#dc2626' : ''}"><pre>${escapeHtml(displayResult)}</pre></div>
            </div>`;
        }

        case 'resource_start':
            return `<div class="resource-block">
                <div class="resource-header">
                    <span class="resource-name">读取资源: ${escapeHtml(block.resourceName || '')}</span>
                    <span class="flex items-center gap-1 rounded-md bg-indigo-100 px-2 py-0.5 text-[10px] font-medium text-indigo-700">
                        <svg class="h-3 w-3 animate-pulse" fill="currentColor" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10"></circle><path class="opacity-75" fill-rule="evenodd" d="M12 2a10 10 0 00-10 10c0 4.42 2.87 8.17 6.84 9.49.5.09.68-.22.68-.48v-1.7c-2.78.61-3.37-1.34-3.37-1.34-.46-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.89 1.53 2.34 1.09 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.26-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02A9.578 9.578 0 0112 6.8c.85 0 1.71.11 2.51.33 1.91-1.29 2.75-1.02 2.75-1.02.55 1.37.2 2.38.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.33 4.68-4.56 4.93.36.31.68.92.68 1.85v2.75c0 .27.18.58.69.48A10.02 10.02 0 0022 12c0-5.52-4.48-10-10-10z" clip-rule="evenodd"></path></svg>
                        读取中
                    </span>
                </div>
                <div class="tool-call-args"><div class="tool-call-args-label">URI</div><div class="tool-call-args-value">${escapeHtml(block.resourceUri || '')}</div></div>
            </div>`;

        case 'resource_end':
            return `<div class="resource-block" style="border-color:#c7d2fe;background:#fff;">
                <div class="resource-header" style="border-color:#e0e7ff;">
                    <span class="resource-label" style="color:#6366f1;">资源内容</span>
                    <span class="tool-result-badge success">✓ 已读取</span>
                </div>
                <div class="resource-content">
                    <div class="tool-call-args-label" style="margin-bottom:0.25rem;">文件名: ${escapeHtml(block.resourceName || '')}</div>
                    <pre>${escapeHtml(block.content || '')}</pre>
                    ${block.isTruncated ? `<div class="mt-2 text-[10px] text-gray-500">内容已截断，仅显示前 ${block.previewChars} 个字符</div>` : ''}
                </div>
            </div>`;

        case 'resource_error':
            return `<div class="tool-result-block" style="border-color:#fecaca;background:rgba(254,242,242,0.5);">
                <div class="tool-result-header" style="border-color:#fecaca;">
                    <span class="tool-result-label" style="color:#ef4444;">资源读取失败</span>
                    <span class="tool-result-badge error">✗ 错误</span>
                </div>
                <div class="tool-result-content" style="color:#dc2626;">
                    <div class="tool-call-args-label" style="margin-bottom:0.25rem;">文件名: ${escapeHtml(block.resourceName || '')}</div>
                    <pre>${escapeHtml(block.content || '')}</pre>
                </div>
            </div>`;

        case 'text':
            return `<div class="text-block">${renderMarkdown(block.content)}</div>`;

        default:
            return '';
    }
}

// ─── Markdown Render ────────────────────────────────────
function renderMarkdown(content) {
    if (!content) return '';
    // Configure marked
    if (typeof marked !== 'undefined') {
        marked.setOptions({ breaks: true, gfm: true });
        let html = marked.parse(content);
        // Highlight code blocks
        const div = document.createElement('div');
        div.innerHTML = html;
        div.querySelectorAll('pre code').forEach(block => {
            if (typeof hljs !== 'undefined') {
                try { hljs.highlightElement(block); } catch(e) {}
            }
        });
        // Add copy buttons
        div.querySelectorAll('pre').forEach(pre => {
            const code = pre.querySelector('code');
            if (!code) return;
            const wrapper = document.createElement('div');
            wrapper.className = 'code-block-wrapper';
            const header = document.createElement('div');
            header.className = 'code-block-header';
            const lang = code.className.match(/language-(\w+)/);
            header.innerHTML = `<span>${lang ? lang[1] : 'text'}</span>`;
            const copyBtn = document.createElement('button');
            copyBtn.className = 'code-block-copy';
            copyBtn.innerHTML = '📋 复制';
            copyBtn.onclick = () => {
                navigator.clipboard.writeText(code.textContent).then(() => {
                    copyBtn.innerHTML = '✓ 已复制';
                    copyBtn.classList.add('copied');
                    setTimeout(() => { copyBtn.innerHTML = '📋 复制'; copyBtn.classList.remove('copied'); }, 2000);
                });
            };
            header.appendChild(copyBtn);
            pre.parentNode.insertBefore(wrapper, pre);
            wrapper.appendChild(header);
            wrapper.appendChild(pre);
        });
        return div.innerHTML;
    }
    return escapeHtml(content);
}

// ─── Utilities ──────────────────────────────────────────
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
}

function setStatus(newStatus) {
    status = newStatus;
    renderMessages();
    updateSendButton();
}

function scrollToBottom() {
    const body = document.getElementById('chat-body');
    body.scrollTop = body.scrollHeight;
}

function trimMessages(msgs) {
    const assistantIndices = msgs.map((m, i) => m.role === 'assistant' ? i : -1).filter(i => i !== -1);
    if (assistantIndices.length <= MAX_CONTEXT_ROUNDS) return msgs;
    return msgs.slice(assistantIndices[assistantIndices.length - MAX_CONTEXT_ROUNDS]);
}

// ─── Actions ───────────────────────────────────────────
function cancelStream() {
    if (abortController) {
        abortController.abort();
        abortController = null;
    }
    setStatus('idle');
}

function clearMessages() {
    if (status === 'loading' || status === 'streaming') return;
    messages = [];
    streamingBlocks = [];
    streamingText = '';
    error = null;
    setStatus('idle');
    if (abortController) { abortController.abort(); abortController = null; }
}

function regenerateLastResponse() {
    if (status === 'loading' || status === 'streaming') return;
    let lastUserIndex = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'user') { lastUserIndex = i; break; }
    }
    if (lastUserIndex === -1) { error = '没有找到可以重新生成的用户消息'; renderMessages(); return; }
    const messagesUpToLastUser = messages.slice(0, lastUserIndex + 1);
    const lastUserMessage = messagesUpToLastUser[lastUserIndex];
    messages = messagesUpToLastUser;
    renderMessages();
    // Re-send
    const input = document.getElementById('chat-input');
    input.value = lastUserMessage.content;
    uploadedFiles = lastUserMessage.files ? [...lastUserMessage.files] : [];
    renderFileList();
    handleSend();
}

function retryLastMessage() {
    const lastUserMsg = messages[messages.length - 1];
    if (lastUserMsg && lastUserMsg.role === 'user') {
        const input = document.getElementById('chat-input');
        input.value = lastUserMsg.content;
        uploadedFiles = lastUserMsg.files ? [...lastUserMsg.files] : [];
        renderFileList();
        messages = messages.slice(0, -1);
        error = null;
        handleSend();
    }
}
