/**
 * Code Assistant - Frontend App (Advanced)
 * 支持: Tiptap编辑器、/斜杠命令、@引用、结构化请求、Tool Runtime
 */

// ─── State ─────────────────────────────────────────────
let messages = [];
let status = 'idle';
let error = null;
let mode = 'utility-skill';
let clientIP = null;
let abortController = null;
let uploadedFiles = [];
let streamingBlocks = [];
let streamingText = '';
let editor = null;

// History records (persisted in localStorage)
let inputHistory = [];
const HISTORY_KEY = 'ai_input_history';
const HISTORY_MAX = 50;

const MAX_CONTEXT_ROUNDS = 8;

// ─── Slash Commands Definition ──────────────────────────
const slashCommands = [
    { label: '切换工具模式', icon: '�', desc: '切换到实用工具技能', alias: ['tool', '工具'],
      action: (ed) => { setMode('utility-skill'); ed.clear(); } },
    { label: '切换文件模式', icon: '�', desc: '切换到文件与天气技能', alias: ['file', '文件', 'reader'],
      action: (ed) => { setMode('reader-skill'); ed.clear(); } },
    { label: '引用计算器', icon: '�', desc: '插入计算器工具引用', alias: ['calc', '计算'],
      action: (ed) => { ed.insertToolReference('calculator'); } },
    { label: '引用天气查询', icon: '🌤', desc: '插入天气工具引用', alias: ['weather', '天气'],
      action: (ed) => { ed.insertToolReference('get_weather'); } },
    { label: '引用文件读取', icon: '📄', desc: '插入文件读取引用', alias: ['read', '文件读取'],
      action: (ed) => { ed.insertToolReference('local-text-read'); } },
    { label: '清空对话', icon: '🗑', desc: '清空当前对话历史', alias: ['clear', '清空'],
      action: (ed) => { clearMessages(); ed.clear(); } },
];

// ─── At References Definition ──────────────────────────
const atReferences = [
    { label: 'calculator', type: 'tool', desc: '数学计算器',
      keywords: ['calc', '计算', 'math', '计算器'] },
    { label: 'datetime', type: 'tool', desc: '日期时间查询',
      keywords: ['time', '时间', 'date', '日期'] },
    { label: 'get_weather', type: 'tool', desc: '天气查询',
      keywords: ['weather', '天气', '温度'] },
    { label: 'get_location', type: 'tool', desc: '地理位置',
      keywords: ['location', '位置', 'ip', '地理'] },
    { label: 'unit_convert', type: 'tool', desc: '单位换算',
      keywords: ['unit', '换算', '转换'] },
    { label: 'text_transform', type: 'tool', desc: '文本转换',
      keywords: ['text', '文本', 'markdown', 'json'] },
    { label: 'web_browse', type: 'tool', desc: '网页浏览',
      keywords: ['web', '网页', 'url', 'browse'] },
    { label: 'local-text-read', type: 'tool', desc: '本地文件读取',
      keywords: ['file', '文件', 'read'] },
    { label: 'list_files', type: 'tool', desc: '目录列表',
      keywords: ['list', '目录', 'files'] },
    { label: '当前IP', type: 'context', desc: '引用客户端IP地址' },
    { label: '对话历史', type: 'context', desc: '引用最近的对话历史' },
    { label: 'utility-skill', type: 'skill', desc: '工具技能模式' },
    { label: 'reader-skill', type: 'skill', desc: '文件与天气技能模式' },
];

// ─── Init ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    initEditor();
    initFeatures();
    initFileUpload();
    getPublicIP();
    loadHistory();
    renderHistoryList();
});

function initEditor() {
    editor = new AIInputEditor('editor-container', {
        placeholder: '输入问题，使用 / 打开命令菜单，@ 引用工具或上下文 (Ctrl+Enter 发送)',
        slashCommands: slashCommands,
        atReferences: atReferences,
        onSend: (rawText, structured) => {
            handleSend(rawText, structured);
        },
        onFileDrop: (files) => {
            for (let i = 0; i < files.length; i++) handleFile(files[i]);
        }
    });
}

