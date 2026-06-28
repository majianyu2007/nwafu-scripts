// ==UserScript==
// @name         西农抢课助手 Pro
// @version      6.2.0
// @description  为西北农林科技大学本科生选课系统提供目标课程轮询、重试、提醒和验证码辅助。
// @match        https://bksxk.nwafu.edu.cn/*
// @grant        GM_notification
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @connect      *
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    // ===================== 配置区域 =====================
    const CONFIG = {
        STUDENT_CODE: '',                              // 留空=自动获取，也可手动填写
        TARGET_TCIDS: [                                // 目标教学班ID列表
            '202520262ey08001',
            '202520262ey08101',
            '202520262ey08201',
            '202520262ey08301',
            '202520262ey08401',
            '202520262ZH13901',
            '202520262ZH12201',
            '202520262ZH11901',
            '202520262ZH03701',
            '202520262ey15001',
            '202520262ZH16001',
        ],
        CHECK_INTERVAL: 3000,                          // 每轮间隔（ms）
        REQUEST_DELAY: 500,                            // 单个请求间隔（ms）
        QUERY_EVERY_N_ROUNDS: 5,                       // 每N轮查询一次课程状态
        RETRY_FULL_EVERY_N_ROUNDS: 3,                  // 已满课程每N轮重试一次
        AUTO_REFRESH: true,                            // 自动刷新防session过期
        AUTO_REFRESH_INTERVAL: 120000,                 // 刷新间隔（ms）
        STOP_ON_SUCCESS: true,                         // 抢到后移除目标
        SOUND_ALERT: true,                             // 声音提醒
        DESKTOP_NOTIFICATION: true,                    // 桌面通知
        AUTO_LOGIN_DELAY: 0,                           // 登录页自动登录延时（秒），0=不自动登录
        // 选课类型：XGXK=通识类选修课 | FANKC=方案内课程 | FAWKC=方案外课程
        //          TYKC=体育课 | CXKC=重修课程 | FXKC=辅修 | TJKC=系统推荐
        TEACHING_CLASS_TYPE: 'XGXK',
        // ===== 验证码识别配置（纯浏览器端 OCR，不依赖任何外部服务器）=====
        CAPTCHA_AUTO_SOLVE: true,                      // 登录页自动识别验证码
        CAPTCHA_TRY_LIMIT: 1,                          // 登录页只自动尝试一次
        CAPTCHA_IMAGE_SCALE: 3,                        // 图片放大倍数（提高识别率）
    };

    const DEFAULT_TARGET_TCIDS = CONFIG.TARGET_TCIDS.slice();
    const TARGET_META = {};
    DEFAULT_TARGET_TCIDS.forEach(tcid => {
        TARGET_META[tcid] = { type: CONFIG.TEACHING_CLASS_TYPE, name: '' };
    });

    function parseTargetIds(text) {
        return Array.from(new Set(String(text || '')
            .split(/[\s,，;；]+/)
            .map(s => s.trim())
            .filter(Boolean)));
    }

    function parseTargetEntries(text) {
        const entries = [];
        const seen = new Set();
        const missingTypes = [];
        String(text || '').split(/[\r\n]+/).forEach(line => {
            const cleaned = line.trim();
            if (!cleaned) return;
            const parts = cleaned.split(/[\s,，;；|]+/).map(s => s.trim()).filter(Boolean);
            if (!parts.length) return;
            const id = parts[0];
            const type = parts.find(p => /^(XGXK|FANKC|FAWKC|TYKC|CXKC|FXKC|TJKC|QXKC)$/.test(p)) || '';
            if (!type) missingTypes.push(id);
            if (!seen.has(id)) {
                seen.add(id);
                entries.push({ id, type });
            }
        });
        entries.missingTypes = missingTypes;
        return entries;
    }

    function normalizeTargetMeta(meta) {
        if (!meta || typeof meta !== 'object') return {};
        return {
            type: meta.type || meta.teachingClassType || CONFIG.TEACHING_CLASS_TYPE,
            name: meta.name || '',
            courseNumber: meta.courseNumber || '',
            teacherName: meta.teacherName || '',
        };
    }

    function setTarget(tcid, meta = {}) {
        const id = String(tcid || '').trim();
        if (!id) return false;
        if (!CONFIG.TARGET_TCIDS.includes(id)) CONFIG.TARGET_TCIDS.push(id);
        TARGET_META[id] = { ...normalizeTargetMeta(TARGET_META[id]), ...normalizeTargetMeta(meta) };
        return true;
    }

    function removeTarget(tcid) {
        const id = String(tcid || '').trim();
        const i = CONFIG.TARGET_TCIDS.indexOf(id);
        if (i > -1) CONFIG.TARGET_TCIDS.splice(i, 1);
        delete TARGET_META[id];
        delete courseCache[id];
    }

    function getTargetMeta(tcid) {
        const id = String(tcid || '').trim();
        if (!TARGET_META[id]) TARGET_META[id] = { type: CONFIG.TEACHING_CLASS_TYPE, name: '' };
        return TARGET_META[id];
    }

    function formatTargetsForTextarea() {
        return CONFIG.TARGET_TCIDS.map(tcid => `${tcid} ${getTeachingClassType(tcid)}`).join('\n');
    }

    function numOr(value, fallback, min = 0) {
        const n = Number(value);
        return Number.isFinite(n) && n >= min ? n : fallback;
    }

    function boolOr(value, fallback) {
        return typeof value === 'boolean' ? value : fallback;
    }

    function escHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function loadUserConfig() {
        try {
            const saved = JSON.parse(GM_getValue('sniperUserConfig', '{}'));
            if (Array.isArray(saved.TARGET_TCIDS)) {
                CONFIG.TARGET_TCIDS.splice(0, CONFIG.TARGET_TCIDS.length);
                Object.keys(TARGET_META).forEach(k => delete TARGET_META[k]);
                parseTargetIds(saved.TARGET_TCIDS.join('\n')).forEach(tcid => setTarget(tcid, { type: saved.TEACHING_CLASS_TYPE || CONFIG.TEACHING_CLASS_TYPE }));
            }
            if (saved.TARGET_META && typeof saved.TARGET_META === 'object') {
                Object.keys(saved.TARGET_META).forEach(tcid => {
                    if (CONFIG.TARGET_TCIDS.includes(tcid)) TARGET_META[tcid] = normalizeTargetMeta(saved.TARGET_META[tcid]);
                });
            }
            if (typeof saved.STUDENT_CODE === 'string') CONFIG.STUDENT_CODE = saved.STUDENT_CODE.trim();
            if (typeof saved.TEACHING_CLASS_TYPE === 'string' && saved.TEACHING_CLASS_TYPE) CONFIG.TEACHING_CLASS_TYPE = saved.TEACHING_CLASS_TYPE;
            CONFIG.CHECK_INTERVAL = numOr(saved.CHECK_INTERVAL, CONFIG.CHECK_INTERVAL, 500);
            CONFIG.REQUEST_DELAY = numOr(saved.REQUEST_DELAY, CONFIG.REQUEST_DELAY, 0);
            CONFIG.QUERY_EVERY_N_ROUNDS = Math.max(1, Math.floor(numOr(saved.QUERY_EVERY_N_ROUNDS, CONFIG.QUERY_EVERY_N_ROUNDS, 1)));
            CONFIG.RETRY_FULL_EVERY_N_ROUNDS = Math.max(1, Math.floor(numOr(saved.RETRY_FULL_EVERY_N_ROUNDS, CONFIG.RETRY_FULL_EVERY_N_ROUNDS, 1)));
            CONFIG.AUTO_REFRESH_INTERVAL = numOr(saved.AUTO_REFRESH_INTERVAL, CONFIG.AUTO_REFRESH_INTERVAL, 30000);
            CONFIG.AUTO_REFRESH = boolOr(saved.AUTO_REFRESH, CONFIG.AUTO_REFRESH);
            CONFIG.STOP_ON_SUCCESS = boolOr(saved.STOP_ON_SUCCESS, CONFIG.STOP_ON_SUCCESS);
            CONFIG.SOUND_ALERT = boolOr(saved.SOUND_ALERT, CONFIG.SOUND_ALERT);
            CONFIG.DESKTOP_NOTIFICATION = boolOr(saved.DESKTOP_NOTIFICATION, CONFIG.DESKTOP_NOTIFICATION);
            CONFIG.CAPTCHA_AUTO_SOLVE = boolOr(saved.CAPTCHA_AUTO_SOLVE, CONFIG.CAPTCHA_AUTO_SOLVE);
        } catch (e) {
            console.warn('[抢课助手] 读取用户配置失败，使用脚本默认配置', e);
        }
    }

    function saveUserConfig() {
        GM_setValue('sniperUserConfig', JSON.stringify({
            STUDENT_CODE: CONFIG.STUDENT_CODE,
            TARGET_TCIDS: CONFIG.TARGET_TCIDS,
            TARGET_META,
            CHECK_INTERVAL: CONFIG.CHECK_INTERVAL,
            REQUEST_DELAY: CONFIG.REQUEST_DELAY,
            QUERY_EVERY_N_ROUNDS: CONFIG.QUERY_EVERY_N_ROUNDS,
            RETRY_FULL_EVERY_N_ROUNDS: CONFIG.RETRY_FULL_EVERY_N_ROUNDS,
            AUTO_REFRESH: CONFIG.AUTO_REFRESH,
            AUTO_REFRESH_INTERVAL: CONFIG.AUTO_REFRESH_INTERVAL,
            STOP_ON_SUCCESS: CONFIG.STOP_ON_SUCCESS,
            SOUND_ALERT: CONFIG.SOUND_ALERT,
            DESKTOP_NOTIFICATION: CONFIG.DESKTOP_NOTIFICATION,
            TEACHING_CLASS_TYPE: CONFIG.TEACHING_CLASS_TYPE,
            CAPTCHA_AUTO_SOLVE: CONFIG.CAPTCHA_AUTO_SOLVE,
        }));
    }

    loadUserConfig();

    // ===================== 验证码识别模块（Tesseract.js 本地 OCR）==============
    // 完全在浏览器端运行，验证码图片不会发送到任何外部服务器

    let _tesseractWorker = null;
    let _tesseractLoading = false;
    let _tesseractReady = false;

    /** 动态加载 Tesseract.js（从 CDN，仅在需要时加载） */
    function loadTesseract() {
        if (_tesseractReady) return Promise.resolve(_tesseractWorker);
        if (_tesseractLoading) {
            // 等待已在进行中的加载
            return new Promise((resolve, reject) => {
                const check = () => {
                    if (_tesseractReady) resolve(_tesseractWorker);
                    else if (_tesseractLoading) setTimeout(check, 200);
                    else reject(new Error('Tesseract 加载失败'));
                };
                check();
            });
        }
        _tesseractLoading = true;
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            // Tesseract.js v5 CDN
            script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
            script.onload = async () => {
                try {
                    const Tesseract = window.Tesseract;
                    _tesseractWorker = await Tesseract.createWorker('eng');
                    _tesseractReady = true;
                    _tesseractLoading = false;
                    console.log('[抢课助手] Tesseract.js OCR 引擎加载完成');
                    resolve(_tesseractWorker);
                } catch (e) {
                    _tesseractLoading = false;
                    reject(e);
                }
            };
            script.onerror = () => {
                _tesseractLoading = false;
                reject(new Error('Tesseract.js CDN 加载失败，请检查网络'));
            };
            document.head.appendChild(script);
        });
    }

    /** 图像预处理：灰度化 + 二值化 + 放大，提高 OCR 识别率 */
    function preprocessCaptchaImage(imgEl, scale = 3) {
        const origW = imgEl.naturalWidth || imgEl.width;
        const origH = imgEl.naturalHeight || imgEl.height;
        if (!origW || !origH) return null;

        // 创建放大后的 canvas
        const w = origW * scale;
        const h = origH * scale;
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');

        // 先绘制到原始大小
        const tmpCanvas = document.createElement('canvas');
        tmpCanvas.width = origW;
        tmpCanvas.height = origH;
        const tmpCtx = tmpCanvas.getContext('2d');
        tmpCtx.drawImage(imgEl, 0, 0, origW, origH);
        const imageData = tmpCtx.getImageData(0, 0, origW, origH);
        const pixels = imageData.data;

        // 灰度化 + 去噪 + 放大
        const scaledData = ctx.createImageData(w, h);
        for (let sy = 0; sy < h; sy++) {
            for (let sx = 0; sx < w; sx++) {
                const ox = Math.floor(sx / scale);
                const oy = Math.floor(sy / scale);
                const idx = (oy * origW + ox) * 4;
                const didx = (sy * w + sx) * 4;

                // 灰度化
                const gray = 0.299 * pixels[idx] + 0.587 * pixels[idx + 1] + 0.114 * pixels[idx + 2];

                // Otsu 简单二值化（阈值 128），让文字变黑白
                const bin = gray > 128 ? 255 : 0;

                scaledData.data[didx] = bin;
                scaledData.data[didx + 1] = bin;
                scaledData.data[didx + 2] = bin;
                scaledData.data[didx + 3] = 255;
            }
        }
        ctx.putImageData(scaledData, 0, 0);
        return canvas;
    }

    /** 核心：使用 Tesseract.js 在浏览器本地识别验证码 */
    async function recognizeCaptchaLocal(imgEl) {
        // 预处理图像
        const processed = preprocessCaptchaImage(imgEl, CONFIG.CAPTCHA_IMAGE_SCALE);
        if (!processed) throw new Error('图像预处理失败');

        // 加载 OCR 引擎
        const worker = await loadTesseract();

        // 执行识别
        const { data } = await worker.recognize(processed, {
            // 只识别字母和数字
            tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
        });

        // 清理结果：只保留字母数字，去除空格
        const text = (data.text || '').replace(/[^a-zA-Z0-9]/g, '').trim();
        console.log('[抢课助手] OCR 识别原始结果:', data.text, '→ 清理后:', text);
        return text;
    }

    /** 获取验证码图片元素 */
    function findCaptchaImage() {
        const vcodeImg = document.getElementById('vcodeImg');
        if (vcodeImg && (vcodeImg.tagName === 'IMG' || vcodeImg.tagName === 'CANVAS')) return vcodeImg;
        const selectors = [
            'img[src*="vcode"]', 'img[src*="captcha"]', 'img[src*="verify"]',
            'img[id*="vcode"]', 'img[id*="captcha"]', 'img[id*="verify"]',
            'img[class*="vcode"]', 'img[class*="captcha"]',
            'canvas[id*="captcha"]',
        ];
        for (const sel of selectors) {
            try { const el = document.querySelector(sel); if (el) return el; } catch (_) { }
        }
        return null;
    }

    /** 获取验证码输入框 */
    function findCaptchaInput() {
        return document.getElementById('verifyCode')
            || document.querySelector('input[placeholder*="验证码"]')
            || document.querySelector('input[name*="verify"]');
    }

    /** 获取换一张按钮 */
    function findCaptchaRefreshBtn() {
        return document.getElementById('refresher_vcode')
            || document.querySelector('#vcodeImg')?.parentElement?.querySelector('a,button,span')
            || document.querySelector('a[onclick*="vcode"],span[onclick*="vcode"]');
    }

    /** 填入输入框并触发所有必要的 DOM 事件 */
    function fillCaptchaInput(inputEl, value) {
        if (!inputEl || !value) return;
        const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        if (nativeSetter) nativeSetter.call(inputEl, value);
        else inputEl.value = value;
        inputEl.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
        inputEl.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
        inputEl.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Unidentified' }));
        console.log('[抢课助手] ✅ 验证码已填入:', value);
    }

    /** 点击换一张 */
    function clickCaptchaRefresh() {
        const btn = findCaptchaRefreshBtn();
        const img = findCaptchaImage();
        if (btn) btn.click();
        else if (img) img.click();
    }

    /** 单次尝试识别并填入验证码 */
    async function solveCaptchaOnce() {
        const img = findCaptchaImage();
        if (!img) return { ok: false, msg: '未找到验证码图片' };
        const input = findCaptchaInput();
        if (!input) return { ok: false, msg: '未找到验证码输入框' };
        try {
            const value = await recognizeCaptchaLocal(img);
            if (!value || value.length < 1) return { ok: false, msg: '识别结果为空' };
            fillCaptchaInput(input, value);
            return { ok: true, value };
        } catch (e) {
            return { ok: false, msg: e.message };
        }
    }

    /** 多次尝试（刷新验证码 + 重试） */
    async function solveCaptchaWithRetry(maxRetries = 3) {
        for (let i = 0; i < maxRetries; i++) {
            if (i > 0) {
                await sleep(300);
                clickCaptchaRefresh();
                await sleep(500);
            }
            const result = await solveCaptchaOnce();
            if (result.ok) return result;
            console.log(`[抢课助手] 验证码第${i + 1}次识别失败: ${result.msg}`);
        }
        return { ok: false, msg: `已尝试 ${maxRetries} 次均失败` };
    }

    // ===================== 被动捕获认证参数 =====================
    let capturedToken = '';
    let capturedBatchCode = '';
    let capturedStudentCode = '';

    const origOpen = XMLHttpRequest.prototype.open;
    const origSetHeader = XMLHttpRequest.prototype.setRequestHeader;
    const origSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
        this._capUrl = url;
        return origOpen.call(this, method, url, ...rest);
    };
    XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
        if (name.toLowerCase() === 'token' && value) capturedToken = value;
        return origSetHeader.call(this, name, value);
    };
    XMLHttpRequest.prototype.send = function (body) {
        if (this._isOurs) return origSend.call(this, body); // 跳过我们自己发的请求
        try {
            if (this._capUrl?.includes('publicCourse.do') && body) {
                const json = JSON.parse(decodeURIComponent(body.replace('querySetting=', '')));
                if (json.data?.electiveBatchCode) {
                    capturedBatchCode = json.data.electiveBatchCode;
                    console.log('[抢课助手] 捕获 electiveBatchCode:', capturedBatchCode);
                }
                if (json.data?.studentCode && !capturedStudentCode) {
                    capturedStudentCode = json.data.studentCode;
                    console.log('[抢课助手] 捕获 studentCode:', capturedStudentCode);
                }
            }
            if (this._capUrl?.includes('electiveBatchCode=')) {
                const m = this._capUrl.match(/electiveBatchCode=([a-f0-9]+)/);
                if (m) capturedBatchCode = m[1];
            }
            if (this._capUrl?.includes('studentCode=') && !capturedStudentCode) {
                const m = this._capUrl.match(/studentCode=(\d+)/);
                if (m) {
                    capturedStudentCode = m[1];
                    console.log('[抢课助手] 捕获 studentCode:', capturedStudentCode);
                }
            }
        } catch (_) { }
        return origSend.call(this, body);
    };
    console.log('[抢课助手] 参数捕获器已安装');

    // ===================== 状态 =====================
    let isRunning = false;
    let sessionExpired = false;
    let checkTimer = null;
    let refreshTimer = null;
    let attemptCount = 0;
    let successCount = 0;
    let lastCheckTime = null;
    let logHistory = [];      // 日志历史
    const courseCache = {};

    // ===================== 工具函数 =====================
    const sleep = ms => new Promise(r => setTimeout(r, ms));

    const $ = id => document.getElementById(id);

    function readSessionJson(key) {
        try {
            const raw = sessionStorage.getItem(key);
            return raw ? JSON.parse(raw) : null;
        } catch (_) {
            return null;
        }
    }

    function readStudentInfo() {
        return readSessionJson('studentInfo') || {};
    }

    function readCurrentBatch() {
        const studentInfo = readStudentInfo();
        return studentInfo.electiveBatch || readSessionJson('currentBatch') || {};
    }

    function readCurrentCampus() {
        const studentInfo = readStudentInfo();
        const campus = readSessionJson('currentCampus') || {};
        return {
            code: campus.code || studentInfo.campus || '1',
            name: campus.name || studentInfo.campusName || '',
        };
    }

    function getToken() {
        if (capturedToken) return capturedToken;
        const stored = sessionStorage.getItem('token');
        if (stored) {
            capturedToken = stored;
            return stored;
        }
        const m = location.search.match(/token=([a-f0-9-]+)/);
        if (m) {
            capturedToken = m[1];
            return capturedToken;
        }
        return '';
    }

    function getStudentCode() {
        const studentInfo = readStudentInfo();
        const code = CONFIG.STUDENT_CODE || capturedStudentCode || studentInfo.code || studentInfo.number || '';
        if (code && !capturedStudentCode) capturedStudentCode = code;
        return code;
    }

    function getBatchCode() {
        if (capturedBatchCode) return capturedBatchCode;
        const batch = readCurrentBatch();
        const code = batch.code || '';
        if (code) capturedBatchCode = code;
        return code;
    }

    function getTeachingClassType(tcid) {
        if (tcid) return getTargetMeta(tcid).type || CONFIG.TEACHING_CLASS_TYPE || 'XGXK';
        return CONFIG.TEACHING_CLASS_TYPE || sessionStorage.getItem('teachingClassType') || 'XGXK';
    }

    function getTargetTypeSummary() {
        const types = Array.from(new Set(CONFIG.TARGET_TCIDS.map(tcid => getTeachingClassType(tcid)).filter(Boolean)));
        if (!types.length) return '0 门';
        if (types.length <= 3) return types.join('+');
        return `${types.slice(0, 3).join('+')}等${types.length}类`;
    }

    function getCampusCode() {
        return readCurrentCampus().code || '1';
    }

    function getCourseName(tcid) {
        const s = courseCache[tcid];
        return s ? `${s.name}[${s.courseIndex}]` : tcid;
    }

    // 从 tcid 提取课程编号前缀用于搜索
    // 用短前缀（2字母+2数字）合并查询，减少API调用次数
    // 如 202520262ZH06401 → ZH06，202520262ey08001 → ey08
    function extractPrefix(tcid) {
        const m = tcid.match(/\d{9}([a-zA-Z]+\d{2})/);
        return m ? m[1] : null;
    }

    // ===================== API =====================
    function apiPost(url, body, label) {
        const token = getToken();
        const name = label || url.split('/').pop();
        const t0 = Date.now();

        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr._isOurs = true; // 标记为我们自己的请求，拦截器会跳过
            xhr.open('POST', url, true);
            xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded; charset=UTF-8');
            xhr.setRequestHeader('Accept', 'application/json, text/javascript, */*; q=0.01');
            xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
            if (token) xhr.setRequestHeader('token', token);
            xhr.timeout = 10000;

            xhr.onload = () => {
                const ms = Date.now() - t0;
                const raw = xhr.responseText;

                // Session 过期检测
                if (raw.startsWith('<')) {
                    console.warn(`[抢课助手] ⚠️ ${name}: 返回HTML，Session过期 (${ms}ms)`);
                    handleSessionExpired();
                    return reject(new Error('Session过期'));
                }
                try {
                    const data = JSON.parse(raw);
                    console.log(`[抢课助手] ✅ ${name} → code:${data.code} msg:"${data.msg || ''}" (${ms}ms)`);
                    resolve(data);
                } catch (_) {
                    console.error(`[抢课助手] ❌ ${name}: JSON解析失败 (${ms}ms)`, raw.substring(0, 200));
                    reject(new Error('JSON解析失败'));
                }
            };
            xhr.onerror = () => { console.error(`[抢课助手] ❌ ${name}: 网络错误`); reject(new Error('网络错误')); };
            xhr.ontimeout = () => { console.error(`[抢课助手] ❌ ${name}: 超时`); reject(new Error('请求超时')); };
            xhr.send(body);
        });
    }

    function handleSessionExpired() {
        sessionExpired = true;
        log('⚠️ Session已过期，即将刷新页面...', 'error');
        saveState(true);
        setTimeout(() => location.reload(), 1000);
    }

    function saveState(running) {
        GM_setValue('sniperRunning', running);
        GM_setValue('sniperTimestamp', Date.now());
    }

    function persistData() {
        GM_setValue('sniperAttempts', attemptCount);
        GM_setValue('sniperSuccess', successCount);
        GM_setValue('sniperCache', JSON.stringify(courseCache));
        GM_setValue('sniperLogs', JSON.stringify(logHistory.slice(0, 30)));
    }

    function restoreData() {
        attemptCount = GM_getValue('sniperAttempts', 0);
        successCount = GM_getValue('sniperSuccess', 0);
        try {
            const cached = JSON.parse(GM_getValue('sniperCache', '{}'));
            Object.assign(courseCache, cached);
        } catch (_) { }
        try {
            logHistory = JSON.parse(GM_getValue('sniperLogs', '[]'));
        } catch (_) { logHistory = []; }
    }

    // ===================== 业务：查询课程状态 =====================
    async function queryTargetCourses() {
        const batchCode = getBatchCode();
        if (!batchCode) {
            log('等待获取选课批次码...', 'warning');
            return;
        }

        // 按课程类型分组查询。页面添加的目标会自带类型；手动粘贴目标必须显式写类型。
        const groups = {};
        for (const tcid of CONFIG.TARGET_TCIDS) {
            const p = extractPrefix(tcid);
            const type = getTeachingClassType(tcid);
            if (!groups[type]) groups[type] = new Set();
            if (p) groups[type].add(p);
            else console.warn(`[抢课助手] 无法从 tcid 提取前缀: ${tcid}`);
        }

        for (const [type, prefixes] of Object.entries(groups)) {
            for (const prefix of prefixes) {
                if (sessionExpired) break;
                try {
                    const qs = JSON.stringify({
                        data: {
                            studentCode: getStudentCode(),
                            campus: getCampusCode(),
                            electiveBatchCode: batchCode,
                            isMajor: '1',
                            teachingClassType: type,
                            checkConflict: '2',
                            checkCapacity: '2',
                            queryContent: prefix,
                        },
                        pageSize: '100',
                        pageNumber: '0',
                        order: '',
                    });
                    const data = await apiPost(
                        '/xsxkapp/sys/xsxkapp/elective/publicCourse.do',
                        'querySetting=' + encodeURIComponent(qs),
                        `查询[${type}/${prefix}]`
                    );
                    if (data.dataList) {
                        for (const c of data.dataList) {
                            if (CONFIG.TARGET_TCIDS.includes(c.teachingClassID)) {
                                TARGET_META[c.teachingClassID] = { ...getTargetMeta(c.teachingClassID), type };
                                courseCache[c.teachingClassID] = {
                                    name: c.courseName,
                                    courseIndex: c.courseIndex,
                                    isFull: c.isFull,
                                    numberOfSelected: c.numberOfSelected,
                                    classCapacity: c.classCapacity,
                                    isConflict: c.isConflict,
                                    teacherName: c.teacherName,
                                };
                            }
                        }
                    }
                } catch (e) {
                    log(`查询[${type}/${prefix}]失败: ${e.message}`, 'error');
                }
            }
        }
    }

    // ===================== 业务：选课 =====================
    async function trySelect(tcid) {
        const batchCode = getBatchCode();
        if (!batchCode) return { ok: false, msg: '无批次码' };

        const studentCode = getStudentCode();
        if (!studentCode) return { ok: false, msg: '未获取到学号' };

        const body = JSON.stringify({
            data: {
                operationType: '1',
                studentCode: studentCode,
                electiveBatchCode: batchCode,
                teachingClassId: tcid,
                isMajor: '1',
                campus: getCampusCode(),
                teachingClassType: getTeachingClassType(tcid),
                chooseVolunteer: '1',
            },
        });

        console.log(`[抢课助手] 📤 volunteer.do 请求: studentCode=${studentCode} tcid=${tcid} token=${getToken().substring(0, 8)}...`);

        try {
            const data = await apiPost(
                '/xsxkapp/sys/xsxkapp/elective/volunteer.do',
                'addParam=' + encodeURIComponent(body),
                `选课[${getCourseName(tcid)}]`
            );
            return { ok: data.code === '1', msg: data.msg || (data.code === '1' ? '选课成功' : '选课失败') };
        } catch (e) {
            return { ok: false, msg: e.message };
        }
    }

    // ===================== 核心循环 =====================
    async function runRound() {
        if (!isRunning || sessionExpired) return;

        attemptCount++;
        lastCheckTime = new Date();
        updateStatus();

        console.log(`[抢课助手] ══════ 第 ${attemptCount} 轮 ══════`);

        // 定期查询课程状态
        if (attemptCount === 1 || attemptCount % CONFIG.QUERY_EVERY_N_ROUNDS === 0) {
            log(`📊 查询课程状态 (第${attemptCount}轮)`, 'info');
            await queryTargetCourses();
            updateTargetsList();
        }

        // 逐个尝试选课
        let tried = 0, skipped = 0;
        for (const tcid of [...CONFIG.TARGET_TCIDS]) {
            if (!isRunning || sessionExpired) break;

            const cached = courseCache[tcid];
            const name = getCourseName(tcid);

            // 已知已满：降频重试
            if (cached?.isFull === '1' && attemptCount % CONFIG.RETRY_FULL_EVERY_N_ROUNDS !== 0) {
                skipped++;
                continue;
            }

            if (tried > 0) await sleep(CONFIG.REQUEST_DELAY);
            tried++;

            const { ok, msg } = await trySelect(tcid);

            if (ok) {
                log(`✅ 选课成功！: ${name}`, 'success');
                onSuccess(tcid, name);
            } else if (msg.includes('课容量')) {
                log(`🔴 ${name}: 已满`, 'info');
                if (cached) cached.isFull = '1';
            } else if (/已选|已经选|已选过/.test(msg)) {
                log(`✅ ${name}: 已在选课结果中`, 'success');
                onSuccess(tcid, name);
            } else {
                log(`⚠️ ${name}: ${msg}`, 'warning');
            }
        }

        if (skipped) console.log(`[抢课助手] 本轮: 尝试${tried}门, 跳过${skipped}门已满`);
        updateTargetsList();
        persistData();

        // 安排下一轮
        if (isRunning && !sessionExpired) {
            checkTimer = setTimeout(runRound, CONFIG.CHECK_INTERVAL);
        }
    }

    function onSuccess(tcid, name) {
        successCount++;
        updateStatus();
        playSuccessSound();
        showNotification('🎉 抢课成功！', `已成功选中: ${name}`);

        if (CONFIG.STOP_ON_SUCCESS) {
            if (CONFIG.TARGET_TCIDS.includes(tcid)) {
                removeTarget(tcid);
                saveUserConfig();
                syncCourseAddButtonStates();
                log(`已移除: ${name}，剩余 ${CONFIG.TARGET_TCIDS.length} 门`, 'info');
            }
            if (CONFIG.TARGET_TCIDS.length === 0) {
                log('🎉 所有目标课程已抢完！', 'success');
                stop();
            }
        }
    }

    // ===================== 控制 =====================
    function start() {
        if (!CONFIG.TARGET_TCIDS.length) {
            log('❌ 目标列表为空，请先点“设置”添加教学班 ID', 'error');
            openConfigDialog();
            return;
        }
        if (!getToken()) {
            log('❌ 未获取到Token', 'error');
            return;
        }
        if (!getBatchCode()) log('⚠️ 未获取到选课批次码，等待捕获...', 'warning');

        isRunning = true;
        sessionExpired = false;
        saveState(true); // 保存运行状态，手动刷新后也能自动恢复
        updateStatus();
        log('🚀 已启动！', 'success');
        log(`📋 目标: ${CONFIG.TARGET_TCIDS.length}门 | 间隔: ${CONFIG.CHECK_INTERVAL}ms | 请求延时: ${CONFIG.REQUEST_DELAY}ms`, 'info');

        checkTimer = setTimeout(runRound, 100);

        if (CONFIG.AUTO_REFRESH) {
            refreshTimer = setInterval(() => {
                log('🔄 自动刷新...', 'info');
                saveState(true);
                location.reload();
            }, CONFIG.AUTO_REFRESH_INTERVAL);
        }

        const btn = $('sniper-toggle');
        if (btn) { btn.textContent = '停止抢课'; btn.className = 'btn btn-stop'; }
    }

    function stop() {
        isRunning = false;
        if (checkTimer) { clearTimeout(checkTimer); checkTimer = null; }
        if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
        saveState(false);
        updateStatus();
        log('⏸️ 已停止', 'info');
        const btn = $('sniper-toggle');
        if (btn) { btn.textContent = '开始抢课'; btn.className = 'btn btn-start'; }
    }

    // ===================== UI =====================
    function createPanel() {
        const panel = document.createElement('div');
        panel.id = 'sniper-panel';
        panel.innerHTML = `
            <style>
                #sniper-panel {
                    position: fixed; top: 12px; right: 12px; width: 236px;
                    background: #ffffff; border: 1px solid #e0e0e0;
                    border-radius: 18px; padding: 10px; z-index: 999999;
                    font-family: "SF Pro Text", system-ui, -apple-system, "Microsoft YaHei", sans-serif;
                    color: #1d1d1f; user-select: none;
                }
                #sniper-panel h3 { margin: 0 28px 8px 0; font-size: 15px; line-height: 1.24; letter-spacing: -0.224px; font-weight: 600; display: flex; align-items: center; gap: 6px; cursor: move; color: #1d1d1f; white-space: nowrap; }
                #sniper-panel .st { background: #f5f5f7; border: 1px solid #e0e0e0; padding: 8px; border-radius: 11px; margin-bottom: 6px; font-size: 12px; }
                #sniper-panel .sr { display: flex; justify-content: space-between; gap: 10px; margin: 2px 0; }
                #sniper-panel .sr-quiet { color: #7a7a7a; }
                #sniper-panel .sv { font-weight: 600; color: #1d1d1f; text-align: right; }
                #sniper-panel .btn { width: 100%; min-height: 30px; padding: 6px 10px; border: 1px solid #0066cc; border-radius: 9999px; cursor: pointer; font-size: 13px; line-height: 1.29; letter-spacing: -0.224px; font-weight: 400; margin-top: 6px; background: #ffffff; color: #0066cc; }
                #sniper-panel .btn:active { transform: scale(.95); }
                #sniper-panel .btn-start { background: #0066cc; border-color: #0066cc; color: #ffffff; }
                #sniper-panel .btn-stop { background: #1d1d1f; border-color: #1d1d1f; color: #ffffff; }
                #sniper-panel .btn-refresh { background: #ffffff; color: #0066cc; }
                #sniper-panel .tgt { background: #fafafc; border: 1px solid #e0e0e0; border-radius: 11px; padding: 7px; margin-bottom: 6px; max-height: 72px; overflow-y: auto; font-size: 12px; display: none; }
                #sniper-panel .tgt.has-targets { display: block; }
                #sniper-panel .ti { display: flex; justify-content: space-between; gap: 8px; align-items: center; padding: 4px 0; border-bottom: 1px solid #f0f0f0; }
                #sniper-panel .ti:last-child { border-bottom: none; }
                #sniper-panel .ti > span:first-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
                #sniper-panel .ts { padding: 1px 5px; border-radius: 9999px; font-size: 10px; white-space: nowrap; color: #fff; }
                .ts-ok { background: #0066cc; }  .ts-full { background: #7a7a7a; }
                .ts-cf { background: #333333; }  .ts-wait { background: #d2d2d7; color: #1d1d1f !important; }
                #sniper-panel details { margin-top: 8px; }
                #sniper-panel summary { cursor: pointer; color: #0066cc; font-size: 12px; line-height: 1.3; list-style: none; }
                #sniper-panel summary::-webkit-details-marker { display: none; }
                #sniper-panel .lg { max-height: 88px; overflow-y: auto; background: #fafafc; border: 1px solid #e0e0e0; border-radius: 11px; padding: 6px; margin-top: 6px; font-size: 11px; font-family: ui-monospace, SFMono-Regular, Consolas, Monaco, monospace; }
                #sniper-panel .le { margin: 2px 0; padding: 2px 0; border-bottom: 1px solid #f0f0f0; word-break: break-all; }
                .log-success { color: #0066cc; }  .log-error { color: #1d1d1f; }
                .log-info { color: #333333; }     .log-warning { color: #7a7a7a; }
                #sniper-panel .mb { position: absolute; top: 8px; right: 8px; background: #f5f5f7; border: 1px solid #e0e0e0; color: #1d1d1f; width: 22px; height: 22px; border-radius: 9999px; cursor: pointer; font-size: 13px; line-height: 18px; }
                #sniper-panel.min .pc { display: none; }
                #sniper-panel.min { width: auto; padding: 8px 38px 8px 10px; }
                #sniper-panel.min h3 { margin-bottom: 0; }
                #sniper-panel .btn-row { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
                #sniper-panel .btn-row .btn { margin-top: 6px; padding: 6px 8px; font-size: 12px; }
                #sniper-config-mask { position: fixed; inset: 0; z-index: 1000000; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; font-family: "SF Pro Text", system-ui, -apple-system, "Microsoft YaHei", sans-serif; }
                #sniper-config { width: min(720px, calc(100vw - 32px)); max-height: calc(100vh - 44px); overflow: auto; background: #ffffff; color: #1d1d1f; border: 1px solid #e0e0e0; border-radius: 18px; padding: 24px; }
                #sniper-config h3 { margin: 0 0 17px; font-size: 21px; line-height: 1.19; letter-spacing: 0.231px; font-weight: 600; cursor: default; color: #1d1d1f; }
                #sniper-config label { display: block; font-size: 14px; line-height: 1.29; letter-spacing: -0.224px; font-weight: 600; color: #333333; margin: 12px 0 6px; }
                #sniper-config input, #sniper-config textarea, #sniper-config select { width: 100%; box-sizing: border-box; border: 1px solid #e0e0e0; border-radius: 11px; padding: 8px 12px; font-size: 14px; font-family: inherit; color: #1d1d1f; background: #ffffff; }
                #sniper-config textarea { min-height: 150px; resize: vertical; font-family: Consolas, Monaco, monospace; }
                #sniper-config .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
                #sniper-config .checks { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px 12px; margin-top: 10px; }
                #sniper-config .checks label { display: flex; gap: 8px; align-items: center; font-weight: 500; margin: 0; }
                #sniper-config .checks input { width: auto; }
                #sniper-config .hint { font-size: 12px; color: #7a7a7a; margin-top: 6px; line-height: 1.45; }
                #sniper-config .actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 16px; }
                #sniper-config .actions button { border: 1px solid #0066cc; border-radius: 9999px; padding: 8px 15px; cursor: pointer; font-size: 14px; font-weight: 400; color: #0066cc; background: #ffffff; }
                #sniper-config .actions button:active { transform: scale(.95); }
                #sniper-config .primary { background: #0066cc; color: #fff; }
                #sniper-config .secondary { background: #fff; color: #0066cc; }
                #sniper-config .danger { background: #fff; color: #7a7a7a; border-color: #e0e0e0; }
                .sniper-add-course {
                    margin-left: 8px !important; padding: 2px 8px !important; border: 1px solid #0066cc !important;
                    border-radius: 9999px !important; background: #ffffff !important; color: #0066cc !important;
                    cursor: pointer !important; font-size: 12px !important; line-height: 1.45 !important;
                    vertical-align: middle !important; white-space: nowrap !important;
                }
                .sniper-add-course.added { background: #f5f5f7 !important; border-color: #e0e0e0 !important; color: #7a7a7a !important; }
                .sniper-remove-target {
                    margin-left: 4px; border: 1px solid #cbd5e1; border-radius: 4px; background: #fff;
                    color: #475569; cursor: pointer; font-size: 11px; padding: 1px 4px;
                }
                @media (max-width: 640px) {
                    #sniper-config .grid, #sniper-config .checks { grid-template-columns: 1fr; }
                }
                .pulse { animation: pulse 1.5s ease-in-out infinite; }
                @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.6} }
            </style>
            <button class="mb" id="sniper-min">−</button>
            <h3>西农抢课助手 v6.2</h3>
            <div class="pc">
                <div class="st">
                    <div class="sr"><span>状态</span><span class="sv" id="s-state">未启动</span></div>
                    <div class="sr"><span>轮次 / 成功</span><span class="sv"><span id="s-round">0</span> / <span id="s-ok">0</span></span></div>
                    <div class="sr sr-quiet"><span>目标 / 间隔</span><span class="sv" id="s-mode">-</span></div>
                </div>
                <div class="tgt" id="s-targets"></div>
                <button class="btn btn-start" id="sniper-toggle">开始抢课</button>
                <div class="btn-row">
                    <button class="btn btn-refresh" id="sniper-config-btn">设置</button>
                    <button class="btn btn-refresh" id="sniper-refresh">刷新</button>
                </div>
                <button class="btn btn-refresh" id="sniper-clear">清除数据</button>
                <details>
                    <summary>查看日志</summary>
                    <div class="lg" id="s-log"></div>
                </details>
            </div>
        `;
        document.body.appendChild(panel);

        $('sniper-toggle').onclick = () => isRunning ? stop() : start();
        $('sniper-config-btn').onclick = openConfigDialog;
        $('s-targets').addEventListener('click', e => {
            const btn = e.target.closest('.sniper-remove-target');
            if (!btn) return;
            removeTarget(btn.dataset.tcid);
            saveUserConfig();
            updateTargetsList();
            updateStatus();
            syncCourseAddButtonStates();
            log(`➖ 已移除目标: ${btn.dataset.tcid}`, 'info');
        });
        $('sniper-refresh').onclick = () => location.reload();
        $('sniper-clear').onclick = () => {
            if (!confirm('确认清除所有缓存数据（轮次、日志、课程缓存）？')) return;
            GM_setValue('sniperAttempts', 0);
            GM_setValue('sniperSuccess', 0);
            GM_setValue('sniperCache', '{}');
            GM_setValue('sniperLogs', '[]');
            GM_setValue('sniperRunning', false);
            log('🗑️ 数据已清除，刷新页面...', 'info');
            setTimeout(() => location.reload(), 500);
        };
        $('sniper-min').onclick = () => {
            panel.classList.toggle('min');
            $('sniper-min').textContent = panel.classList.contains('min') ? '+' : '−';
        };

        // 拖拽 + 保存位置
        let dx, dy;
        panel.querySelector('h3').onmousedown = e => {
            e.preventDefault();
            dx = e.clientX - panel.offsetLeft;
            dy = e.clientY - panel.offsetTop;
            const move = e => { panel.style.left = (e.clientX - dx) + 'px'; panel.style.top = (e.clientY - dy) + 'px'; panel.style.right = 'auto'; };
            const up = () => {
                document.removeEventListener('mousemove', move);
                document.removeEventListener('mouseup', up);
                GM_setValue('panelPos', JSON.stringify({ left: panel.style.left, top: panel.style.top }));
            };
            document.addEventListener('mousemove', move);
            document.addEventListener('mouseup', up);
        };
    }

    function detectTypeFromElement(el) {
        const section = el.closest('#cvRecommendCourse,#cvProgramCourse,#cvUnProgramCourse,#cvPublicCourse,#cvRetakeCourse,#cvSportCourse,#cvMinorCourse,#cvSchoolCourse');
        const sectionMap = {
            cvRecommendCourse: 'TJKC',
            cvProgramCourse: 'FANKC',
            cvUnProgramCourse: 'FAWKC',
            cvPublicCourse: 'XGXK',
            cvRetakeCourse: 'CXKC',
            cvSportCourse: 'TYKC',
            cvMinorCourse: 'FXKC',
            cvSchoolCourse: 'QXKC',
        };
        if (section && sectionMap[section.id]) return sectionMap[section.id];

        const active = document.querySelector('li.cv-active a[teachingClassType], a.cv-active[teachingClassType]');
        return active?.getAttribute('teachingClassType') || sessionStorage.getItem('teachingClassType') || CONFIG.TEACHING_CLASS_TYPE || 'XGXK';
    }

    function inferCourseInfoFromButton(btn) {
        const card = btn.closest('.cv-course-card,.cv-row,.cv-block,.cv-item,tr') || btn.parentElement;
        const text = (card?.innerText || '').replace(/\s+/g, ' ').trim();
        const title = card?.querySelector('h5,.cv-course,.cv-title-col,.cv-school-title-col')?.innerText?.replace(/\s+/g, ' ').trim() || '';
        return {
            type: detectTypeFromElement(btn),
            name: title || text.slice(0, 60),
            teacherName: card?.querySelector('.cv-teacher-col,.cv-info h5')?.innerText?.trim() || '',
        };
    }

    function isCourseActionButton(btn) {
        const text = (btn.innerText || btn.textContent || '').replace(/\s+/g, '');
        if (/教学班详情|教材信息|课程详情|详情/.test(text)) return false;
        return /加入|退选|已选|已满|冲突|选择/.test(text) || btn.classList.contains('cv-btn-chose');
    }

    let courseButtonInstallTimer = null;
    let courseButtonsInstalling = false;

    function scheduleInstallCourseAddButtons(delay = 160) {
        if (courseButtonInstallTimer) return;
        courseButtonInstallTimer = setTimeout(() => {
            courseButtonInstallTimer = null;
            installCourseAddButtons();
        }, delay);
    }

    function isRelevantCourseMutation(mutation) {
        return Array.from(mutation.addedNodes || []).some(node => {
            if (node.nodeType !== 1) return false;
            if (node.id === 'sniper-panel' || node.id === 'sniper-config-mask') return false;
            if (node.classList?.contains('sniper-add-course')) return false;
            if (node.closest?.('#sniper-panel,#sniper-config-mask')) return false;
            return node.matches?.('button[tcid],button[tcId],.cv-course-card,.cv-row,.cv-block,.cv-item,tr')
                || node.querySelector?.('button[tcid],button[tcId],.cv-course-card,.cv-row,.cv-block,.cv-item,tr');
        });
    }

    function installCourseAddButtons() {
        if (courseButtonsInstalling) return;
        if (!location.href.includes('curriculavariable.do') && !location.href.includes('grablessons.do')) return;
        courseButtonsInstalling = true;

        const syncButtonState = btn => {
            if (!isCourseActionButton(btn)) return;
            const tcid = btn.getAttribute('tcId') || btn.getAttribute('tcid');
            const card = btn.closest('.cv-course-card,.cv-row,.cv-block,.cv-item,tr') || btn.parentElement;
            if (!tcid || card?.querySelector(`.sniper-add-course[data-tcid="${tcid}"]`)) return;
            const add = document.createElement('button');
            add.type = 'button';
            add.className = `sniper-add-course ${CONFIG.TARGET_TCIDS.includes(tcid) ? 'added' : ''}`;
            add.dataset.tcid = tcid;
            add.textContent = CONFIG.TARGET_TCIDS.includes(tcid) ? '已目标' : '+目标';
            add.title = '加入抢课助手目标列表';
            const title = card?.querySelector('h5,.cv-course,.cv-title-col,.cv-school-title-col');
            if (title) title.insertAdjacentElement('beforeend', add);
            else btn.insertAdjacentElement('afterend', add);
        };

        try {
            document.querySelectorAll('button[tcId],button[tcid],.cv-btn-chose[tcId],.cv-btn-chose[tcid]')
                .forEach(syncButtonState);
            syncCourseAddButtonStates();
        } finally {
            courseButtonsInstalling = false;
        }
    }

    function syncCourseAddButtonStates() {
        document.querySelectorAll('.sniper-add-course[data-tcid]').forEach(btn => {
            const added = CONFIG.TARGET_TCIDS.includes(btn.dataset.tcid);
            btn.classList.toggle('added', added);
            btn.textContent = added ? '已目标' : '+目标';
            btn.title = added ? '已在抢课助手目标列表' : '加入抢课助手目标列表';
        });
    }

    function bindCourseAddButtons() {
        document.body.addEventListener('click', e => {
            const add = e.target.closest('.sniper-add-course');
            if (!add) return;
            e.preventDefault();
            e.stopPropagation();

            const tcid = add.dataset.tcid;
            const card = add.closest('.cv-course-card,.cv-row,.cv-block,.cv-item,tr') || add.parentElement;
            const sourceBtn = Array.from(card?.querySelectorAll(`[tcId="${tcid}"],[tcid="${tcid}"]`) || []).find(isCourseActionButton);
            const meta = sourceBtn ? inferCourseInfoFromButton(sourceBtn) : { type: CONFIG.TEACHING_CLASS_TYPE };
            setTarget(tcid, meta);
            saveUserConfig();
            updateTargetsList();
            updateStatus();
            syncCourseAddButtonStates();
            log(`已加入目标: ${meta.name || tcid} [${meta.type || getTeachingClassType(tcid)}]`, 'success');
        }, true);

        const observer = new MutationObserver(mutations => {
            if (courseButtonsInstalling) return;
            if (mutations.some(isRelevantCourseMutation)) scheduleInstallCourseAddButtons();
        });
        observer.observe(document.body, { childList: true, subtree: true });
        scheduleInstallCourseAddButtons(500);
        setTimeout(() => scheduleInstallCourseAddButtons(0), 1500);
    }

    function openConfigDialog() {
        const old = $('sniper-config-mask');
        if (old) old.remove();

        const mask = document.createElement('div');
        mask.id = 'sniper-config-mask';
        mask.innerHTML = `
            <div id="sniper-config">
                <h3>抢课设置</h3>
                <label for="cfg-targets">目标教学班 ID</label>
                <textarea id="cfg-targets" spellcheck="false" placeholder="一行一个，例如：202520262xxxx01 TYKC">${formatTargetsForTextarea()}</textarea>
                <div class="hint">推荐在课程旁点「+目标」，脚本会自动记录该课类型。手动输入必须每行填写：教学班ID 类型，例如 202520262xxxx01 TYKC。</div>

                <div class="grid">
                    <div>
                        <label for="cfg-student">学号</label>
                        <input id="cfg-student" value="${CONFIG.STUDENT_CODE || ''}" placeholder="留空自动获取">
                    </div>
                    <div>
                        <label for="cfg-check">每轮间隔 ms</label>
                        <input id="cfg-check" type="number" min="500" step="100" value="${CONFIG.CHECK_INTERVAL}">
                    </div>
                    <div>
                        <label for="cfg-delay">单请求间隔 ms</label>
                        <input id="cfg-delay" type="number" min="0" step="50" value="${CONFIG.REQUEST_DELAY}">
                    </div>
                    <div>
                        <label for="cfg-query">每 N 轮查状态</label>
                        <input id="cfg-query" type="number" min="1" step="1" value="${CONFIG.QUERY_EVERY_N_ROUNDS}">
                    </div>
                    <div>
                        <label for="cfg-full">已满每 N 轮重试</label>
                        <input id="cfg-full" type="number" min="1" step="1" value="${CONFIG.RETRY_FULL_EVERY_N_ROUNDS}">
                    </div>
                    <div>
                        <label for="cfg-refresh-interval">自动刷新间隔 ms</label>
                        <input id="cfg-refresh-interval" type="number" min="30000" step="10000" value="${CONFIG.AUTO_REFRESH_INTERVAL}">
                    </div>
                </div>

                <div class="checks">
                    <label><input id="cfg-auto-refresh" type="checkbox"> 自动刷新防过期</label>
                    <label><input id="cfg-stop-success" type="checkbox"> 成功后移除目标</label>
                    <label><input id="cfg-sound" type="checkbox"> 成功声音提醒</label>
                    <label><input id="cfg-notify" type="checkbox"> 桌面通知</label>
                    <label><input id="cfg-captcha" type="checkbox"> 登录页 OCR 辅助</label>
                </div>
                <div class="hint">如果脚本正在运行，保存会自动短暂停止并按新参数重新启动。建议每轮间隔不要太低，避免页面或接口限流。</div>

                <div class="actions">
                    <button class="danger" id="cfg-defaults">恢复默认目标</button>
                    <button class="secondary" id="cfg-cancel">取消</button>
                    <button class="primary" id="cfg-save">保存设置</button>
                </div>
            </div>
        `;
        document.body.appendChild(mask);

        $('cfg-auto-refresh').checked = CONFIG.AUTO_REFRESH;
        $('cfg-stop-success').checked = CONFIG.STOP_ON_SUCCESS;
        $('cfg-sound').checked = CONFIG.SOUND_ALERT;
        $('cfg-notify').checked = CONFIG.DESKTOP_NOTIFICATION;
        $('cfg-captcha').checked = CONFIG.CAPTCHA_AUTO_SOLVE;

        const close = () => mask.remove();
        mask.addEventListener('click', e => { if (e.target === mask) close(); });
        $('cfg-cancel').onclick = close;
        $('cfg-defaults').onclick = () => {
            $('cfg-targets').value = DEFAULT_TARGET_TCIDS.map(tcid => `${tcid} XGXK`).join('\n');
        };
        $('cfg-save').onclick = () => {
            const previousMeta = { ...TARGET_META };
            const entries = parseTargetEntries($('cfg-targets').value);
            if (!entries.length) {
                alert('请至少填写一个目标教学班 ID');
                return;
            }
            if (entries.missingTypes?.length) {
                alert(`以下教学班 ID 缺少课程类型，请按“教学班ID 类型”填写：\n${entries.missingTypes.join('\n')}`);
                return;
            }
            const wasRunning = isRunning;
            if (wasRunning) stop();

            CONFIG.STUDENT_CODE = $('cfg-student').value.trim();
            CONFIG.TARGET_TCIDS.splice(0, CONFIG.TARGET_TCIDS.length);
            Object.keys(TARGET_META).forEach(k => delete TARGET_META[k]);
            entries.forEach(({ id, type }) => setTarget(id, { ...previousMeta[id], type }));
            CONFIG.CHECK_INTERVAL = numOr($('cfg-check').value, CONFIG.CHECK_INTERVAL, 500);
            CONFIG.REQUEST_DELAY = numOr($('cfg-delay').value, CONFIG.REQUEST_DELAY, 0);
            CONFIG.QUERY_EVERY_N_ROUNDS = Math.max(1, Math.floor(numOr($('cfg-query').value, CONFIG.QUERY_EVERY_N_ROUNDS, 1)));
            CONFIG.RETRY_FULL_EVERY_N_ROUNDS = Math.max(1, Math.floor(numOr($('cfg-full').value, CONFIG.RETRY_FULL_EVERY_N_ROUNDS, 1)));
            CONFIG.AUTO_REFRESH_INTERVAL = numOr($('cfg-refresh-interval').value, CONFIG.AUTO_REFRESH_INTERVAL, 30000);
            CONFIG.AUTO_REFRESH = $('cfg-auto-refresh').checked;
            CONFIG.STOP_ON_SUCCESS = $('cfg-stop-success').checked;
            CONFIG.SOUND_ALERT = $('cfg-sound').checked;
            CONFIG.DESKTOP_NOTIFICATION = $('cfg-notify').checked;
            CONFIG.CAPTCHA_AUTO_SOLVE = $('cfg-captcha').checked;

            saveUserConfig();
            updateTargetsList();
            updateStatus();
            syncCourseAddButtonStates();
            log(`⚙️ 设置已保存：目标 ${CONFIG.TARGET_TCIDS.length} 门，轮询 ${CONFIG.CHECK_INTERVAL}ms`, 'success');
            close();
            if (wasRunning) setTimeout(start, 300);
        };
    }

    function updateTargetsList() {
        const el = $('s-targets');
        if (!el) return;
        if (!CONFIG.TARGET_TCIDS.length) {
            el.classList.remove('has-targets');
            el.innerHTML = '';
            return;
        }
        el.classList.add('has-targets');

        el.innerHTML = CONFIG.TARGET_TCIDS.map(tcid => {
            const s = courseCache[tcid];
            const meta = getTargetMeta(tcid);
            let name = meta.name || tcid, text = `${meta.type || getTeachingClassType(tcid)} 等待查询`, cls = 'ts-wait';
            if (s) {
                name = `${s.name}[${s.courseIndex}]`;
                if (s.isConflict === '1') { text = `${meta.type} 冲突 ${s.numberOfSelected}/${s.classCapacity}`; cls = 'ts-cf'; }
                else if (s.isFull === '0') { text = `${meta.type} 可选 ${s.numberOfSelected}/${s.classCapacity}`; cls = 'ts-ok'; }
                else { text = `${meta.type} 已满 ${s.numberOfSelected}/${s.classCapacity}`; cls = 'ts-full'; }
            }
            return `<div class="ti"><span title="${escHtml(tcid)}">${escHtml(name)}</span><span><span class="ts ${cls}">${escHtml(text)}</span><button class="sniper-remove-target" data-tcid="${escHtml(tcid)}" title="移除">×</button></span></div>`;
        }).join('');
    }

    function updateStatus() {
        const s = $('s-state');
        if (s) s.innerHTML = isRunning ? '<span class="pulse">运行中</span>' : '未启动';
        const r = $('s-round'); if (r) r.textContent = attemptCount;
        const o = $('s-ok'); if (o) o.textContent = successCount;
        const t = $('s-time'); if (t) t.textContent = lastCheckTime ? lastCheckTime.toLocaleTimeString() : '-';
        const a = $('s-auth'); if (a) a.textContent = `${getToken() ? '✅' : '❌'} / ${getBatchCode() ? '✅' : '❌'}`;
        const m = $('s-mode'); if (m) m.textContent = `${getTargetTypeSummary()} / ${CONFIG.CHECK_INTERVAL}ms`;
    }

    // ===================== 日志 =====================
    function log(message, type = 'info') {
        const el = $('s-log');
        const time = new Date().toLocaleTimeString();
        const text = `[${time}] ${message}`;
        // 保存到历史
        logHistory.unshift({ text, type });
        if (logHistory.length > 30) logHistory.length = 30;
        // 显示到UI
        if (el) {
            const entry = document.createElement('div');
            entry.className = `le log-${type}`;
            entry.textContent = text;
            el.insertBefore(entry, el.firstChild);
            while (el.children.length > 60) el.removeChild(el.lastChild);
        }
        console.log(`[抢课助手] [${type.toUpperCase()}] ${message}`);
    }

    function restoreLogUI() {
        const el = $('s-log');
        if (!el || !logHistory.length) return;
        for (const { text, type } of logHistory) {
            const entry = document.createElement('div');
            entry.className = `le log-${type}`;
            entry.textContent = text;
            el.appendChild(entry);
        }
    }

    // ===================== 提醒 =====================
    function playSuccessSound() {
        if (!CONFIG.SOUND_ALERT) return;
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            [0, 150, 300].forEach((d, i) => {
                setTimeout(() => {
                    const o = ctx.createOscillator(), g = ctx.createGain();
                    o.connect(g); g.connect(ctx.destination);
                    o.frequency.value = 600 + i * 200; o.type = 'sine'; g.gain.value = 0.3;
                    o.start(); setTimeout(() => o.stop(), 150);
                }, d);
            });
        } catch (_) { }
    }

    function showNotification(title, body) {
        if (!CONFIG.DESKTOP_NOTIFICATION) return;
        if (Notification.permission === 'granted') new Notification(title, { body, requireInteraction: true });
        else if (Notification.permission !== 'denied') Notification.requestPermission();
        try { GM_notification({ title, text: body, timeout: 10000 }); } catch (_) { }
        alert(`${title}\n\n${body}`);
    }

    // ===================== 自动登录 =====================
    function tryAutoLogin() {
        if (!location.href.includes('index.do')) return false;

        // 登录页只做一次验证码辅助；失败后交给手动输入，不反复刷新/重试。
        if (CONFIG.CAPTCHA_AUTO_SOLVE && findCaptchaImage() && !window.__sniperCaptchaTried) {
            window.__sniperCaptchaTried = true;
            console.log('[抢课助手] 🔐 登录页验证码辅助：自动尝试一次');
            loadTesseract().then(() => {
                return solveCaptchaOnce();
            }).then(result => {
                if (result.ok) {
                    log(`🔐 验证码已自动填入: ${result.value}`, 'success');
                } else {
                    log(`⚠️ 验证码自动识别失败，请手动输入`, 'warning');
                }
            }).catch(e => {
                log(`⚠️ OCR 加载失败: ${e.message}`, 'error');
            });
        }

        if (!CONFIG.AUTO_LOGIN_DELAY) return false; // 0=不自动点击登录

        const delay = CONFIG.AUTO_LOGIN_DELAY;
        console.log(`[抢课助手] 🔐 登录页面，${delay}秒后自动登录`);

        const tip = document.createElement('div');
        tip.style.cssText = 'position:fixed;top:12px;right:12px;z-index:999999;background:#fff;color:#1d1d1f;border:1px solid #e0e0e0;padding:8px 12px;border-radius:18px;font-size:13px;font-family:"SF Pro Text",system-ui,-apple-system,"Microsoft YaHei",sans-serif;';
        let sec = delay;
        tip.innerHTML = `抢课助手：<b>${sec}</b>秒后自动登录...`;
        document.body.appendChild(tip);

        const timer = setInterval(() => {
            if (--sec > 0) tip.innerHTML = `抢课助手：<b>${sec}</b>秒后自动登录...`;
            else { tip.innerHTML = '抢课助手：正在登录...'; clearInterval(timer); }
        }, 1000);

        setTimeout(() => {
            const btn = $('studentLoginBtn');
            if (btn) { console.log('[抢课助手] 🔐 点击登录'); btn.click(); }
            else { console.warn('[抢课助手] ⚠️ 未找到登录按钮'); tip.innerHTML = '⚠️ 未找到登录按钮，请手动登录'; }
        }, delay * 1000);

        return true;
    }

    // ===================== 初始化 =====================
    function init() {
        if ($('sniper-panel')) return;

        // 从URL补充token
        if (!capturedToken) {
            const m = location.search.match(/token=([a-f0-9-]+)/);
            if (m) capturedToken = m[1];
        }

        // 恢复持久化数据
        restoreData();

        createPanel();
        bindCourseAddButtons();
        restoreLogUI();
        updateTargetsList();

        // 恢复面板位置
        try {
            const pos = JSON.parse(GM_getValue('panelPos', 'null'));
            if (pos) {
                const panel = $('sniper-panel');
                panel.style.left = pos.left;
                panel.style.top = pos.top;
                panel.style.right = 'auto';
            }
        } catch (_) { }

        if (Notification.permission === 'default') Notification.requestPermission();

        log('抢课助手 v6.2 就绪', 'success');
        log(`👤 学号: ${getStudentCode() || '等待自动获取...'}`, 'info');
        log(`📋 目标: ${CONFIG.TARGET_TCIDS.length}门`, 'info');
        log(`🔑 Token: ${getToken() ? '已获取' : '未获取'} | 批次码: ${getBatchCode() ? '已获取' : '等待捕获'} | 目标类型: ${getTargetTypeSummary()} | 校区: ${getCampusCode()}`, getToken() ? 'info' : 'error');
        updateStatus();

        // 自动恢复
        if (GM_getValue('sniperRunning', false) && Date.now() - GM_getValue('sniperTimestamp', 0) < 300000) {
            log('🔄 检测到刷新，2秒后自动恢复...', 'info');
            setTimeout(start, 2000);
        }
    }

    // ===================== 入口 =====================
    function onReady() {
        if (tryAutoLogin()) return;
        setTimeout(init, 800);
    }

    if (document.readyState === 'complete') onReady();
    else window.addEventListener('load', onReady);
})();
