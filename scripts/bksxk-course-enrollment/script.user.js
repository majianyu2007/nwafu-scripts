// ==UserScript==
// @name         西农抢课助手 Pro
// @version      6.2.2
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
        LOGIN_NAME: '',                                // 可选：本机保存的登录账号，源码默认留空
        LOGIN_PASSWORD: '',                            // 可选：本机保存的登录密码，源码默认留空
        TARGET_TCIDS: [],                              // 目标教学班ID列表
        CHECK_INTERVAL: 3000,                          // 每轮间隔（ms）
        REQUEST_DELAY: 500,                            // 单个请求间隔（ms）
        QUERY_EVERY_N_ROUNDS: 5,                       // 每N轮查询一次课程状态
        RETRY_FULL_EVERY_N_ROUNDS: 3,                  // 已满课程每N轮重试一次
        AUTO_REFRESH: true,                            // 自动刷新防session过期
        AUTO_REFRESH_INTERVAL: 120000,                 // 刷新间隔（ms）
        AUTO_RELOGIN: true,                            // 运行中被踢回登录页时自动登录
        AUTO_RELOGIN_DELAY: 2,                         // 自动登录前等待（秒）
        RUNNING_STATE_TTL: 1800000,                    // 运行状态心跳有效期（ms）
        STOP_ON_SUCCESS: true,                         // 抢到后移除目标
        SOUND_ALERT: true,                             // 声音提醒
        DESKTOP_NOTIFICATION: true,                    // 桌面通知
        AUTO_LOGIN_DELAY: 1,                           // 登录页自动登录延时（秒），0=不自动登录
        TEXTBOOK_CHOICE: 'decline_bought',             // 教材策略：order=订购 | decline_borrowed=借用 | decline_bought=已购买
        // 选课类型：XGXK=通识类选修课 | FANKC=方案内课程 | FAWKC=方案外课程
        //          TYKC=体育课 | CXKC=重修课程 | FXKC=辅修 | TJKC=系统推荐
        TEACHING_CLASS_TYPE: 'XGXK',
        // ===== 验证码识别配置（纯浏览器端 OCR，不依赖任何外部服务器）=====
        CAPTCHA_AUTO_SOLVE: false,                     // 登录页自动识别验证码；默认关闭，手动填好后会自动提交
        CAPTCHA_TRY_LIMIT: 3,                          // 登录提交失败后最多重新识别验证码图片数
        CAPTCHA_CANDIDATES_PER_IMAGE: 8,               // 单张验证码最多验证的候选数
        CAPTCHA_IMAGE_SCALE: 8,                        // 图片放大倍数（提高识别率）
        CAPTCHA_LENGTH: 4,                             // 当前选课系统普通验证码长度
        CAPTCHA_OCR_TIMEOUT: 5000,                     // 单张验证码 OCR 最长等待（ms）
    };

    const SPEED_PRESETS = {
        safe: {
            label: '稳妥',
            hint: '间隔较长，适合先确认配置或网络不稳定时使用。',
            CHECK_INTERVAL: 5000,
            REQUEST_DELAY: 800,
            QUERY_EVERY_N_ROUNDS: 3,
            RETRY_FULL_EVERY_N_ROUNDS: 2,
        },
        normal: {
            label: '常规',
            hint: '默认推荐配置，兼顾响应速度和接口压力。',
            CHECK_INTERVAL: 3000,
            REQUEST_DELAY: 500,
            QUERY_EVERY_N_ROUNDS: 5,
            RETRY_FULL_EVERY_N_ROUNDS: 3,
        },
        fast: {
            label: '快速',
            hint: '更频繁地尝试目标课程，请只在必要时使用。',
            CHECK_INTERVAL: 1500,
            REQUEST_DELAY: 300,
            QUERY_EVERY_N_ROUNDS: 8,
            RETRY_FULL_EVERY_N_ROUNDS: 2,
        },
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

    function getSpeedPresetKey() {
        const keys = Object.keys(SPEED_PRESETS);
        return keys.find(key => {
            const preset = SPEED_PRESETS[key];
            return CONFIG.CHECK_INTERVAL === preset.CHECK_INTERVAL
                && CONFIG.REQUEST_DELAY === preset.REQUEST_DELAY
                && CONFIG.QUERY_EVERY_N_ROUNDS === preset.QUERY_EVERY_N_ROUNDS
                && CONFIG.RETRY_FULL_EVERY_N_ROUNDS === preset.RETRY_FULL_EVERY_N_ROUNDS;
        }) || 'custom';
    }

    function applySpeedPreset(key) {
        const preset = SPEED_PRESETS[key];
        if (!preset) return false;
        CONFIG.CHECK_INTERVAL = preset.CHECK_INTERVAL;
        CONFIG.REQUEST_DELAY = preset.REQUEST_DELAY;
        CONFIG.QUERY_EVERY_N_ROUNDS = preset.QUERY_EVERY_N_ROUNDS;
        CONFIG.RETRY_FULL_EVERY_N_ROUNDS = preset.RETRY_FULL_EVERY_N_ROUNDS;
        return true;
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

    function cleanCourseName(value) {
        return String(value || '').replace(/\s*(?:\+目标|已目标)\s*$/g, '').trim();
    }

    function getTextWithoutSniperButtons(el) {
        if (!el) return '';
        const clone = el.cloneNode(true);
        clone.querySelectorAll?.('.sniper-add-course').forEach(btn => btn.remove());
        return cleanCourseName((clone.innerText || clone.textContent || '').replace(/\s+/g, ' '));
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
            if (typeof saved.LOGIN_NAME === 'string') CONFIG.LOGIN_NAME = saved.LOGIN_NAME.trim();
            if (typeof saved.LOGIN_PASSWORD === 'string') CONFIG.LOGIN_PASSWORD = saved.LOGIN_PASSWORD;
            if (typeof saved.TEACHING_CLASS_TYPE === 'string' && saved.TEACHING_CLASS_TYPE) CONFIG.TEACHING_CLASS_TYPE = saved.TEACHING_CLASS_TYPE;
            CONFIG.CHECK_INTERVAL = numOr(saved.CHECK_INTERVAL, CONFIG.CHECK_INTERVAL, 500);
            CONFIG.REQUEST_DELAY = numOr(saved.REQUEST_DELAY, CONFIG.REQUEST_DELAY, 0);
            CONFIG.QUERY_EVERY_N_ROUNDS = Math.max(1, Math.floor(numOr(saved.QUERY_EVERY_N_ROUNDS, CONFIG.QUERY_EVERY_N_ROUNDS, 1)));
            CONFIG.RETRY_FULL_EVERY_N_ROUNDS = Math.max(1, Math.floor(numOr(saved.RETRY_FULL_EVERY_N_ROUNDS, CONFIG.RETRY_FULL_EVERY_N_ROUNDS, 1)));
            CONFIG.AUTO_REFRESH_INTERVAL = numOr(saved.AUTO_REFRESH_INTERVAL, CONFIG.AUTO_REFRESH_INTERVAL, 30000);
            CONFIG.AUTO_REFRESH = boolOr(saved.AUTO_REFRESH, CONFIG.AUTO_REFRESH);
            CONFIG.AUTO_RELOGIN = boolOr(saved.AUTO_RELOGIN, CONFIG.AUTO_RELOGIN);
            CONFIG.AUTO_LOGIN_DELAY = numOr(saved.AUTO_LOGIN_DELAY, CONFIG.AUTO_LOGIN_DELAY, 0);
            CONFIG.STOP_ON_SUCCESS = boolOr(saved.STOP_ON_SUCCESS, CONFIG.STOP_ON_SUCCESS);
            CONFIG.SOUND_ALERT = boolOr(saved.SOUND_ALERT, CONFIG.SOUND_ALERT);
            CONFIG.DESKTOP_NOTIFICATION = boolOr(saved.DESKTOP_NOTIFICATION, CONFIG.DESKTOP_NOTIFICATION);
            CONFIG.CAPTCHA_AUTO_SOLVE = boolOr(saved.CAPTCHA_AUTO_SOLVE, CONFIG.CAPTCHA_AUTO_SOLVE);
            if (['order', 'decline_borrowed', 'decline_bought'].includes(saved.TEXTBOOK_CHOICE)) {
                CONFIG.TEXTBOOK_CHOICE = saved.TEXTBOOK_CHOICE;
            }
        } catch (e) {
            console.warn('[抢课助手] 读取用户配置失败，使用脚本默认配置', e);
        }
    }

    function saveUserConfig() {
        GM_setValue('sniperUserConfig', JSON.stringify({
            STUDENT_CODE: CONFIG.STUDENT_CODE,
            LOGIN_NAME: CONFIG.LOGIN_NAME,
            LOGIN_PASSWORD: CONFIG.LOGIN_PASSWORD,
            TARGET_TCIDS: CONFIG.TARGET_TCIDS,
            TARGET_META,
            CHECK_INTERVAL: CONFIG.CHECK_INTERVAL,
            REQUEST_DELAY: CONFIG.REQUEST_DELAY,
            QUERY_EVERY_N_ROUNDS: CONFIG.QUERY_EVERY_N_ROUNDS,
            RETRY_FULL_EVERY_N_ROUNDS: CONFIG.RETRY_FULL_EVERY_N_ROUNDS,
            AUTO_REFRESH: CONFIG.AUTO_REFRESH,
            AUTO_REFRESH_INTERVAL: CONFIG.AUTO_REFRESH_INTERVAL,
            AUTO_RELOGIN: CONFIG.AUTO_RELOGIN,
            AUTO_LOGIN_DELAY: CONFIG.AUTO_LOGIN_DELAY,
            STOP_ON_SUCCESS: CONFIG.STOP_ON_SUCCESS,
            SOUND_ALERT: CONFIG.SOUND_ALERT,
            DESKTOP_NOTIFICATION: CONFIG.DESKTOP_NOTIFICATION,
            TEACHING_CLASS_TYPE: CONFIG.TEACHING_CLASS_TYPE,
            CAPTCHA_AUTO_SOLVE: CONFIG.CAPTCHA_AUTO_SOLVE,
            TEXTBOOK_CHOICE: CONFIG.TEXTBOOK_CHOICE,
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

    function withTimeout(promise, ms, message) {
        let timer = null;
        const timeout = new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(message || '操作超时')), ms);
        });
        return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
    }

    function normalizeCaptchaText(value) {
        return String(value || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase().trim();
    }

    function isCaptchaTextValid(value) {
        const text = normalizeCaptchaText(value);
        return text.length === CONFIG.CAPTCHA_LENGTH;
    }

    function uniqueValues(values) {
        const seen = new Set();
        const result = [];
        values.forEach(value => {
            const text = normalizeCaptchaText(value);
            if (!text || seen.has(text)) return;
            seen.add(text);
            result.push(text);
        });
        return result;
    }

    function addCaptchaBase(candidates, value) {
        const text = normalizeCaptchaText(value);
        if (text.length === CONFIG.CAPTCHA_LENGTH) candidates.push(text);
    }

    function buildCaptchaBases(text) {
        const base = normalizeCaptchaText(text);
        if (!base) return [];
        const bases = [];
        addCaptchaBase(bases, base);

        if (base.length > CONFIG.CAPTCHA_LENGTH) {
            addCaptchaBase(bases, base.slice(-CONFIG.CAPTCHA_LENGTH));
            addCaptchaBase(bases, base.slice(0, CONFIG.CAPTCHA_LENGTH));
            for (let i = 0; i <= base.length - CONFIG.CAPTCHA_LENGTH; i++) {
                addCaptchaBase(bases, base.slice(i, i + CONFIG.CAPTCHA_LENGTH));
            }
            if (base.length <= CONFIG.CAPTCHA_LENGTH + 2) {
                for (let i = 0; i < base.length; i++) {
                    const oneRemoved = base.slice(0, i) + base.slice(i + 1);
                    if (oneRemoved.length === CONFIG.CAPTCHA_LENGTH) addCaptchaBase(bases, oneRemoved);
                    if (oneRemoved.length === CONFIG.CAPTCHA_LENGTH + 1) {
                        for (let j = 0; j < oneRemoved.length; j++) {
                            addCaptchaBase(bases, oneRemoved.slice(0, j) + oneRemoved.slice(j + 1));
                        }
                    }
                }
            }
        }

        return uniqueValues(bases);
    }

    function getCaptchaConfusions(ch) {
        const confusion = {
            O: ['0', '6', 'C', 'D', 'Q', 'U', '5'],
            0: ['O', '6', 'C', 'D', 'Q'],
            6: ['G', 'O', '0', 'B'],
            G: ['6', 'C', 'O'],
            C: ['O', '0', 'G', 'Q'],
            D: ['O', '0'],
            Q: ['O', '0', 'C'],
            U: ['V', 'Y', 'O'],
            V: ['Y', 'U'],
            Y: ['B', '9', 'V', 'U', 'H'],
            9: ['B', 'Y', 'P', '8'],
            B: ['8', '6', '9', 'Y'],
            8: ['B', '9'],
            S: ['5'],
            5: ['S', 'O'],
            I: ['1', 'L', 'T'],
            L: ['1', 'I'],
            1: ['I', 'L', '7'],
            T: ['Y', '7', 'I'],
            Z: ['2', '7'],
            2: ['Z'],
            A: ['4'],
            4: ['A'],
            F: ['P', 'E'],
            P: ['F', 'R', '9'],
            R: ['P', 'B'],
            H: ['Y', 'N', 'M'],
            M: ['N', 'H'],
            N: ['M', 'H'],
            W: ['M', 'N'],
            X: ['K'],
            K: ['X'],
        };
        return confusion[ch] || [];
    }

    function expandCaptchaBase(base) {
        const chars = normalizeCaptchaText(base).split('');
        const candidates = [];
        if (chars.length !== CONFIG.CAPTCHA_LENGTH) return candidates;

        candidates.push(chars.join(''));

        // 实测常见：Tesseract 会把 6YTB 读成 OYTY，这个组合必须排在单字符替换前。
        if ((chars[0] === 'O' || chars[0] === '0') && (chars[3] === 'Y' || chars[3] === '9')) {
            candidates.push(`6${chars[1]}${chars[2]}B`);
            candidates.push(`0${chars[1]}${chars[2]}B`);
            candidates.push(`O${chars[1]}${chars[2]}B`);
        }

        // H5CX 一类验证码可能被读成 YHOOX，删去首位后留下 HOOX。
        for (let i = 0; i < chars.length - 1; i++) {
            if (chars[i] === 'O' && chars[i + 1] === 'O') {
                const pairs = ['5C', 'SC', '0C', 'OC', 'CC', '5O'];
                pairs.forEach(pair => {
                    const copy = chars.slice();
                    copy[i] = pair[0];
                    copy[i + 1] = pair[1];
                    candidates.push(copy.join(''));
                });
            }
        }

        if (chars[0] === 'Y') {
            const copy = chars.slice();
            copy[0] = 'H';
            candidates.push(copy.join(''));
        }
        if (chars[3] === 'Y' || chars[3] === '9') {
            const copy = chars.slice();
            copy[3] = 'B';
            candidates.push(copy.join(''));
        }
        if (chars[0] === 'O' || chars[0] === '0') {
            const copy = chars.slice();
            copy[0] = '6';
            candidates.push(copy.join(''));
        }

        chars.forEach((ch, idx) => {
            getCaptchaConfusions(ch).forEach(next => {
                const copy = chars.slice();
                copy[idx] = next;
                candidates.push(copy.join(''));
            });
        });

        for (let i = 0; i < chars.length; i++) {
            const left = getCaptchaConfusions(chars[i]).slice(0, 4);
            for (let j = i + 1; j < chars.length; j++) {
                const right = getCaptchaConfusions(chars[j]).slice(0, 4);
                left.forEach(a => {
                    right.forEach(b => {
                        const copy = chars.slice();
                        copy[i] = a;
                        copy[j] = b;
                        candidates.push(copy.join(''));
                    });
                });
            }
        }

        return uniqueValues(candidates);
    }

    function buildCaptchaTextCandidates(input) {
        const seeds = Array.isArray(input) ? input : [input];
        const bases = [];
        seeds.forEach(seed => {
            buildCaptchaBases(seed).forEach(base => bases.push(base));
        });
        const uniqueBases = uniqueValues(bases);
        const candidates = [];
        uniqueBases.forEach(base => candidates.push(base));
        uniqueBases.forEach(base => expandCaptchaBase(base).forEach(candidate => candidates.push(candidate)));
        return uniqueValues(candidates).slice(0, CONFIG.CAPTCHA_CANDIDATES_PER_IMAGE);
    }

    /** 图像预处理：灰度化 + 二值化 + 放大，提高 OCR 识别率 */
    function preprocessCaptchaImage(imgEl, options = {}) {
        const scale = options.scale || CONFIG.CAPTCHA_IMAGE_SCALE;
        const rawW = imgEl.naturalWidth || imgEl.width;
        const rawH = imgEl.naturalHeight || imgEl.height;
        const cropX = options.cropX == null ? 0 : options.cropX;
        const cropY = options.cropY == null ? 2 : options.cropY;
        const origW = Math.max(1, rawW - cropX * 2);
        const origH = Math.max(1, rawH - cropY * 2);
        if (!rawW || !rawH || !origW || !origH) return null;

        const pad = options.pad == null ? 0 : options.pad;
        // 创建放大后的 canvas
        const w = origW * scale + pad * 2;
        const h = origH * scale + pad * 2;
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        ctx.fillStyle = options.invert ? '#000000' : '#ffffff';
        ctx.fillRect(0, 0, w, h);

        // 先绘制到原始大小
        const tmpCanvas = document.createElement('canvas');
        tmpCanvas.width = origW;
        tmpCanvas.height = origH;
        const tmpCtx = tmpCanvas.getContext('2d');
        tmpCtx.imageSmoothingEnabled = false;
        tmpCtx.fillStyle = '#ffffff';
        tmpCtx.fillRect(0, 0, origW, origH);
        if (options.angle) {
            tmpCtx.save();
            tmpCtx.translate(origW / 2, origH / 2);
            tmpCtx.rotate(options.angle * Math.PI / 180);
            tmpCtx.drawImage(imgEl, cropX, cropY, origW, origH, -origW / 2, -origH / 2, origW, origH);
            tmpCtx.restore();
        } else {
            tmpCtx.drawImage(imgEl, cropX, cropY, origW, origH, 0, 0, origW, origH);
        }
        const imageData = tmpCtx.getImageData(0, 0, origW, origH);
        const pixels = imageData.data;
        const threshold = options.threshold == null ? 150 : options.threshold;
        const invert = Boolean(options.invert);
        const grayscale = Boolean(options.grayscale);

        // 灰度化 + 去噪 + 放大
        const scaledData = ctx.createImageData(origW * scale, origH * scale);
        for (let sy = 0; sy < origH * scale; sy++) {
            for (let sx = 0; sx < origW * scale; sx++) {
                const ox = Math.floor(sx / scale);
                const oy = Math.floor(sy / scale);
                const idx = (oy * origW + ox) * 4;
                const didx = (sy * origW * scale + sx) * 4;

                // 灰度化
                const gray = 0.299 * pixels[idx] + 0.587 * pixels[idx + 1] + 0.114 * pixels[idx + 2];

                let bin = grayscale ? gray : (gray > threshold ? 255 : 0);
                if (invert) bin = 255 - bin;

                scaledData.data[didx] = bin;
                scaledData.data[didx + 1] = bin;
                scaledData.data[didx + 2] = bin;
                scaledData.data[didx + 3] = 255;
            }
        }
        ctx.putImageData(scaledData, pad, pad);
        return canvas;
    }

    function buildCaptchaCandidates(imgEl) {
        return [
            { grayscale: true, scale: 10, pad: 28 },
            { threshold: 160, scale: 10, pad: 28 },
            { threshold: 170, scale: 10, pad: 28 },
            { threshold: 140, scale: CONFIG.CAPTCHA_IMAGE_SCALE, pad: 18 },
            { threshold: 160, scale: CONFIG.CAPTCHA_IMAGE_SCALE, angle: -7, pad: 18 },
            { threshold: 160, scale: CONFIG.CAPTCHA_IMAGE_SCALE, angle: 7, pad: 18 },
        ].map(opts => preprocessCaptchaImage(imgEl, opts)).filter(Boolean);
    }

    /** 核心：使用 Tesseract.js 在浏览器本地识别验证码 */
    async function recognizeCaptchaLocal(imgEl) {
        const candidates = buildCaptchaCandidates(imgEl);
        if (!candidates.length) throw new Error('图像预处理失败');

        // 加载 OCR 引擎
        const worker = await loadTesseract();
        let best = '';

        await worker.setParameters?.({
            tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
            tessedit_pageseg_mode: '7',
        });

        const rawTexts = [];
        let bestResult = { text: '', confidence: 0, candidates: [] };
        for (const processed of candidates) {
            const { data } = await withTimeout(worker.recognize(processed), CONFIG.CAPTCHA_OCR_TIMEOUT, 'OCR识别超时');

            const text = normalizeCaptchaText(data.text);
            const confidence = Number(data.confidence || 0);
            console.log('[抢课助手] OCR 识别原始结果:', data.text, '→ 清理后:', text);
            if (text) rawTexts.push(text);
            if (isCaptchaTextValid(text) && confidence > bestResult.confidence) {
                bestResult = { text, confidence, candidates: [] };
            }
            if (text.length > best.length) best = text;
        }

        const candidateTexts = bestResult.text ? [bestResult.text, ...rawTexts] : rawTexts;
        const textCandidates = buildCaptchaTextCandidates(candidateTexts);
        const displayText = bestResult.text || best || textCandidates[0] || '';
        return {
            text: displayText,
            confidence: bestResult.confidence,
            candidates: textCandidates,
            rawTexts,
        };
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
        if (!inputEl) return;
        const nextValue = String(value || '');
        const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        if (nativeSetter) nativeSetter.call(inputEl, nextValue);
        else inputEl.value = nextValue;
        inputEl.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
        inputEl.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
        inputEl.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Unidentified' }));
        if (nextValue) console.log('[抢课助手] ✅ 验证码已填入:', nextValue);
    }

    let lastCaptchaObservedValue = '';
    let lastCaptchaObservedAt = 0;

    function getCaptchaInputValue() {
        return String(findCaptchaInput()?.value || '').trim();
    }

    function resetCaptchaStability() {
        lastCaptchaObservedValue = getCaptchaInputValue();
        lastCaptchaObservedAt = Date.now();
    }

    function getStableCaptchaValue(minStableMs = 700) {
        const raw = getCaptchaInputValue();
        const normalized = normalizeCaptchaText(raw);
        const now = Date.now();
        if (raw !== lastCaptchaObservedValue) {
            lastCaptchaObservedValue = raw;
            lastCaptchaObservedAt = now;
            return '';
        }
        if (normalized.length !== CONFIG.CAPTCHA_LENGTH) return '';
        return now - lastCaptchaObservedAt >= minStableMs ? raw : '';
    }

    function prepareLoginInputs() {
        const loginName = $('loginName');
        const loginPwd = $('loginPwd');
        const captchaInput = findCaptchaInput();
        if (loginName) loginName.setAttribute('autocomplete', 'username');
        if (loginPwd) loginPwd.setAttribute('autocomplete', 'current-password');
        if (captchaInput) {
            captchaInput.setAttribute('autocomplete', 'off');
            captchaInput.setAttribute('autocapitalize', 'characters');
            captchaInput.setAttribute('spellcheck', 'false');
            if (!captchaInput.dataset.sniperPrepared) {
                captchaInput.dataset.sniperPrepared = '1';
                ['input', 'change', 'keyup'].forEach(type => {
                    captchaInput.addEventListener(type, resetCaptchaStability, { passive: true });
                });
            }
        }
        resetCaptchaStability();
    }

    function clearStaleCaptchaAutofill() {
        const input = findCaptchaInput();
        if (!input || input.dataset.sniperInitialCleared) return;
        input.dataset.sniperInitialCleared = '1';
        if (normalizeCaptchaText(input.value) && document.activeElement !== input) {
            fillCaptchaInput(input, '');
        }
        resetCaptchaStability();
    }

    /** 点击换一张 */
    function clickCaptchaRefresh() {
        const btn = findCaptchaRefreshBtn();
        const img = findCaptchaImage();
        if (btn) btn.click();
        else if (img) img.click();
    }

    async function waitForCaptchaReload(prevSrc = '', prevToken = '', timeout = 3000) {
        const start = Date.now();
        while (Date.now() - start < timeout) {
            const img = findCaptchaImage();
            const src = img?.src || '';
            const token = sessionStorage.getItem('vtoken') || '';
            const changed = (prevSrc && src && src !== prevSrc) || (prevToken && token && token !== prevToken);
            const loaded = img && img.complete && (img.naturalWidth || img.width);
            if (loaded && (!prevSrc && !prevToken || changed)) return true;
            await sleep(100);
        }
        return false;
    }

    async function refreshCaptchaAndWait() {
        const img = findCaptchaImage();
        const prevSrc = img?.src || '';
        const prevToken = sessionStorage.getItem('vtoken') || '';
        clickCaptchaRefresh();
        clearCaptchaInput();
        await waitForCaptchaReload(prevSrc, prevToken);
        await sleep(150);
    }

    /** 单次尝试识别并填入验证码 */
    async function solveCaptchaOnce() {
        const img = findCaptchaImage();
        if (!img) return { ok: false, msg: '未找到验证码图片' };
        const input = findCaptchaInput();
        if (!input) return { ok: false, msg: '未找到验证码输入框' };
        try {
            const result = await recognizeCaptchaLocal(img);
            const value = result.text || '';
            const candidates = result.candidates || buildCaptchaTextCandidates(value);
            if (!value) return { ok: false, msg: '识别结果为空' };
            if (!candidates.length) {
                return { ok: false, msg: `识别结果长度异常：${value}` };
            }
            fillCaptchaInput(input, candidates[0]);
            return { ok: true, value: candidates[0], candidates, confidence: result.confidence };
        } catch (e) {
            return { ok: false, msg: e.message };
        }
    }

    /** 兼容旧调用：单次识别；重试由登录失败后触发。 */
    async function solveCaptchaWithRetry() {
        return solveCaptchaOnce();
    }

    // ===================== 被动捕获认证参数 =====================
    let capturedToken = '';
    let capturedBatchCode = '';
    let capturedStudentCode = '';
    let lastLoginResult = null;

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
    function observePageXhr(xhr) {
        const url = String(xhr._capUrl || '');
        if (!url.includes('/student/check/login.do')) return;
        try {
            const data = JSON.parse(xhr.responseText || '{}');
            lastLoginResult = {
                at: Date.now(),
                code: String(data.code || ''),
                msg: data.msg || '',
            };
            console.log(`[抢课助手] 登录接口返回 code:${lastLoginResult.code} msg:"${lastLoginResult.msg}"`);
        } catch (_) {
            lastLoginResult = {
                at: Date.now(),
                code: '',
                msg: '登录接口响应解析失败',
            };
        }
    }
    XMLHttpRequest.prototype.send = function (body) {
        if (this._isOurs) return origSend.call(this, body); // 跳过我们自己发的请求
        try {
            if (!this._sniperObserved) {
                this._sniperObserved = true;
                this.addEventListener('load', () => observePageXhr(this));
            }
            if (this._capUrl?.includes('publicCourse.do') && body) {
                const json = JSON.parse(decodeURIComponent(body.replace('querySetting=', '')));
                if (json.data?.electiveBatchCode) {
                    capturedBatchCode = json.data.electiveBatchCode;
                    rememberBatchCode(capturedBatchCode);
                    console.log('[抢课助手] 捕获 electiveBatchCode:', capturedBatchCode);
                }
                if (json.data?.studentCode && !capturedStudentCode) {
                    capturedStudentCode = json.data.studentCode;
                    console.log('[抢课助手] 捕获 studentCode:', capturedStudentCode);
                }
            }
            if (this._capUrl?.includes('electiveBatchCode=')) {
                const m = this._capUrl.match(/electiveBatchCode=([a-f0-9]+)/);
                if (m) {
                    capturedBatchCode = m[1];
                    rememberBatchCode(capturedBatchCode);
                }
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

    function isVisibleElement(el) {
        if (!el) return false;
        const style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    }

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

    function normalizeBatchSnapshot(batch) {
        if (!batch || typeof batch !== 'object') return null;
        const code = String(batch.code || batch.electiveBatchCode || '').trim();
        if (!code) return null;
        return {
            code,
            name: batch.name || '',
            beginTime: batch.beginTime || '',
            endTime: batch.endTime || '',
            schoolTerm: batch.schoolTerm || '',
            typeCode: batch.typeCode || '',
            typeName: batch.typeName || '',
            batchType: batch.batchType || '',
        };
    }

    function readSavedBatch() {
        try {
            return normalizeBatchSnapshot(JSON.parse(GM_getValue('sniperLastBatch', 'null')));
        } catch (_) {
            return null;
        }
    }

    function rememberBatch(batch) {
        const snapshot = normalizeBatchSnapshot(batch);
        if (!snapshot) return null;
        capturedBatchCode = snapshot.code;
        try {
            GM_setValue('sniperLastBatch', JSON.stringify(snapshot));
        } catch (_) { }
        return snapshot;
    }

    function rememberBatchCode(code) {
        const saved = readSavedBatch() || {};
        return rememberBatch({ ...saved, code });
    }

    function rememberCurrentBatch() {
        return rememberBatch(readCurrentBatch());
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
        const code = CONFIG.STUDENT_CODE || capturedStudentCode || studentInfo.code || studentInfo.number || CONFIG.LOGIN_NAME || '';
        if (code && !capturedStudentCode) capturedStudentCode = code;
        return code;
    }

    function getBatchCode() {
        if (capturedBatchCode) return capturedBatchCode;
        const batch = readCurrentBatch();
        const current = rememberBatch(batch);
        if (current?.code) return current.code;
        const saved = readSavedBatch();
        if (saved?.code) {
            capturedBatchCode = saved.code;
            return saved.code;
        }
        return '';
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

    function buildTextbookPreference(map) {
        if (!map || typeof map !== 'object') return '';
        const reasonMap = {
            decline_borrowed: '01',
            decline_bought: '02',
        };
        return Object.entries(map)
            .map(([key, raw]) => {
                let bookId = key;
                try {
                    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
                    bookId = parsed?.JCBH || bookId;
                } catch (_) { }
                if (!bookId) return '';
                if (CONFIG.TEXTBOOK_CHOICE === 'order') return bookId;
                return `${bookId}-${reasonMap[CONFIG.TEXTBOOK_CHOICE] || reasonMap.decline_bought}`;
            })
            .filter(Boolean)
            .join(',');
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
        GM_setValue('sniperSessionExpiredAt', Date.now());
        setTimeout(() => location.reload(), 1000);
    }

    function saveState(running) {
        rememberCurrentBatch();
        GM_setValue('sniperRunning', running);
        GM_setValue('sniperTimestamp', Date.now());
    }

    function hasRecentRunningState() {
        if (!GM_getValue('sniperRunning', false)) return false;
        const ts = Number(GM_getValue('sniperTimestamp', 0));
        return ts > 0 && Date.now() - ts < CONFIG.RUNNING_STATE_TTL;
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
    async function querySelectionPrecheck(tcid) {
        const batchCode = getBatchCode();
        const studentCode = getStudentCode();
        if (!batchCode || !studentCode) return { ok: true, needBook: '', testTeachingClassID: '' };

        try {
            const body = [
                ['jxbid', tcid],
                ['electiveBatchCode', batchCode],
                ['studentCode', studentCode],
                ['isMajor', '1'],
                ['teachingClassType', getTeachingClassType(tcid)],
                ['campus', getCampusCode()],
                ['checkCapacity', '0'],
                ['checkConflict', '0'],
            ].map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
            const data = await apiPost(
                '/xsxkapp/sys/xsxkapp/elective/testCourse.do',
                body,
                `预检[${getCourseName(tcid)}]`
            );
            const needBook = buildTextbookPreference(data.map);
            return { ok: true, needBook, testTeachingClassID: '' };
        } catch (e) {
            return { ok: false, msg: e.message };
        }
    }

    async function trySelect(tcid) {
        const batchCode = getBatchCode();
        if (!batchCode) return { ok: false, msg: '无批次码' };

        const studentCode = getStudentCode();
        if (!studentCode) return { ok: false, msg: '未获取到学号' };

        const precheck = await querySelectionPrecheck(tcid);
        if (!precheck.ok) return { ok: false, msg: precheck.msg || '预检查失败' };

        const dataPayload = {
            operationType: '1',
            studentCode: studentCode,
            electiveBatchCode: batchCode,
            teachingClassId: tcid,
            isMajor: '1',
            campus: getCampusCode(),
            teachingClassType: getTeachingClassType(tcid),
            chooseVolunteer: '1',
            testTeachingClassID: precheck.testTeachingClassID || '',
        };
        if (precheck.needBook) dataPayload.needBook = precheck.needBook;
        const body = JSON.stringify({ data: dataPayload });

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
        saveState(true);
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
                    position: fixed; top: 12px; right: 12px; width: min(360px, calc(100vw - 24px));
                    background: #ffffff; border: 1px solid #e0e0e0;
                    border-radius: 18px; padding: 10px; z-index: 999999;
                    font-family: "SF Pro Text", system-ui, -apple-system, "Microsoft YaHei", sans-serif;
                    color: #1d1d1f; user-select: none;
                }
                #sniper-panel h3 { margin: 0 28px 8px 0; font-size: 15px; line-height: 1.24; letter-spacing: 0; font-weight: 600; display: flex; align-items: center; gap: 6px; cursor: move; color: #1d1d1f; white-space: nowrap; }
                #sniper-panel .st { background: #f5f5f7; border: 1px solid #e0e0e0; padding: 8px; border-radius: 11px; margin-bottom: 6px; font-size: 12px; }
                #sniper-panel .sr { display: flex; justify-content: space-between; gap: 10px; margin: 2px 0; }
                #sniper-panel .sr-quiet { color: #7a7a7a; }
                #sniper-panel .sv { font-weight: 600; color: #1d1d1f; text-align: right; }
                #sniper-panel .btn { width: 100%; min-height: 30px; padding: 6px 10px; border: 1px solid #0066cc; border-radius: 9999px; cursor: pointer; font-size: 13px; line-height: 1.29; letter-spacing: 0; font-weight: 400; margin-top: 6px; background: #ffffff; color: #0066cc; }
                #sniper-panel .btn:active { transform: scale(.95); }
                #sniper-panel .btn-start { background: #0066cc; border-color: #0066cc; color: #ffffff; }
                #sniper-panel .btn-stop { background: #1d1d1f; border-color: #1d1d1f; color: #ffffff; }
                #sniper-panel .btn-refresh { background: #ffffff; color: #0066cc; }
                #sniper-panel .tgt { background: #fafafc; border: 1px solid #e0e0e0; border-radius: 11px; padding: 7px; margin-bottom: 6px; max-height: min(42vh, 360px); overflow-y: auto; font-size: 12px; display: none; }
                #sniper-panel .tgt.has-targets { display: block; }
                #sniper-panel .ti { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px; align-items: start; padding: 7px 0; border-bottom: 1px solid #f0f0f0; }
                #sniper-panel .ti:last-child { border-bottom: none; }
                #sniper-panel .td { min-width: 0; }
                #sniper-panel .tn { font-weight: 600; color: #1d1d1f; line-height: 1.35; word-break: break-word; overflow-wrap: anywhere; }
                #sniper-panel .tid { color: #7a7a7a; font-size: 11px; line-height: 1.35; word-break: break-all; margin-top: 2px; }
                #sniper-panel .ta { display: flex; gap: 4px; align-items: center; justify-content: flex-end; }
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
                #sniper-config { width: min(760px, calc(100vw - 32px)); max-height: calc(100vh - 44px); overflow: auto; background: #ffffff; color: #1d1d1f; border: 1px solid #e0e0e0; border-radius: 14px; padding: 22px; }
                #sniper-config h3 { margin: 0 0 16px; font-size: 20px; line-height: 1.2; letter-spacing: 0; font-weight: 600; cursor: default; color: #1d1d1f; }
                #sniper-config label { display: block; font-size: 13px; line-height: 1.3; letter-spacing: 0; font-weight: 600; color: #333333; margin: 0 0 6px; }
                #sniper-config input, #sniper-config textarea, #sniper-config select { width: 100%; box-sizing: border-box; border: 1px solid #e0e0e0; border-radius: 11px; padding: 8px 12px; font-size: 14px; font-family: inherit; color: #1d1d1f; background: #ffffff; }
                #sniper-config textarea { min-height: 150px; resize: vertical; font-family: Consolas, Monaco, monospace; }
                #sniper-config .grid { display: grid; gap: 12px; }
                #sniper-config .grid-two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
                #sniper-config .grid-three { grid-template-columns: repeat(3, minmax(0, 1fr)); }
                #sniper-config .advanced-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
                #sniper-config .field { min-width: 0; }
                #sniper-config .section { border-top: 1px solid #f0f0f0; margin-top: 16px; padding-top: 14px; }
                #sniper-config .section-title { margin: 0 0 10px; color: #1d1d1f; font-size: 14px; line-height: 1.3; font-weight: 600; }
                #sniper-config .subgrid { margin-top: 12px; }
                #sniper-config .checks { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px 12px; margin-top: 12px; }
                #sniper-config .checks label { display: flex; gap: 8px; align-items: center; font-weight: 500; margin: 0; }
                #sniper-config .checks input { width: auto; }
                #sniper-config .hint { font-size: 12px; color: #7a7a7a; margin-top: 6px; line-height: 1.45; }
                #sniper-config details.advanced { margin-top: 12px; border: 1px solid #e0e0e0; border-radius: 11px; padding: 10px 12px; background: #fafafc; }
                #sniper-config details.advanced.is-hidden { display: none; }
                #sniper-config details.advanced summary { color: #333333; font-weight: 600; font-size: 13px; }
                #sniper-config .preset-hint { min-height: 18px; }
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
                .sniper-add-course.added { background: #f5f5f7 !important; border-color: #e0e0e0 !important; color: #7a7a7a !important; cursor: default !important; }
                .sniper-remove-target {
                    margin-left: 4px; border: 1px solid #cbd5e1; border-radius: 4px; background: #fff;
                    color: #475569; cursor: pointer; font-size: 11px; padding: 1px 4px;
                }
                @media (max-width: 640px) {
                    #sniper-config .grid, #sniper-config .grid-two, #sniper-config .grid-three, #sniper-config .advanced-grid, #sniper-config .checks { grid-template-columns: 1fr; }
                }
                .pulse { animation: pulse 1.5s ease-in-out infinite; }
                @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.6} }
            </style>
            <button class="mb" id="sniper-min">−</button>
            <h3>西农抢课助手 v6.2.1</h3>
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
        const text = getTextWithoutSniperButtons(card);
        const title = getTextWithoutSniperButtons(card?.querySelector('h5,.cv-course,.cv-title-col,.cv-school-title-col'));
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
            add.disabled = CONFIG.TARGET_TCIDS.includes(tcid);
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
            btn.disabled = added;
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
            if (add.disabled || add.classList.contains('added') || CONFIG.TARGET_TCIDS.includes(tcid)) return;
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

        const speedPresetKey = getSpeedPresetKey();
        const mask = document.createElement('div');
        mask.id = 'sniper-config-mask';
        mask.innerHTML = `
            <div id="sniper-config">
                <h3>抢课设置</h3>
                <label for="cfg-targets">目标教学班 ID</label>
                <textarea id="cfg-targets" spellcheck="false" placeholder="一行一个，例如：202520262xxxx01 TYKC">${formatTargetsForTextarea()}</textarea>
                <div class="hint">推荐在课程旁点「+目标」，脚本会自动记录该课类型。手动输入必须每行填写：教学班ID 类型，例如 202520262xxxx01 TYKC。</div>

                <div class="section">
                    <div class="section-title">登录恢复</div>
                    <div class="grid grid-three">
                        <div class="field">
                            <label for="cfg-student">学号</label>
                            <input id="cfg-student" value="${escHtml(CONFIG.STUDENT_CODE || '')}" placeholder="留空自动获取">
                        </div>
                        <div class="field">
                            <label for="cfg-login-name">登录账号</label>
                            <input id="cfg-login-name" value="${escHtml(CONFIG.LOGIN_NAME || '')}" autocomplete="username" placeholder="留空不自动填写">
                        </div>
                        <div class="field">
                            <label for="cfg-login-password">登录密码</label>
                            <input id="cfg-login-password" type="password" value="${escHtml(CONFIG.LOGIN_PASSWORD || '')}" autocomplete="current-password" placeholder="留空不自动填写">
                        </div>
                    </div>
                    <div class="grid grid-three subgrid">
                        <div class="field">
                            <label for="cfg-login-delay">自动登录等待秒</label>
                            <input id="cfg-login-delay" type="number" min="0" step="1" value="${CONFIG.AUTO_LOGIN_DELAY}">
                        </div>
                    </div>
                </div>

                <div class="section">
                    <div class="section-title">选课策略</div>
                    <div class="grid grid-two">
                        <div class="field">
                            <label for="cfg-speed">抢课速度</label>
                            <select id="cfg-speed">
                                <option value="normal"${speedPresetKey === 'normal' ? ' selected' : ''}>常规</option>
                                <option value="safe"${speedPresetKey === 'safe' ? ' selected' : ''}>稳妥</option>
                                <option value="fast"${speedPresetKey === 'fast' ? ' selected' : ''}>快速</option>
                                <option value="custom"${speedPresetKey === 'custom' ? ' selected' : ''}>自定义</option>
                            </select>
                            <div class="hint preset-hint" id="cfg-speed-hint"></div>
                        </div>
                        <div class="field">
                            <label for="cfg-textbook">教材策略</label>
                            <select id="cfg-textbook">
                                <option value="decline_bought">不订购：已购买正版教材</option>
                                <option value="decline_borrowed">不订购：借用正版教材</option>
                                <option value="order">订购教材</option>
                            </select>
                        </div>
                    </div>
                </div>

                <details class="advanced" id="cfg-advanced"${speedPresetKey === 'custom' ? ' open' : ''}>
                    <summary>高级请求参数</summary>
                    <div class="grid advanced-grid">
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
                </details>

                <div class="checks section">
                    <label><input id="cfg-auto-refresh" type="checkbox"> 自动刷新防过期</label>
                    <label><input id="cfg-auto-relogin" type="checkbox"> 掉线后自动登录</label>
                    <label><input id="cfg-stop-success" type="checkbox"> 成功后移除目标</label>
                    <label><input id="cfg-sound" type="checkbox"> 声音提醒</label>
                    <label><input id="cfg-notify" type="checkbox"> 桌面通知</label>
                    <label><input id="cfg-captcha" type="checkbox"> 登录页 OCR 辅助</label>
                </div>
                <div class="hint">OCR 默认关闭。启用后最多尝试 ${CONFIG.CAPTCHA_TRY_LIMIT} 张验证码；失败后按提醒设置提示手动输入。</div>

                <div class="actions">
                    <button class="danger" id="cfg-defaults">清空目标</button>
                    <button class="secondary" id="cfg-cancel">取消</button>
                    <button class="primary" id="cfg-save">保存设置</button>
                </div>
            </div>
        `;
        document.body.appendChild(mask);

        const updateSpeedPresetUI = () => {
            const selected = $('cfg-speed').value;
            const preset = SPEED_PRESETS[selected];
            const isCustom = selected === 'custom';
            $('cfg-advanced').classList.toggle('is-hidden', !isCustom);
            $('cfg-advanced').open = isCustom;
            $('cfg-speed-hint').textContent = preset ? preset.hint : '使用下面的高级参数。';
            if (!preset) return;
            $('cfg-check').value = preset.CHECK_INTERVAL;
            $('cfg-delay').value = preset.REQUEST_DELAY;
            $('cfg-query').value = preset.QUERY_EVERY_N_ROUNDS;
            $('cfg-full').value = preset.RETRY_FULL_EVERY_N_ROUNDS;
        };

        $('cfg-speed').value = speedPresetKey;
        $('cfg-speed').addEventListener('change', updateSpeedPresetUI);
        ['cfg-check', 'cfg-delay', 'cfg-query', 'cfg-full'].forEach(id => {
            $(id).addEventListener('input', () => {
                $('cfg-speed').value = 'custom';
                $('cfg-speed-hint').textContent = '使用下面的高级参数。';
                $('cfg-advanced').open = true;
            });
        });

        $('cfg-auto-refresh').checked = CONFIG.AUTO_REFRESH;
        $('cfg-auto-relogin').checked = CONFIG.AUTO_RELOGIN;
        $('cfg-stop-success').checked = CONFIG.STOP_ON_SUCCESS;
        $('cfg-sound').checked = CONFIG.SOUND_ALERT;
        $('cfg-notify').checked = CONFIG.DESKTOP_NOTIFICATION;
        $('cfg-captcha').checked = CONFIG.CAPTCHA_AUTO_SOLVE;
        $('cfg-textbook').value = CONFIG.TEXTBOOK_CHOICE;
        updateSpeedPresetUI();

        const close = () => mask.remove();
        mask.addEventListener('click', e => { if (e.target === mask) close(); });
        $('cfg-cancel').onclick = close;
        $('cfg-defaults').onclick = () => {
            $('cfg-targets').value = DEFAULT_TARGET_TCIDS.map(tcid => `${tcid} XGXK`).join('\n');
        };
        $('cfg-save').onclick = () => {
            const previousMeta = { ...TARGET_META };
            const entries = parseTargetEntries($('cfg-targets').value);
            if (entries.missingTypes?.length) {
                alert(`以下教学班 ID 缺少课程类型，请按“教学班ID 类型”填写：\n${entries.missingTypes.join('\n')}`);
                return;
            }
            const wasRunning = isRunning;
            if (wasRunning) stop();

            CONFIG.STUDENT_CODE = $('cfg-student').value.trim();
            CONFIG.LOGIN_NAME = $('cfg-login-name').value.trim();
            CONFIG.LOGIN_PASSWORD = $('cfg-login-password').value;
            CONFIG.TARGET_TCIDS.splice(0, CONFIG.TARGET_TCIDS.length);
            Object.keys(TARGET_META).forEach(k => delete TARGET_META[k]);
            entries.forEach(({ id, type }) => setTarget(id, { ...previousMeta[id], type }));
            if (!applySpeedPreset($('cfg-speed').value)) {
                CONFIG.CHECK_INTERVAL = numOr($('cfg-check').value, CONFIG.CHECK_INTERVAL, 500);
                CONFIG.REQUEST_DELAY = numOr($('cfg-delay').value, CONFIG.REQUEST_DELAY, 0);
                CONFIG.QUERY_EVERY_N_ROUNDS = Math.max(1, Math.floor(numOr($('cfg-query').value, CONFIG.QUERY_EVERY_N_ROUNDS, 1)));
                CONFIG.RETRY_FULL_EVERY_N_ROUNDS = Math.max(1, Math.floor(numOr($('cfg-full').value, CONFIG.RETRY_FULL_EVERY_N_ROUNDS, 1)));
            }
            CONFIG.AUTO_REFRESH_INTERVAL = numOr($('cfg-refresh-interval').value, CONFIG.AUTO_REFRESH_INTERVAL, 30000);
            CONFIG.AUTO_LOGIN_DELAY = numOr($('cfg-login-delay').value, CONFIG.AUTO_LOGIN_DELAY, 0);
            CONFIG.AUTO_REFRESH = $('cfg-auto-refresh').checked;
            CONFIG.AUTO_RELOGIN = $('cfg-auto-relogin').checked;
            CONFIG.STOP_ON_SUCCESS = $('cfg-stop-success').checked;
            CONFIG.SOUND_ALERT = $('cfg-sound').checked;
            CONFIG.DESKTOP_NOTIFICATION = $('cfg-notify').checked;
            CONFIG.CAPTCHA_AUTO_SOLVE = $('cfg-captcha').checked;
            CONFIG.TEXTBOOK_CHOICE = $('cfg-textbook').value;

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
            let name = cleanCourseName(meta.name) || '等待查询课程名称', text = `${meta.type || getTeachingClassType(tcid)} 等待查询`, cls = 'ts-wait';
            if (s) {
                name = cleanCourseName(`${s.name}[${s.courseIndex}]`);
                if (s.isConflict === '1') { text = `${meta.type} 冲突 ${s.numberOfSelected}/${s.classCapacity}`; cls = 'ts-cf'; }
                else if (s.isFull === '0') { text = `${meta.type} 可选 ${s.numberOfSelected}/${s.classCapacity}`; cls = 'ts-ok'; }
                else { text = `${meta.type} 已满 ${s.numberOfSelected}/${s.classCapacity}`; cls = 'ts-full'; }
            }
            return `<div class="ti"><div class="td"><div class="tn" title="${escHtml(name)}">${escHtml(name)}</div><div class="tid" title="${escHtml(tcid)}">${escHtml(tcid)}</div></div><div class="ta"><span class="ts ${cls}">${escHtml(text)}</span><button class="sniper-remove-target" data-tcid="${escHtml(tcid)}" title="移除">×</button></div></div>`;
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

    function playAlertSound() {
        if (!CONFIG.SOUND_ALERT) return;
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            [0, 220, 440].forEach(d => {
                setTimeout(() => {
                    const o = ctx.createOscillator(), g = ctx.createGain();
                    o.connect(g); g.connect(ctx.destination);
                    o.frequency.value = 420; o.type = 'square'; g.gain.value = 0.18;
                    o.start(); setTimeout(() => o.stop(), 180);
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

    function remindManualCaptchaNeeded(tip, message = '验证码自动识别失败，请手动输入验证码') {
        if (tip) tip.innerHTML = `抢课助手：${escHtml(message)}，填满 ${CONFIG.CAPTCHA_LENGTH} 位后会自动提交`;
        playAlertSound();
        showNotification('抢课助手需要手动验证码', `${message}。请回到登录页手动输入验证码。`);
    }

    // ===================== 自动登录 =====================
    function isLoginPage() {
        if (!location.href.includes('index.do') || !$('studentLoginBtn') || !$('loginName') || !$('loginPwd')) return false;
        if (getToken() && !isVisibleElement($('loginDiv'))) return false;
        return isVisibleElement($('studentLoginBtn')) && isVisibleElement($('loginName'));
    }

    function isLoginFormReady() {
        const account = $('loginName')?.value?.trim();
        const password = $('loginPwd')?.value;
        return Boolean(account && password && getStableCaptchaValue());
    }

    async function submitLoginCandidate(candidate) {
        const account = $('loginName')?.value?.trim();
        const password = $('loginPwd')?.value;
        const vtoken = sessionStorage.getItem('vtoken') || '';
        if (!account || !password || !candidate || !vtoken) {
            return { ok: false, code: '', msg: '账号、密码或验证码缺失' };
        }
        const base64Api = window.$?.base64 || window.jQuery?.base64;
        if (typeof getDesKeys !== 'function' || typeof strEnc !== 'function' || !base64Api?.encode) {
            return { ok: false, code: '', msg: '页面加密函数未就绪' };
        }
        const keys = getDesKeys();
        const loginPwd = base64Api.encode(strEnc(password, keys[0], keys[1], keys[2]));
        const params = new URLSearchParams({
            loginName: account,
            loginPwd,
            verifyCode: candidate,
            vtoken,
        });
        const base = window.BaseUrl || '/xsxkapp';
        const response = await fetch(`${base}/sys/xsxkapp/student/check/login.do?timestrap=${Date.now()}&${params.toString()}`, {
            credentials: 'include',
        });
        const data = await response.json().catch(() => ({}));
        const code = String(data.code || '');
        if (code === '1' && data.data?.token) {
            sessionStorage.removeItem('token');
            sessionStorage.setItem('token', data.data.token);
            capturedToken = data.data.token;
            if (data.data.number && !CONFIG.STUDENT_CODE) capturedStudentCode = data.data.number;
            return { ok: true, code, msg: '登录成功', number: data.data.number || '' };
        }
        return { ok: false, code, msg: data.msg || '登录失败' };
    }

    function parseBatchFromRadio(input) {
        if (!input) return null;
        const raw = input.dataset?.value || input.getAttribute('data-value') || '';
        if (!raw) return null;
        try {
            return JSON.parse(raw);
        } catch (_) {
            return null;
        }
    }

    function getBatchRadioItems() {
        return Array.from(document.querySelectorAll('input.cv-electiveBatch-select, input[name="electiveBatchSelect"]'))
            .map(input => ({
                input,
                batch: parseBatchFromRadio(input),
                rowText: input.closest('tr')?.innerText?.replace(/\s+/g, ' ').trim() || '',
            }))
            .filter(item => item.batch?.code && !item.input.disabled && (isVisibleElement(item.input) || isVisibleElement(item.input.closest('tr'))));
    }

    function selectSavedOrDefaultBatch() {
        const items = getBatchRadioItems();
        if (!items.length) return null;

        const saved = readSavedBatch();
        const current = normalizeBatchSnapshot(readCurrentBatch());
        const preferredCode = saved?.code || current?.code || capturedBatchCode || '';
        let item = preferredCode ? items.find(next => next.batch.code === preferredCode) : null;
        if (!item) item = items.find(next => next.input.checked);
        if (!item) item = items.find(next => String(next.batch.canSelectCurrent || '') === '1');
        if (!item) item = items.find(next => String(next.batch.canSelect || '') === '1' && !next.batch.noSelectReason);
        if (!item) item = items[0];

        if (!item.input.checked) item.input.click();
        item.input.checked = true;
        item.input.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
        item.input.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
        rememberBatch(item.batch);
        return item.batch;
    }

    function findVisibleButtonByText(text) {
        return Array.from(document.querySelectorAll('button,a,input[type="button"]')).find(el => {
            const label = (el.innerText || el.textContent || el.value || '').replace(/\s+/g, '');
            return label === text && isVisibleElement(el);
        });
    }

    async function handleBatchDialogIfPresent(tip) {
        const items = getBatchRadioItems();
        if (!items.length) return false;

        const selected = selectSavedOrDefaultBatch();
        if (tip && selected?.name) tip.innerHTML = `抢课助手：已选择上次轮次「${escHtml(selected.name)}」，正在确认...`;
        await sleep(120);

        const confirmBtn = findVisibleButtonByText('确定');
        if (!confirmBtn) return true;
        confirmBtn.click();
        await sleep(800);
        rememberCurrentBatch();
        return true;
    }

    async function enterCoursePageFromHome(tip, timeout = 10000) {
        const start = Date.now();
        while (Date.now() - start < timeout) {
            rememberCurrentBatch();
            if (location.href.includes('curriculavariable.do') || location.href.includes('grablessons.do')) return true;
            await handleBatchDialogIfPresent(tip);
            const btn = $('courseBtn') || findVisibleButtonByText('开始选课');
            if (btn && isVisibleElement(btn)) {
                if (tip) tip.innerHTML = '抢课助手：正在进入选课界面...';
                btn.click();
                while (Date.now() - start < timeout) {
                    if (location.href.includes('curriculavariable.do') || location.href.includes('grablessons.do')) return true;
                    await sleep(200);
                }
                return false;
            }
            await sleep(300);
        }
        return false;
    }

    async function continueAfterLogin(number, shouldEnterCourse = false, tip = null) {
        const studentNumber = number || capturedStudentCode || CONFIG.LOGIN_NAME || $('loginName')?.value?.trim();
        if (window.CVStudentLogin?.studentInfo && studentNumber) {
            window.CVStudentLogin.studentInfo(studentNumber);
        } else {
            setTimeout(() => location.reload(), 300);
            return;
        }

        const start = Date.now();
        while (Date.now() - start < 12000) {
            await handleBatchDialogIfPresent(tip);
            const hasStudentInfo = Boolean(sessionStorage.getItem('studentInfo'));
            const hasCourseButton = $('courseBtn') && isVisibleElement($('courseBtn'));
            if (hasStudentInfo || hasCourseButton) break;
            await sleep(300);
        }
        rememberCurrentBatch();
        if (shouldEnterCourse) {
            const entered = await enterCoursePageFromHome(tip);
            if (!entered && tip) tip.innerHTML = '抢课助手：已登录，未找到开始选课按钮，请手动进入选课界面';
        }
    }

    function setInputValue(inputEl, value) {
        if (!inputEl) return;
        const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        const nextValue = String(value || '');
        if (nativeSetter) nativeSetter.call(inputEl, nextValue);
        else inputEl.value = nextValue;
        inputEl.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
        inputEl.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
        inputEl.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Unidentified' }));
    }

    function fillSavedLoginFields() {
        const loginName = $('loginName');
        const loginPwd = $('loginPwd');
        if (CONFIG.LOGIN_NAME && loginName && !loginName.value) setInputValue(loginName, CONFIG.LOGIN_NAME);
        if (CONFIG.LOGIN_PASSWORD && loginPwd && !loginPwd.value) setInputValue(loginPwd, CONFIG.LOGIN_PASSWORD);
    }

    function createLoginHelperPanel(shouldRecover) {
        const old = $('sniper-login-helper');
        if (old) old.remove();
        const panel = document.createElement('div');
        panel.id = 'sniper-login-helper';
        panel.style.cssText = 'position:fixed;top:12px;right:12px;z-index:999999;background:#fff;color:#1d1d1f;border:1px solid #e0e0e0;padding:10px 12px;border-radius:14px;font-size:13px;line-height:1.45;font-family:"SF Pro Text",system-ui,-apple-system,"Microsoft YaHei",sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.08);max-width:280px;';
        panel.innerHTML = `
            <div style="font-weight:600;margin-bottom:6px;">抢课助手登录恢复</div>
            <div id="sniper-login-tip">${shouldRecover ? '检测到运行中掉线，准备自动登录。' : '未处于运行恢复状态。'}</div>
            <button id="sniper-save-login" type="button" style="margin-top:8px;border:1px solid #0066cc;border-radius:9999px;background:#fff;color:#0066cc;padding:5px 10px;cursor:pointer;">保存当前账号密码到本机</button>
        `;
        document.body.appendChild(panel);
        $('sniper-save-login').onclick = () => {
            CONFIG.LOGIN_NAME = $('loginName')?.value?.trim() || '';
            CONFIG.LOGIN_PASSWORD = $('loginPwd')?.value || '';
            saveUserConfig();
            const tip = $('sniper-login-tip');
            if (tip) tip.textContent = CONFIG.LOGIN_NAME && CONFIG.LOGIN_PASSWORD ? '已保存到本机脚本配置。' : '账号或密码为空，未保存完整登录信息。';
        };
        return $('sniper-login-tip');
    }

    function clearCaptchaInput() {
        const input = findCaptchaInput();
        if (input) {
            fillCaptchaInput(input, '');
            resetCaptchaStability();
        }
    }

    async function solveCaptchaForLogin(tip, refreshFirst = false) {
        if (!CONFIG.CAPTCHA_AUTO_SOLVE || !findCaptchaImage()) {
            return { ok: false, msg: '验证码自动识别未启用' };
        }
        if (refreshFirst) {
            await refreshCaptchaAndWait();
        }
        tip.innerHTML = '抢课助手：正在识别验证码...';
        try {
            await loadTesseract();
            const result = await solveCaptchaOnce();
            if (result.ok) {
                window.__sniperCaptchaCandidates = result.candidates || [result.value];
                tip.innerHTML = `抢课助手：验证码已填入，准备验证 ${window.__sniperCaptchaCandidates.length} 个候选...`;
            }
            return result;
        } catch (e) {
            return { ok: false, msg: e.message };
        }
    }

    function tryAutoLogin() {
        if (!isLoginPage()) return false;

        const shouldRecover = CONFIG.AUTO_RELOGIN && hasRecentRunningState();
        prepareLoginInputs();
        setTimeout(() => {
            fillSavedLoginFields();
            prepareLoginInputs();
            clearStaleCaptchaAutofill();
        }, 250);
        const helperTip = createLoginHelperPanel(shouldRecover);
        if (!shouldRecover && !CONFIG.AUTO_LOGIN_DELAY) return false;

        const delay = shouldRecover ? CONFIG.AUTO_RELOGIN_DELAY : CONFIG.AUTO_LOGIN_DELAY;
        const startedAt = Date.now();
        let autoCaptchaAttempt = 0;
        let captchaSolving = false;
        let loginLoopBusy = false;
        let loginFinished = false;
        let waitManualCaptcha = false;
        const maxWaitMs = Math.max(30 * 60 * 1000, delay * 1000 + CONFIG.CAPTCHA_TRY_LIMIT * 20000);
        console.log(`[抢课助手] 🔐 登录页面，${delay}秒后尝试自动登录`);

        const tip = helperTip || createLoginHelperPanel(shouldRecover);
        tip.innerHTML = shouldRecover ? '检测到运行中掉线，准备自动登录...' : '准备自动登录...';

        const timer = setInterval(async () => {
            if (loginFinished) return;
            if (loginLoopBusy) return;
            loginLoopBusy = true;
            try {
            const elapsed = Date.now() - startedAt;
            const waitLeft = Math.ceil((delay * 1000 - elapsed) / 1000);
            if (waitLeft > 0) {
                tip.innerHTML = `抢课助手：<b>${waitLeft}</b>秒后检查登录表单...`;
                return;
            }

            const btn = $('studentLoginBtn');
            if (!btn) {
                tip.innerHTML = '抢课助手：未找到登录按钮，请手动登录';
                clearInterval(timer);
                return;
            }

            if (captchaSolving) return;

            const hasAccount = Boolean($('loginName')?.value?.trim() && $('loginPwd')?.value);
            const captchaText = normalizeCaptchaText(findCaptchaInput()?.value || '');
            if (hasAccount && !captchaText && CONFIG.CAPTCHA_AUTO_SOLVE && !waitManualCaptcha) {
                captchaSolving = true;
                const result = await solveCaptchaForLogin(tip, autoCaptchaAttempt > 0);
                captchaSolving = false;
                if (!result.ok) {
                    autoCaptchaAttempt++;
                    console.warn(`[抢课助手] 验证码自动识别失败(${autoCaptchaAttempt}/${CONFIG.CAPTCHA_TRY_LIMIT}): ${result.msg}`);
                    if (autoCaptchaAttempt >= CONFIG.CAPTCHA_TRY_LIMIT) {
                        waitManualCaptcha = true;
                        clearCaptchaInput();
                        remindManualCaptchaNeeded(tip, `OCR 已尝试 ${CONFIG.CAPTCHA_TRY_LIMIT} 张验证码失败`);
                    } else {
                        tip.innerHTML = `抢课助手：验证码识别失败，准备换一张 (${autoCaptchaAttempt + 1}/${CONFIG.CAPTCHA_TRY_LIMIT})...`;
                        clearCaptchaInput();
                    }
                    return;
                }
            }

            if (isLoginFormReady()) {
                const candidateText = getStableCaptchaValue();
                const useAutoCandidates = !waitManualCaptcha && Boolean(window.__sniperCaptchaCandidates?.length);
                if (useAutoCandidates) autoCaptchaAttempt++;
                const candidates = useAutoCandidates
                    ? window.__sniperCaptchaCandidates.slice(0, CONFIG.CAPTCHA_CANDIDATES_PER_IMAGE)
                    : [candidateText];
                tip.innerHTML = useAutoCandidates
                    ? `抢课助手：正在验证第 ${autoCaptchaAttempt}/${CONFIG.CAPTCHA_TRY_LIMIT} 张验证码的 ${candidates.length} 个候选...`
                    : '抢课助手：正在提交手动验证码...';
                try {
                    for (const candidate of candidates) {
                        if (useAutoCandidates) {
                            fillCaptchaInput($('verifyCode'), candidate);
                            await sleep(120);
                        }
                        console.log(`[抢课助手] 🔐 验证验证码候选: ${candidate}`);
                        const result = await submitLoginCandidate(candidate);
                        lastLoginResult = { at: Date.now(), code: result.code, msg: result.msg };
                        if (result.ok) {
                            loginFinished = true;
                            clearInterval(timer);
                            tip.innerHTML = '抢课助手：登录成功，正在进入选课系统...';
                            window.__sniperCaptchaCandidates = [];
                            await continueAfterLogin(result.number, shouldRecover, tip);
                            return;
                        }
                        if (result.code === '2') {
                            tip.innerHTML = '抢课助手：账号或密码不正确，请手动处理';
                            clearInterval(timer);
                            return;
                        }
                        if (result.code === '4') {
                            tip.innerHTML = '抢课助手：在线人数超过上限，稍后继续重试登录...';
                            if (useAutoCandidates) autoCaptchaAttempt = Math.max(0, autoCaptchaAttempt - 1);
                            await sleep(3000);
                            return;
                        }
                    }
                } catch (e) {
                    console.warn('[抢课助手] 登录候选验证异常:', e);
                    tip.innerHTML = useAutoCandidates && autoCaptchaAttempt < CONFIG.CAPTCHA_TRY_LIMIT
                        ? `抢课助手：登录验证异常，准备换一张 (${autoCaptchaAttempt + 1}/${CONFIG.CAPTCHA_TRY_LIMIT})...`
                        : '抢课助手：登录验证异常，请重新输入验证码';
                }
                window.__sniperCaptchaCandidates = [];
                clearCaptchaInput();
                await refreshCaptchaAndWait();
                if (useAutoCandidates && autoCaptchaAttempt >= CONFIG.CAPTCHA_TRY_LIMIT) {
                    waitManualCaptcha = true;
                    remindManualCaptchaNeeded(tip, `验证码已尝试 ${CONFIG.CAPTCHA_TRY_LIMIT} 次失败`);
                } else {
                    tip.innerHTML = useAutoCandidates
                        ? `抢课助手：验证码候选均不正确，准备换一张 (${autoCaptchaAttempt + 1}/${CONFIG.CAPTCHA_TRY_LIMIT})...`
                        : `抢课助手：验证码不正确，请重新输入 ${CONFIG.CAPTCHA_LENGTH} 位验证码`;
                }
                return;
            }

            if (elapsed > maxWaitMs) {
                tip.innerHTML = '抢课助手：等待账号、密码或验证码，请手动登录';
                clearInterval(timer);
                return;
            }

            tip.innerHTML = CONFIG.CAPTCHA_AUTO_SOLVE
                ? '抢课助手：等待账号、密码和验证码填充...'
                : `抢课助手：请手动输入 ${CONFIG.CAPTCHA_LENGTH} 位验证码，填好后会自动提交`;
            } finally {
                loginLoopBusy = false;
            }
        }, 500);

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

        rememberCurrentBatch();

        // 自动恢复
        if (hasRecentRunningState()) {
            if (location.href.includes('index.do') && !location.href.includes('curriculavariable.do') && !location.href.includes('grablessons.do')) {
                log('🔄 检测到运行中掉线，准备进入选课界面...', 'info');
                setTimeout(async () => {
                    const entered = await enterCoursePageFromHome(null);
                    if (!entered) log('⚠️ 未能自动进入选课界面，请手动点击“开始选课”', 'warning');
                }, 800);
            } else {
                log('🔄 检测到刷新，2秒后自动恢复...', 'info');
                setTimeout(start, 2000);
            }
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
