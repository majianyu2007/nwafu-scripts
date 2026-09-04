// ==UserScript==
// @name        U校园答案显示器
// @version     1.0.0
// @description 在 U校园练习页面读取并显示答案，支持部分题型填充和题目切换刷新。
// @match       https://sso.unipus.cn/*
// @match       https://uai.unipus.cn/*
// @match       https://ucontent.unipus.cn/*
// @icon        https://ucontent.unipus.cn/favicon.ico
// @grant       GM_xmlhttpRequest
// @grant       GM_addStyle
// @grant       GM_getValue
// @grant       GM_setValue
// @connect     ucontent.unipus.cn
// @connect     uai.unipus.cn
// @connect     sso.unipus.cn
// @require     https://cdnjs.cloudflare.com/ajax/libs/crypto-js/4.1.1/crypto-js.min.js
// @run-at      document-end
// @namespace   https://mjy.js.org/nwafu-scripts/
// @author      majianyu2007
// @license     MIT
// @homepageURL https://mjy.js.org/nwafu-scripts/scripts/unipus-answer-viewer/
// @supportURL  https://github.com/majianyu2007/nwafu-scripts/issues
// @updateURL   https://mjy.js.org/nwafu-scripts/userscripts/unipus-answer-viewer.user.js
// @downloadURL https://mjy.js.org/nwafu-scripts/userscripts/unipus-answer-viewer.user.js
// ==/UserScript==

