/**
 * AI Input Editor Engine
 * 基于 contenteditable 的富文本编辑器
 * 支持: /斜杠命令、@引用、Inline Chip、结构化请求
 */

class AIInputEditor {
    constructor(container, options = {}) {
        this.container = typeof container === 'string' ? document.getElementById(container) : container;
        this.options = {
            placeholder: '输入问题，使用 / 打开命令，@ 引用内容...',
            slashCommands: [],
            atReferences: [],
            onSend: null,
            onFileDrop: null,
            ...options
        };

        this.chips = [];
        this.slashMenuVisible = false;
        this.atMenuVisible = false;
        this.filteredItems = [];
        this.selectedMenuIndex = 0;
        this.range = null;
        this._lastSlashQuery = '';
        this._lastAtQuery = '';

        this._init();
    }

    _init() {
        this.container.innerHTML = '';
        this.container.className = 'ai-editor-container';

        this.placeholder = document.createElement('div');
        this.placeholder.className = 'ai-editor-placeholder';
        this.placeholder.textContent = this.options.placeholder;
        this.container.appendChild(this.placeholder);

        this.editor = document.createElement('div');
        this.editor.className = 'ai-editor-content';
        this.editor.contentEditable = 'true';
        this.editor.setAttribute('role', 'textbox');
        this.editor.setAttribute('aria-multiline', 'true');
        this.container.appendChild(this.editor);

        this.slashMenu = document.createElement('div');
        this.slashMenu.className = 'ai-slash-menu';
        this.slashMenu.style.display = 'none';
        this.container.appendChild(this.slashMenu);

        this.atMenu = document.createElement('div');
        this.atMenu.className = 'ai-at-menu';
        this.atMenu.style.display = 'none';
        this.container.appendChild(this.atMenu);

        this.editor.addEventListener('input', () => this._onInput());
        this.editor.addEventListener('keydown', (e) => this._onKeyDown(e));
        this.editor.addEventListener('keyup', (e) => this._onKeyUp(e));
        this.editor.addEventListener('blur', () => this._onBlur());
        this.editor.addEventListener('focus', () => this._onFocus());
        this.editor.addEventListener('paste', (e) => this._onPaste(e));

        this.editor.addEventListener('dragover', (e) => { e.preventDefault(); this.container.classList.add('dragover'); });
        this.editor.addEventListener('dragleave', () => this.container.classList.remove('dragover'));
        this.editor.addEventListener('drop', (e) => {
            e.preventDefault();
            this.container.classList.remove('dragover');
            if (this.options.onFileDrop) this.options.onFileDrop(e.dataTransfer.files);
        });
    }

    _onInput() {
        const text = this.getText();
        this.placeholder.style.display = text ? 'none' : 'block';

        if (!this.slashMenuVisible) {
            const slashMatch = this._detectSlashTrigger();
            if (slashMatch) {
                this._lastSlashQuery = slashMatch.query;
                this._showSlashMenu(slashMatch.query);
            }
        } else {
            const slashMatch = this._detectSlashTrigger();
            if (slashMatch) {
                this._lastSlashQuery = slashMatch.query;
                this._filterSlashItems(slashMatch.query);
            } else {
                this._hideSlashMenu();
            }
        }

        if (!this.atMenuVisible) {
            const atMatch = this._detectAtTrigger();
            if (atMatch) {
                this._lastAtQuery = atMatch.query;
                this._showAtMenu(atMatch.query);
            }
        } else {
            const atMatch = this._detectAtTrigger();
            if (atMatch) {
                this._lastAtQuery = atMatch.query;
                this._filterAtItems(atMatch.query);
            } else {
                this._hideAtMenu();
            }
        }
    }