// ─── Public─────────
async function getPublicIP() {
    try {
        const resp = await fetch('https://api.ipify.org?format=json');
        const data = await resp.json();
        if (data.ip) {
            clientIP = data.ip;
            // Add IP reference dynamically
            editor.options.atReferences.push({
                label: 'IP: ' + clientIP, type: 'context',
                desc: '客户端公网IP地址',
                keywords: ['ip', 'IP', '地址']
            });
        }
    } catch (e) { /* ignore */ }
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
function initFeatures() { updateEmptyState(); }

function updateEmptyState() {
    const grid = document.getElementById('feature-grid');
    const title = document.getElementById('empty-title');
    const desc = document.getElementById('empty-desc');

    if (mode === 'utility-skill') {
        title.textContent = '实用工具助手';
        desc.textContent = '输入 / 查看命令菜单，@ 引用工具。支持数学计算、日期查询、单位换算等工具调用。';
        const features = [
            { title: '数学计算', desc: '精确计算数学表达式', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z' },
            { title: '日期时间', desc: '获取当前时间和日期', icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z' },
            { title: '单位换算', desc: '长度、重量、温度转换', icon: 'M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16 16H9m3 0h3' },
            { title: '/ 斜杠命令', desc: '输入 / 调出命令菜单快速操作', icon: 'M13 10V3L4 14h7v7l9-11h-7z' },
        ];
        grid.innerHTML = features.map(f => '<div class="feature-card"><div class="feature-icon-container"><svg class="feature-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="' + f.icon + '"></path></svg></div><h3 class="feature-title">' + f.title + '</h3><p class="feature-desc">' + f.desc + '</p></div>').join('');
    } else {
        title.textContent = '文件与天气助手';
        desc.textContent = '输入 / 引用工具，@ 引用上下文。支持读取本地文件、查询实时天气、获取地理位置。';
        const features = [
            { title: '目录列表', desc: '查看项目根目录文件', icon: 'M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z' },
            { title: '文件读取', desc: '读取项目根目录下文本文件', icon: 'M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z' },
            { title: '实时天气', desc: '查询指定城市实时天气', icon: 'M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z' },
            { title: '@ 引用系统', desc: '输入 @ 引用工具、文件或上下文', icon: 'M16 12a4 4 0 10-8 0 4 4 0 008 0zm0 0v1.5a2.5 2.5 0 005 0V12a9 9 0 10-9 9m4.5-1.206a8.959 8.959 0 01-4.5 1.207' },
        ];
        grid.innerHTML = features.map(f => '<div class="feature-card"><div class="feature-icon-container feature-icon-purple"><svg class="feature-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="' + f.icon + '"></path></svg></div><h3 class="feature-title">' + f.title + '</h3><p class="feature-desc">' + f.desc + '</p></div>').join('');
    }
}

// ─── File Upload ────────────────────────────────────────
function initFileUpload() {
    const dropArea = document.getElementById('file-upload-area');
    if (!dropArea) return;
    dropArea.addEventListener('dragover', (e) => { e.preventDefault(); dropArea.classList.add('dragover'); });
    dropArea.addEventListener('dragleave', () => dropArea.classList.remove('dragover'));
    dropArea.addEventListener('drop', (e) => {
        e.preventDefault();
        dropArea.classList.remove('dragover');
        for (let i = 0; i < e.dataTransfer.files.length; i++) handleFile(e.dataTransfer.files[i]);
    });
}

function handleFileSelect(event) {
    const files = event.target.files;
    for (let i = 0; i < files.length; i++) handleFile(files[i]);
    event.target.value = '';
}

function handleFile(file) {
    const ext = '.' + file.name.split('.').pop()?.toLowerCase();
    const allowed = ['.py','.js','.ts','.jsx','.tsx','.go','.rs','.java','.md','.json','.yaml','.yml','.css','.scss','.sql','.sh','.bash','.toml','.xml','.html','.vue','.svelte','.c','.cpp','.h','.hpp','.rb','.php','.swift','.kt','.dart','.txt'];
    if (!allowed.includes(ext) || file.size > 1024 * 1024) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        uploadedFiles.push({ name: file.name, size: file.size, type: ext.slice(1), content: e.target.result });
        renderFileList();
        // Also add as @ reference
        if (editor) {
            editor.addAtReference({
                label: file.name, type: 'file',
                desc: '已上传的文件',
                data: { file: file.name, content: e.target.result }
            });
        }
    };
    reader.readAsText(file);
}

function removeFile(index) {
    uploadedFiles.splice(index, 1);
    renderFileList();
}


function renderFileList() {
    const list = document.getElementById('file-list');
    if (!list) return;
    list.innerHTML = uploadedFiles.map((f, i) => '<div class="file-item"><svg class="h-4 w-4 flex-shrink-0 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg><span class="file-item-name">' + f.name + '</span><span class="text-xs text-gray-400 flex-shrink-0">' + formatSize(f.size) + '</span><button class="file-item-remove" onclick="removeFile(' + i + ')"><svg class w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg></button></div>').join('');
}

function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function renderMessage(msg, isStreaming, sText, sBlocks) {
    const isUser = msg.role === 'user';
    if (msg.role === 'system') return '';

    const allBlocks = isStreaming ? (sBlocks || []) : (msg.blocks || []);
    const textContent = isStreaming && sText !== undefined ? sText : msg.content;
    const avatarClass = isUser ? 'user' : 'ai';
    const avatarText = isUser ? 'U' : 'AI';

    let contentHtml = '';
    if (isUser) {
        let filesHtml = '';
        if (msg.files && msg.files.length > 0) {
            filesHtml = '<div class="mb-2 flex flex-wrap gap-1.5">' + msg.files.map(f => '<span class="inline-flex items-center gap-1 rounded-md bg-white/20 px-2 py-0.5 text-xs">📄 ' + escapeHtml(f.name) + '</span>').join('') + '</div>';
        }
        contentHtml = '<div class="user-bubble">' + filesHtml + '<div>' + escapeHtml(textContent || '') + '</div></div>';
    } else {
        let inner = '';
        if (allBlocks.length > 0) {
            inner = allBlocks.map(b => renderStructuredBlock(b)).join('');
        } else {
            inner = renderMarkdown(textContent || '');
        }
        if (isStreaming) inner += '<span class="streaming-cursor"></span>';
        contentHtml = '<div class="ai-bubble">' + inner + '</div>';
    }

    return '<div class="msg-row ' + (isUser ? 'user' : 'assistant') + '"><div class="msg-wrapper"><div class="avatar ' + avatarClass + '">' + avatarText + '</div><div class="msg-content">' + contentHtml + '</div></div></div>';
}

// Message ───────────────────────────────────────
async function handleSend(rawText, structured) {
    if (!rawText.trim() && uploadedFiles.length === 0) return;
    if (status === 'loading' || status === 'streaming') return;
    if (abortController) abortController.abort();
    abortController = new AbortController();

    error = null;
    setStatus('loading');
    streamingBlocks = [];
    streamingText = '';

    // 保存到输入历史记录
    addToHistory(rawText);

    // Build structured request payload
    const requestPayload = {
        messages: [...messages, {
            role: 'user',
            content: rawText,
            files: uploadedFiles.length > 0 ? [...uploadedFiles] : undefined,
            structured: structured || null
        }],
        skill: mode,
        clientIP: clientIP
    };

    // Keep plain messages for display
    const userMessage = { role: 'user', content: rawText, files: uploadedFiles.length > 0 ? [...uploadedFiles] : undefined };
    const updatedMessages = [...messages, userMessage];
    messages = updatedMessages;

    renderMessages();
    editor.clear();
    uploadedFiles = [];
    renderFileList();

    try {
        const resp = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestPayload),
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
                    if (chunk.type === 'text') collectedText += chunk.content || '';
                    collectedBlocks.push(chunkToBlock(chunk));
                    if (chunk.type === 'error') setStatus('retrying');
                    if (chunk.type === 'done') isDone = true;
                } catch (e) { /* skip parse error */ }
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
            streamingBlocks.push({ type: 'tool_call', toolName: chunk.toolName || '', toolArgs: chunk.toolArgs || {}, serverId: chunk.serverId, content: '' });
            break;
        case 'tool_result':
            streamingBlocks.push({ type: 'tool_result', toolName: chunk.toolName || chunk.toolResult || '', isValid: chunk.isValid, serverId: chunk.serverId, content: chunk.toolResult || '' });
            break;
        case 'resource_start':
            streamingBlocks.push({ type: 'resource_start', resourceName: chunk.resourceName || '', resourceUri: chunk.resourceUri || '', serverId: chunk.serverId, content: '' });
            break;
        case 'resource_end':
            streamingBlocks.push({ type: 'resource_end', content: chunk.contentPreview || '', resourceName: chunk.resourceName, resourceUri: chunk.resourceUri, serverId: chunk.serverId, isTruncated: chunk.isTruncated, previewChars: chunk.previewChars });
            break;
        case 'resource_error':
            streamingBlocks.push({ type: 'resource_error', content: chunk.error || '', resourceName: chunk.resourceName, resourceUri: chunk.resourceUri, serverId: chunk.serverId });
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
            streamingBlocks.push({ type: 'text', content: '📌 ' + chunk.message + ' (' + chunk.fallbackMethod + ')' });
            break;
    }
    renderMessages();
}