(function () {
    'use strict';

    // ==================== 配置常量 ====================
    const CONFIG = {
        JWT_SECRET: 'a824b379f126b8b7aa5e33dee83fb0a05aa7462c',
        KEY_PREFIX: '1a2b3c4d',
        API_BASE: {
            MAIN: 'https://uai.unipus.cn',
            CONTENT: 'https://ucontent.unipus.cn',
            SSO: 'https://sso.unipus.cn'
        }
    };

    // ==================== 调试日志系统 ====================
    const Logger = {
        enabled: false, // 改为 false 以减少生产环境下的控制台输出
        prefix: '[U校园答案]',

        log(message, data = null) {
            if (!this.enabled) return;
            console.log(`${this.prefix} ${message}`, data || '');
        },

        info(message, data = null) {
            if (!this.enabled) return;
            console.info(`${this.prefix} ℹ️ ${message}`, data || '');
        },

        warn(message, data = null) {
            if (!this.enabled) return;
            console.warn(`${this.prefix} ⚠️ ${message}`, data || '');
        },

        error(message, error = null) {
            if (!this.enabled) return;
            console.error(`${this.prefix} ❌ ${message}`, error || '');
        },

        success(message, data = null) {
            if (!this.enabled) return;
            console.log(`${this.prefix} ✅ ${message}`, data || '');
        },

        group(title, callback) {
            if (!this.enabled) {
                return callback();
            }
            console.group(`${this.prefix} ${title}`);
            try {
                const result = callback();
                if (result && typeof result.then === 'function') {
                    return result.finally(() => console.groupEnd());
                }
                console.groupEnd();
                return result;
            } catch (error) {
                console.groupEnd();
                throw error;
            }
        }
    };

    // ==================== 工具函数 ====================
    const Utils = {
        /**
         * Hex字符串转字节数组
         */
        hexToBytes(hex) {
            const bytes = [];
            for (let i = 0; i < hex.length; i += 2) {
                bytes.push(parseInt(hex.substr(i, 2), 16));
            }
            Logger.log(`Hex转字节数组: ${hex.length}个字符 -> ${bytes.length}个字节`);
            return bytes;
        },

        /**
         * 字节数组转Hex字符串
         */
        bytesToHex(bytes) {
            return Array.from(bytes, byte => {
                return ('0' + (byte & 0xFF).toString(16)).slice(-2);
            }).join('');
        },

        /**
         * 去除字节数组尾部的0填充
         */
        removePadding(bytes) {
            let i = bytes.length;
            while (i > 0 && bytes[i - 1] === 0) {
                i--;
            }
            const result = bytes.slice(0, i);
            Logger.log(`去除填充: ${bytes.length}字节 -> ${result.length}字节`);
            return result;
        },

        /**
         * 生成JWT认证令牌
         */
        generateAuthToken(openId) {
            Logger.group('生成JWT令牌', () => {
                Logger.log('OpenId:', openId);

                const header = {
                    typ: 'JWT',
                    alg: 'HS256'
                };

                const payload = {
                    open_id: openId || '',
                    name: '',
                    email: '',
                    administrator: false,
                    exp: Date.now() + 31536000000, // 一年后过期
                    iss: 'c4f772063dcfa98e9c50',
                    aud: 'edx.unipus.cn'
                };

                Logger.log('JWT Header:', header);
                Logger.log('JWT Payload:', payload);

                // Base64url编码
                const base64UrlEncode = (obj) => {
                    const str = JSON.stringify(obj);
                    const base64 = CryptoJS.enc.Base64.stringify(CryptoJS.enc.Utf8.parse(str));
                    return base64.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
                };

                const encodedHeader = base64UrlEncode(header);
                const encodedPayload = base64UrlEncode(payload);

                Logger.log('Encoded Header:', encodedHeader);
                Logger.log('Encoded Payload:', encodedPayload);

                // HS256签名
                const signatureInput = `${encodedHeader}.${encodedPayload}`;
                const signature = CryptoJS.HmacSHA256(signatureInput, CONFIG.JWT_SECRET);
                const encodedSignature = CryptoJS.enc.Base64.stringify(signature)
                    .replace(/=/g, '')
                    .replace(/\+/g, '-')
                    .replace(/\//g, '_');

                const token = `${signatureInput}.${encodedSignature}`;
                Logger.success('JWT令牌生成成功');
                Logger.log('Token长度:', token.length);
            });

            const header = btoa(JSON.stringify({ typ: 'JWT', alg: 'HS256' })).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
            const payload = btoa(JSON.stringify({
                open_id: openId || '',
                name: '',
                email: '',
                administrator: false,
                exp: Date.now() + 31536000000,
                iss: 'c4f772063dcfa98e9c50',
                aud: 'edx.unipus.cn'
            })).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

            const signatureInput = `${header}.${payload}`;
            const signature = CryptoJS.HmacSHA256(signatureInput, CONFIG.JWT_SECRET);
            const encodedSignature = CryptoJS.enc.Base64.stringify(signature)
                .replace(/=/g, '')
                .replace(/\+/g, '-')
                .replace(/\//g, '_');

            return `${signatureInput}.${encodedSignature}`;
        },

        /**
         * 解密答案数据
         */
        decryptAnswer(encryptedData, k) {
            try {
                Logger.log('🔓 开始解密答案数据');
                Logger.log('加密数据:', encryptedData.substring(0, 50) + '...');
                Logger.log('密钥片段 k:', k);

                // 1. 移除"unipus."前缀
                if (!encryptedData.startsWith('unipus.')) {
                    Logger.warn('数据不是以"unipus."开头');
                    return encryptedData;
                }
                const hexCipher = encryptedData.substring('unipus.'.length);
                Logger.log('移除前缀后:', hexCipher.substring(0, 50) + '...');

                // 2. 构造密钥
                const keyString = CONFIG.KEY_PREFIX + k;
                Logger.log('完整密钥:', keyString);

                // 3. Hex转字节数组
                const cipherBytes = this.hexToBytes(hexCipher);
                Logger.log('密文字节长度:', cipherBytes.length);

                // 4. 转换为Base64 (匹配Java的逻辑)
                const base64Cipher = btoa(String.fromCharCode.apply(null, cipherBytes));
                Logger.log('Base64密文长度:', base64Cipher.length);

                // 5. 准备密钥
                const keyWords = CryptoJS.enc.Utf8.parse(keyString);

                Logger.log('准备解密...');

                // 6. AES解密 (ECB模式，无填充)
                const decrypted = CryptoJS.AES.decrypt(
                    base64Cipher,
                    keyWords,
                    {
                        mode: CryptoJS.mode.ECB,
                        padding: CryptoJS.pad.NoPadding
                    }
                );

                Logger.log('解密完成，准备转换为字符串...');

                // 7. 转换为字节数组
                const decryptedBytes = [];
                const words = decrypted.words;
                const sigBytes = decrypted.sigBytes;

                for (let i = 0; i < sigBytes; i++) {
                    const byte = (words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff;
                    decryptedBytes.push(byte);
                }

                Logger.log('解密字节长度:', decryptedBytes.length);

                // 8. 去除尾部的0填充
                let endIndex = decryptedBytes.length;
                while (endIndex > 0 && decryptedBytes[endIndex - 1] === 0) {
                    endIndex--;
                }
                const cleanBytes = decryptedBytes.slice(0, endIndex);
                Logger.log('去除填充后长度:', cleanBytes.length);

                // 9. 转换为UTF-8字符串
                const plaintext = new TextDecoder('utf-8').decode(new Uint8Array(cleanBytes));
                Logger.success('✅ 解密成功！');
                Logger.log('明文长度:', plaintext.length);
                Logger.log('明文预览:', plaintext.substring(0, 100));

                // 保存到调试对象
                if (window.UnipusAnswerDebug) {
                    window.UnipusAnswerDebug.lastDecryptedData = plaintext;
                }

                return plaintext;
            } catch (error) {
                Logger.error('解密失败:', error);
                throw error;
            }
        },

        /**
         * 从JWT token中解析openId
         */
        parseJwtToken(token) {
            try {
                // JWT格式: header.payload.signature
                const parts = token.split('.');
                if (parts.length !== 3) {
                    Logger.warn('JWT格式不正确');
                    return null;
                }

                // 解码payload (Base64Url)
                const payload = parts[1];
                // Base64Url to Base64
                const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
                // 添加padding
                const padded = base64.padEnd(base64.length + (4 - base64.length % 4) % 4, '=');

                // 解码
                const decoded = atob(padded);
                const payloadObj = JSON.parse(decoded);

                Logger.log('JWT Payload解析成功:', payloadObj);
                return payloadObj.openId || payloadObj.open_id || payloadObj.openid;
            } catch (error) {
                Logger.error('解析JWT失败:', error);
                return null;
            }
        },

        /**
         * 从Cookie或localStorage获取openId
         */
        getOpenId() {
            try {
                Logger.log('开始查找OpenId...');

                // 优先方案:从Cookie中的JWT token解析
                Logger.log('方案1: 从Cookie的JWT token中提取');
                const jwtMatch = document.cookie.match(/jwt=([^;]+)/);
                if (jwtMatch) {
                    const jwtToken = jwtMatch[1];
                    Logger.log('找到JWT token:', jwtToken.substring(0, 50) + '...');
                    const openId = this.parseJwtToken(jwtToken);
                    if (openId) {
                        Logger.success('✅ 从JWT token成功提取OpenId:', openId);
                        return openId;
                    }
                }

                // 备用方案:从其他位置查找
                Logger.log('方案2: 尝试其他存储位置');

                const sources = [
                    // 从localStorage
                    () => localStorage.getItem('openId'),
                    () => localStorage.getItem('open_id'),
                    () => localStorage.getItem('openid'),

                    // 从localStorage的JSON对象
                    () => {
                        const userInfo = localStorage.getItem('userInfo');
                        if (!userInfo) return null;
                        try {
                            const obj = JSON.parse(userInfo);
                            return obj.openId || obj.open_id || obj.openid;
                        } catch (e) { return null; }
                    },

                    // 从Cookie直接匹配
                    () => {
                        const patterns = [
                            /openId=([^;]+)/,
                            /open_id=([^;]+)/,
                            /openid=([^;]+)/
                        ];
                        for (const pattern of patterns) {
                            const match = document.cookie.match(pattern);
                            if (match) return match[1];
                        }
                        return null;
                    },

                    // 从全局变量
                    () => {
                        if (window.userInfo?.openId) return window.userInfo.openId;
                        if (window.user?.openId) return window.user.openId;
                        if (window.appData?.openId) return window.appData.openId;
                        return null;
                    },

                    // 从sessionStorage
                    () => {
                        const openId = sessionStorage.getItem('openId') ||
                            sessionStorage.getItem('open_id') ||
                            sessionStorage.getItem('openid');
                        return openId;
                    }
                ];

                for (let i = 0; i < sources.length; i++) {
                    try {
                        const openId = sources[i]();
                        if (openId) {
                            Logger.success(`✅ 找到OpenId (备用来源${i + 1}):`, openId);
                            return openId;
                        }
                    } catch (e) {
                        Logger.warn(`备用来源${i + 1}检查失败:`, e.message);
                    }
                }

                Logger.error('❌ 未能从任何位置找到OpenId');
                Logger.warn('请确认已登录U校园账号');
                return null;
            } catch (error) {
                Logger.error('获取OpenId失败:', error);
                return null;
            }
        },

        /**
         * 从URL或页面上下文中提取courseInstanceId和taskId
         */
        getTaskInfo() {
            try {
                Logger.log('📍 提取任务信息');

                // 从URL中提取
                const url = window.location.href;
                Logger.log('当前URL:', url);

                // 尝试多种模式匹配
                const patterns = [
                    // 新格式: #/course-v2:xxx/courseware/xxx/xxx/xxx/xxx
                    /#\/(course-v2:[^\/]+)\/courseware\/[^\/]+\/[^\/]+\/[^\/]+\/([^\/\?]+)/,
                    // 标准格式: course/course-v2:xxx/taskId
                    /course\/(course-v2:[^\/]+)\/([^\/]+)/,
                    // 查询参数格式
                    /instanceId=(course-v2:[^&]+).*taskId=([^&]+)/,
                    // Tutorial格式
                    /tutorial\/(course-v2:[^\/]+)/,
                    // 简化的hash格式
                    /#\/(course-v2:[^\/]+)/
                ];

                for (const pattern of patterns) {
                    const match = url.match(pattern);
                    if (match) {
                        const result = {
                            courseInstanceId: match[1],
                            taskId: match[2] || this.extractTaskIdFromPath(url)
                        };

                        Logger.success('✅ 从URL提取成功');
                        Logger.log('匹配模式:', pattern.toString());
                        Logger.log('courseInstanceId:', result.courseInstanceId);
                        Logger.log('taskId:', result.taskId);

                        return result;
                    }
                }

                // 从页面上下文中查找
                if (window.appContext) {
                    Logger.log('从window.appContext提取');
                    return {
                        courseInstanceId: window.appContext.courseId,
                        taskId: window.appContext.taskId
                    };
                }

                Logger.warn('❌ 无法从URL或页面上下文提取任务信息');
                return null;
            } catch (error) {
                Logger.error('提取任务信息失败:', error);
                return null;
            }
        },

        /**
         * 从URL路径中提取taskId（最后一个路径段）
         */
        extractTaskIdFromPath(url) {
            try {
                // 提取hash后的路径部分
                const hashPart = url.split('#')[1];
                if (!hashPart) return null;

                // 移除查询参数
                const path = hashPart.split('?')[0];

                // 获取路径段
                const segments = path.split('/').filter(s => s);

                // 返回最后一个非空段作为taskId
                const taskId = segments[segments.length - 1];
                Logger.log('从路径提取taskId:', taskId);
                return taskId;
            } catch (error) {
                Logger.error('提取taskId失败:', error);
                return null;
            }
        },

        /**
         * 解析答案JSON并格式化显示
         */
        parseAnswerJSON(jsonString, questionType = 'UNKNOWN') {
            try {
                Logger.log('📋 解析答案JSON');
                Logger.log('JSON长度:', jsonString.length);
                Logger.log('题型:', questionType);
                Logger.log('JSON内容预览:', jsonString.substring(0, 500));

                const data = JSON.parse(jsonString);
                Logger.log('JSON解析成功,数据类型:', typeof data);
                Logger.log('是否为数组:', Array.isArray(data));
                Logger.log('数据长度/键数:', Array.isArray(data) ? data.length : Object.keys(data).length);

                if (!Array.isArray(data) || data.length === 0) {
                    Logger.warn('答案数组为空或不是数组');
                    Logger.log('完整数据:', data);
                    return [];
                }

                const answers = [];

                data.forEach((item, index) => {
                    try {
                        Logger.log(`🔍 处理第${index + 1}题`);
                        Logger.log('原始item:', JSON.stringify(item).substring(0, 200));
                        Logger.log('item完整内容:', item);  // 输出完整对象以便查看

                        const answerObj = JSON.parse(item.answer || '{}');
                        const analysisObj = JSON.parse(item.analysis || '{}');

                        Logger.log('Answer对象结构:', JSON.stringify(answerObj).substring(0, 300));
                        Logger.log('Answer完整对象:', answerObj);  // 输出完整answer对象
                        Logger.log('Analysis对象结构:', JSON.stringify(analysisObj).substring(0, 300));
                        Logger.log('Analysis完整对象:', analysisObj);  // 输出完整analysis对象

                        const questionAnswers = [];

                        // 策略1: 从answer.children[].answers提取
                        if (answerObj.children && Array.isArray(answerObj.children)) {
                            Logger.log(`策略1: answer.children有${answerObj.children.length}个子项`);
                            answerObj.children.forEach((child, i) => {
                                let childMatched = false;
                                if (child.answers && Array.isArray(child.answers)) {
                                    Logger.log(`    找到${child.answers.length}个答案`);
                                    questionAnswers.push(child.answers);
                                    childMatched = true;
                                }

                                if (!childMatched) {
                                    // 检查是否有其他可能的答案字段
                                    const possibleKeys = ['answer', 'value', 'text', 'content', 'correct', 'correctAnswer'];
                                    for (const key of possibleKeys) {
                                        if (child[key] && child[key] !== '') {
                                            Logger.log(`    在子项${i}中找到字段"${key}":`, child[key]);
                                            questionAnswers.push([child[key]]);
                                            break;
                                        }
                                    }
                                }
                            });
                        }

                        // 策略2: 从analysis.children[].analysis提取
                        if (questionAnswers.length === 0 && analysisObj.children) {
                            Logger.log(`策略2: 尝试从analysis.children提取`);
                            if (Array.isArray(analysisObj.children)) {
                                analysisObj.children.forEach((child, i) => {
                                    if (child.analysis && child.analysis.trim() !== '') {
                                        questionAnswers.push([child.analysis]);
                                    }
                                });
                            }
                        }

                        // 策略3: 从根级analysis提取
                        if (questionAnswers.length === 0 && analysisObj.analysis) {
                            Logger.log(`策略3: 从根级analysis提取`);
                            questionAnswers.push([analysisObj.analysis]);
                        }

                        // 策略4: 尝试从answer直接提取answers数组
                        if (questionAnswers.length === 0 && answerObj.answers && Array.isArray(answerObj.answers)) {
                            Logger.log(`策略4: 从answer.answers直接提取`);
                            // 默认将连续的数组元素算作独立空（U校园通常情况）。如果属于同一空多解，也可降级为选第一项。
                            answerObj.answers.forEach(ans => questionAnswers.push([ans]));
                        }

                        // 策略5: 尝试从item直接获取
                        if (questionAnswers.length === 0) {
                            Logger.log(`策略5: 检查item的其他字段`);
                            const possibleFields = ['correctAnswer', 'correct_answer', 'standardAnswer', 'standard_answer'];
                            for (const field of possibleFields) {
                                if (item[field]) {
                                    Logger.log(`  找到字段: ${field}`);
                                    if (Array.isArray(item[field])) {
                                        item[field].forEach(ans => questionAnswers.push([ans]));
                                    } else {
                                        questionAnswers.push([item[field]]);
                                    }
                                    break;
                                }
                            }
                        }

                        Logger.log(`✓ 第${index + 1}题提取到${questionAnswers.length}个题空`);
                        if (questionAnswers.length === 0) {
                            Logger.warn(`⚠️ 第${index + 1}题未能提取到答案`);
                        }

                        answers.push({
                            id: item.id,
                            quesId: item.quesId,
                            answers: questionAnswers,
                            content: item.content,
                            rawItem: item,  // 保留原始数据用于调试
                            isEmpty: questionAnswers.length === 0,
                            hasEmptyChildren: answerObj.children && answerObj.children.every(c => Object.keys(c).length === 0)
                        });
                    } catch (e) {
                        Logger.error(`解析第${index + 1}题失败:`, e);
                        Logger.log('失败的item:', item);
                    }
                });

                const totalAnswers = answers.reduce((sum, a) => sum + a.answers.length, 0);
                Logger.success(`✅ 成功解析${answers.length}道题目,共${totalAnswers}个答案`);

                // 显示每题答案数统计
                Logger.log('各题答案数统计:');
                answers.forEach((item, i) => {
                    Logger.log(`  题${i + 1}: ${item.answers.length}个答案`);
                });

                // 保存到调试对象
                if (window.UnipusAnswerDebug) {
                    window.UnipusAnswerDebug.lastParsedAnswers = answers;
                }

                return answers;
            } catch (error) {
                Logger.error('解析答案JSON失败:', error);
                Logger.log('失败时的JSON:', jsonString);
                return [];
            }
        }
    };

    // ==================== API请求模块 ====================
    const API = {
        /**
         * 获取答案
         */
        async getAnswer(courseInstanceId, taskId, openId) {
            return new Promise((resolve, reject) => {
                Logger.group('请求答案API', () => {
                    Logger.log('courseInstanceId:', courseInstanceId);
                    Logger.log('taskId:', taskId);
                    Logger.log('openId:', openId);

                    const token = Utils.generateAuthToken(openId);
                    const url = `${CONFIG.API_BASE.CONTENT}/course/api/v3/answer/${courseInstanceId}/${taskId}/default`;

                    Logger.log('请求URL:', url);
                    Logger.log('Token长度:', token.length);

                    GM_xmlhttpRequest({
                        method: 'GET',
                        url: url,
                        headers: {
                            'x-annotator-auth-token': token,
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                            'Accept': 'application/json'
                        },
                        onload: function (response) {
                            Logger.group('API响应', () => {
                                Logger.log('状态码:', response.status);
                                Logger.log('响应头:', response.responseHeaders);

                                if (response.status === 200) {
                                    try {
                                        const data = JSON.parse(response.responseText);
                                        Logger.log('响应数据:', data);

                                        if (data.code === 0 && data.data) {
                                            Logger.success('成功获取加密答案');
                                            resolve(data);
                                        } else {
                                            Logger.error('API返回错误:', data.message || data.msg);
                                            reject(new Error(data.message || data.msg || '未知错误'));
                                        }
                                    } catch (e) {
                                        Logger.error('解析响应JSON失败:', e);
                                        Logger.log('原始响应:', response.responseText);
                                        reject(e);
                                    }
                                } else {
                                    Logger.error('HTTP错误:', response.status);
                                    Logger.log('响应内容:', response.responseText);
                                    reject(new Error(`HTTP ${response.status}`));
                                }
                            });
                        },
                        onerror: function (error) {
                            Logger.error('请求失败:', error);
                            reject(error);
                        },
                        ontimeout: function () {
                            Logger.error('请求超时');
                            reject(new Error('请求超时'));
                        },
                        timeout: 10000
                    });
                });
            });
        }
    };

    // ==================== 调试辅助 ====================
    // 暴露到全局,方便调试
    window.UnipusAnswerDebug = {
        lastDecryptedData: null,
        lastParsedAnswers: null,

        // 查看最后一次解密的原始数据
        showRawData() {
            if (this.lastDecryptedData) {
                console.log('====== 解密后的原始JSON数据 ======');
                console.log(this.lastDecryptedData);
                console.log('====== 尝试解析为JSON ======');
                try {
                    const parsed = JSON.parse(this.lastDecryptedData);
                    console.log('解析成功:', parsed);
                    return parsed;
                } catch (e) {
                    console.error('解析失败:', e);
                    return null;
                }
            } else {
                console.warn('还没有解密数据');
            }
        },

        // 查看最后一次解析的答案
        showParsedAnswers() {
            if (this.lastParsedAnswers) {
                console.log('====== 解析后的答案数据 ======');
                console.log(this.lastParsedAnswers);
                return this.lastParsedAnswers;
            } else {
                console.warn('还没有解析答案');
            }
        }
    };

    // ==================== UI模块 ====================
    const UI = {
        floatingWindow: null,

        /**
         * 创建悬浮窗
         */
        createFloatingWindow() {
            if (this.floatingWindow) {
                Logger.warn('悬浮窗已存在');
                return;
            }

            Logger.log('创建悬浮窗');

            const container = document.createElement('div');
            container.id = 'unipus-answer-float';
            container.innerHTML = `
                <div class="float-header">
                    <span class="float-title">U校园</span>
                    <div class="float-controls">
                        <button class="float-btn solo-btn" id="solo-mode-btn" title="开启后，切换题目将自动获取答案并填充">Solo</button>
                        <button class="float-btn" id="auto-fill-answers" title="一键填充答案">⚡</button>
                        <button class="float-btn" id="export-raw-data" title="导出原始数据(调试用)">📋</button>
                        <button class="float-btn" id="refresh-answer" title="刷新答案">🔄</button>
                        <button class="float-btn" id="minimize-answer" title="最小化">−</button>
                        <button class="float-btn" id="close-answer" title="关闭">×</button>
                    </div>
                </div>
                <div class="float-content">
                    <div class="status-area status-info" style="display:none;">
                        <span class="status-text">正在初始化...</span>
                    </div>
                    <div class="answer-area" style="display:none;">
                        <div class="answer-list"></div>
                    </div>
                </div>
            `;

            document.body.appendChild(container);
            this.floatingWindow = container;

            // 绑定事件
            this.bindEvents();

            Logger.success('悬浮窗创建成功');
        },

        /**
         * 绑定事件
         */
        bindEvents() {
            const container = this.floatingWindow;

            // 从 localStorage 恢复悬浮窗位置
            const savedPos = localStorage.getItem('unipus_float_pos');
            if (savedPos) {
                try {
                    const pos = JSON.parse(savedPos);
                    container.style.left = pos.left;
                    container.style.top = pos.top;
                    container.style.right = pos.right;
                    container.style.bottom = pos.bottom;
                } catch (e) { }
            }

            // 拖拽功能
            let isDragging = false;
            let currentX, currentY, initialX, initialY;

            const header = container.querySelector('.float-header');
            header.addEventListener('mousedown', (e) => {
                if (e.target.classList.contains('float-btn')) return;

                isDragging = true;
                initialX = e.clientX - container.offsetLeft;
                initialY = e.clientY - container.offsetTop;
            });

            document.addEventListener('mousemove', (e) => {
                if (!isDragging) return;

                e.preventDefault();
                currentX = e.clientX - initialX;
                currentY = e.clientY - initialY;

                container.style.left = currentX + 'px';
                container.style.top = currentY + 'px';
                container.style.right = 'auto';
                container.style.bottom = 'auto';
            });

            document.addEventListener('mouseup', () => {
                if (isDragging) {
                    isDragging = false;
                    // 停止拖拽时保存位置到 localStorage
                    localStorage.setItem('unipus_float_pos', JSON.stringify({
                        left: container.style.left,
                        top: container.style.top,
                        right: container.style.right,
                        bottom: container.style.bottom
                    }));
                }
            });

            // Solo 模式按钮
            const soloBtn = container.querySelector('#solo-mode-btn');
            if (soloBtn) {
                const isSoloSaved = localStorage.getItem('unipus_solo_mode') === 'true';
                if (isSoloSaved) soloBtn.classList.add('solo-active');

                soloBtn.addEventListener('click', () => {
                    const isActive = soloBtn.classList.toggle('solo-active');
                    localStorage.setItem('unipus_solo_mode', String(isActive));
                    this.showStatus(`Solo 模式已${isActive ? '开启 🚀' : '关闭'}`, 'info');
                });
            }

            // 一键填充答案按钮
            const autoFillBtn = container.querySelector('#auto-fill-answers');
            if (autoFillBtn) {
                autoFillBtn.addEventListener('click', () => {
                    Logger.log('用户请求一键填充答案');
                    this.autoFillAnswers();
                });
            }

            // 单个答案的复制 (使用事件委托)
            container.querySelector('.answer-list').addEventListener('click', (e) => {
                if (e.target.closest('.copy-single-btn')) {
                    const btn = e.target.closest('.copy-single-btn');
                    const textToCopy = btn.getAttribute('data-clipboard');
                    if (textToCopy) {
                        navigator.clipboard.writeText(textToCopy).then(() => {
                            const originalHTML = btn.innerHTML;
                            btn.innerHTML = '✅';
                            setTimeout(() => { btn.innerHTML = originalHTML; }, 1500);
                        }).catch(err => {
                            Logger.error('复制失败:', err);
                        });
                    }
                }
            });


            // 导出原始数据按钮
            const exportBtn = container.querySelector('#export-raw-data');
            exportBtn.addEventListener('click', () => {
                Logger.log('用户请求导出原始数据');
                const data = window.UnipusAnswerDebug.showRawData();
                if (data) {
                    alert('原始数据已输出到控制台，请按F12查看');
                }
            });

            // 刷新按钮
            const refreshBtn = container.querySelector('#refresh-answer');
            refreshBtn.addEventListener('click', () => {
                Logger.log('用户点击刷新按钮');
                this.loadAnswer();
            });

            // 最小化按钮
            const minimizeBtn = container.querySelector('#minimize-answer');
            minimizeBtn.addEventListener('click', () => {
                const content = container.querySelector('.float-content');
                if (content.style.display === 'none') {
                    content.style.display = 'block';
                    minimizeBtn.textContent = '−';
                } else {
                    content.style.display = 'none';
                    minimizeBtn.textContent = '+';
                }
            });

            // 关闭按钮
            const closeBtn = container.querySelector('#close-answer');
            closeBtn.addEventListener('click', () => {
                Logger.log('用户关闭悬浮窗');
                container.remove();
                this.floatingWindow = null;
            });
        },

        /**
         * 显示状态信息
         */
        showStatus(message, type = 'info') {
            const statusArea = this.floatingWindow.querySelector('.status-area');
            const statusText = statusArea.querySelector('.status-text');

            statusText.textContent = message;
            statusArea.className = `status-area status-${type}`;
            statusArea.style.display = 'block';

            const answerArea = this.floatingWindow.querySelector('.answer-area');
            answerArea.style.display = 'none';

            Logger.log(`显示状态: [${type}] ${message}`);
        },

        /**
         * 基于页面上的输入框数量，对齐并分配抓取到的答案
         * 解决：一个大题里有多个空白，但在 API 返回里被合并为一个数组的情况，
         * 以及：一个填空有多个可选答案的情况。
         */
        alignAnswers(answersData) {
            let displayList = [];
            let flatForFill = [];

            // 全新的清晰映射策略：answersData里的每个item有answers数组，每个元素代表一个填空/选项
            // 该填空/选项又是一个数组，包含了它的多个合法解（同义词）
            answersData.forEach(item => {
                if (item.answers && item.answers.length > 0) {
                    item.answers.forEach(ansArr => {
                        if (Array.isArray(ansArr) && ansArr.length > 0) {
                            const formattedArr = ansArr.map(a => this.stripAndFormatHtml(a));
                            // UI展示用 ' / ' 隔开同义选项，复制和一键填充只取第一个最标准的答案
                            displayList.push({ text: formattedArr.join(' / '), copyText: formattedArr[0] });
                            flatForFill.push(formattedArr[0]);
                        } else if (typeof ansArr === 'string') {
                            const formatted = this.stripAndFormatHtml(ansArr);
                            displayList.push({ text: formatted, copyText: formatted });
                            flatForFill.push(formatted);
                        }
                    });
                } else {
                    displayList.push({ text: '无答案', copyText: '' });
                    flatForFill.push('');
                }
            });

            return { displayList, flatForFill };
        },

        /**
         * HTML转义与过滤 (移除p和strong，真实化换行)
         */
        stripAndFormatHtml(htmlStr) {
            if (typeof htmlStr !== 'string') return htmlStr;
            let formatted = htmlStr
                .replace(/\\\\n/g, '\n') // 匹配字面量字符 '\n' (斜杠+n) 并换成真正的换行符
                .replace(/\\n/g, '\n')   // 如果本身就是换行符也可以保留
                .replace(/\\\\r/g, '')
                .replace(/<br\s*\/?>/gi, '\n')
                .replace(/<p.*?>/gi, '')
                .replace(/<\/p>/gi, '\n')
                .replace(/<strong.*?>/gi, '')
                .replace(/<\/strong>/gi, '');

            const div = document.createElement('div');
            div.innerHTML = formatted;
            let text = div.textContent.trim();

            // 双重保险：移除多个连续的换行，并替换为标准的换行展示
            text = text.replace(/(?:\r\n|\r|\n)+/g, '\n');
            return text;
        },

        showAnswers(answers) {
            Logger.group('显示答案', () => {
                Logger.log('答案数量:', answers.length);

                const statusArea = this.floatingWindow.querySelector('.status-area');
                statusArea.style.display = 'none';

                const answerArea = this.floatingWindow.querySelector('.answer-area');
                const answerList = answerArea.querySelector('.answer-list');

                answerList.innerHTML = '';

                if (answers.length === 0) {
                    answerList.innerHTML = '<div class="no-answer">暂无答案</div>';
                } else {
                    const content = document.createElement('div');
                    content.className = 'answer-content';

                    const { displayList } = this.alignAnswers(answers);

                    if (displayList.length > 0) {
                        displayList.forEach((item, itemIndex) => {
                            if (item.text !== '无答案') {
                                const answerLine = document.createElement('div');
                                answerLine.className = 'answer-line';
                                answerLine.innerHTML = `
                                    <span class="answer-index">${itemIndex + 1}.</span>
                                    <span class="answer-text">${this.escapeHtml(item.text)}</span>
                                    <button class="copy-single-btn" data-clipboard="${this.escapeHtml(item.copyText)}" title="复制此答案">📋</button>
                                `;
                                content.appendChild(answerLine);
                            }
                        });
                    }

                    // 如果没有任何答案,显示提示信息
                    if (displayList.length === 0 || displayList.every(i => i.text === '无答案')) {
                        const firstItem = answers[0];
                        if (firstItem && firstItem.hasEmptyChildren) {
                            content.innerHTML = '<div class="no-answer">⚠️ 此题目服务器返回的答案数据为空<br><small>可能是听力题、视频题或其他特殊题型</small></div>';
                        } else {
                            content.innerHTML = '<div class="no-answer">❌ 暂无答案数据</div>';
                        }
                    }

                    answerList.appendChild(content);
                }

                answerArea.style.display = 'block';
                Logger.success('答案显示完成');
            });
        },

        /**
         * 自动填充已解析的答案到页面输入框中
         */
        async autoFillAnswers() {
            Logger.group('自动填充答案', async () => {
                let answersData = window.UnipusAnswerDebug ? window.UnipusAnswerDebug.lastParsedAnswers : null;

                // 需求: 若答案没有刷新/未加载，在点击一键填充后，自动刷新答案并填充
                if (!answersData || answersData.length === 0) {
                    this.showStatus('正在自动获取答案...', 'info');
                    await this.loadAnswer(); // 等待答案拉取和解析完成
                    answersData = window.UnipusAnswerDebug ? window.UnipusAnswerDebug.lastParsedAnswers : null;

                    if (!answersData || answersData.length === 0) {
                        this.showStatus('❌ 暂无可填充的答案 (拉取失败或本页无题)', 'error');
                        return; // 若仍然拿不到，终止填充
                    }
                }

                // 寻找输入框 (支持长文本多行和填空单行) 以及下拉框容器
                // 长文本多行: .question-inputbox-input (textarea)
                // 填空单行: .input-user-answer input
                // 下拉框: .fe-scoop
                const allRawNodes = Array.from(document.querySelectorAll('.question-inputbox-input, .input-user-answer input, .fe-scoop'));
                const fillableNodes = allRawNodes.filter(n => {
                    // 如果当前节点是带 input 的类名或者是 input 标签本身，检查它是否在一个 .fe-scoop 容器内
                    // 如果在容器内，我们只处理 .fe-scoop 那个节点，避免重复计算
                    if (n.tagName === 'INPUT' || n.tagName === 'TEXTAREA' || n.classList.contains('input-user-answer')) {
                        if (n.closest('.fe-scoop')) return false;
                    }
                    return true;
                });

                // ================== 处理单/多选题目 ==================
                // 选择题结构: .multipleChoice 或 .question-common-abs-choice 包裹了 .option
                const multipleChoiceQuestions = Array.from(document.querySelectorAll('.question-common-abs-choice'));
                let mcFillCount = 0;

                // ================== 处理排序题 (Sequence/Sorting) ==================
                const sequenceViews = Array.from(document.querySelectorAll('.sequence-view, #sortableListWrapper'));
                let sequenceFillCount = 0;

                if (fillableNodes.length === 0 && multipleChoiceQuestions.length === 0 && sequenceViews.length === 0) {
                    this.showStatus('⚠️ 页面上未找到支持的输入框、选择项或排序结构', 'warning');
                    setTimeout(() => {
                        this.showStatus('加载完成', 'success');
                        this.showAnswers(answersData);
                    }, 2000);
                    return;
                }

                if (multipleChoiceQuestions.length > 0) {
                    Logger.log(`找到 ${multipleChoiceQuestions.length} 道选择题`);

                    // 将所有正确选项打平为一个顺序数组
                    const allChoiceAnswers = answersData.flatMap(item =>
                        (item.answers || []).map(ansArr => {
                            const ansStr = Array.isArray(ansArr) && ansArr.length > 0 ? ansArr.join('/') : String(ansArr || '');
                            return ansStr.toUpperCase();
                        })
                    );

                    Logger.log(`提取到 ${allChoiceAnswers.length} 个选择题答案:`, allChoiceAnswers);

                    for (let idx = 0; idx < multipleChoiceQuestions.length; idx++) {
                        const mcqEl = multipleChoiceQuestions[idx];
                        if (idx < allChoiceAnswers.length && allChoiceAnswers[idx] !== "") {
                            const correctAnsString = allChoiceAnswers[idx];
                            // 以斜杠分割提取出所有的正确选项字母, 加上去重防御脏数据
                            const correctLetters = [...new Set(correctAnsString.split('/').map(l => l.trim()))];

                            const options = Array.from(mcqEl.querySelectorAll('.option'));
                            for (const opt of options) {
                                const captionEl = opt.querySelector('.caption');
                                if (captionEl) {
                                    const letter = captionEl.textContent.trim().toUpperCase();

                                    // 检查当前选项是否应该被选中
                                    const shouldBeSelected = correctLetters.includes(letter);
                                    const isSelected = opt.classList.contains('selected');

                                    // 这里我们等待一小段时间再点击下一个，防止 React 在多选时丢失状态更新
                                    if (shouldBeSelected && !isSelected) {
                                        opt.click();
                                        opt.classList.add('unipus-flash');
                                        mcFillCount++;
                                        await new Promise(r => setTimeout(r, 150));
                                    } else if (!shouldBeSelected && isSelected) {
                                        // 如果本来选错了，把它取消掉（也是点击）
                                        opt.click();
                                        await new Promise(r => setTimeout(r, 150));
                                    } else if (shouldBeSelected && isSelected) {
                                        // 已经选上了，也算匹配到了答案
                                        mcFillCount++;
                                    }
                                }
                            }
                        }
                    }
                }

                // ================== 处理排序题逻辑 ==================
                // 排序题需要模拟真实的拖拽操作来更新 React 内部状态，
                // 纯 DOM 移动只会改变视觉，不会改变提交的数据。

                if (sequenceViews.length > 0) {
                    Logger.log(`找到 ${sequenceViews.length} 个排序容器`);

                    // 提取所有排序类答案
                    const allSequenceAnswers = answersData.flatMap(item =>
                        (item.answers || []).map(ansArr => {
                            const ansStr = Array.isArray(ansArr) && ansArr.length > 0 ? ansArr[0] : String(ansArr || '');
                            const match = ansStr.match(/^[A-Z](?=[.\s]|$)/i);
                            return match ? match[0].toUpperCase() : null;
                        }).filter(Boolean)
                    );

                    Logger.log('提取到的排序答案序列:', allSequenceAnswers);

                    /**
                     * 从 wrapper 中实时读取当前排序项的标签
                     */
                    const readCurrentPairs = (wrapperEl) => {
                        return Array.from(wrapperEl.querySelectorAll('.sequence-reply-view-item-text')).map(el => {
                            const spans = el.querySelectorAll('span');
                            return {
                                el,
                                label: spans[0] ? spans[0].textContent.trim().replace(/\.$/, '').toUpperCase() : ''
                            };
                        });
                    };

                    /**
                     * 模拟一次拖拽操作 (高拟真平滑拖拽版)
                     */
                    const simulateDrag = async (sourceEl, targetEl, movingUp) => {
                        const sr = sourceEl.getBoundingClientRect();
                        const tr = targetEl.getBoundingClientRect();
                        const sx = sr.left + sr.width / 2, sy = sr.top + sr.height / 2;

                        // 目标边缘防抖判断
                        const tx = tr.left + tr.width / 2;
                        const ty = movingUp ? tr.top + 2 : tr.bottom - 2;

                        const dt = new DataTransfer();
                        try {
                            dt.setData('text/plain', '');
                        } catch(e) {}

                        // Hover & 按下
                        sourceEl.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, clientX: sx, clientY: sy }));
                        sourceEl.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true, clientX: sx, clientY: sy }));
                        sourceEl.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: sx, clientY: sy, buttons: 1 }));
                        sourceEl.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: sx, clientY: sy, buttons: 1 }));

                        await new Promise(r => setTimeout(r, 60)); // 短暂延迟模拟长按激活

                        // 拖拽起步
                        const startMoveY = sy + (movingUp ? -5 : 5);
                        document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, clientX: sx, clientY: startMoveY, buttons: 1 }));
                        document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: sx, clientY: startMoveY, buttons: 1 }));
                        sourceEl.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, clientX: sx, clientY: startMoveY, dataTransfer: dt }));
                        await new Promise(r => setTimeout(r, 20));

                        // 沿途平滑移动 (3 帧平滑插值)
                        const steps = 3;
                        for (let i = 1; i <= steps; i++) {
                            const curX = sx + (tx - sx) * (i / steps);
                            const curY = startMoveY + (ty - startMoveY) * (i / steps);
                            document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, clientX: curX, clientY: curY, buttons: 1 }));
                            document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: curX, clientY: curY, buttons: 1 }));
                            document.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, clientX: curX, clientY: curY, dataTransfer: dt }));
                            await new Promise(r => setTimeout(r, 15));
                        }

                        // 悬停 & 放下
                        targetEl.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, clientX: tx, clientY: ty, dataTransfer: dt }));
                        targetEl.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, clientX: tx, clientY: ty, dataTransfer: dt }));
                        await new Promise(r => setTimeout(r, 50));

                        targetEl.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, clientX: tx, clientY: ty, dataTransfer: dt }));
                        sourceEl.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, clientX: tx, clientY: ty, dataTransfer: dt }));

                        document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, clientX: tx, clientY: ty, buttons: 0 }));
                        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: tx, clientY: ty, buttons: 0 }));

                        // 等待动画落位
                        await new Promise(r => setTimeout(r, 500));
                    };

                    // 防止 querySelectorAll 同时选出父级 .sequence-view 和子级 #sortableListWrapper 导致重复处理
                    const processedSequenceWrappers = new Set();

                    for (const view of sequenceViews) {
                        const wrapper = view.id === 'sortableListWrapper' ? view : view.querySelector('#sortableListWrapper');
                        if (!wrapper || processedSequenceWrappers.has(wrapper)) continue;
                        processedSequenceWrappers.add(wrapper);

                        const initialPairs = readCurrentPairs(wrapper);
                        if (initialPairs.length === 0 || initialPairs.length !== allSequenceAnswers.length) continue;

                        Logger.log('检测到排序题, 目标排序序列:', allSequenceAnswers);

                        // 动态多遍排序算法 (Dynamic Multi-pass Sorting)
                        let isSorted = false;
                        let maxSteps = 20;
                        let stepCount = 0;

                        while (!isSorted && stepCount < maxSteps) {
                            const currentPairs = readCurrentPairs(wrapper);
                            const currentLabels = currentPairs.map(p => p.label);

                            isSorted = allSequenceAnswers.every((label, i) => currentLabels[i] === label);
                            if (isSorted) break;

                            let targetPos = allSequenceAnswers.findIndex((ans, i) => currentLabels[i] !== ans);
                            const targetLabel = allSequenceAnswers[targetPos];
                            const sourcePos = currentPairs.findIndex(p => p.label === targetLabel);

                            if (sourcePos === -1) {
                                Logger.warn(`找不到选项 ${targetLabel}, 跳过排序`);
                                break;
                            }

                            stepCount++;
                            await simulateDrag(currentPairs[sourcePos].el, currentPairs[targetPos].el, sourcePos > targetPos);
                        }

                        const isCorrect = allSequenceAnswers.every((label, i) => readCurrentPairs(wrapper)[i].label === label);
                        if (isCorrect) {
                            Logger.success(`排序自动填充完成 (耗时 ${stepCount} 步)`);
                            sequenceFillCount++;
                            wrapper.classList.add('unipus-flash');
                        } else {
                            Logger.warn('达到最大排序尝试限制, 可能部分选项未能就位');
                        }
                    }
                }

                // ================== 处理填空题目与下拉题目 ==================
                const { flatForFill } = this.alignAnswers(answersData);

                Logger.log(`找到 ${fillableNodes.length} 个填空位置，准备填充 ${flatForFill.length} 个答案`);

                // 准备 React Hook 绕过器
                const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                const nativeTextAreaValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;

                const setReactValue = (el, val) => {
                    const setter = el.tagName === 'TEXTAREA' ? nativeTextAreaValueSetter : nativeInputValueSetter;
                    setter.call(el, val);
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                    el.classList.add('unipus-flash');
                };

                let fillCount = 0;

                for (let idx = 0; idx < fillableNodes.length; idx++) {
                    const node = fillableNodes[idx];
                    if (idx < flatForFill.length && flatForFill[idx] !== "") {
                        const targetValue = flatForFill[idx].split(' / ')[0];
                        if (node.classList.contains('fe-scoop')) {
                            // 处理下拉选项
                            const hiddenOptions = Array.from(node.querySelectorAll('.scoop-select-wrapper > div > i > p')).map(p => p.textContent.trim());
                            let targetIndex = -1;

                            // 尝试把A/B/C映射为0/1/2索引
                            if (targetValue.length === 1 && targetValue >= 'A' && targetValue <= 'Z') {
                                targetIndex = targetValue.charCodeAt(0) - 65;
                            }

                            // 如果算出的索引越界或者不对，尝试退化为直接匹配文本 (比如填入的就是"G")
                            if (targetIndex < 0 || targetIndex >= hiddenOptions.length) {
                                targetIndex = hiddenOptions.indexOf(targetValue);
                            }

                            if (targetIndex !== -1 && targetIndex < hiddenOptions.length) {
                                const trigger = node.querySelector('.ant-dropdown-trigger');
                                if (trigger) {
                                    const expectedText = hiddenOptions[targetIndex];
                                    const visibleTextEl = node.querySelector('.user-answer-text');

                                    if (expectedText && visibleTextEl && visibleTextEl.textContent.trim() !== expectedText) {
                                        trigger.click(); // 展开菜单
                                        await new Promise(r => setTimeout(r, 200));

                                        // 寻找弹出菜单的所有项（就在当前节点内部）
                                        const menuItems = Array.from(node.querySelectorAll('.ant-dropdown-menu-item'));
                                        if (menuItems[targetIndex]) {
                                            menuItems[targetIndex].click();
                                            fillCount++;
                                            node.classList.add('unipus-flash');
                                        }
                                        await new Promise(r => setTimeout(r, 150));
                                    } else if (expectedText && visibleTextEl && visibleTextEl.textContent.trim() === expectedText) {
                                        fillCount++; // 已经正确选择
                                    }
                                }
                            } else if (hiddenOptions.length === 0) {
                                // 如果没有下拉项，说明可能是带输入框的 scoop (fe-scoop 内部包裹了 input)
                                const inputInside = node.querySelector('input, textarea');
                                if (inputInside) {
                                    setReactValue(inputInside, targetValue);
                                    fillCount++;
                                }
                            }
                        } else {
                            // 常规文本框处理
                            setReactValue(node, targetValue);
                            fillCount++;
                        }
                    }
                }

                let successMsgPrefix = [];
                if (fillCount > 0) successMsgPrefix.push(`${fillCount} 个填空`);
                if (mcFillCount > 0) successMsgPrefix.push(`${mcFillCount} 个选项`);
                if (sequenceFillCount > 0) successMsgPrefix.push(`${sequenceFillCount} 组排序`);

                const finalMsg = successMsgPrefix.length > 0
                    ? `✅ 成功填充 ${successMsgPrefix.join(' 和 ')}！`
                    : `⚠️ 没有匹配到可填充的答案`;

                this.showStatus(finalMsg, successMsgPrefix.length > 0 ? 'success' : 'warning');
                setTimeout(() => {
                    if (window.UnipusAnswerDebug && window.UnipusAnswerDebug.lastParsedAnswers) {
                        this.showAnswers(window.UnipusAnswerDebug.lastParsedAnswers);
                    }
                }, 2000);
            });
        },

        /**
         * HTML简单转义
         */
        escapeHtml(text) {
            if (typeof text !== 'string') return text;
            return text.replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;")
                .replace(/'/g, "&#039;");
        },

        /**
         * 加载答案 (返回 Promise 以支持 Solo 模式链式调用)
         */
        loadAnswer() {
            return Logger.group('开始加载答案流程', async () => {
                try {
                    this.showStatus('正在获取任务信息...', 'info');

                    // 1. 获取openId
                    const openId = Utils.getOpenId();
                    if (!openId) {
                        this.showStatus('❌ 未找到OpenId，请先登录', 'error');
                        return;
                    }

                    // 2. 获取任务信息
                    const taskInfo = Utils.getTaskInfo();
                    if (!taskInfo || !taskInfo.courseInstanceId || !taskInfo.taskId) {
                        this.showStatus('❌ 无法识别当前页面，请在题目页面使用', 'error');
                        return;
                    }

                    this.showStatus('正在请求答案...', 'info');

                    // 3. 请求答案API (带3次重试)
                    let response;
                    for (let attempt = 1; attempt <= 3; attempt++) {
                        try {
                            response = await API.getAnswer(
                                taskInfo.courseInstanceId,
                                taskInfo.taskId,
                                openId
                            );
                            if (response && response.data) break; // 成功则跳出重试循环
                        } catch (err) {
                            if (attempt === 3) throw err;
                            Logger.warn(`请求失败，正在进行第 ${attempt} 次重试...`);
                            this.showStatus(`网络抖动，正在重试 (${attempt}/3)...`, 'warning');
                            await new Promise(r => setTimeout(r, 600)); // 退避600ms
                        }
                    }

                    this.showStatus('正在解密答案...', 'info');

                    // 4. 解密答案
                    const plaintext = Utils.decryptAnswer(response.data, response.k);

                    this.showStatus('正在解析答案...', 'info');

                    // 5. 解析答案
                    const answers = Utils.parseAnswerJSON(plaintext);

                    // 6. 显示答案
                    if (answers.length > 0) {
                        this.showAnswers(answers);
                        Logger.success('答案加载完成');
                    } else {
                        this.showStatus('⚠️ 未能解析出答案', 'warning');
                    }

                } catch (error) {
                    Logger.error('加载答案失败:', error);
                    this.showStatus(`❌ 加载失败: ${error.message}`, 'error');
                }
            });
        }
    };

    // ==================== 样式 ====================
    GM_addStyle(`
        #unipus-answer-float {
            position: fixed;
            top: 100px;
            right: 20px;
            width: 320px;
            max-height: 600px;
            background: rgba(255, 255, 255, 0.85);
            backdrop-filter: blur(16px) saturate(180%);
            -webkit-backdrop-filter: blur(16px) saturate(180%);
            border: 1px solid rgba(255, 255, 255, 0.5);
            border-radius: 16px;
            box-shadow: 0 10px 40px rgba(0, 0, 0, 0.1), 0 1px 3px rgba(0, 0, 0, 0.05);
            z-index: 999999;
            font-family: "PingFang SC", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            overflow: hidden;
            display: flex;
            flex-direction: column;
            color: #333;
        }
        .float-header {
            background: rgba(255, 255, 255, 0.4);
            border-bottom: 1px solid rgba(0, 0, 0, 0.05);
            color: #1a1a1a;
            padding: 12px 18px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            cursor: move;
            user-select: none;
        }
        .float-title {
            font-weight: 700;
            font-size: 15px;
            letter-spacing: 0.5px;
            background: linear-gradient(90deg, #111, #555);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        .float-controls {
            display: flex;
            gap: 6px;
            align-items: center;
        }
        .solo-btn {
            font-size: 11px !important;
            font-weight: 700 !important;
            letter-spacing: 0.5px;
            padding: 4px 8px !important;
            transition: all 0.2s ease;
        }
        .solo-btn.solo-active {
            background: rgba(34, 197, 94, 0.85) !important;
            color: #fff !important;
            box-shadow: 0 0 8px rgba(34, 197, 94, 0.5);
        }
        .float-btn {
            background: rgba(0, 0, 0, 0.04);
            border: 1px solid transparent;
            color: #555;
            width: 28px;
            height: 28px;
            border-radius: 8px;
            cursor: pointer;
            font-size: 14px;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
            padding: 0;
        }
        .float-btn:hover {
            background: #fff;
            box-shadow: 0 2px 6px rgba(0,0,0,0.06);
            transform: translateY(-1px);
        }
        .float-btn:active {
            transform: translateY(0);
        }
        #auto-fill-answers {
            color: #eab308;
            background: rgba(234, 179, 8, 0.1);
        }
        #auto-fill-answers:hover {
            background: rgba(234, 179, 8, 0.2);
        }
        .float-content {
            padding: 18px;
            overflow-y: auto;
            max-height: 520px;
        }
        .status-area {
            text-align: center;
            padding: 16px;
            border-radius: 12px;
            font-weight: 500;
        }
        .status-area.status-info {
            background: rgba(227, 242, 253, 0.7);
            color: #1976d2;
        }
        .status-area.status-success {
            background: rgba(232, 245, 233, 0.7);
            color: #2e7d32;
        }
        .status-area.status-warning {
            background: rgba(255, 243, 224, 0.7);
            color: #f57c00;
        }
        .status-area.status-error {
            background: rgba(255, 235, 238, 0.7);
            color: #c62828;
        }
        .status-text {
            font-size: 14px;
        }
        .answer-area {
            animation: slideUpFade 0.4s cubic-bezier(0.16, 1, 0.3, 1);
        }
        @keyframes slideUpFade {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
        }
        .answer-list {
            display: flex;
            flex-direction: column;
            gap: 12px;
        }
        .answer-content {
            display: flex;
            flex-direction: column;
            gap: 8px;
            background: rgba(255,255,255,0.6);
            padding: 14px;
            border-radius: 12px;
            border: 1px solid rgba(255,255,255,0.8);
            box-shadow: inset 0 2px 4px rgba(255,255,255,0.5);
        }
        .answer-line {
            display: flex;
            align-items: flex-start;
            gap: 10px;
            font-size: 14px;
            line-height: 1.5;
            padding: 6px 0;
            border-bottom: 1px solid rgba(0,0,0,0.03);
        }
        .answer-line:last-child {
            border-bottom: none;
            padding-bottom: 0;
        }

        @keyframes unipusFlash {
            0% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.8); border-color: #22c55e; }
            50% { box-shadow: 0 0 0 6px rgba(34, 197, 94, 0.2); border-color: #22c55e; }
            100% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0); border-color: inherit; }
        }
        .unipus-flash {
            animation: unipusFlash 1.5s ease-out !important;
        }

        /* 滚动条美化 */
        .float-content::-webkit-scrollbar {
            width: 5px;
        }
        .float-content::-webkit-scrollbar-track {
            background: transparent;
        }
        .float-content::-webkit-scrollbar-thumb {
            background: rgba(0,0,0,0.15);
            border-radius: 10px;
        }
        .float-content::-webkit-scrollbar-thumb:hover {
            background: rgba(0,0,0,0.25);
        }
        .answer-index {
            color: #888;
            font-weight: 600;
            min-width: 20px;
            padding-top: 2px;
        }
        .answer-text {
            color: #222;
            flex: 1;
            word-break: break-word;
            font-weight: 500;
            white-space: pre-wrap; /* Preserve newlines */
        }
        .copy-single-btn {
            background: transparent;
            border: none;
            cursor: pointer;
            opacity: 0.4;
            transition: all 0.2s;
            font-size: 14px;
            padding: 2px;
            margin-top: 1px;
        }
        .copy-single-btn:hover {
            opacity: 1;
            transform: scale(1.1);
        }
        .no-answer {
            color: #999;
            font-style: italic;
            text-align: center;
            padding: 16px;
            font-size: 13px;
        }
        /* 滚动条样式 */
        .float-content::-webkit-scrollbar {
            width: 5px;
        }
        .float-content::-webkit-scrollbar-track {
            background: transparent;
        }
        .float-content::-webkit-scrollbar-thumb {
            background: rgba(0,0,0,0.15);
            border-radius: 10px;
        }
        .float-content::-webkit-scrollbar-thumb:hover {
            background: rgba(0,0,0,0.25);
        }
    `);

    // ==================== 主程序 ====================
    function init() {
        Logger.group('脚本初始化', () => {
            Logger.log('当前URL:', window.location.href);
            Logger.log('CryptoJS版本:', typeof CryptoJS !== 'undefined' ? '已加载' : '未加载');

            // 检查是否在作答页面 - 改进检测逻辑
            const url = window.location.href;
            const isTaskPage = url.includes('course-v2:') ||
                url.includes('/course/') ||
                url.includes('/tutorial/') ||
                url.includes('_explorationpc_') ||
                url.includes('/courseware/') ||
                document.querySelector('[data-task-id]') !== null;

            if (!isTaskPage) {
                Logger.warn('当前不在题目页面，脚本待命');
                return;
            }

            Logger.log('检测到题目页面，准备创建UI');

            // 延迟创建UI，确保页面加载完成
            setTimeout(() => {
                UI.createFloatingWindow();
                UI.loadAnswer();

                // --- 新增：单页应用(SPA) 切换题目自动刷新监听 ---
                let lastTaskId = Utils.getTaskInfo().taskId;

                const onUrlChange = () => {
                    const currentTaskInfo = Utils.getTaskInfo();
                    if (currentTaskInfo && currentTaskInfo.taskId && currentTaskInfo.taskId !== lastTaskId) {
                        Logger.log(`检测到题目切换: ${lastTaskId} -> ${currentTaskInfo.taskId}`);
                        lastTaskId = currentTaskInfo.taskId;

                        // 每次切题清理上一题的解析缓存和页面残留
                        if (window.UnipusAnswerDebug) window.UnipusAnswerDebug.lastParsedAnswers = null;
                        const answerList = document.querySelector('#unipus-answer-float .answer-list');

                        // 检查 Solo 模式状态
                        const isSoloMode = localStorage.getItem('unipus_solo_mode') === 'true';

                        if (isSoloMode) {
                            UI.showStatus('Solo模式开启: 自动加载并填充答案...', 'info');
                            if (answerList) {
                                answerList.innerHTML = '<div class="no-answer">正在获取新题答案...</div>';
                            }
                            // 延时加载以确保页面DOM基本就绪
                            setTimeout(() => {
                                UI.loadAnswer().then(() => {
                                    // 加载完答案后自动触发填充
                                    setTimeout(() => {
                                        const autoFillBtn = document.getElementById('auto-fill-answers');
                                        if (autoFillBtn) autoFillBtn.click();
                                    }, 1000);
                                });
                            }, 500);
                        } else {
                            Logger.log('Solo模式未开启，不自动刷新答案');
                            // 可以选择清除当前显示的答案防止干扰
                            if (answerList) {
                                answerList.innerHTML = '<div class="no-answer">⚠️ 已切换题目，请手动刷新答案</div>';
                            }
                        }
                    }
                };

                // 监听 hash 变化 (U校园的部分路由是用 /#/ 控制的)
                window.addEventListener('hashchange', onUrlChange);

                // 拦截 pushState 和 replaceState (兼容更深层的 React Router 导航)
                const originalPushState = history.pushState;
                history.pushState = function () {
                    originalPushState.apply(this, arguments);
                    onUrlChange();
                };
                const originalReplaceState = history.replaceState;
                history.replaceState = function () {
                    originalReplaceState.apply(this, arguments);
                    onUrlChange();
                };
                // --------------------------------------------------
            }, 1000);

            Logger.success('脚本初始化完成');
        });
    }

    // 页面加载完成后执行
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    Logger.info('U校园答案显示器已加载');
})();