/* =========================================================
 * AI聊天助手 前端逻辑
 * 接口：会话列表 / 模型列表 / 创建会话 / 历史消息 / 流式消息 / 删除会话
 * ========================================================= */
(function () {
    'use strict';

    var MAX_LEN = 2000;

    var state = {
        sessions: [],
        currentSessionId: null,
        currentModel: '',
        models: [],
        selectedModel: null,
        streaming: false,
        abortController: null,
        creating: false,
        loadingHistory: false
    };

    var el = {
        app: document.getElementById('app'),
        sessionList: document.getElementById('sessionList'),
        sessionCount: document.getElementById('sessionCount'),
        newChatBtn: document.getElementById('newChatBtn'),
        welcomeNewChatBtn: document.getElementById('welcomeNewChatBtn'),
        welcomeView: document.getElementById('welcomeView'),
        chatView: document.getElementById('chatView'),
        chatBody: document.getElementById('chatBody'),
        chatTitle: document.getElementById('chatTitle'),
        chatModel: document.getElementById('chatModel'),
        messages: document.getElementById('messages'),
        input: document.getElementById('messageInput'),
        sendBtn: document.getElementById('sendBtn'),
        charCount: document.getElementById('charCount'),
        charCountWrap: document.getElementById('charCountWrap'),
        modelModal: document.getElementById('modelModal'),
        modelGrid: document.getElementById('modelGrid'),
        modalCloseBtn: document.getElementById('modalCloseBtn'),
        modalCancelBtn: document.getElementById('modalCancelBtn'),
        modalConfirmBtn: document.getElementById('modalConfirmBtn'),
        toast: document.getElementById('toast'),
        menuBtn: document.getElementById('menuBtn'),
        sidebarMask: document.getElementById('sidebarMask')
    };

    /* ---------------- 工具函数 ---------------- */

    function escapeHtml(str) {
        return String(str == null ? '' : str).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function pad2(n) {
        return n < 10 ? '0' + n : '' + n;
    }

    function toMillis(ts) {
        var n = Number(ts);
        if (!isFinite(n) || n <= 0) return Date.now();
        // 服务器使用秒级时间戳，兼容毫秒
        return n < 1e12 ? n * 1000 : n;
    }

    function formatTime(ts) {
        var d = new Date(toMillis(ts));
        var now = new Date();
        var hm = pad2(d.getHours()) + ':' + pad2(d.getMinutes());
        if (d.toDateString() === now.toDateString()) return hm;
        var prefix = d.getFullYear() === now.getFullYear() ? '' : d.getFullYear() + '-';
        return prefix + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + hm;
    }

    function truncate(str, len) {
        str = String(str || '');
        return str.length > len ? str.slice(0, len) + '…' : str;
    }

    var toastTimer = null;
    function showToast(msg) {
        el.toast.textContent = msg;
        el.toast.hidden = false;
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () {
            el.toast.hidden = true;
        }, 2600);
    }

    /* ---------------- 接口请求 ---------------- */

    function request(url, options) {
        options = options || {};
        var init = {
            method: options.method || 'GET',
            headers: { 'Content-Type': 'application/json' },
            body: options.body
        };
        if (options.signal) init.signal = options.signal;

        return fetch(url, init).then(function (res) {
            return res.json().catch(function () { return null; }).then(function (json) {
                if (!res.ok || !json || json.success === false) {
                    var msg = (json && json.message) || ('请求失败 (HTTP ' + res.status + ')');
                    throw new Error(msg);
                }
                return json.data;
            });
        });
    }

    /* ---------------- 会话列表 ---------------- */

    function loadSessions() {
        return request('/api/sessions').then(function (data) {
            state.sessions = Array.isArray(data) ? data : [];
            renderSessions();
        }).catch(function (err) {
            renderSessions();
            showToast('获取会话列表失败：' + err.message);
        });
    }

    function sortedSessions() {
        return state.sessions.slice().sort(function (a, b) {
            return (Number(b.updated_at) || 0) - (Number(a.updated_at) || 0);
        });
    }

    function renderSessions() {
        var list = sortedSessions();
        el.sessionCount.textContent = list.length + ' 个会话';

        if (!list.length) {
            el.sessionList.innerHTML = '<div class="session-empty">暂无历史会话<br>点击上方「新建对话」开始聊天</div>';
            return;
        }

        var html = list.map(function (s) {
            var active = s.id === state.currentSessionId ? ' active' : '';
            var title = s.first_user_message ? String(s.first_user_message) : '新的对话';
            return '' +
                '<div class="session-item' + active + '" data-id="' + escapeHtml(s.id) + '">' +
                '  <div class="session-top">' +
                '    <span class="session-title">' + escapeHtml(title) + '</span>' +
                '    <button class="session-del" type="button" data-id="' + escapeHtml(s.id) + '" title="删除会话">...</button>' +
                '  </div>' +
                '  <div class="session-sub">' +
                '    <span class="model-pill">' + escapeHtml(s.model || '未知模型') + '</span>' +
                '    <span class="session-time">' + escapeHtml(formatTime(s.updated_at || s.created_at)) + '</span>' +
                '  </div>' +
                '</div>';
        }).join('');

        el.sessionList.innerHTML = html;
    }

    function handleDeleteSession(id, event) {
        event.stopPropagation();
        if (!window.confirm('确定要删除该会话吗？删除后不可恢复。')) return;

        request('/api/session/' + encodeURIComponent(id), { method: 'DELETE' }).then(function () {
            state.sessions = state.sessions.filter(function (s) { return s.id !== id; });

            if (state.currentSessionId === id) {
                if (state.abortController) {
                    try { state.abortController.abort(); } catch (e) { /* ignore */ }
                }
                state.streaming = false;
                state.currentSessionId = null;
                state.currentModel = '';
                showWelcome();
            }
            renderSessions();
            showToast('会话已删除');
        }).catch(function (err) {
            showToast('删除会话失败：' + err.message);
        });
    }

    /* ---------------- 视图切换 ---------------- */

    function showWelcome() {
        el.chatView.hidden = true;
        el.welcomeView.hidden = false;
        el.messages.innerHTML = '';
        setStreaming(false);
    }

    function showChat() {
        el.welcomeView.hidden = true;
        el.chatView.hidden = false;
    }

    function openSession(id) {
        var session = state.sessions.filter(function (s) { return s.id === id; })[0];

        if (state.abortController) {
            try { state.abortController.abort(); } catch (e) { /* ignore */ }
            state.abortController = null;
        }
        state.streaming = false;

        state.currentSessionId = id;
        state.currentModel = session ? (session.model || '') : '';
        renderSessions();
        showChat();
        closeSidebar();

        el.chatTitle.textContent = (session && session.first_user_message) || '新的对话';
        el.chatModel.textContent = state.currentModel;
        el.messages.innerHTML = '<div class="session-empty">正在加载历史消息...</div>';
        state.loadingHistory = true;
        updateComposer();

        request('/api/session/' + encodeURIComponent(id) + '/history').then(function (data) {
            el.messages.innerHTML = '';
            var list = Array.isArray(data) ? data : [];
            list.forEach(function (m) {
                appendMessage(m.role === 'user' ? 'user' : 'assistant', m.content, m.timestamp);
            });
            if (!list.length) {
                el.messages.innerHTML = '<div class="session-empty">还没有消息，开始你的第一次提问吧</div>';
            }
            scrollToBottom();
        }).catch(function (err) {
            el.messages.innerHTML = '';
            showToast('获取历史消息失败：' + err.message);
        }).then(function () {
            state.loadingHistory = false;
            updateComposer();
            el.input.focus();
        });
    }

    /* ---------------- 消息渲染 ---------------- */

    function appendMessage(role, content, ts) {
        var row = document.createElement('div');
        row.className = 'msg-row ' + (role === 'user' ? 'user' : 'assistant');

        var bubble = document.createElement('div');
        bubble.className = 'bubble';
        if (role === 'user') {
            bubble.textContent = content;
        } else {
            bubble.innerHTML = renderMarkdown(content);
        }

        var time = document.createElement('div');
        time.className = 'msg-time';
        time.textContent = formatTime(ts);

        row.appendChild(bubble);
        row.appendChild(time);
        el.messages.appendChild(row);
        return row;
    }

    function scrollToBottom() {
        el.messages.scrollTop = el.messages.scrollHeight;
    }

    function isNearBottom() {
        return el.messages.scrollHeight - el.messages.scrollTop - el.messages.clientHeight < 90;
    }

    /* ---------------- 发送消息（SSE 流式） ---------------- */

    function setStreaming(flag) {
        state.streaming = flag;
        el.sendBtn.classList.toggle('loading', flag);
        el.sendBtn.disabled = flag || el.input.value.trim().length === 0;
        el.input.focus();
    }

    function handleSend() {
        var text = el.input.value.trim();
        if (!text || state.streaming || state.loadingHistory) return;
        if (!state.currentSessionId) {
            showToast('请先新建一个对话');
            return;
        }
        if (text.length > MAX_LEN) {
            showToast('消息长度不能超过 ' + MAX_LEN + ' 字');
            return;
        }

        var sessionId = state.currentSessionId;
        appendMessage('user', text, Date.now() / 1000);

        el.input.value = '';
        updateComposer();
        scrollToBottom();

        var row = document.createElement('div');
        row.className = 'msg-row assistant';
        var bubble = document.createElement('div');
        bubble.className = 'bubble';
        bubble.innerHTML = '<span class="typing"><span></span><span></span><span></span></span>';
        var time = document.createElement('div');
        time.className = 'msg-time';
        time.textContent = formatTime(Date.now() / 1000);
        row.appendChild(bubble);
        row.appendChild(time);
        el.messages.appendChild(row);
        scrollToBottom();

        setStreaming(true);

        var answer = '';
        var rafId = null;
        var firstDelta = true;
        var stick = true;

        function paint() {
            rafId = null;
            bubble.innerHTML = renderMarkdown(answer) + '<span class="cursor-blink"></span>';
            if (stick) scrollToBottom();
        }

        function schedulePaint() {
            if (rafId === null) rafId = requestAnimationFrame(paint);
        }

        streamChat(sessionId, text, function (delta) {
            if (firstDelta) {
                firstDelta = false;
                bubble.innerHTML = '';
            }
            answer += delta;
            stick = isNearBottom();
            schedulePaint();
        }).then(function () {
            if (rafId !== null) cancelAnimationFrame(rafId);
            rafId = null;

            if (!answer) {
                bubble.innerHTML = '<span style="color:#e5484d">未收到回复，请稍后重试。</span>';
            } else {
                bubble.innerHTML = renderMarkdown(answer);
            }
            scrollToBottom();

            // 同步更新左侧会话信息
            var s = state.sessions.filter(function (x) { return x.id === sessionId; })[0];
            if (s) {
                if (!s.first_user_message) s.first_user_message = text;
                s.updated_at = Math.floor(Date.now() / 1000);
                s.message_count = (Number(s.message_count) || 0) + 2;
                el.chatTitle.textContent = truncate(s.first_user_message, 30);
                renderSessions();
            }
        }).catch(function (err) {
            if (rafId !== null) cancelAnimationFrame(rafId);
            rafId = null;
            if (err && err.name === 'AbortError') {
                if (answer) bubble.innerHTML = renderMarkdown(answer);
                return;
            }
            bubble.innerHTML = '<span style="color:#e5484d">回复失败：' + escapeHtml(err.message || '网络异常') + '</span>';
            showToast('发送消息失败：' + (err.message || '网络异常'));
        }).then(function () {
            state.abortController = null;
            setStreaming(false);
        });
    }

    /**
     * 读取 SSE 流：data: 文本\n\n ... data: [DONE]
     * 注意：服务端对每个分片做了 JSON 转义（形如 data: "文本"），这里兼容两种形式。
     */
    function streamChat(sessionId, message, onDelta) {
        var controller = new AbortController();
        state.abortController = controller;

        return fetch('/api/message/async', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_id: sessionId, message: message }),
            signal: controller.signal
        }).then(function (res) {
            if (!res.ok) throw new Error('HTTP ' + res.status);
            if (!res.body || !res.body.getReader) {
                return res.text().then(function (txt) {
                    parseSseText(txt, onDelta);
                });
            }

            var reader = res.body.getReader();
            var decoder = new TextDecoder('utf-8');
            var buffer = '';
            var finished = false;

            function consume(line) {
                var trimmed = line.replace(/^\s+/, '');
                if (trimmed.indexOf('data:') !== 0) return;
                var payload = trimmed.slice(5);
                if (payload.charAt(0) === ' ') payload = payload.slice(1);

                if (payload === '[DONE]') {
                    finished = true;
                    return;
                }
                if (!payload) return;

                var text = payload;
                if (payload.charAt(0) === '"') {
                    try {
                        text = JSON.parse(payload);
                    } catch (e) {
                        text = payload;
                    }
                }
                if (typeof text === 'string' && text.length) onDelta(text);
            }

            function pump() {
                return reader.read().then(function (result) {
                    if (result.done) {
                        if (buffer) consume(buffer.replace(/\r$/, ''));
                        return;
                    }
                    buffer += decoder.decode(result.value, { stream: true });

                    var idx;
                    while ((idx = buffer.indexOf('\n')) >= 0) {
                        var line = buffer.slice(0, idx);
                        buffer = buffer.slice(idx + 1);
                        if (line.charAt(line.length - 1) === '\r') line = line.slice(0, -1);
                        if (finished) return;
                        consume(line);
                    }
                    if (finished) return;
                    return pump();
                });
            }

            return pump();
        });
    }

    function parseSseText(text, onDelta) {
        text.split('\n').forEach(function (line) {
            if (line.indexOf('data:') !== 0) return;
            var payload = line.slice(5).trim();
            if (!payload || payload === '[DONE]') return;
            if (payload.charAt(0) === '"') {
                try { payload = JSON.parse(payload); } catch (e) { /* ignore */ }
            }
            if (typeof payload === 'string' && payload) onDelta(payload);
        });
    }

    /* ---------------- 输入框 ---------------- */

    function autoGrow() {
        el.input.style.height = 'auto';
        el.input.style.height = Math.min(el.input.scrollHeight, 150) + 'px';
    }

    function updateComposer() {
        var len = el.input.value.length;
        el.charCount.textContent = len;
        el.charCountWrap.classList.toggle('warn', len >= MAX_LEN * 0.9);
        el.sendBtn.disabled = state.streaming || state.loadingHistory || len === 0;
        if (el.sendBtn.classList.contains('loading') && !state.streaming) {
            el.sendBtn.classList.remove('loading');
        }
        autoGrow();
    }

    /* ---------------- 模型选择弹窗 ---------------- */

    function openModelPicker() {
        if (state.streaming) {
            showToast('请等待当前回复完成后再新建对话');
            return;
        }
        state.selectedModel = null;
        el.modalConfirmBtn.disabled = true;
        el.modalConfirmBtn.textContent = '确定';
        el.modelModal.hidden = false;
        el.modelGrid.innerHTML = '<div class="model-loading">正在获取模型列表...</div>';

        request('/api/models').then(function (data) {
            state.models = Array.isArray(data) ? data : [];
            if (!state.models.length) {
                el.modelGrid.innerHTML = '<div class="model-error">服务器暂无可用的模型</div>';
                return;
            }
            el.modelGrid.innerHTML = state.models.map(function (m) {
                return '' +
                    '<div class="model-card" data-model="' + escapeHtml(m.name) + '" role="radio" aria-checked="false" tabindex="0">' +
                    '  <div class="model-card-top">' +
                    '    <span class="model-radio"></span>' +
                    '    <span class="model-name">' + escapeHtml(m.name) + '</span>' +
                    '  </div>' +
                    '  <p class="model-desc">' + escapeHtml(m.desc || '暂无描述') + '</p>' +
                    '</div>';
            }).join('');

            // 默认选中第一个模型
            selectModel(el.modelGrid.querySelector('.model-card'));
        }).catch(function (err) {
            el.modelGrid.innerHTML = '<div class="model-error">获取模型列表失败：' + escapeHtml(err.message) + '</div>';
        });
    }

    function selectModel(card) {
        if (!card) return;
        Array.prototype.forEach.call(el.modelGrid.querySelectorAll('.model-card'), function (c) {
            c.classList.remove('selected');
            c.setAttribute('aria-checked', 'false');
        });
        card.classList.add('selected');
        card.setAttribute('aria-checked', 'true');
        state.selectedModel = card.getAttribute('data-model');
        el.modalConfirmBtn.disabled = false;
    }

    function closeModelPicker() {
        if (state.creating) return;
        el.modelModal.hidden = true;
        el.modelGrid.innerHTML = '';
        state.selectedModel = null;
    }

    function createSession(model) {
        if (!model || state.creating) return;
        state.creating = true;
        el.modalConfirmBtn.disabled = true;
        el.modalConfirmBtn.textContent = '创建中...';

        request('/api/session', {
            method: 'POST',
            body: JSON.stringify({ model: model })
        }).then(function (data) {
            var now = Math.floor(Date.now() / 1000);
            var session = {
                id: data.session_id,
                model: data.model || model,
                created_at: now,
                updated_at: now,
                message_count: 0,
                first_user_message: ''
            };

            state.sessions.unshift(session);
            state.currentSessionId = session.id;
            state.currentModel = session.model;

            state.creating = false;
            closeModelPicker();
            showChat();
            closeSidebar();

            el.chatTitle.textContent = '新的对话';
            el.chatModel.textContent = session.model;
            el.messages.innerHTML = '<div class="session-empty">会话已创建，输入你的问题开始聊天吧</div>';
            el.input.value = '';
            updateComposer();
            renderSessions();
            el.input.focus();
            showToast('会话创建成功');
        }).catch(function (err) {
            showToast('创建会话失败：' + err.message);
        }).then(function () {
            state.creating = false;
            el.modalConfirmBtn.textContent = '确定';
            el.modalConfirmBtn.disabled = !state.selectedModel;
        });
    }

    /* ---------------- Markdown 渲染 ---------------- */

    function renderMarkdown(src) {
        var text = String(src == null ? '' : src).replace(/\r\n?/g, '\n');
        var lines = text.split('\n');
        var html = '';
        var i = 0;
        var para = [];
        var listType = null;
        var inQuote = false;

        function flushPara() {
            if (!para.length) return;
            html += '<p>' + inline(para.join('\n')) + '</p>';
            para = [];
        }
        function closeList() {
            if (!listType) return;
            html += '</' + listType + '>';
            listType = null;
        }
        function closeQuote() {
            if (!inQuote) return;
            html += '</blockquote>';
            inQuote = false;
        }
        function closeAll() {
            flushPara();
            closeList();
            closeQuote();
        }

        while (i < lines.length) {
            var line = lines[i];

            // 围栏代码块
            var fence = line.match(/^\s*```\s*([\w#+.\-]*)\s*$/);
            if (fence) {
                closeAll();
                var lang = fence[1] || '';
                var buf = [];
                i++;
                while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
                    buf.push(lines[i]);
                    i++;
                }
                if (i < lines.length) i++;
                html += renderCodeBlock(buf.join('\n'), lang);
                continue;
            }

            // 空行
            if (!line.trim()) {
                closeAll();
                i++;
                continue;
            }

            // 分割线
            if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(line)) {
                closeAll();
                html += '<hr>';
                i++;
                continue;
            }

            // 标题
            var heading = line.match(/^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/);
            if (heading) {
                closeAll();
                var level = heading[1].length;
                html += '<h' + level + '>' + inline(heading[2]) + '</h' + level + '>';
                i++;
                continue;
            }

            // 引用
            var quote = line.match(/^\s*>\s?(.*)$/);
            if (quote) {
                flushPara();
                closeList();
                if (!inQuote) {
                    html += '<blockquote>';
                    inQuote = true;
                }
                html += '<p>' + inline(quote[1]) + '</p>';
                i++;
                continue;
            }
            if (inQuote) closeQuote();

            // 表格
            if (line.indexOf('|') >= 0 && i + 1 < lines.length &&
                /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1]) && lines[i + 1].indexOf('-') >= 0) {
                closeAll();
                var headerCells = splitTableRow(line);
                i += 2;
                var bodyRows = '';
                while (i < lines.length && lines[i].trim() && lines[i].indexOf('|') >= 0) {
                    bodyRows += '<tr>' + splitTableRow(lines[i]).map(function (c) {
                        return '<td>' + inline(c) + '</td>';
                    }).join('') + '</tr>';
                    i++;
                }
                html += '<table><thead><tr>' + headerCells.map(function (c) {
                    return '<th>' + inline(c) + '</th>';
                }).join('') + '</tr></thead><tbody>' + bodyRows + '</tbody></table>';
                continue;
            }

            // 列表
            var listItem = line.match(/^\s*([-*+]|\d+[.)])\s+(.*)$/);
            if (listItem) {
                flushPara();
                closeQuote();
                var type = /\d/.test(listItem[1]) ? 'ol' : 'ul';
                if (listType !== type) {
                    closeList();
                    html += '<' + type + '>';
                    listType = type;
                }
                html += '<li>' + inline(listItem[2]) + '</li>';
                i++;
                continue;
            }
            if (listType) closeList();

            // 普通段落
            para.push(line);
            i++;
        }

        closeAll();
        return html;
    }

    function splitTableRow(line) {
        var s = line.trim();
        if (s.charAt(0) === '|') s = s.slice(1);
        if (s.charAt(s.length - 1) === '|') s = s.slice(0, -1);
        return s.split('|').map(function (c) { return c.trim(); });
    }

    function inline(text) {
        var codes = [];
        var s = escapeHtml(text).replace(/`([^`\n]+)`/g, function (m, code) {
            codes.push(code);
            return '\u0000' + (codes.length - 1) + '\u0000';
        });

        s = s.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
        s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>');
        s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
        s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
        s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
            '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

        s = s.replace(/\u0000(\d+)\u0000/g, function (m, idx) {
            return '<code>' + codes[Number(idx)] + '</code>';
        });
        s = s.replace(/\n/g, '<br>');
        return s;
    }

    /* ---------------- 代码块与语法高亮 ---------------- */

    var KEYWORDS = {
        cpp: 'alignas alignof asm auto bool break case catch char class const constexpr continue decltype default delete do double else enum explicit export extern false float for friend goto if inline int long mutable namespace new noexcept nullptr operator private protected public reinterpret_cast return short signed sizeof static static_cast struct switch template this throw true try typedef typeid typename union unsigned using virtual void volatile while std string vector unique_ptr shared_ptr size_t include define'.split(' '),
        c: 'auto break case char const continue default do double else enum extern float for goto if inline int long register restrict return short signed sizeof static struct switch typedef union unsigned void volatile while size_t include define'.split(' '),
        js: 'async await break case catch class const continue debugger default delete do else export extends false finally for function if import in instanceof let new null of return static super switch this throw true try typeof undefined var void while with yield'.split(' '),
        java: 'abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for if implements import instanceof int interface long native new package private protected public return short static super switch synchronized this throw throws transient try void volatile while var'.split(' '),
        python: 'and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield'.split(' '),
        go: 'break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var nil true false'.split(' '),
        rust: 'as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self static struct super trait true type unsafe use where while Some None Ok Err'.split(' '),
        bash: 'if then else elif fi for while do done case esac function in return export local readonly echo cd ls grep sed awk cat mkdir rm cp mv'.split(' '),
        sql: 'select from where insert into values update set delete create table drop alter add index primary key foreign references not null join left right inner outer on group by order having limit offset and or as distinct'.split(' '),
        default: 'if else for while return class struct public private int char void true false null'.split(' ')
    };

    var LANG_ALIAS = {
        'c++': 'cpp', 'cc': 'cpp', 'cxx': 'cpp', 'h': 'cpp', 'hpp': 'cpp',
        'js': 'js', 'javascript': 'js', 'jsx': 'js', 'ts': 'js', 'typescript': 'js',
        'py': 'python', 'sh': 'bash', 'shell': 'bash', 'zsh': 'bash',
        'htm': 'html', 'yml': 'yaml'
    };

    function normalizeLang(lang) {
        var key = String(lang || '').toLowerCase().trim();
        return LANG_ALIAS[key] || key;
    }

    function renderCodeBlock(code, lang) {
        var label = lang ? escapeHtml(lang) : 'text';
        var cls = 'lang-' + (normalizeLang(lang) || 'text');
        return '' +
            '<div class="code-block">' +
            '  <div class="code-head">' +
            '    <span class="code-lang">' + label + '</span>' +
            '    <button class="code-copy" type="button">复制</button>' +
            '  </div>' +
            '  <pre><code class="' + escapeHtml(cls) + '">' + highlight(code, lang) + '</code></pre>' +
            '</div>';
    }

    function highlight(code, lang) {
        code = String(code == null ? '' : code);
        var key = normalizeLang(lang);

        if (!key || key === 'text' || key === 'plain' || key === 'html' || key === 'markdown') {
            return escapeHtml(code);
        }

        var kws = KEYWORDS[key] || KEYWORDS.default;
        var hashComment = ['python', 'bash', 'yaml', 'ruby', 'perl'].indexOf(key) >= 0;
        var commentPattern = hashComment ? '#[^\\n]*' : '\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/';
        var re = new RegExp(
            '(' + commentPattern + ')' +
            '|("(?:\\\\.|[^"\\\\])*"|\'(?:\\\\.|[^\'\\\\])*\'|`(?:\\\\.|[^`\\\\])*`)' +
            '|\\b(0[xX][0-9a-fA-F]+|\\d+(?:\\.\\d+)?)\\b' +
            '|\\b([A-Za-z_$][\\w$]*)\\b',
            'g'
        );

        var out = '';
        var last = 0;
        var m;
        while ((m = re.exec(code)) !== null) {
            out += escapeHtml(code.slice(last, m.index));

            if (m[1] !== undefined) {
                out += '<span class="tok-com">' + escapeHtml(m[1]) + '</span>';
            } else if (m[2] !== undefined) {
                out += '<span class="tok-str">' + escapeHtml(m[2]) + '</span>';
            } else if (m[3] !== undefined) {
                out += '<span class="tok-num">' + escapeHtml(m[3]) + '</span>';
            } else if (m[4] !== undefined) {
                var word = m[4];
                if (kws.indexOf(word) >= 0) {
                    out += '<span class="tok-kw">' + escapeHtml(word) + '</span>';
                } else if (code.charAt(m.index + word.length) === '(') {
                    out += '<span class="tok-fn">' + escapeHtml(word) + '</span>';
                } else {
                    out += escapeHtml(word);
                }
            }
            last = re.lastIndex;
        }
        out += escapeHtml(code.slice(last));
        return out;
    }

    /* ---------------- 代码复制 ---------------- */

    function copyText(text, callback) {
        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(text).then(callback, function () {
                fallbackCopy(text, callback);
            });
        } else {
            fallbackCopy(text, callback);
        }
    }

    function fallbackCopy(text, callback) {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        try {
            document.execCommand('copy');
            callback();
        } catch (e) {
            showToast('复制失败，请手动选择复制');
        }
        document.body.removeChild(ta);
    }

    /* ---------------- 移动端侧栏 ---------------- */

    function closeSidebar() {
        el.app.classList.remove('sidebar-open');
    }

    /* ---------------- 事件绑定 ---------------- */

    function bindEvents() {
        el.newChatBtn.addEventListener('click', openModelPicker);
        el.welcomeNewChatBtn.addEventListener('click', openModelPicker);

        el.sessionList.addEventListener('click', function (e) {
            var del = e.target.closest('.session-del');
            if (del) {
                handleDeleteSession(del.getAttribute('data-id'), e);
                return;
            }
            var item = e.target.closest('.session-item');
            if (item) openSession(item.getAttribute('data-id'));
        });

        el.input.addEventListener('input', updateComposer);
        el.input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                if (e.isComposing || e.keyCode === 229) return;
                e.preventDefault();
                handleSend();
            }
        });
        el.sendBtn.addEventListener('click', handleSend);

        el.modelGrid.addEventListener('click', function (e) {
            var card = e.target.closest('.model-card');
            if (card) selectModel(card);
        });
        el.modelGrid.addEventListener('keydown', function (e) {
            var card = e.target.closest('.model-card');
            if (!card) return;
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                selectModel(card);
            }
        });

        el.modalCloseBtn.addEventListener('click', closeModelPicker);
        el.modalCancelBtn.addEventListener('click', closeModelPicker);
        el.modelModal.addEventListener('click', function (e) {
            if (e.target === el.modelModal) closeModelPicker();
        });
        el.modalConfirmBtn.addEventListener('click', function () {
            createSession(state.selectedModel);
        });

        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && !el.modelModal.hidden) closeModelPicker();
        });

        el.messages.addEventListener('click', function (e) {
            var btn = e.target.closest('.code-copy');
            if (!btn) return;
            var block = btn.closest('.code-block');
            var codeEl = block ? block.querySelector('pre code') : null;
            if (!codeEl) return;

            copyText(codeEl.textContent, function () {
                btn.textContent = '已复制';
                btn.classList.add('copied');
                setTimeout(function () {
                    btn.textContent = '复制';
                    btn.classList.remove('copied');
                }, 1600);
            });
        });

        el.menuBtn.addEventListener('click', function () {
            el.app.classList.add('sidebar-open');
        });
        el.sidebarMask.addEventListener('click', closeSidebar);
    }

    /* ---------------- 初始化 ---------------- */

    function init() {
        bindEvents();
        updateComposer();
        loadSessions();
    }

    init();
})();