    _onKeyDown(e) {
        if (this.slashMenuVisible || this.atMenuVisible) {
            const menu = this.slashMenuVisible ? this.slashMenu : this.atMenu;
            const items = menu.querySelectorAll('.ai-menu-item');

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                this.selectedMenuIndex = Math.min(this.selectedMenuIndex + 1, items.length - 1);
                this._updateMenuSelection(items);
                return;
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                this.selectedMenuIndex = Math.max(this.selectedMenuIndex - 1, 0);
                this._updateMenuSelection(items);
                return;
            }
            if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                this._selectMenuItem(this.selectedMenuIndex);
                return;
            }
            if (e.key === 'Escape') {
                e.preventDefault();
                this._hideAllMenus();
                return;
            }
        }

        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            this._doSend();
        }
    }

    _onKeyUp(e) {
        if (e.key === 'Backspace' || e.key === 'Delete') {
            this._cleanupChips();
        }
    }

    _onBlur() {
        setTimeout(() => {
            if (!this.slashMenu.matches(':hover') && !this.atMenu.matches(':hover')) {
                this._hideAllMenus();
            }
        }, 200);
    }

    _onFocus() {
        const text = this.getText();
        this.placeholder.style.display = text ? 'none' : 'block';
    }

    _onPaste(e) {
        e.preventDefault();
        const text = e.clipboardData.getData('text/plain');
        document.execCommand('insertText', false, text);
    }

    _detectSlashTrigger() {
        const sel = window.getSelection();
        if (!sel.rangeCount || !sel.isCollapsed) return null;
        const range = sel.getRangeAt(0);
        const textBefore = this._getTextBeforeCursor(range);
        if (!textBefore) return null;
        const match = textBefore.match(/(?:^|\s)\/(\w*)$/);
        if (match) return { query: match[1] };
        return null;
    }

    _detectAtTrigger() {
        const sel = window.getSelection();
        if (!sel.rangeCount || !sel.isCollapsed) return null;
        const range = sel.getRangeAt(0);
        const textBefore = this._getTextBeforeCursor(range);
        if (!textBefore) return null;
        const match = textBefore.match(/(^|\s)@(\w*)$/);
        if (match) return { query: match[2] || '' };
        return null;
    }

    _getTextBeforeCursor(range) {
        const tempRange = document.createRange();
        const textNode = range.startContainer;
        if (textNode.nodeType !== Node.TEXT_NODE) return '';
        tempRange.setStart(textNode, 0);
        tempRange.setEnd(range.startContainer, range.startOffset);
        return tempRange.toString();
    }

    _showSlashMenu(query) {
        this._saveRange();
        this.slashMenuVisible = true;
        this.selectedMenuIndex = 0;
        const commands = this.options.slashCommands;
        this.filteredItems = commands.filter(cmd =>
            cmd.label.toLowerCase().includes(query.toLowerCase()) ||
            (cmd.alias && cmd.alias.some(a => a.toLowerCase().includes(query.toLowerCase())))
        );
        this._renderMenu(this.slashMenu, this.filteredItems, 'slash', query);
        this._hideAtMenu();
    }

    _filterSlashItems(query) {
        const commands = this.options.slashCommands;
        this.filteredItems = commands.filter(cmd =>
            cmd.label.toLowerCase().includes(query.toLowerCase()) ||
            (cmd.alias && cmd.alias.some(a => a.toLowerCase().includes(query.toLowerCase())))
        );
        this.selectedMenuIndex = 0;
        this._renderMenu(this.slashMenu, this.filteredItems, 'slash', query);
    }

    _hideSlashMenu() {
        this.slashMenuVisible = false;
        this.slashMenu.style.display = 'none';
    }

    _showAtMenu(query) {
        this._saveRange();
        this.atMenuVisible = true;
        this.selectedMenuIndex = 0;
        const refs = this.options.atReferences;
        this.filteredItems = refs.filter(ref =>
            ref.label.toLowerCase().includes(query.toLowerCase()) ||
            (ref.keywords && ref.keywords.some(k => k.toLowerCase().includes(query.toLowerCase())))
        );
        this._renderMenu(this.atMenu, this.filteredItems, 'at', query);
        this._hideSlashMenu();
    }

    _filterAtItems(query) {
        const refs = this.options.atReferences;
        this.filteredItems = refs.filter(ref =>
            ref.label.toLowerCase().includes(query.toLowerCase()) ||
            (ref.keywords && ref.keywords.some(k => k.toLowerCase().includes(query.toLowerCase())))
        );
        this.selectedMenuIndex = 0;
        this._renderMenu(this.atMenu, this.filteredItems, 'at', query);
    }

    _hideAtMenu() {
        this.atMenuVisible = false;
        this.atMenu.style.display = 'none';
    }

    _hideAllMenus() {
        this._hideSlashMenu();
        this._hideAtMenu();
    }

    _renderMenu(menuEl, items, type, query) {
        if (items.length === 0) {
            menuEl.style.display = 'none';
            return;
        }
        menuEl.innerHTML = '';
        menuEl.style.display = 'block';
        items.forEach((item, idx) => {
            const el = document.createElement('div');
            el.className = 'ai-menu-item' + (idx === this.selectedMenuIndex ? ' selected' : '');
            const icon = item.icon || (type === 'slash' ? '⚡' : '📎');
            el.innerHTML = '<span class="ai-menu-icon">' + icon + '</span>' +
                '<span class="ai-menu-label">' + this._highlightMatch(item.label, query) + '</span>' +
                (item.desc ? '<span class="ai-menu-desc">' + item.desc + '</span>' : '');
            el.addEventListener('click', (e) => {
                e.preventDefault();
                this.selectedMenuIndex = idx;
                this._selectMenuItem(idx);
            });
            el.addEventListener('mouseenter', () => {
                this.selectedMenuIndex = idx;
                this._updateMenuSelection(menuEl.querySelectorAll('.ai-menu-item'));
            });
            menuEl.appendChild(el);
        });
    }

    _highlightMatch(text, query) {
        if (!query) return text;
        const idx = text.toLowerCase().indexOf(query.toLowerCase());
        if (idx === -1) return text;
        return text.substring(0, idx) + '<strong>' + text.substring(idx, idx + query.length) + '</strong>' + text.substring(idx + query.length);
    }

    _updateMenuSelection(items) {
        items.forEach((item, idx) => {
            item.classList.toggle('selected', idx === this.selectedMenuIndex);
        });
        const selected = items[this.selectedMenuIndex];
        if (selected) selected.scrollIntoView({ block: 'nearest' });
    }

    _selectMenuItem(index) {
        const item = this.filteredItems[index];
        if (!item) return;
        if (this.slashMenuVisible) {
            this._insertSlashCommand(item);
        } else if (this.atMenuVisible) {
            this._insertAtReference(item);
        }
        this._hideAllMenus();
    }

    _insertSlashCommand(cmd) {
        this._removeTriggerText('/');
        if (cmd.action) cmd.action(this);
    }

    _insertAtReference(ref) {
        this._removeTriggerText('@');
        this._insertChip(ref);
    }

    _insertChip(ref) {
        const chipId = 'chip_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
        const chipData = { id: chipId, type: ref.type || 'reference', label: ref.label, data: ref.data || ref };
        this.chips.push(chipData);

        const chipEl = document.createElement('span');
        chipEl.className = 'ai-inline-chip';
        chipEl.contentEditable = 'false';
        chipEl.dataset.chipId = chipId;
        chipEl.dataset.chipType = ref.type || 'reference';
        chipEl.innerHTML = '<span class="ai-chip-icon">' + this._getChipIcon(ref.type) + '</span>' +
            '<span class="ai-chip-label">' + ref.label + '</span>' +
            '<span class="ai-chip-remove" data-chip-id="' + chipId + '">×</span>';

        this._restoreRange();
        const sel = window.getSelection();
        if (sel.rangeCount) {
            const range = sel.getRangeAt(0);
            range.deleteContents();
            range.insertNode(chipEl);
            const space = document.createTextNode(' ');
            chipEl.after(space);
            range.setStartAfter(space);
            range.collapse(true);
            sel.removeAllRanges();
            sel.addRange(range);
        }

        const removeBtn = chipEl.querySelector('.ai-chip-remove');
        removeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this._removeChip(chipId);
        });
    }

    _removeChip(chipId) {
        this.chips = this.chips.filter(c => c.id !== chipId);
        const chipEl = this.editor.querySelector('[data-chip-id="' + chipId + '"]');
        if (chipEl) {
            const next = chipEl.nextSibling;
            chipEl.remove();
            if (next && next.nodeType === Node.TEXT_NODE && next.textContent === ' ') next.remove();
        }
    }

    _cleanupChips() {
        const activeChipIds = new Set();
        this.editor.querySelectorAll('.ai-inline-chip').forEach(el => activeChipIds.add(el.dataset.chipId));
        this.chips = this.chips.filter(c => activeChipIds.has(c.id));
    }

    _getChipIcon(type) {
        const icons = { file: '📄', tool: '🔧', context: '📋', skill: '�', reference: '📎', weather: '🌤', location: '📍', default: '📎' };
        return icons[type] || icons.default;
    }

    _saveRange() {
        const sel = window.getSelection();
        if (sel.rangeCount) this.range = sel.getRangeAt(0).cloneRange();
    }

    _restoreRange() {
        if (this.range) {
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(this.range);
        }
    }

    _removeTriggerText(trigger) {
        const sel = window.getSelection();
        if (!sel.rangeCount) return;
        const range = sel.getRangeAt(0);
        const textNode = range.startContainer;
        if (textNode.nodeType !== Node.TEXT_NODE) return;
        const offset = range.startOffset;
        const text = textNode.textContent;
        let startOffset = offset;
        for (let i = offset - 1; i >= 0; i--) {
            const substr = text.substring(i, offset);
            if (substr.startsWith(trigger) && (i === 0 || text[i - 1] === ' ' || text[i - 1] === '\n')) {
                startOffset = i;
                break;
            }
            if (text[i] === ' ' || text[i] === '\n') break;
        }
        const deleteLength = offset - startOffset;
        range.setStart(textNode, startOffset);
        range.setEnd(textNode, offset);
        range.deleteContents();
    }

    _escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    getText() {
        let html = this.editor.innerHTML;
        this.editor.querySelectorAll('.ai-inline-chip').forEach(chip => {
            const chipId = chip.dataset.chipId;
            const chipData = this.chips.find(c => c.id === chipId);
            if (chipData) {
                const placeholder = '@[' + chipData.type + ':' + chipData.label + ']';
                html = html.replace(chip.outerHTML, placeholder);
            }
        });
        const temp = document.createElement('div');
        temp.innerHTML = html;
        return temp.textContent.trim();
    }

    getStructuredRequest() {
        const segments = [];
        const editorNode = this.editor;

        const processNode = (node) => {
            if (node.nodeType === Node.TEXT_NODE) {
                const text = node.textContent.trim();
                if (text) segments.push({ type: 'text', content: text });
            } else if (node.nodeType === Node.ELEMENT_NODE) {
                if (node.classList.contains('ai-inline-chip')) {
                    const chipId = node.dataset.chipId;
                    const chipData = this.chips.find(c => c.id === chipId);
                    if (chipData) {
                        segments.push({ type: 'chip', chipType: chipData.type, label: chipData.label, data: chipData.data });
                    }
                } else if (node.classList.contains('ai-inline-codeblock')) {
                    const code = node.querySelector('code');
                    const lang = node.querySelector('.ai-code-lang');
                    segments.push({ type: 'code', language: lang ? lang.textContent : 'text', content: code ? code.textContent : '' });
                } else {
                    node.childNodes.forEach(child => processNode(child));
                }
            }
        };

        editorNode.childNodes.forEach(child => processNode(child));
        return { rawText: this.getText(), segments, chips: this.chips.map(c => ({ type: c.type, label: c.label, data: c.data })) };
    }

    clear() {
        this.editor.innerHTML = '';
        this.chips = [];
        this.placeholder.style.display = 'block';
        this._hideAllMenus();
    }

    isEmpty() { return !this.getText(); }

    _doSend() {
        if (this.isEmpty()) return;
        if (this.options.onSend) {
            const structured = this.getStructuredRequest();
            this.options.onSend(structured.rawText, structured);
        }
    }

    setSlashCommands(commands) { this.options.slashCommands = commands; }
    setAtReferences(references) { this.options.atReferences = references; }
    addAtReference(reference) { this.options.atReferences.push(reference); }

    setValue(text) {
        this.editor.textContent = text;
        this._onInput();
    }

    insertSkillSwitch(skillId) {
        const skillNames = { 'utility-skill': '工具模式', 'reader-skill': '文件模式' };
        document.execCommand('insertText', false, '[' + (skillNames[skillId] || skillId) + '] ');
    }

    insertToolReference(toolName) {
        this._insertChip({ type: 'tool', label: toolName, data: { toolName } });
    }
}

window.AIInputEditor = AIInputEditor;