function chunkToBlock(chunk) {
    return { type: chunk.type, content: chunk.content || '', toolCallId: chunk.toolCallId, toolName: chunk.toolName, toolArgs: chunk.toolArgs, toolResult: chunk.toolResult, isValid: chunk.isValid, resourceName: chunk.resourceName, resourceUri: chunk.resourceUri, serverId: chunk.serverId, isTruncated: chunk.isTruncated, previewChars: chunk.previewChars };
}

// ─── Render Messages ───────────────────────────────────
function renderMessages() {
    const emptyState = document.getElementById('empty-state');
    const msgContainer = document.getElementById('messages-container');
    const actionBtns = document.getElementById('action-buttons');
    const isStreaming = status === 'loading' || status === 'streaming';
    const isEmpty = messages.length === 0 && !isStreaming;

    emptyState.style.display = isEmpty ? 'flex' : 'none';
    msgContainer.style.display = isEmpty ? 'none' : 'flex';
    actionBtns.style.display = messages.length > 0 ? 'flex' : 'none';

    const inputArea = document.getElementById('input-area');
    const streamingControls = document.getElementById('streaming-controls');
    const retryStatus = document.getElementById('retry-status');

    if (inputArea) inputArea.style.display = isStreaming ? 'none' : 'block';
    if (streamingControls) streamingControls.style.display = isStreaming && status !== 'retrying' ? 'flex' : 'none';
    if (retryStatus) retryStatus.style.display = status === 'retrying' ? 'flex' : 'none';

    if (isEmpty) return;

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

    if (isStreaming && lastAssistantIndex < 0) {
        html += renderMessage({ role: 'assistant', content: '' }, true, streamingText, streamingBlocks);
    }

    if (error) {
        html += '<div class="error-container"><div class="error-content"><svg class="error-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg><div class="error-text"><p class="error-title">出错了</p><p class="error-msg">' + escapeHtml(error) + '</p><button class="retry-btn" onclick="retryLastMessage()">重试</button></div></div></div>';
    }

    msgContainer.innerHTML = html;
    scrollToBottom();
}

