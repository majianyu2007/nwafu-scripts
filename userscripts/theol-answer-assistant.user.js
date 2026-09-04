// ==UserScript==
// @name        THEOL 自动答题助手
// @version     1.0.0
// @description 在 THEOL 页面增加题库查询、OpenAI 兼容 LLM 配置、答案填入和运行日志面板。
// @match       https://eol.nwafu.edu.cn/*
// @grant       GM_xmlhttpRequest
// @grant       GM_setValue
// @grant       GM_getValue
// @grant       GM_deleteValue
// @grant       GM_addStyle
// @grant       GM_registerMenuCommand
// @connect     tk.enncy.cn
// @connect     api.715654.xyz
// @run-at      document-end
// @namespace   https://mjy.js.org/nwafu-scripts/
// @author      majianyu2007
// @license     MIT
// @homepageURL https://mjy.js.org/nwafu-scripts/scripts/theol-answer-assistant/
// @supportURL  https://github.com/majianyu2007/nwafu-scripts/issues
// @updateURL   https://mjy.js.org/nwafu-scripts/userscripts/theol-answer-assistant.user.js
// @downloadURL https://mjy.js.org/nwafu-scripts/userscripts/theol-answer-assistant.user.js
// ==/UserScript==

(function() {
    'use strict';

    // ==================== 常量 ====================
    const ENNCY_QUERY_URL = 'https://tk.enncy.cn/query';
    const ENNCY_INFO_URL = 'https://tk.enncy.cn/info';
    const SCRIPT_NAME = 'THEOL自动答题';

    // ==================== 配置读写 ====================
    const CFG = {
        get enncyToken() { return GM_getValue('enncy_token', ''); },
        set enncyToken(v) { GM_setValue('enncy_token', v); },
        get enncyEnabled() { return GM_getValue('enncy_enabled', true); },
        set enncyEnabled(v) { GM_setValue('enncy_enabled', v); },

        get llmEndpoint() { return GM_getValue('llm_endpoint', ''); },
        set llmEndpoint(v) { GM_setValue('llm_endpoint', v); },
        get llmKey() { return GM_getValue('llm_key', ''); },
        set llmKey(v) { GM_setValue('llm_key', v); },
        get llmModel() { return GM_getValue('llm_model', 'gpt-4o-mini'); },
        set llmModel(v) { GM_setValue('llm_model', v); },
        get llmEnabled() { return GM_getValue('llm_enabled', false); },
        set llmEnabled(v) { GM_setValue('llm_enabled', v); },

        get priority() { return GM_getValue('priority', 'enncy_first'); },
        set priority(v) { GM_setValue('priority', v); },

        get autoNext() { return GM_getValue('auto_next', false); },
        set autoNext(v) { GM_setValue('auto_next', v); },
    };

    // ==================== 日志 ====================
    const logLines = [];
    function log(msg, type='info') {
        const time = new Date().toLocaleTimeString();
        const line = `[${time}] ${msg}`;
        logLines.push({line, type});
        if (logLines.length > 200) logLines.shift();
        updateLogUI();
        console.log(`[${SCRIPT_NAME}]`, msg);
    }

    // ==================== UI ====================
    let panelEl, logEl, statusEl;
    let enncyTokenInput, enncyEnabledCb;
    let llmEndpointInput, llmKeyInput, llmModelInput, llmEnabledCb;
    let prioritySelect, autoNextCb;
    let configSection;
    let currentAnswerBtn, autoAnswerBtn, stopBtn;
    let autoRunning = false;
    let answeredCount = 0;

    function createUI() {
        // 注入样式
        GM_addStyle(`
            #theol-answer-panel {
                position: fixed; z-index: 99999; bottom: 10px; right: 10px;
                width: 420px; max-height: 560px;
                background: #1e1e2e; color: #cdd6f4; border-radius: 10px;
                box-shadow: 0 8px 32px rgba(0,0,0,0.5); font-size: 13px;
                font-family: 'Microsoft YaHei', 'PingFang SC', sans-serif;
                display: flex; flex-direction: column; overflow: hidden;
            }
            #theol-answer-panel.minimized .theol-body { display: none; }
            #theol-answer-panel.minimized { max-height: none; }
            .theol-header {
                display: flex; align-items: center; padding: 8px 12px;
                background: #313244; cursor: move; user-select: none;
                border-radius: 10px 10px 0 0; gap: 8px;
            }
            .theol-header .title { font-weight: bold; color: #f5c2e7; flex:1; }
            .theol-header .stats { font-size: 12px; color: #a6adc8; }
            .theol-header button {
                background: none; border: none; color: #cdd6f4; cursor: pointer;
                font-size: 16px; padding: 2px 6px; border-radius: 4px;
            }
            .theol-header button:hover { background: #45475a; }
            .theol-body {
                padding: 10px; overflow-y: auto; flex: 1;
                display: flex; flex-direction: column; gap: 8px;
            }
            .theol-section {
                border: 1px solid #45475a; border-radius: 6px; padding: 8px;
            }
            .theol-section legend {
                color: #89b4fa; font-weight: bold; cursor: pointer;
                padding: 0 4px;
            }
            .theol-section.collapsed .theol-section-content { display: none; }
            .theol-row { display: flex; align-items: center; gap: 6px; margin: 4px 0; }
            .theol-row label { min-width: 55px; font-size: 12px; color: #a6adc8; }
            .theol-row input[type="text"],
            .theol-row input[type="password"],
            .theol-row select {
                flex: 1; padding: 4px 6px; border: 1px solid #45475a;
                border-radius: 4px; background: #313244; color: #cdd6f4;
                font-size: 12px;
            }
            .theol-row input:focus { outline: 1px solid #89b4fa; }
            .theol-row select { cursor: pointer; }
            .theol-btn {
                padding: 6px 12px; border: none; border-radius: 4px;
                cursor: pointer; font-size: 12px; font-weight: bold;
                transition: all 0.15s;
            }
            .theol-btn-primary { background: #89b4fa; color: #1e1e2e; }
            .theol-btn-primary:hover { background: #b4d0fb; }
            .theol-btn-danger { background: #f38ba8; color: #1e1e2e; }
            .theol-btn-danger:hover { background: #f5a8c0; }
            .theol-btn-success { background: #a6e3a1; color: #1e1e2e; }
            .theol-btn-success:hover { background: #c0f0bc; }
            .theol-btn-warn { background: #f9e2af; color: #1e1e2e; }
            .theol-btn-warn:hover { background: #fcecc8; }
            .theol-btn-sm { padding: 2px 8px; font-size: 11px; }
            .theol-btn:disabled { opacity: 0.5; cursor: not-allowed; }
            .theol-log {
                background: #11111b; border-radius: 4px; padding: 6px;
                min-height: 80px; max-height: 150px; overflow-y: auto;
                font-size: 11px; font-family: 'Consolas', 'Monaco', monospace;
                white-space: pre-wrap; word-break: break-all;
            }
            .theol-log .log-info { color: #a6e3a1; }
            .theol-log .log-warn { color: #f9e2af; }
            .theol-log .log-error { color: #f38ba8; }
            .theol-status { font-size: 12px; padding: 4px 8px; border-radius: 4px; }
            .theol-status.idle { background: #313244; color: #a6adc8; }
            .theol-status.running { background: #1e4030; color: #a6e3a1; }
            .theol-status.error { background: #401e2e; color: #f38ba8; }
            .theol-btn-row { display: flex; gap: 6px; flex-wrap: wrap; }
            .theol-check-row { display: flex; align-items: center; gap: 6px; }
            .theol-check-row input[type="checkbox"] { cursor: pointer; }
        `);

        // 构建面板
        panelEl = document.createElement('div');
        panelEl.id = 'theol-answer-panel';
        panelEl.innerHTML = `
            <div class="theol-header" id="theol-drag-handle">
                <span class="title">🧠 THEOL 答题助手</span>
                <span class="stats" id="theol-stats">已答: 0</span>
                <button id="theol-config-toggle" title="配置">⚙</button>
                <button id="theol-minimize-btn" title="最小化">–</button>
            </div>
            <div class="theol-body">
                <div id="theol-status" class="theol-status idle">🟢 就绪，等待操作</div>

                <div class="theol-section" id="theol-config-section">
                    <legend>⚙ 配置</legend>
                    <div class="theol-section-content">
                        <!-- enncy -->
                        <div id="theol-enncy-config">
                            <div class="theol-check-row" style="margin-bottom:4px">
                                <input type="checkbox" id="theol-enncy-enabled">
                                <label style="color:#f5c2e7;font-weight:bold">📚 enncy题库</label>
                            </div>
                            <div class="theol-row">
                                <label>Token:</label>
                                <input type="text" id="theol-enncy-token" placeholder="输入enncy题库token">
                                <button class="theol-btn theol-btn-sm theol-btn-primary" id="theol-enncy-check">查询次数</button>
                            </div>
                        </div>
                        <hr style="border-color:#45475a;margin:8px 0">
                        <!-- LLM -->
                        <div id="theol-llm-config">
                            <div class="theol-check-row" style="margin-bottom:4px">
                                <input type="checkbox" id="theol-llm-enabled">
                                <label style="color:#f5c2e7;font-weight:bold">🤖 OpenAI兼容LLM</label>
                            </div>
                            <div class="theol-row">
                                <label>API地址:</label>
                                <input type="text" id="theol-llm-endpoint" placeholder="https://api.openai.com/v1/chat/completions">
                            </div>
                            <div class="theol-row">
                                <label>API Key:</label>
                                <input type="password" id="theol-llm-key" placeholder="sk-...">
                            </div>
                            <div class="theol-row">
                                <label>模型:</label>
                                <input type="text" id="theol-llm-model" placeholder="gpt-4o-mini">
                            </div>
                        </div>
                        <hr style="border-color:#45475a;margin:8px 0">
                        <div class="theol-row">
                            <label>优先级:</label>
                            <select id="theol-priority">
                                <option value="enncy_first">enncy优先 → LLM兜底</option>
                                <option value="llm_first">LLM优先 → enncy兜底</option>
                                <option value="enncy_only">仅enncy</option>
                                <option value="llm_only">仅LLM</option>
                            </select>
                        </div>
                        <div class="theol-check-row" style="margin-top:4px">
                            <input type="checkbox" id="theol-auto-next">
                            <label>答完一题自动跳下一题</label>
                        </div>
                    </div>
                </div>

                <div class="theol-btn-row">
                    <button class="theol-btn theol-btn-primary" id="theol-current-btn">🎯 回答当前题</button>
                    <button class="theol-btn theol-btn-success" id="theol-auto-btn">▶ 连续自动答题</button>
                    <button class="theol-btn theol-btn-danger" id="theol-stop-btn" disabled>⏹ 停止</button>
                </div>

                <div class="theol-section" id="theol-answer-preview-section" style="display:none">
                    <legend>📝 答案预览（点击复制按钮后粘贴）</legend>
                    <div class="theol-section-content">
                        <textarea id="theol-answer-preview" readonly
                            style="width:100%;height:80px;background:#11111b;color:#a6e3a1;border:1px solid #45475a;
                            border-radius:4px;font-size:12px;resize:vertical;padding:4px;font-family:inherit;"
                            placeholder="获取到的答案将显示在这里..."></textarea>
                        <div style="display:flex;gap:6px;margin-top:4px">
                            <button class="theol-btn theol-btn-sm theol-btn-primary" id="theol-copy-btn">📋 复制答案</button>
                            <span style="font-size:11px;color:#a6adc8">复制后到编辑器按 Ctrl+V 粘贴</span>
                        </div>
                    </div>
                </div>

                <div class="theol-log" id="theol-log">等待操作...</div>
            </div>
        `;
        document.body.appendChild(panelEl);

        // 绑定引用
        statusEl = document.getElementById('theol-status');
        logEl = document.getElementById('theol-log');

        // 绑定配置控件
        enncyEnabledCb = document.getElementById('theol-enncy-enabled');
        enncyTokenInput = document.getElementById('theol-enncy-token');
        llmEnabledCb = document.getElementById('theol-llm-enabled');
        llmEndpointInput = document.getElementById('theol-llm-endpoint');
        llmKeyInput = document.getElementById('theol-llm-key');
        llmModelInput = document.getElementById('theol-llm-model');
        prioritySelect = document.getElementById('theol-priority');
        autoNextCb = document.getElementById('theol-auto-next');
        configSection = document.getElementById('theol-config-section');

        currentAnswerBtn = document.getElementById('theol-current-btn');
        autoAnswerBtn = document.getElementById('theol-auto-btn');
        stopBtn = document.getElementById('theol-stop-btn');

        // 加载配置到UI
        loadConfigToUI();
        applyConfigVisibility();

        // 事件绑定
        enncyEnabledCb.addEventListener('change', () => {
            CFG.enncyEnabled = enncyEnabledCb.checked;
            applyConfigVisibility();
        });
        enncyTokenInput.addEventListener('change', () => CFG.enncyToken = enncyTokenInput.value.trim());
        llmEnabledCb.addEventListener('change', () => {
            CFG.llmEnabled = llmEnabledCb.checked;
            applyConfigVisibility();
        });
        llmEndpointInput.addEventListener('change', () => CFG.llmEndpoint = llmEndpointInput.value.trim());
        llmKeyInput.addEventListener('change', () => CFG.llmKey = llmKeyInput.value.trim());
        llmModelInput.addEventListener('change', () => CFG.llmModel = llmModelInput.value.trim());
        prioritySelect.addEventListener('change', () => CFG.priority = prioritySelect.value);
        autoNextCb.addEventListener('change', () => CFG.autoNext = autoNextCb.checked);

        document.getElementById('theol-enncy-check').addEventListener('click', checkEnncyInfo);

        document.getElementById('theol-current-btn').addEventListener('click', answerCurrentQuestion);
        document.getElementById('theol-auto-btn').addEventListener('click', startAutoAnswer);
        document.getElementById('theol-stop-btn').addEventListener('click', stopAutoAnswer);

        // 折叠/最小化
        document.getElementById('theol-config-toggle').addEventListener('click', () => {
            configSection.classList.toggle('collapsed');
        });
        document.getElementById('theol-minimize-btn').addEventListener('click', () => {
            panelEl.classList.toggle('minimized');
            const btn = document.getElementById('theol-minimize-btn');
            btn.textContent = panelEl.classList.contains('minimized') ? '+' : '–';
        });

        // 复制按钮：通过用户点击事件触发，绕过浏览器的剪贴板安全策略
        document.getElementById('theol-copy-btn').addEventListener('click', () => {
            const textarea = document.getElementById('theol-answer-preview');
            const text = textarea.value;
            if (!text) { log('没有可复制的内容', 'warn'); return; }
            textarea.select();
            textarea.focus();
            try {
                document.execCommand('copy');
                log('✅ 已复制到剪贴板！去编辑器按 Ctrl+V 粘贴', 'info');
            } catch(e) {
                // 兜底：选中文本让用户自己 Ctrl+C
                log('⚠ 自动复制失败，请手动 Ctrl+C 复制已选中的文本', 'warn');
            }
        });

        // 拖拽
        makeDraggable(panelEl, document.getElementById('theol-drag-handle'));

        log('面板初始化完成');
    }

    function loadConfigToUI() {
        enncyEnabledCb.checked = CFG.enncyEnabled;
        enncyTokenInput.value = CFG.enncyToken;
        llmEnabledCb.checked = CFG.llmEnabled;
        llmEndpointInput.value = CFG.llmEndpoint;
        llmKeyInput.value = CFG.llmKey;
        llmModelInput.value = CFG.llmModel;
        prioritySelect.value = CFG.priority;
        autoNextCb.checked = CFG.autoNext;
    }

    function applyConfigVisibility() {
        const enncyOn = enncyEnabledCb.checked;
        const llmOn = llmEnabledCb.checked;

        // 显示/隐藏 enncy token输入行
        const enncyConfig = document.getElementById('theol-enncy-config');
        const enncyInputs = enncyConfig.querySelectorAll('.theol-row');
        enncyInputs.forEach(el => { el.style.display = enncyOn ? '' : 'none'; });

        // 显示/隐藏 LLM配置
        const llmConfig = document.getElementById('theol-llm-config');
        const llmInputs = llmConfig.querySelectorAll('.theol-row');
        llmInputs.forEach(el => { el.style.display = llmOn ? '' : 'none'; });

        // 如果只有一个开启，简化优先级选项
        const enncyOnly = enncyOn && !llmOn;
        const llmOnly = !enncyOn && llmOn;
        if (enncyOnly) prioritySelect.value = 'enncy_only';
        if (llmOnly) prioritySelect.value = 'llm_only';
        prioritySelect.querySelector('option[value="enncy_first"]').style.display = !llmOn ? 'none' : '';
        prioritySelect.querySelector('option[value="llm_first"]').style.display = !enncyOn ? 'none' : '';
        prioritySelect.querySelector('option[value="enncy_only"]').style.display = enncyOn ? '' : 'none';
        prioritySelect.querySelector('option[value="llm_only"]').style.display = llmOn ? '' : 'none';
    }

    function updateLogUI() {
        if (!logEl) return;
        const recent = logLines.slice(-30);
        logEl.innerHTML = recent.map(l =>
            `<span class="log-${l.type}">${escapeHtml(l.line)}</span>`
        ).join('\n');
        logEl.scrollTop = logEl.scrollHeight;
    }

    function setStatus(text, cls) {
        if (!statusEl) return;
        statusEl.textContent = text;
        statusEl.className = 'theol-status ' + cls;
    }

    function updateStats() {
        const el = document.getElementById('theol-stats');
        if (el) el.textContent = '已答: ' + answeredCount;
    }

    function escapeHtml(s) {
        const d = document.createElement('div');
        d.textContent = s;
        return d.innerHTML;
    }

    function makeDraggable(el, handle) {
        let ox, oy, mx, my;
        handle.addEventListener('mousedown', e => {
            if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
            mx = e.clientX; my = e.clientY;
            const rect = el.getBoundingClientRect();
            ox = rect.left; oy = rect.top;
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
            e.preventDefault();
        });
        function onMove(e) {
            el.style.right = 'auto';
            el.style.bottom = 'auto';
            el.style.left = (ox + e.clientX - mx) + 'px';
            el.style.top = (oy + e.clientY - my) + 'px';
        }
        function onUp() {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        }
    }

    // ==================== iframe 安全访问 ====================
    function safeGetDoc(iframe) {
        try {
            return iframe.contentDocument || (iframe.contentWindow && iframe.contentWindow.document) || null;
        } catch(e) {
            return null;
        }
    }

    // ==================== 题目检测 ====================
    function findTestDoc() {
        try {
            // 当前窗口是否为测试主页面
            if (window.location.href.includes('stu_qtest_main.jsp')) {
                const qFrame = document.querySelector('iframe[src*="stu_qtest_question"]');
                if (qFrame) return safeGetDoc(qFrame);
            }
            // 尝试通过 mainFrame 进入 (从课程页面)
            const mainFrame = document.getElementById('mainFrame');
            if (mainFrame) {
                const mainDoc = safeGetDoc(mainFrame);
                if (mainDoc && mainDoc.location.href.includes('stu_qtest_main.jsp')) {
                    const qFrame = mainDoc.querySelector('iframe[src*="stu_qtest_question"]');
                    if (qFrame) return safeGetDoc(qFrame);
                }
            }
            // 当前是否就是题目iframe
            if (window.location.href.includes('stu_qtest_question.jsp')) {
                return document;
            }
            return null;
        } catch(e) {
            console.log('[THEOL答题] findTestDoc error:', e.message);
            return null;
        }
    }

    function findTestMainDoc() {
        try {
            if (window.location.href.includes('stu_qtest_main.jsp')) return document;
            const mainFrame = document.getElementById('mainFrame');
            if (mainFrame) {
                const mainDoc = safeGetDoc(mainFrame);
                if (mainDoc && mainDoc.location.href.includes('stu_qtest_main.jsp')) return mainDoc;
            }
            return null;
        } catch(e) {
            console.log('[THEOL答题] findTestMainDoc error:', e.message);
            return null;
        }
    }

    function extractQuestion(doc) {
        if (!doc) return null;
        const form = doc.querySelector('form');
        if (!form) return null;

        // 获取题目ID
        const qidInput = form.querySelector('input[name="currentSubmitQuestionid"]');
        const questionId = qidInput ? qidInput.value : '';

        // 获取题目文本（从 hidden *_content 字段）
        const contentInputs = form.querySelectorAll('input[name$="_content"]');
        let questionText = '';
        contentInputs.forEach(inp => {
            if (inp.value && inp.value.trim()) questionText = inp.value.trim();
        });

        // 获取题目类型
        const answerInputs = form.querySelectorAll('input[name="answer"]');
        let qtype = 'unknown';
        if (answerInputs.length > 0) {
            const firstType = answerInputs[0].type;
            if (firstType === 'radio') {
                // 判断是单选还是判断
                const values = Array.from(answerInputs).map(i => i.value);
                if (values.length === 2 && values.includes('T') && values.includes('F')) {
                    qtype = 'judgement';
                } else {
                    qtype = 'single';
                }
            } else if (firstType === 'checkbox') {
                qtype = 'multiple';
            }
        } else {
            // 没有 radio/checkbox → 可能是问答/论述（UEditor）
            const editorDiv = form.querySelector('#ueditor_div_answer, #ue_answer');
            if (editorDiv) {
                // 通过题目在页面上的位置判断是问答还是论述
                // 论述通常题目更长
                qtype = questionText.length > 50 ? 'essay' : 'completion';
            }
        }

        // 获取选项列表
        const options = [];
        if (qtype === 'single' || qtype === 'multiple') {
            const rows = form.querySelectorAll('tr.optionContent');
            rows.forEach(row => {
                const input = row.querySelector('input[name="answer"]');
                const label = row.querySelector('label');
                if (input && label) {
                    options.push({
                        value: input.value,
                        text: label.textContent.trim(),
                        element: input
                    });
                }
            });
        } else if (qtype === 'judgement') {
            const rows = form.querySelectorAll('tr.optionContent');
            rows.forEach(row => {
                const inputs = row.querySelectorAll('input[name="answer"]');
                inputs.forEach(inp => {
                    options.push({
                        value: inp.value,
                        text: inp.value === 'T' ? '正确' : '错误',
                        element: inp
                    });
                });
            });
        }

        return {
            questionId,
            questionText,
            qtype, // 'single' | 'multiple' | 'judgement' | 'completion' | 'essay'
            options,
            form,
            doc
        };
    }

    function detectQuestionTypeLabel(qtype) {
        const map = { single: '单选题', multiple: '不定项选择题', judgement: '判断题', completion: '问答题', essay: '论述题', unknown: '未知题型' };
        return map[qtype] || map.unknown;
    }

    // ==================== API 调用 ====================

    // enncy.cn API
    function queryEnncy(questionText, options, qtype) {
        return new Promise((resolve, reject) => {
            const token = CFG.enncyToken;
            if (!token) { reject(new Error('enncy token未配置')); return; }

            const params = new URLSearchParams();
            params.set('token', token);
            params.set('title', questionText);
            if (options.length > 0) {
                params.set('options', options.map(o => o.text).join('\n'));
            }
            // 映射题型
            const typeMap = { single: 'single', multiple: 'multiple', judgement: 'judgement', completion: 'completion', essay: 'completion' };
            params.set('type', typeMap[qtype] || 'unknown');

            const url = ENNCY_QUERY_URL + '?' + params.toString();

            GM_xmlhttpRequest({
                method: 'GET',
                url: url,
                timeout: 10000,
                onload: function(resp) {
                    try {
                        const data = JSON.parse(resp.responseText);
                        resolve(data);
                    } catch(e) {
                        reject(new Error('enncy响应解析失败: ' + e.message));
                    }
                },
                onerror: function(e) { reject(new Error('enncy请求失败: ' + e)); },
                ontimeout: function() { reject(new Error('enncy请求超时')); }
            });
        });
    }

    function checkEnncyInfo() {
        const token = enncyTokenInput.value.trim();
        if (!token) { log('请先输入enncy token', 'warn'); return; }
        log('正在查询enncy次数...', 'info');

        GM_xmlhttpRequest({
            method: 'GET',
            url: ENNCY_INFO_URL + '?token=' + encodeURIComponent(token),
            timeout: 10000,
            onload: function(resp) {
                try {
                    const data = JSON.parse(resp.responseText);
                    if (data.code === 1) {
                        log(`enncy: 剩余${data.data.times}次, 累计使用${data.data.user_times}次, 成功${data.data.success_times}次`, 'info');
                    } else {
                        log('enncy查询失败: ' + (data.message || '未知错误'), 'error');
                    }
                } catch(e) {
                    log('enncy响应解析失败: ' + e.message, 'error');
                }
            },
            onerror: function() { log('enncy请求失败', 'error'); }
        });
    }

    // OpenAI兼容LLM API
    function queryLLM(questionText, options, qtype) {
        return new Promise((resolve, reject) => {
            const endpoint = CFG.llmEndpoint;
            const key = CFG.llmKey;
            const model = CFG.llmModel;
            if (!endpoint || !key) { reject(new Error('LLM未配置')); return; }

            const prompt = buildLLMPrompt(questionText, options, qtype);

            const body = JSON.stringify({
                model: model,
                messages: [
                    { role: 'user', content: prompt }
                ],
                temperature: 0.1,
                max_tokens: qtype === 'essay' ? 2000 : 500
            });

            GM_xmlhttpRequest({
                method: 'POST',
                url: endpoint,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + key
                },
                data: body,
                timeout: 30000,
                onload: function(resp) {
                    try {
                        const data = JSON.parse(resp.responseText);
                        if (data.choices && data.choices[0] && data.choices[0].message) {
                            resolve(data.choices[0].message.content.trim());
                        } else if (data.error) {
                            reject(new Error('LLM错误: ' + data.error.message));
                        } else {
                            reject(new Error('LLM返回格式异常'));
                        }
                    } catch(e) {
                        reject(new Error('LLM响应解析失败: ' + e.message));
                    }
                },
                onerror: function(e) {
                    const errMsg = (e && e.message) ? e.message : String(e);
                    if (errMsg.includes('@connect') || errMsg.includes('connect list') || errMsg.includes('not a part')) {
                        const domain = new URL(endpoint).hostname;
                        reject(new Error(`LLM域名被拦截！请在脚本头部添加: // @connect ${domain}`));
                    } else {
                        reject(new Error('LLM请求失败: ' + errMsg));
                    }
                },
                ontimeout: function() { reject(new Error('LLM请求超时')); }
            });
        });
    }

    function buildLLMPrompt(questionText, options, qtype) {
        let prompt;
        switch (qtype) {
            case 'single':
                prompt = `你是一个答题助手。请回答以下单项选择题，选择唯一正确的答案。\n\n题目：${questionText}\n\n选项：\n`;
                options.forEach((o, i) => {
                    prompt += `${String.fromCharCode(65+i)}. ${o.text}\n`;
                });
                prompt += '\n请只返回正确答案的字母（如"A"），不要解释。';
                break;

            case 'multiple':
                prompt = `你是一个答题助手。请回答以下多项选择题，选择所有正确的答案。\n\n题目：${questionText}\n\n选项：\n`;
                options.forEach((o, i) => {
                    prompt += `${String.fromCharCode(65+i)}. ${o.text}\n`;
                });
                prompt += '\n请返回所有正确答案的字母，用逗号分隔（如"A,C,D"），不要解释。';
                break;

            case 'judgement':
                prompt = `你是一个答题助手。请判断以下说法是否正确。\n\n${questionText}\n\n请只返回"正确"或"错误"，不要解释。`;
                break;

            case 'completion':
                prompt = `你是一个答题助手。请回答以下问题。\n\n${questionText}\n\n请简洁准确地回答，控制在一段话以内。`;
                break;

            case 'essay':
                prompt = `你是一个答题助手。请论述以下问题。\n\n${questionText}\n\n请详细论述，字数不少于200字，条理清晰。`;
                break;

            default:
                prompt = `你是一个答题助手。请回答以下问题。\n\n${questionText}\n\n请给出答案。`;
        }
        return prompt;
    }

    // ==================== 答案匹配与填充 ====================
    function matchAnswerToOptions(answerText, options, qtype) {
        // 将API返回的答案文本匹配到具体的选项
        if (qtype === 'judgement') {
            const t = answerText.trim();
            if (t.includes('正确') || t.includes('对') || t.toUpperCase() === 'T' || t.toUpperCase() === 'TRUE') {
                return ['T'];
            }
            if (t.includes('错误') || t.includes('错') || t.toUpperCase() === 'F' || t.toUpperCase() === 'FALSE') {
                return ['F'];
            }
            return [];
        }

        if (qtype === 'single') {
            // 尝试匹配字母
            const letterMatch = answerText.trim().match(/^([A-D])$/i);
            if (letterMatch && options.length > 0) {
                const idx = letterMatch[1].toUpperCase().charCodeAt(0) - 65;
                if (idx >= 0 && idx < options.length) return [options[idx].value];
            }
            // 尝试匹配文本 (找最相似的选项)
            let bestOption = null, bestScore = 0;
            for (const opt of options) {
                const score = textSimilarity(answerText, opt.text);
                if (score > bestScore) { bestScore = score; bestOption = opt; }
            }
            if (bestOption && bestScore > 0.3) return [bestOption.value];
            // 最后尝试: 答案包含某个选项文本
            for (const opt of options) {
                if (answerText.includes(opt.text.substring(0, 4))) return [opt.value];
            }
            return [];
        }

        if (qtype === 'multiple') {
            const result = [];
            // 尝试匹配字母（逗号分隔）
            const letterMatch = answerText.match(/[A-D]/gi);
            if (letterMatch && letterMatch.length > 0) {
                letterMatch.forEach(letter => {
                    const idx = letter.toUpperCase().charCodeAt(0) - 65;
                    if (idx >= 0 && idx < options.length) result.push(options[idx].value);
                });
                if (result.length > 0) return result;
            }
            // 尝试文本匹配（每个选项）
            for (const opt of options) {
                if (answerText.includes(opt.text.substring(0, 3))) result.push(opt.value);
            }
            return result;
        }

        return [];
    }

    function textSimilarity(a, b) {
        // 简单的包含/重叠度计算
        a = a.toLowerCase(); b = b.toLowerCase();
        if (a.includes(b) || b.includes(a)) return 0.8;
        const aWords = new Set(a.split(/[\s,，。；;、]+/));
        const bWords = new Set(b.split(/[\s,，。；;、]+/));
        let common = 0;
        aWords.forEach(w => { if (bWords.has(w)) common++; });
        const total = Math.max(aWords.size, bWords.size);
        return total > 0 ? common / total : 0;
    }

    function showAnswerInPreview(text, source) {
        const section = document.getElementById('theol-answer-preview-section');
        const textarea = document.getElementById('theol-answer-preview');
        if (!section || !textarea) return;
        section.style.display = '';
        textarea.value = text;
        // 自动选中方便复制
        setTimeout(() => { textarea.select(); textarea.focus(); }, 100);
        log(`💡 答案已显示在预览区，点击「复制答案」按钮后去编辑器粘贴 (来源: ${source})`, 'info');
    }

    async function fillAnswer(doc, question, answerValues, rawAnswerText) {
        const form = question.form;
        const qtype = question.qtype;

        if (qtype === 'single' || qtype === 'judgement') {
            // 清除已有选择
            const radios = form.querySelectorAll('input[name="answer"]');
            radios.forEach(r => r.checked = false);
            // 设置目标值
            const targetVal = answerValues[0];
            const target = form.querySelector(`input[name="answer"][value="${targetVal}"]`);
            if (target) {
                target.checked = true;
                log(`✓ 已选择: ${targetVal}`, 'info');
            } else {
                log(`✗ 未找到选项: ${targetVal}`, 'error');
                return false;
            }
        } else if (qtype === 'multiple') {
            // 先清空
            const checkboxes = form.querySelectorAll('input[name="answer"]');
            checkboxes.forEach(c => c.checked = false);
            // 设置目标值
            answerValues.forEach(val => {
                const cb = form.querySelector(`input[name="answer"][value="${val}"]`);
                if (cb) {
                    cb.checked = true;
                    log(`✓ 已勾选: ${val}`, 'info');
                }
            });
        } else if (qtype === 'completion' || qtype === 'essay') {
            // 直接写入UEditor的iframe body（绕过不可靠的ready回调）
            const htmlContent = '<p>' + rawAnswerText.replace(/\n/g, '</p><p>') + '</p>';
            let filled = false;

            // 方案1：直接操作iframe body
            const holderDiv = doc.querySelector('.edui-editor-iframeholder');
            if (holderDiv) {
                const iframe = holderDiv.querySelector('iframe');
                if (iframe) {
                    const bodyDoc = iframe.contentDocument || (iframe.contentWindow && iframe.contentWindow.document);
                    if (bodyDoc && bodyDoc.body) {
                        bodyDoc.body.innerHTML = htmlContent;
                        filled = true;
                        log('✓ 已通过iframe写入编辑器内容', 'info');
                    }
                }
            }

            // 方案2：同时尝试UEditor API（如果可用）
            try {
                const win = doc.defaultView || doc.parentWindow;
                if (win && win.UE) {
                    const editor = win.UE.getEditor('answer');
                    if (editor && editor.setContent) {
                        try { editor.setContent(rawAnswerText); } catch(e) {}
                    }
                }
                const textarea = doc.querySelector('#ueditor_div_answer textarea');
                if (textarea) textarea.value = rawAnswerText;
            } catch(e) {}

            if (filled) {
                log('✅ 已自动填入编辑器', 'info');
            } else {
                log('⚠ 自动填入失败，请在下方预览区复制后手动粘贴', 'warn');
            }
        }
        return true;
    }

    function submitAnswer(doc) {
        const form = doc.querySelector('form');
        if (!form) return;
        const submitBtn = form.querySelector('input[type="submit"]');
        if (submitBtn) {
            submitBtn.click();
            log('已提交答案，等待下一题...', 'info');
        }
    }

    // ==================== 核心流程 ====================
    async function answerCurrentQuestion(skipSubmit = false) {
        setStatus('🔍 正在检测题目...', 'running');
        const doc = findTestDoc();
        if (!doc) {
            log('未找到题目页面！请确保在考试页面中', 'error');
            setStatus('❌ 未找到题目', 'error');
            return false;
        }

        const question = extractQuestion(doc);
        if (!question || !question.questionText) {
            log('未能提取题目内容', 'error');
            setStatus('❌ 提取失败', 'error');
            return false;
        }

        const typeLabel = detectQuestionTypeLabel(question.qtype);
        log(`📋 [${typeLabel}] ${question.questionText.substring(0, 50)}...`, 'info');
        if (question.options.length > 0) {
            log(`选项: ${question.options.map(o => o.text).join(' | ')}`, 'info');
        }
        setStatus(`⏳ ${typeLabel}: ${question.questionText.substring(0, 40)}...`, 'running');

        let answerText = null;
        let answerSource = '';

        const priority = CFG.priority;
        const enncyOk = CFG.enncyEnabled && CFG.enncyToken;
        const llmOk = CFG.llmEnabled && CFG.llmEndpoint && CFG.llmKey;

        // 按优先级调用API
        const tryEnncy = async () => {
            if (!enncyOk) return null;
            log('📡 查询enncy题库...', 'info');
            try {
                const data = await queryEnncy(question.questionText, question.options, question.qtype);
                if (data.code === 1) {
                    const ans = data.data.answer || '';
                    const ai = data.data.ai ? ' (AI辅助)' : '';
                    log(`✅ enncy命中: ${ans}${ai} | 剩余${data.data.times}次`, 'info');
                    return { text: ans, source: 'enncy' };
                } else {
                    log(`❌ enncy未找到: ${data.message}`, 'warn');
                    return null;
                }
            } catch(e) {
                log('enncy错误: ' + e.message, 'error');
                return null;
            }
        };

        const tryLLM = async () => {
            if (!llmOk) return null;
            log('🤖 调用LLM...', 'info');
            try {
                const ans = await queryLLM(question.questionText, question.options, question.qtype);
                log(`✅ LLM返回: ${ans.substring(0, 100)}`, 'info');
                return { text: ans, source: 'LLM' };
            } catch(e) {
                log('LLM错误: ' + e.message, 'error');
                return null;
            }
        };

        // 按优先级执行
        if (priority === 'enncy_only') {
            const r = await tryEnncy();
            if (r) { answerText = r.text; answerSource = r.source; }
        } else if (priority === 'llm_only') {
            const r = await tryLLM();
            if (r) { answerText = r.text; answerSource = r.source; }
        } else if (priority === 'enncy_first') {
            let r = await tryEnncy();
            if (!r && llmOk) {
                log('enncy未命中，尝试LLM...', 'info');
                r = await tryLLM();
            }
            if (r) { answerText = r.text; answerSource = r.source; }
        } else if (priority === 'llm_first') {
            let r = await tryLLM();
            if (!r && enncyOk) {
                log('LLM失败，尝试enncy...', 'info');
                r = await tryEnncy();
            }
            if (r) { answerText = r.text; answerSource = r.source; }
        }

        if (!answerText) {
            log('所有答题渠道均未返回有效答案', 'error');
            setStatus('❌ 未获取到答案', 'error');
            return false;
        }

        // 显示答案预览（供手动复制）
        showAnswerInPreview(answerText, answerSource);

        // 匹配答案到选项
        let answerValues;
        if (question.qtype === 'completion' || question.qtype === 'essay') {
            answerValues = [];
        } else {
            answerValues = matchAnswerToOptions(answerText, question.options, question.qtype);
            if (answerValues.length === 0) {
                log('⚠ 无法将答案匹配到选项，将尝试直接填充文本', 'warn');
            }
        }

        // 填充答案
        const filled = await fillAnswer(doc, question, answerValues, answerText);
        if (filled) {
            answeredCount++;
            updateStats();
            setStatus(`✅ 已答题 (来源: ${answerSource})`, 'idle');

            // 自动跳下一题（仅单题模式且autoNext开启时）
            if (!skipSubmit && CFG.autoNext) {
                setTimeout(() => submitAnswer(doc), 500);
            }
            return true;
        } else {
            setStatus('⚠ 填充答案失败', 'error');
            return false;
        }
    }

    async function autoAnswerLoop() {
        if (!autoRunning) {
            updateAutoBtnState();
            return;
        }

        // 等待题目iframe加载
        const doc = findTestDoc();
        if (!doc) {
            log('⏳ 等待题目页面加载...', 'info');
            setTimeout(() => autoAnswerLoop(), 1500);
            return;
        }

        const question = extractQuestion(doc);
        if (!question || !question.questionText) {
            log('⏳ 等待题目内容加载...', 'info');
            setTimeout(() => autoAnswerLoop(), 1500);
            return;
        }

        // 避免重复处理同一题
        const currentQid = question.questionId;
        if (autoAnswerLoop._lastQid && autoAnswerLoop._lastQid === currentQid) {
            // 同一道题，等待页面变化
            setTimeout(() => autoAnswerLoop(), 800);
            return;
        }

        // 检查是否已经作答
        let alreadyAnswered = false;
        if (question.qtype === 'single' || question.qtype === 'judgement') {
            alreadyAnswered = !!doc.querySelector('input[name="answer"]:checked');
        } else if (question.qtype === 'multiple') {
            alreadyAnswered = doc.querySelectorAll('input[name="answer"]:checked').length > 0;
        } else if (question.qtype === 'completion' || question.qtype === 'essay') {
            // 检查UEditor内容是否已有文字
            try {
                const win = doc.defaultView || doc.parentWindow;
                if (win && win.UE) {
                    const editor = win.UE.getEditor('answer');
                    if (editor && editor.isReady && editor.isReady()) {
                        const content = editor.getContent();
                        alreadyAnswered = content && content.trim().length > 10;
                    }
                }
            } catch(e) {}
        }

        if (alreadyAnswered) {
            log('⏭ 当前题已作答，自动跳下一题', 'info');
            autoAnswerLoop._lastQid = currentQid;
            submitAnswer(doc);
            setTimeout(() => autoAnswerLoop(), 2500);
            return;
        }

        const typeLabel = detectQuestionTypeLabel(question.qtype);
        log(`\n━━━ [${typeLabel}] #${question.questionId} ━━━`, 'info');
        autoAnswerLoop._lastQid = currentQid;

        const success = await answerCurrentQuestion(true);  // skipSubmit: loop handles submission

        if (!autoRunning) {
            updateAutoBtnState();
            return;
        }

        // 只有填充成功才提交，避免提交空答案
        if (success) {
            const qDoc = findTestDoc();
            if (qDoc) {
                submitAnswer(qDoc);
                log('⏳ 等待下一题加载...', 'info');
            }
        } else {
            log('⚠ 答案填充失败，跳过提交', 'warn');
        }
        setTimeout(() => autoAnswerLoop(), 3000);
    }

    function startAutoAnswer() {
        autoRunning = true;
        autoAnswerLoop._lastQid = null;
        updateAutoBtnState();
        setStatus('🔄 连续答题中...', 'running');
        log('▶ 开始连续自动答题', 'info');
        autoAnswerLoop();
    }

    function stopAutoAnswer() {
        autoRunning = false;
        updateAutoBtnState();
        setStatus('🟢 已停止', 'idle');
        log('⏹ 停止自动答题', 'info');
    }

    function updateAutoBtnState() {
        if (autoAnswerBtn) autoAnswerBtn.disabled = autoRunning;
        if (stopBtn) stopBtn.disabled = !autoRunning;
    }

    // ==================== 初始化 ====================
    function init() {
        console.log('[THEOL答题] init() 调用, top=', window.top === window.self, ' url=', window.location.href);

        // 防止重复初始化
        if (document.getElementById('theol-answer-panel')) {
            console.log('[THEOL答题] 面板已存在，跳过');
            return;
        }

        // 只在顶层窗口创建UI（避免iframe内重复创建）
        if (window.top !== window.self) {
            console.log('[THEOL答题] 非顶层窗口，跳过');
            return;
        }

        // 检查是否在考试相关页面（顶层包含mainFrame，或直接是测试页）
        const testMainDoc = findTestMainDoc();
        if (!testMainDoc) {
            console.log('[THEOL答题] 未找到测试页面，稍后重试...');
            return;
        }

        console.log('[THEOL答题] 找到测试页面，创建面板');
        createUI();
        console.log('[THEOL答题] 面板已创建');
        log('✅ 脚本已启动 - enncy题库 + LLM双引擎', 'info');
        log('请先配置至少一个答题渠道', 'info');

        // 注册菜单
        GM_registerMenuCommand('⚙ 配置答题助手', () => {
            if (panelEl) {
                configSection.classList.remove('collapsed');
                panelEl.classList.remove('minimized');
            }
        });
        GM_registerMenuCommand('🎯 回答当前题', answerCurrentQuestion);
    }

    // 页面加载完成后初始化
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        setTimeout(init, 500);
    } else {
        window.addEventListener('load', () => setTimeout(init, 500));
    }

    // 轮询重试：考试页面可能是动态加载的iframe
    let retryCount = 0;
    const retryInterval = setInterval(() => {
        if (document.getElementById('theol-answer-panel')) {
            clearInterval(retryInterval);
            return;
        }
        retryCount++;
        if (retryCount > 30) { // 最多重试30次（30秒）
            clearInterval(retryInterval);
            return;
        }
        init();
    }, 1000);

})();
