// ==UserScript==
// @name        NWAFU 学生服务上传增强：拖放与粘贴
// @version     0.5.2
// @description 为学生服务数据采集附件上传增加拖放、粘贴、重命名和 PDF/PNG 压缩处理。
// @match       https://xsfw.nwafu.edu.cn/xsfw/sys/sjcjyqapp/*
// @require     https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js
// @require     https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js
// @grant       none
// @run-at      document-idle
// @namespace   https://mjy.js.org/nwafu-scripts/
// @author      majianyu2007
// @license     MIT
// @homepageURL https://mjy.js.org/nwafu-scripts/scripts/xsfw-upload-enhancer/
// @supportURL  https://github.com/majianyu2007/nwafu-scripts/issues
// @updateURL   https://mjy.js.org/nwafu-scripts/userscripts/xsfw-upload-enhancer.user.js
// @downloadURL https://mjy.js.org/nwafu-scripts/userscripts/xsfw-upload-enhancer.user.js
// ==/UserScript==

(function () {
  'use strict';

  var STYLE_ID = 'tm-nwafu-upload-enhancer-style';
  var ROOT_SELECTOR = '[xtype="cache-upload"]';
  var INPUT_SELECTOR = 'input[type="file"][emap-role="upload-input"]';
  var INIT_ATTR = 'data-tm-drag-paste-ready';
  var ALLOWED_EXTS = ['doc', 'jpg', 'png', 'jpeg', 'bmp', 'docx', 'zip', 'rar', 'pdf', 'xls', 'xlsx', 'txt'];
  var MAX_BYTES = 10 * 1024 * 1024;
  var TARGET_BYTES = Math.floor(9.3 * 1024 * 1024);
  var PDF_COMPRESS_PROFILES = [
    { label: '清晰压缩', scale: 1.35, quality: 0.68 },
    { label: '标准压缩', scale: 1.1, quality: 0.56 },
    { label: '强力压缩', scale: 0.88, quality: 0.45 },
    { label: '极限压缩', scale: 0.7, quality: 0.36 },
    { label: '兜底压缩', scale: 0.55, quality: 0.28 }
  ];
  var PNG_COMPRESS_SCALES = [0.9, 0.8, 0.68, 0.56, 0.46, 0.36];
  var lastActiveRoot = null;

  function getGlobalValue(name) {
    if (typeof globalThis !== 'undefined' && globalThis[name]) return globalThis[name];
    if (typeof window !== 'undefined' && window[name]) return window[name];
    if (typeof unsafeWindow !== 'undefined' && unsafeWindow[name]) return unsafeWindow[name];
    return null;
  }

  function installStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      ROOT_SELECTOR + '.tm-upload-drag-over [emap-role="upload-container"] {',
      '  outline: 2px dashed #2f7de1;',
      '  outline-offset: 4px;',
      '  background: rgba(47, 125, 225, 0.08);',
      '}',
      '.tm-upload-helper {',
      '  margin: 8px 0 10px;',
      '  padding: 7px 9px;',
      '  border: 1px dashed #7aa7e8;',
      '  color: #2f5f9f;',
      '  background: #f4f8ff;',
      '  font-size: 12px;',
      '  line-height: 1.5;',
      '  white-space: pre-wrap;',
      '}',
      '.tm-upload-helper.tm-upload-working {',
      '  border-color: #e0aa36;',
      '  color: #8a5b00;',
      '  background: #fffaf0;',
      '}',
      '.tm-upload-helper.tm-upload-error {',
      '  border-color: #e38787;',
      '  color: #a12626;',
      '  background: #fff6f6;',
      '}'
    ].join('\n');
    document.head.appendChild(style);
  }

  function isVisible(el) {
    if (!el || el.getAttribute('data-disabled') === 'true') return false;
    var box = el.getBoundingClientRect();
    return box.width > 0 && box.height > 0;
  }

  function getInput(root) {
    return root && root.querySelector(INPUT_SELECTOR);
  }

  function showTip(message, state) {
    var $ = window.jQuery || window.$;
    if ($ && $.bhTip) {
      $.bhTip({ content: message, state: state || 'success' });
    } else {
      console.log('[上传增强] ' + message);
    }
  }

  function setHelper(root, text, type) {
    var helper = root && root.querySelector('.tm-upload-helper');
    if (!helper) return;
    helper.textContent = text;
    helper.classList.remove('tm-upload-working', 'tm-upload-error');
    if (type === 'working') helper.classList.add('tm-upload-working');
    if (type === 'error') helper.classList.add('tm-upload-error');
  }

  function restoreHelper(root, delay) {
    window.setTimeout(function () {
      var helper = root && root.querySelector('.tm-upload-helper');
      if (!helper) return;
      helper.textContent = helper.dataset.defaultText || '';
      helper.classList.remove('tm-upload-working', 'tm-upload-error');
    }, delay || 2500);
  }

  function makePasteName(file, index, forcedExt) {
    var now = new Date();
    var stamp = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
      '-',
      String(now.getHours()).padStart(2, '0'),
      String(now.getMinutes()).padStart(2, '0'),
      String(now.getSeconds()).padStart(2, '0')
    ].join('');

    var base = file.name ? file.name.replace(/\.[^.]+$/, '') : 'pasted-image-' + stamp + '-' + (index + 1);
    return base + '.' + forcedExt;
  }

  function splitFileName(name) {
    var fallback = name || '';
    var dot = fallback.lastIndexOf('.');
    if (dot > 0 && dot < fallback.length - 1) {
      return {
        base: fallback.slice(0, dot),
        ext: fallback.slice(dot + 1).toLowerCase()
      };
    }
    return {
      base: fallback,
      ext: ''
    };
  }

  function sanitizeFileBaseName(value) {
    return (value || '')
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120);
  }

  function looksLikeGarbledName(file) {
    var parts = splitFileName(file.name || '');
    var base = parts.base;
    if (!base) return true;

    var compact = base.replace(/\s+/g, '');
    var ascii = compact.replace(/[^\x00-\x7F]/g, '');
    var nonAscii = compact.length - ascii.length;
    var letters = (compact.match(/[A-Za-z]/g) || []).length;
    var digits = (compact.match(/\d/g) || []).length;
    var hexLike = /^[a-f0-9]{16,}$/i.test(compact);
    var uuidLike = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(compact);
    var timestampLike = /^(img|image|wx_camera|mmexport|screenshot|截屏|截图)?\d{10,}$/i.test(compact);
    var randomLongAscii = compact.length >= 18 && nonAscii === 0 && (letters + digits) / compact.length > 0.85;
    var unsafeChars = /[^\u4e00-\u9fa5A-Za-z0-9 _.,，。()（）【】\[\]-]/.test(base);
    var mojibake = /[\uFFFDÃÂäåçèéêæœ]/.test(base);

    return uuidLike || hexLike || timestampLike || randomLongAscii || unsafeChars || mojibake;
  }

  function renameFile(file, nextName) {
    if (!nextName || file.name === nextName) return file;
    return new File([file], nextName, {
      type: file.type || 'application/octet-stream',
      lastModified: file.lastModified || Date.now()
    });
  }

  function joinFileName(base, ext) {
    return ext ? base + '.' + ext : base;
  }

  function isJpegFile(file) {
    return file && (/^image\/jpe?g$/i.test(file.type) || /\.jpe?g$/i.test(file.name || ''));
  }

  function isPdfFile(file) {
    return file && (/^application\/pdf$/i.test(file.type) || /\.pdf$/i.test(file.name || ''));
  }

  function isPngFile(file) {
    return file && (/^image\/png$/i.test(file.type) || /\.png$/i.test(file.name || ''));
  }

  function canvasToPngBlob(canvas) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('canvas.toBlob returned empty blob'));
        }
      }, 'image/png');
    });
  }

  function loadImage(file) {
    if (window.createImageBitmap) {
      return createImageBitmap(file);
    }

    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = reject;
      img._tmObjectUrl = URL.createObjectURL(file);
      img.src = img._tmObjectUrl;
    });
  }

  function cleanupLoadedImage(image) {
    if (image.close) {
      image.close();
    } else if (image._tmObjectUrl) {
      URL.revokeObjectURL(image._tmObjectUrl);
    }
  }

  async function convertJpegToPng(file, index) {
    var image = await loadImage(file);
    var canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    var ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    var blob = await canvasToPngBlob(canvas);

    cleanupLoadedImage(image);

    return new File([blob], makePasteName(file, index, 'png'), {
      type: 'image/png',
      lastModified: Date.now()
    });
  }

  function getPdfLibs() {
    var pdfjs = (typeof pdfjsLib !== 'undefined' ? pdfjsLib : null) || getGlobalValue('pdfjsLib');
    var jspdfNs = (typeof jspdf !== 'undefined' ? jspdf : null) || getGlobalValue('jspdf');
    var jsPDFCtor = jspdfNs && jspdfNs.jsPDF;
    if (!pdfjs || !jsPDFCtor) return null;
    if (pdfjs.GlobalWorkerOptions && !pdfjs.GlobalWorkerOptions.workerSrc) {
      pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }
    return {
      pdfjs: pdfjs,
      jsPDF: jsPDFCtor
    };
  }

  function compressedPdfName(file) {
    var parts = splitFileName(file.name || 'compressed');
    var base = sanitizeFileBaseName(parts.base) || 'compressed';
    return base.replace(/-compressed$/i, '') + '-compressed.pdf';
  }

  function compressedPngName(file) {
    var parts = splitFileName(file.name || 'compressed');
    var base = sanitizeFileBaseName(parts.base) || 'compressed';
    return base.replace(/-compressed$/i, '') + '-compressed.png';
  }

  async function compressPdf(file, root) {
    var libs = getPdfLibs();
    if (!libs) {
      throw new Error('PDF 压缩组件未加载完成，请刷新页面后重试。');
    }

    setHelper(root, '检测到超限 PDF：' + file.name + '\n原始大小：' + formatSize(file.size) + '，开始本地压缩。', 'working');

    var data = new Uint8Array(await file.arrayBuffer());
    var loadingTask = libs.pdfjs.getDocument({
      data: data,
      disableFontFace: true,
      disableWorker: true,
      isEvalSupported: false
    });
    var pdf = await loadingTask.promise;
    var best = file;

    for (var i = 0; i < PDF_COMPRESS_PROFILES.length; i++) {
      var profile = PDF_COMPRESS_PROFILES[i];
      var compressed = await renderPdfWithProfile(pdf, libs.jsPDF, file, profile, root, i);
      if (compressed.size < best.size) best = compressed;
      setHelper(root, 'PDF 压缩档位 ' + (i + 1) + '/' + PDF_COMPRESS_PROFILES.length + ' 完成：' + formatSize(compressed.size), 'working');
      if (compressed.size <= TARGET_BYTES) break;
    }

    if (pdf.destroy) await pdf.destroy();

    if (best !== file && best.size <= MAX_BYTES) {
      showTip('PDF 已压缩：' + formatSize(file.size) + ' -> ' + formatSize(best.size), best.size <= MAX_BYTES ? 'success' : 'warning');
      setHelper(root, 'PDF 压缩完成：' + file.name + '\n' + formatSize(file.size) + ' -> ' + formatSize(best.size) + '，正在加入上传队列。', 'working');
      return best;
    }

    if (best !== file) {
      throw new Error('压缩后仍为 ' + formatSize(best.size) + '，无法降到系统要求的 10MB 以下。');
    } else {
      throw new Error('PDF 压缩后未变小，仍为 ' + formatSize(file.size) + '。');
    }
  }

  async function renderPdfWithProfile(pdf, JsPDF, file, profile, root, profileIndex) {
    var doc = null;
    for (var pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
      setHelper(root, '正在压缩 PDF：' + file.name + '\n第 ' + pageNo + ' / ' + pdf.numPages + ' 页（' + profile.label + '）', 'working');
      var page = await pdf.getPage(pageNo);
      var baseViewport = page.getViewport({ scale: 1 });
      var renderViewport = page.getViewport({ scale: profile.scale });
      var canvas = document.createElement('canvas');
      canvas.width = Math.ceil(renderViewport.width);
      canvas.height = Math.ceil(renderViewport.height);
      var ctx = canvas.getContext('2d', { alpha: false });
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: renderViewport }).promise;

      var pdfWidth = baseViewport.width;
      var pdfHeight = baseViewport.height;
      var orientation = pdfWidth > pdfHeight ? 'l' : 'p';
      if (!doc) {
        doc = new JsPDF({
          orientation: orientation,
          unit: 'pt',
          format: [pdfWidth, pdfHeight],
          compress: true,
          putOnlyUsedFonts: true
        });
      } else {
        doc.addPage([pdfWidth, pdfHeight], orientation);
      }

      doc.addImage(canvas.toDataURL('image/jpeg', profile.quality), 'JPEG', 0, 0, pdfWidth, pdfHeight, undefined, 'FAST');
      canvas.width = 1;
      canvas.height = 1;
    }

    return new File([doc.output('blob')], compressedPdfName(file), {
      type: 'application/pdf',
      lastModified: Date.now()
    });
  }

  function formatSize(bytes) {
    return (bytes / 1024 / 1024).toFixed(2) + 'MB';
  }

  async function compressPng(file, root) {
    setHelper(root, '检测到超限 PNG：' + file.name + '\n原始大小：' + formatSize(file.size) + '，开始缩小分辨率压缩。', 'working');
    var image = await loadImage(file);
    var best = file;

    for (var i = 0; i < PNG_COMPRESS_SCALES.length; i++) {
      var scale = PNG_COMPRESS_SCALES[i];
      setHelper(root, '正在压缩 PNG：' + file.name + '\n档位 ' + (i + 1) + '/' + PNG_COMPRESS_SCALES.length + '，尺寸约 ' + Math.round(scale * 100) + '%', 'working');
      var canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      var ctx = canvas.getContext('2d');
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      var blob = await canvasToPngBlob(canvas);
      var compressed = new File([blob], compressedPngName(file), {
        type: 'image/png',
        lastModified: Date.now()
      });
      canvas.width = 1;
      canvas.height = 1;

      if (compressed.size < best.size) best = compressed;
      setHelper(root, 'PNG 压缩档位 ' + (i + 1) + '/' + PNG_COMPRESS_SCALES.length + ' 完成：' + formatSize(compressed.size), 'working');
      if (compressed.size <= TARGET_BYTES) break;
    }

    cleanupLoadedImage(image);
    if (best !== file && best.size <= MAX_BYTES) {
      showTip('PNG 已压缩：' + formatSize(file.size) + ' -> ' + formatSize(best.size), best.size <= MAX_BYTES ? 'success' : 'warning');
      setHelper(root, 'PNG 压缩完成：' + file.name + '\n' + formatSize(file.size) + ' -> ' + formatSize(best.size) + '，正在加入上传队列。', 'working');
      return best;
    }

    if (best !== file) {
      throw new Error('PNG 压缩后仍为 ' + formatSize(best.size) + '，无法降到系统要求的 10MB 以下。');
    } else {
      throw new Error('PNG 压缩后未变小，仍为 ' + formatSize(file.size) + '。');
    }
  }

  function maybeRenamePastedFiles(files) {
    if (!files.length) return files;
    if (files.length === 1) {
      var single = splitFileName(files[0].name);
      var input = window.prompt('请输入上传文件名（不用写扩展名）', sanitizeFileBaseName(single.base) || '粘贴图片');
      if (input === null) return files;
      var clean = sanitizeFileBaseName(input);
      if (!clean) return files;
      return [renameFile(files[0], joinFileName(clean, single.ext))];
    }

    var first = splitFileName(files[0].name);
    var prefix = window.prompt('请输入批量粘贴文件名前缀（不用写扩展名）', sanitizeFileBaseName(first.base) || '粘贴图片');
    if (prefix === null) return files;
    var cleanPrefix = sanitizeFileBaseName(prefix);
    if (!cleanPrefix) return files;
    return files.map(function (file, index) {
      var parts = splitFileName(file.name);
      return renameFile(file, joinFileName(cleanPrefix + '-' + (index + 1), parts.ext));
    });
  }

  function maybeRenameSuspiciousFiles(files) {
    return files.map(function (file) {
      if (!looksLikeGarbledName(file)) return file;

      var parts = splitFileName(file.name);
      var fallback = sanitizeFileBaseName(parts.base) || '上传文件';
      var input = window.prompt('文件名看起来可能是乱码，是否修改？\n原文件名：' + file.name + '\n请输入新文件名（不用写扩展名）。点取消则保留原名。', fallback);
      if (input === null) return file;

      var clean = sanitizeFileBaseName(input);
      if (!clean) return file;
      return renameFile(file, joinFileName(clean, parts.ext));
    });
  }

  async function normalizeFiles(root, fileList, fromPaste) {
    var files = Array.prototype.slice.call(fileList || []);
    if (!fromPaste) return compressOversizedFiles(root, maybeRenameSuspiciousFiles(files));

    var normalized = [];
    for (var i = 0; i < files.length; i++) {
      var file = files[i];
      if (isJpegFile(file)) {
        normalized.push(await convertJpegToPng(file, i));
      } else if (!file.name && /^image\//i.test(file.type || '')) {
        var ext = (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
        normalized.push(new File([file], makePasteName(file, i, ext), {
          type: file.type || 'image/png',
          lastModified: Date.now()
        }));
      } else {
        normalized.push(file);
      }
    }
    normalized = maybeRenamePastedFiles(normalized);
    normalized = maybeRenameSuspiciousFiles(normalized);
    return compressOversizedFiles(root, normalized);
  }

  async function compressOversizedFiles(root, files) {
    var prepared = [];
    var rejected = [];
    for (var i = 0; i < files.length; i++) {
      var file = files[i];
      try {
        if (isPdfFile(file) && file.size > MAX_BYTES) {
          prepared.push(await compressPdf(file, root));
        } else if (isPngFile(file) && file.size > MAX_BYTES) {
          prepared.push(await compressPng(file, root));
        } else {
          prepared.push(file);
        }
      } catch (err) {
        rejected.push(file.name + '：' + (err && err.message ? err.message : '压缩失败'));
      }
    }
    if (rejected.length) {
      showTip('以下文件未加入上传：' + rejected.join('；'), 'danger');
      setHelper(root, rejected.join('\n'), 'error');
    }
    return prepared;
  }

  function validateFiles(files) {
    var bad = files.find(function (file) {
      var ext = (file.name.split('.').pop() || '').toLowerCase();
      return ALLOWED_EXTS.indexOf(ext) === -1 || file.size > MAX_BYTES;
    });
    if (!bad) return true;
    var ext = (bad.name.split('.').pop() || '').toLowerCase();
    if (ALLOWED_EXTS.indexOf(ext) === -1) {
      showTip('文件类型不支持：' + bad.name, 'danger');
    } else {
      showTip('文件超过 10MB：' + bad.name, 'danger');
    }
    return false;
  }

  async function prepareFiles(root, rawFiles, fromPaste) {
    try {
      return await normalizeFiles(root, rawFiles, fromPaste);
    } catch (err) {
      showTip('文件预处理失败，请改用原始文件上传。', 'danger');
      setHelper(root, '文件预处理失败：' + (err && err.message ? err.message : '未知错误'), 'error');
      console.error('[上传增强] 文件预处理失败', err);
      return [];
    }
  }

  async function uploadFiles(root, rawFiles, fromPaste) {
    var input = getInput(root);
    if (!input || !rawFiles || !rawFiles.length) return false;
    if (root.getAttribute('data-tm-upload-processing') === '1') {
      showTip('当前附件正在处理中，请稍候。', 'danger');
      return false;
    }
    root.setAttribute('data-tm-upload-processing', '1');

    try {
      var files = await prepareFiles(root, rawFiles, fromPaste);
      if (!files.length || !validateFiles(files)) {
        restoreHelper(root, 5000);
        return false;
      }

      var $ = window.jQuery || window.$;
      if ($ && $.fn && $.fn.fileupload) {
        try {
          $(input).fileupload('add', { files: files });
          showTip('已加入上传队列：' + files.length + ' 个文件', 'success');
          restoreHelper(root, 2500);
          return true;
        } catch (err) {
          console.warn('[上传增强] fileupload add 失败，尝试触发原生 change。', err);
        }
      }

      try {
        var dt = new DataTransfer();
        files.forEach(function (file) { dt.items.add(file); });
        input.files = dt.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        showTip('已选择文件：' + files.length + ' 个', 'success');
        restoreHelper(root, 2500);
        return true;
      } catch (err2) {
        showTip('浏览器不允许脚本写入文件选择框，请改用点击上传。', 'danger');
        setHelper(root, '压缩完成，但浏览器阻止了自动回填文件。请刷新页面后重试。', 'error');
        console.error('[上传增强] 上传失败', err2);
        return false;
      }
    } finally {
      root.removeAttribute('data-tm-upload-processing');
    }
  }

  function filesFromClipboard(event) {
    var data = event.clipboardData;
    if (!data) return [];

    var files = Array.prototype.slice.call(data.files || []);
    if (files.length) return files;

    return Array.prototype.slice.call(data.items || [])
      .filter(function (item) { return item.kind === 'file'; })
      .map(function (item) { return item.getAsFile(); })
      .filter(Boolean);
  }

  function activeUploadRoot() {
    var active = document.activeElement;
    var scoped = active && active.closest && active.closest(ROOT_SELECTOR);
    if (scoped && isVisible(scoped)) return scoped;

    if (lastActiveRoot && isVisible(lastActiveRoot)) return lastActiveRoot;

    var roots = Array.prototype.slice.call(document.querySelectorAll(ROOT_SELECTOR)).filter(isVisible);
    if (!roots.length) return null;
    return roots[roots.length - 1];
  }

  function addHelper(root) {
    if (root.querySelector('.tm-upload-helper')) return;
    var container = root.querySelector('[emap-role="upload-container"]');
    var button = root.querySelector('.emap-upload-btn-button');
    if (!container || !button) return;
    var helper = document.createElement('div');
    helper.className = 'tm-upload-helper';
    helper.dataset.defaultText = '可将文件拖到此附件区域上传，也可按 Ctrl+V 粘贴截图或剪贴板文件；粘贴时可修改文件名，超 10MB 的 PDF/PNG 会尝试压缩。';
    helper.textContent = helper.dataset.defaultText;
    button.parentNode.insertBefore(helper, button.nextSibling);
  }

  function needsPreprocess(files) {
    return Array.prototype.slice.call(files || []).some(function (file) {
      return file.size > MAX_BYTES && (isPdfFile(file) || isPngFile(file));
    });
  }

  function initRoot(root) {
    if (!root || root.getAttribute(INIT_ATTR) === '1') return;
    if (!getInput(root)) return;
    root.setAttribute(INIT_ATTR, '1');
    addHelper(root);

    root.addEventListener('pointerdown', function () {
      lastActiveRoot = root;
    }, true);

    ['dragenter', 'dragover'].forEach(function (type) {
      root.addEventListener(type, function (event) {
        if (!event.dataTransfer || !event.dataTransfer.types || Array.prototype.indexOf.call(event.dataTransfer.types, 'Files') === -1) return;
        event.preventDefault();
        event.stopPropagation();
        root.classList.add('tm-upload-drag-over');
        event.dataTransfer.dropEffect = 'copy';
      }, true);
    });

    ['dragleave', 'dragend'].forEach(function (type) {
      root.addEventListener(type, function () {
        root.classList.remove('tm-upload-drag-over');
      }, true);
    });

    root.addEventListener('drop', function (event) {
      var files = event.dataTransfer && event.dataTransfer.files;
      if (!files || !files.length) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      root.classList.remove('tm-upload-drag-over');
      uploadFiles(root, files, false);
    }, true);

    getInput(root).addEventListener('change', function (event) {
      var files = event.target && event.target.files;
      if (!needsPreprocess(files)) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      uploadFiles(root, files, false);
      event.target.value = '';
    }, true);
  }

  function scan() {
    installStyle();
    Array.prototype.forEach.call(document.querySelectorAll(ROOT_SELECTOR), initRoot);
  }

  document.addEventListener('paste', function (event) {
    var files = filesFromClipboard(event);
    if (!files.length) return;
    var root = activeUploadRoot();
    if (!root) return;
    event.preventDefault();
    uploadFiles(root, files, true);
  }, true);

  scan();
  new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
})();