// ─── Structured Block Render ────────────────────────────
function renderStructuredBlock(block) {
    switch (block.type) {
        case 'reasoning':
            return '<div class="my-2 overflow-hidden rounded-xl border border-amber-200 bg-amber-50/80"><details class="group" open><summary class="flex cursor-pointer items-center gap-2 px-3 py-2 text-xs font-medium text-amber-700">⚡ 推理过程 <span class="ml-auto text-amber-500">点击展开/收起</span></summary><div class="border-t border-amber-200/50 px-3 py-2 text-xs leading-relaxed text-amber-800">' + renderMarkdown(block.content) + '</div></details></div>';
        case 'tool_call': {
            const argsStr = block.toolArgs ? Object.entries(block.toolArgs).map(([k, v]) => k + '=' + v).join(', ') : '';
            return '<div class="tool-call-block"><div class="tool-call-header"><span class="tool-call-name">🔧 ' + escapeHtml(block.toolName || '') + '</span><span class="tool-result-badge success">执行中</span></div>' + (argsStr ? '<div class="tool-call-args"><div class="tool-call-args-label">输入</div><div class="tool-call-args-value">' + escapeHtml(argsStr) + '</div></div>' : '') + '</div>';
        }
        case 'tool_result': {
            let displayResult = block.toolResult || '';
            let isError = false;
            let weatherData = null;
            try {
                const parsed = JSON.parse(displayResult);
                if (parsed.error) { displayResult = parsed.error; isError = true; }
                else if (parsed.city && parsed.temperature !== undefined) weatherData = parsed;
            } catch (e) { /* not JSON */ }
            if (weatherData) {
                let rows = '';
                if (weatherData.city) rows += '<div class="weather-row"><span class="weather-label">城市</span><span class="weather-value">' + weatherData.city + '</span></div>';
                if (weatherData.weather) rows += '<div class="weather-row"><span class="weather-label">天气</span><span class="weather-value">' + weatherData.weather + '</span></div>';
                if (weatherData.temperature != null) rows += '<div class="weather-row"><span class="weather-label">温度</span><span class="weather-value">' + weatherData.temperature + '°C</span></div>';
                if (weatherData.humidity) rows += '<div class="weather-row"><span class="weather-label">湿度</span><span class="weather-value">' + weatherData.humidity + '%</span></div>';
                return '<div class="tool-result-block"><div class="tool-result-header"><span class="tool-result-label">天气结果</span></div><div class="weather-result">' + rows + '</div></div>';
            }
            const success = !isError && block.isValid !== false;
            return '<div class="tool-result-block" style="' + (isError ? 'border-color:#fecaca;background:rgba(254,242,242,0.5)' : success ? 'border-color:#bbf7d0;background:rgba(240,253,244,0.5)' : '') + '"><div class="tool-result-header"><span class="tool-result-label" style="' + (isError ? 'color:#ef4444' : success ? 'color:#22c55e' : '') + '">结果</span><span class="tool-result-badge ' + (isError ? 'error' : 'success') + '">' + (isError ? '✗ 失败' : '✓ 成功') + '</span></div><div class="tool-result-content" style="' + (isError ? 'color:#dc2626' : '') + '"><pre>' + escapeHtml(displayResult) + '</pre></div></div>';
        }
        case 'resource_start':
            return '<div class="resource-block"><div class="resource-header"><span class="resource-name">📖 ' + escapeHtml(block.resourceName || '') + '</span><span class="tool-result-badge success">读取中</span></div></div>';
        case 'resource_end':
            return '<div class="resource-block" style="border-color:#c7d2fe;background:#fff"><div class="resource-header" style="border-color:#e0e7ff"><span style="color:#6366f1">资源内容</span><span class="tool-result-badge success">✓ 已读取</span></div><div class="resource-content"><pre>' + escapeHtml(block.content || '') + '</pre>' + (block.isTruncated ? '<div class="mt-2 text-[10px] text-gray-500">内容已截断</div>' : '') + '</div></div>';
        case 'resource_error':
            return '<div class="tool-result-block" style="border-color:#fecaca;background:rgba(254,242,242,0.5)"><div class="tool-result-header" style="border-color:#fecaca"><span class="tool-result-label" style="color:#ef4444">读取失败</span><span class="tool-result-badge error">✗ 错误</span></div><div class="tool-result-content" style="color:#dc2626"><pre>' + escapeHtml(block.content || '') + '</pre></div></div>';
        case 'text':
            return '<div class="text-block">' + renderMarkdown(block.content) + '</div>';
        default:
            return '';
    }
}

// ─── Markdown Render ────────────────────────────────────
function renderMarkdown(content) {
    if (!content) return '';
    if (typeof marked !== 'undefined') {
        marked.setOptions({ breaks: true, gfm: true });
        let html = marked.parse(content);
        const div = document.createElement('div');
        div.innerHTML = html;
        div.querySelectorAll('pre code').forEach(block => { if (typeof hljs !== 'undefined') try { hljs.highlightElement(block); } catch(e) {} });
        div.querySelectorAll('pre').forEach(pre => {
            const code = pre.querySelector('code');
            if (!code) return;
            const wrapper = document.createElement('div');
            wrapper.className = 'code-block-wrapper';
            const header = document.createElement('div');
            header.className = 'code-block-header';
            const lang = code.className.match(/language-(\w+)/);
            header.innerHTML = '<span>' + (lang ? lang[1] : 'text') + '</span>';
            const copyBtn = document.createElement('button');
            copyBtn.className = 'code-block-copy';
            copyBtn.textContent = '📋 复制';
            copyBtn.onclick = () => { navigator.clipboard.writeText(code.textContent).then(() => { copyBtn.textContent = '✓ 已复制'; setTimeout(() => { copyBtn.textContent = '� 复制'; }, 2000); }); };
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

function setStatus(newStatus) { status = newStatus; renderMessages(); }
function scrollToBottom() { const body = document.getElementById('chat-body'); body.scrollTop = body.scrollHeight; }

function trimMessages(msgs) {
    const indices = msgs.map((m, i) => m.role === 'assistant' ? i : -1).filter(i => i !== -1);
    if (indices.length <= MAX_CONTEXT_ROUNDS) return msgs;
    return msgs.slice(indices[indices.length - MAX_CONTEXT_ROUNDS]);
}

// ─── Actions ───────────────────────────────────────────
function cancelStream() {
    if (abortController) { abortController.abort(); abortController = null; }
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
    let idx = -1;
    for (let i = messages.length - 1; i >= 0; i--) { if (messages[i].role === 'user') { idx = i; break; } }
    if (idx === -1) { error = '没有找到可重新生成的消息'; renderMessages(); return; }
    const userMsg = messages[idx];
    messages = messages.slice(0, idx);
    renderMessages();
    editor.setValue(userMsg.content);
    uploadedFiles = userMsg.files ? [...userMsg.files] : [];
    renderFileList();
    handleSend(userMsg.content, null);
}

function retryLastMessage() {
    const lastMsg = messages[messages.length - 1];
    if (lastMsg && lastMsg.role === 'user') {
        editor.setValue(lastMsg.content);
        uploadedFiles = lastMsg.files ? [...lastMsg.files] : [];
        renderFileList();
        messages = messages.slice(0, -1);
        error = null;
        handleSend(lastMsg.content, null);
    }
}

// ─── Input History ────────────────────────────────────
function loadHistory() {
    try {
        const saved = localStorage.getItem(HISTORY_KEY);
        inputHistory = saved ? JSON.parse(saved) : [];
    } catch (e) { inputHistory = []; }
}

function saveHistory() {
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(inputHistory)); } catch (e) {}
}

function addToHistory(text) {
    if (!text || !text.trim()) return;
    // 去重：相同文本移除旧记录后重新置顶
    inputHistory = inputHistory.filter(h => h.text !== text);
    inputHistory.unshift({
        text: text,
        time: new Date().toLocaleString('zh-CN', {
            month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
        })
    });
    if (inputHistory.length > HISTORY_MAX) inputHistory = inputHistory.slice(0, HISTORY_MAX);
    saveHistory();
    renderHistoryList();
}

function renderHistoryList() {
    const list = document.getElementById('history-list');
    if (!list) return;
    if (inputHistory.length === 0) {
        list.innerHTML = '<div class="history-empty">暂无历史记录</div>';
        return;
    }
    list.innerHTML = inputHistory.map((h, i) =>
        '<div class="history-item" onclick="loadHistoryItem(' + i + ')" title="点击载入到输入框">' +
        '<button class="history-item-delete" onclick="event.stopPropagation(); deleteHistoryItem(' + i + ')" title="删除">' +
        '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="14" height="14"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>' +
        '</button>' +
        '<div class="history-item-text">' + escapeHtml(h.text) + '</div>' +
        '<div class="history-item-time">' + escapeHtml(h.time) + '</div>' +
        '</div>'
    ).join('');
}

function loadHistoryItem(index) {
    const item = inputHistory[index];
    if (!item || !editor) return;
    editor.setValue(item.text);
    if (editor.editor) editor.editor.focus();
}

function deleteHistoryItem(index) {
    inputHistory.splice(index, 1);
    saveHistory();
    renderHistoryList();
}

function clearHistory() {
    inputHistory = [];
    saveHistory();
    renderHistoryList();
}
