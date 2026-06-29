// ==UserScript==
// @name         NWAFU 网上评教辅助
// @version      1.0.0
// @description  为网上评教页面增加一键填写、未提交项定位和手动提交辅助面板。
// @match        https://newehall.nwafu.edu.cn/jwapp/sys/jwwspj/*default/index.do*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  var CONFIG = {
    preferredOptionText: '完全赞同',
    commentText: '无意见',
    autoFillWhenEnteringForm: false,
    allowSubmitButton: true,
    debug: false
  };

  var ROOT_ID = 'nwafu-jwwspj-helper';
  var STYLE_ID = 'nwafu-jwwspj-helper-style';
  var ROOT_MINIMIZED_KEY = 'nwafu-jwwspj-helper-minimized';
  var POSITION_KEY = 'nwafu-jwwspj-helper-position';
  var SELECTORS = {
    resultTab: 'a[href="#/pj"], div.bh-headerBar-nav-item[title="结果性评教"]',
    processTab: 'a[href="#/gcpj"], div.bh-headerBar-nav-item[title="过程评教"]',
    listCard: '.bh-card.bh-card-lv1',
    statusTag: '.sc-panel-diagonalStrips-bar',
    cardTitle: '.sc-panel-diagonalStrips-text',
    formDialog: '.bh-paper-pile-dialog, .bh-paper-pile-body',
    closeDialog: '.bh-paper-pile-closeIcon',
    radio: 'input[type="radio"]',
    textarea: 'textarea',
    submit: 'a[data-action="提交"], button[data-action="提交"], a, button'
  };

  var state = {
    lastSignature: '',
    statusTimer: null,
    statusLockedUntil: 0,
    refreshTimer: null,
    observer: null,
    dragging: false,
    dragOffsetX: 0,
    dragOffsetY: 0,
    lastAutoFillKey: ''
  };

  function log(message, value) {
    if (!CONFIG.debug) return;
    if (typeof value === 'undefined') {
      console.log('[网上评教辅助] ' + message);
    } else {
      console.log('[网上评教辅助] ' + message, value);
    }
  }

  function isVisible(el) {
    if (!el) return false;
    var rect = el.getBoundingClientRect();
    var style = window.getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
  }

  function isDisabled(el) {
    return !el || el.disabled || el.readOnly || el.getAttribute('disabled') !== null || el.getAttribute('readonly') !== null;
  }

  function textOf(el) {
    return (el && (el.innerText || el.textContent || '')).replace(/\s+/g, ' ').trim();
  }

  function getPageKind() {
    var hasVisibleDialog = Array.from(document.querySelectorAll(SELECTORS.formDialog)).some(isVisible);
    var hasVisibleFormControl = Array.from(document.querySelectorAll(SELECTORS.radio + ', ' + SELECTORS.textarea)).some(isVisible);
    if (hasVisibleDialog || hasVisibleFormControl) return 'form';
    if (getVisibleCards().length) return 'list';
    return 'unknown';
  }

  function getVisibleCards() {
    return Array.from(document.querySelectorAll(SELECTORS.listCard)).filter(isVisible);
  }

  function getCardStatus(card) {
    var tag = card.querySelector(SELECTORS.statusTag);
    if (tag) return textOf(tag);
    var text = textOf(card);
    if (text.indexOf('未提交') !== -1) return '未提交';
    if (text.indexOf('已提交') !== -1) return '已提交';
    return '';
  }

  function getCardTitle(card) {
    var title = card.querySelector(SELECTORS.cardTitle);
    return textOf(title) || textOf(card).replace(/^(已提交|未提交)\s*/, '').slice(0, 80);
  }

  function summarizeList() {
    var cards = getVisibleCards();
    var pending = [];
    var submitted = [];
    cards.forEach(function (card) {
      var status = getCardStatus(card);
      var item = {
        card: card,
        title: getCardTitle(card),
        status: status
      };
      if (status === '未提交') pending.push(item);
      if (status === '已提交') submitted.push(item);
    });
    return {
      total: cards.length,
      pending: pending,
      submitted: submitted
    };
  }

  function getRadioGroups() {
    var groups = new Map();
    Array.from(document.querySelectorAll(SELECTORS.radio)).forEach(function (radio) {
      if (!isVisible(radio) || !radio.name) return;
      if (!groups.has(radio.name)) groups.set(radio.name, []);
      groups.get(radio.name).push(radio);
    });
    return Array.from(groups.values());
  }

  function getRadioLabel(radio) {
    var label = radio.closest('label');
    if (!label && radio.id) {
      label = document.querySelector('label[for="' + window.CSS.escape(radio.id) + '"]');
    }
    if (!label) {
      var parent = radio.parentElement;
      if (parent) label = parent.querySelector('.bh-radio-label') || parent;
    }
    return textOf(label);
  }

  function chooseRadioFromGroup(group) {
    var enabled = group.filter(function (radio) {
      return !isDisabled(radio) && isVisible(radio);
    });
    if (enabled.length === 0) {
      return {
        status: 'readonly'
      };
    }

    var checked = enabled.find(function (radio) {
      return radio.checked;
    });
    if (checked) {
      return {
        status: 'skipped'
      };
    }

    var preferred = CONFIG.preferredOptionText
      ? enabled.find(function (radio) {
          return getRadioLabel(radio).indexOf(CONFIG.preferredOptionText) !== -1;
        })
      : null;
    var target = preferred || enabled[0];
    target.checked = true;
    target.click();
    target.dispatchEvent(new Event('input', { bubbles: true }));
    target.dispatchEvent(new Event('change', { bubbles: true }));
    return {
      status: 'filled',
      label: getRadioLabel(target) || CONFIG.preferredOptionText
    };
  }

  function setNativeValue(el, value) {
    var proto = Object.getPrototypeOf(el);
    var descriptor = proto && Object.getOwnPropertyDescriptor(proto, 'value');
    if (descriptor && descriptor.set) {
      descriptor.set.call(el, value);
    } else {
      el.value = value;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function fillCurrentForm() {
    var groups = getRadioGroups();
    var radioStats = {
      filled: 0,
      skipped: 0,
      readonly: 0
    };

    groups.forEach(function (group) {
      var result = chooseRadioFromGroup(group);
      radioStats[result.status] += 1;
    });

    var textareas = Array.from(document.querySelectorAll(SELECTORS.textarea)).filter(function (textarea) {
      return isVisible(textarea);
    });
    var textareaStats = {
      filled: 0,
      skipped: 0,
      readonly: 0
    };

    textareas.forEach(function (textarea) {
      if (isDisabled(textarea)) {
        textareaStats.readonly += 1;
        return;
      }
      if (textarea.value.trim()) {
        textareaStats.skipped += 1;
        return;
      }
      setNativeValue(textarea, CONFIG.commentText);
      textareaStats.filled += 1;
    });

    var summary = [
      '单选：填写 ' + radioStats.filled + '，已选 ' + radioStats.skipped + '，只读 ' + radioStats.readonly,
      '评语：填写 ' + textareaStats.filled + '，已有 ' + textareaStats.skipped + '，只读 ' + textareaStats.readonly
    ].join('；');

    setStatus(summary, radioStats.filled || textareaStats.filled ? 'success' : 'info');
    refreshPanel();
    return {
      radio: radioStats,
      textarea: textareaStats
    };
  }

  function getSubmitButton() {
    var candidates = Array.from(document.querySelectorAll(SELECTORS.submit)).filter(function (el) {
      if (!isVisible(el) || isDisabled(el)) return false;
      var text = textOf(el) || el.value || el.getAttribute('data-action') || '';
      return text.trim() === '提交' || el.getAttribute('data-action') === '提交';
    });
    return candidates[0] || null;
  }

  function submitCurrentForm() {
    if (!CONFIG.allowSubmitButton) {
      setStatus('当前配置未启用提交按钮。', 'warn');
      return;
    }
    var button = getSubmitButton();
    if (!button) {
      setStatus('没有找到可点击的提交按钮。已提交问卷通常不会显示提交按钮。', 'warn');
      return;
    }
    if (!window.confirm('确认点击页面的提交按钮吗？脚本不会自动确认后续弹窗。')) {
      setStatus('已取消提交。', 'info');
      return;
    }
    button.click();
    setStatus('已点击提交按钮。若页面弹出确认框，请手动确认。', 'warn');
  }

  function clickFirstPending() {
    var summary = summarizeList();
    if (summary.pending.length === 0) {
      setStatus('当前列表没有未提交项目。', 'info');
      return false;
    }
    var item = summary.pending[0];
    item.card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    window.setTimeout(function () {
      item.card.click();
      setStatus('已打开：' + item.title, 'success');
    }, 180);
    return true;
  }

  function switchTab(type) {
    var selector = type === 'process' ? SELECTORS.processTab : SELECTORS.resultTab;
    var target = Array.from(document.querySelectorAll(selector)).find(isVisible);
    if (!target) {
      setStatus('没有找到对应的评教入口。', 'warn');
      return;
    }
    target.click();
    setStatus(type === 'process' ? '已切换到过程评教。' : '已切换到结果性评教。', 'info');
    scheduleRefresh();
  }

  function closeFormDialog() {
    var close = Array.from(document.querySelectorAll(SELECTORS.closeDialog)).find(isVisible);
    if (close) {
      close.click();
      setStatus('已返回列表。', 'info');
      scheduleRefresh();
      return;
    }
    window.history.back();
    setStatus('已尝试返回上一页。', 'info');
    scheduleRefresh();
  }

  function setStatus(message, type) {
    var root = document.getElementById(ROOT_ID);
    var status = root && root.querySelector('[data-role="status"]');
    if (!status) return;
    status.textContent = message;
    status.dataset.type = type || 'info';
    state.statusLockedUntil = Date.now() + 8000;
    window.clearTimeout(state.statusTimer);
    state.statusTimer = window.setTimeout(function () {
      if (status.textContent === message) {
        status.textContent = getDefaultStatusText();
        status.dataset.type = 'info';
        state.statusLockedUntil = 0;
      }
    }, 8000);
  }

  function syncDefaultStatus() {
    if (Date.now() < state.statusLockedUntil) return;
    var root = document.getElementById(ROOT_ID);
    var status = root && root.querySelector('[data-role="status"]');
    if (!status) return;
    status.textContent = getDefaultStatusText();
    status.dataset.type = 'info';
  }

  function getDefaultStatusText() {
    var kind = getPageKind();
    if (kind === 'form') return '当前是问卷页面。请检查内容后再提交。';
    if (kind === 'list') return '当前是评教列表。可打开未提交项目。';
    return '等待网上评教页面加载。';
  }

  function getPageSignature() {
    var kind = getPageKind();
    if (kind === 'list') {
      var list = summarizeList();
      return [kind, location.hash, list.total, list.pending.length, list.submitted.length].join('|');
    }
    if (kind === 'form') {
      var groups = getRadioGroups();
      var editableGroups = groups.filter(function (group) {
        return group.some(function (radio) {
          return !isDisabled(radio);
        });
      }).length;
      var editableTextareas = Array.from(document.querySelectorAll(SELECTORS.textarea)).filter(function (textarea) {
        return isVisible(textarea) && !isDisabled(textarea);
      }).length;
      return [kind, location.hash, groups.length, editableGroups, editableTextareas, textOf(document.querySelector(SELECTORS.formDialog)).slice(0, 60)].join('|');
    }
    return [kind, location.href].join('|');
  }

  function updateSummaryText() {
    var root = document.getElementById(ROOT_ID);
    if (!root) return;
    var title = root.querySelector('[data-role="title"]');
    var summary = root.querySelector('[data-role="summary"]');
    var formActions = root.querySelector('[data-role="form-actions"]');
    var listActions = root.querySelector('[data-role="list-actions"]');
    var submitAction = root.querySelector('[data-action="submit"]');
    var fillAction = root.querySelector('[data-action="fill"]');
    var kind = getPageKind();

    root.dataset.page = kind;
    title.textContent = kind === 'form' ? '评教辅助：问卷' : '评教辅助';

    if (kind === 'list') {
      var list = summarizeList();
      summary.textContent = '列表项目 ' + list.total + ' 个，未提交 ' + list.pending.length + ' 个，已提交 ' + list.submitted.length + ' 个。';
      formActions.hidden = true;
      listActions.hidden = false;
      syncDefaultStatus();
      return;
    }

    if (kind === 'form') {
      var groups = getRadioGroups();
      var editableGroups = groups.filter(function (group) {
        return group.some(function (radio) {
          return !isDisabled(radio);
        });
      }).length;
      var textareas = Array.from(document.querySelectorAll(SELECTORS.textarea)).filter(isVisible);
      var editableTextareas = textareas.filter(function (textarea) {
        return !isDisabled(textarea);
      }).length;
      var submit = getSubmitButton();
      summary.textContent = '单选题组 ' + groups.length + ' 个，可编辑 ' + editableGroups + ' 个；评语框 ' + textareas.length + ' 个，可编辑 ' + editableTextareas + ' 个；' + (submit ? '可提交。' : '未发现提交按钮。');
      formActions.hidden = false;
      listActions.hidden = true;
      fillAction.disabled = !editableGroups && !editableTextareas;
      submitAction.disabled = !submit;
      maybeAutoFill(groups, editableGroups, editableTextareas);
      syncDefaultStatus();
      return;
    }

    summary.textContent = '未识别到评教列表或问卷。';
    formActions.hidden = true;
    listActions.hidden = false;
    syncDefaultStatus();
  }

  function maybeAutoFill(groups, editableGroups, editableTextareas) {
    if (!CONFIG.autoFillWhenEnteringForm) return;
    if (!editableGroups && !editableTextareas) return;
    var key = location.href + '|' + groups.length + '|' + editableGroups + '|' + editableTextareas;
    if (state.lastAutoFillKey === key) return;
    state.lastAutoFillKey = key;
    fillCurrentForm();
  }

  function refreshPanel() {
    var root = document.getElementById(ROOT_ID);
    if (!root) return;
    var signature = getPageSignature();
    if (signature === state.lastSignature) return;
    state.lastSignature = signature;
    updateSummaryText();
  }

  function scheduleRefresh() {
    window.clearTimeout(state.refreshTimer);
    state.refreshTimer = window.setTimeout(function () {
      state.lastSignature = '';
      refreshPanel();
    }, 350);
  }

  function installStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      '#' + ROOT_ID + ' {',
      '  position: fixed;',
      '  right: 18px;',
      '  bottom: 18px;',
      '  width: min(330px, calc(100vw - 28px));',
      '  z-index: 99999;',
      '  color: #1f2933;',
      '  font: 13px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;',
      '  background: #ffffff;',
      '  border: 1px solid #ccd6e0;',
      '  border-radius: 8px;',
      '  box-shadow: 0 12px 28px rgba(15, 23, 42, 0.18);',
      '  overflow: hidden;',
      '}',
      '#' + ROOT_ID + ' * { box-sizing: border-box; }',
      '#' + ROOT_ID + ' .jwwspj-helper-head {',
      '  display: flex;',
      '  align-items: center;',
      '  justify-content: space-between;',
      '  gap: 8px;',
      '  padding: 9px 10px;',
      '  cursor: move;',
      '  background: #f5f7fa;',
      '  border-bottom: 1px solid #d9e2ec;',
      '}',
      '#' + ROOT_ID + ' .jwwspj-helper-title { font-weight: 700; }',
      '#' + ROOT_ID + ' .jwwspj-helper-toggle {',
      '  width: 28px;',
      '  height: 28px;',
      '  padding: 0;',
      '  border: 1px solid #b8c4d0;',
      '  border-radius: 6px;',
      '  background: #fff;',
      '  color: #334e68;',
      '  cursor: pointer;',
      '}',
      '#' + ROOT_ID + ' .jwwspj-helper-body { padding: 10px; }',
      '#' + ROOT_ID + '[data-minimized="true"] .jwwspj-helper-body { display: none; }',
      '#' + ROOT_ID + ' .jwwspj-helper-summary { margin: 0 0 8px; color: #334e68; }',
      '#' + ROOT_ID + ' .jwwspj-helper-status {',
      '  min-height: 22px;',
      '  margin: 8px 0 0;',
      '  padding: 6px 8px;',
      '  border-radius: 6px;',
      '  background: #eef2f7;',
      '  color: #334e68;',
      '}',
      '#' + ROOT_ID + ' .jwwspj-helper-status[data-type="success"] { background: #edf8f1; color: #1f7a4d; }',
      '#' + ROOT_ID + ' .jwwspj-helper-status[data-type="warn"] { background: #fff7e6; color: #8a5b00; }',
      '#' + ROOT_ID + ' .jwwspj-helper-status[data-type="error"] { background: #fff1f1; color: #a12626; }',
      '#' + ROOT_ID + ' .jwwspj-helper-actions {',
      '  display: grid;',
      '  grid-template-columns: 1fr 1fr;',
      '  gap: 8px;',
      '}',
      '#' + ROOT_ID + ' .jwwspj-helper-actions[hidden] { display: none; }',
      '#' + ROOT_ID + ' .jwwspj-helper-actions button {',
      '  min-height: 32px;',
      '  padding: 6px 8px;',
      '  border: 1px solid #2f7de1;',
      '  border-radius: 6px;',
      '  background: #fff;',
      '  color: #235a97;',
      '  cursor: pointer;',
      '}',
      '#' + ROOT_ID + ' .jwwspj-helper-actions button:hover { background: #f0f6ff; }',
      '#' + ROOT_ID + ' .jwwspj-helper-actions button:disabled {',
      '  border-color: #d3dae3;',
      '  color: #8a99a8;',
      '  background: #f8fafc;',
      '  cursor: not-allowed;',
      '}',
      '#' + ROOT_ID + ' .jwwspj-helper-actions button[data-action="submit"] { border-color: #d97706; color: #8a5b00; }',
      '#' + ROOT_ID + ' .jwwspj-helper-actions button[data-action="submit"]:disabled { border-color: #d3dae3; color: #8a99a8; }',
      '#' + ROOT_ID + ' .jwwspj-helper-field {',
      '  display: grid;',
      '  grid-template-columns: 72px 1fr;',
      '  align-items: center;',
      '  gap: 8px;',
      '  margin: 8px 0;',
      '}',
      '#' + ROOT_ID + ' .jwwspj-helper-field input,',
      '#' + ROOT_ID + ' .jwwspj-helper-field select {',
      '  width: 100%;',
      '  min-width: 0;',
      '  height: 30px;',
      '  padding: 4px 7px;',
      '  border: 1px solid #c8d2dc;',
      '  border-radius: 6px;',
      '  background: #fff;',
      '}',
      '@media (max-width: 520px) {',
      '  #' + ROOT_ID + ' { right: 14px; bottom: 14px; }',
      '  #' + ROOT_ID + ' .jwwspj-helper-actions { grid-template-columns: 1fr; }',
      '}'
    ].join('\n');
    document.head.appendChild(style);
  }

  function restorePosition(root) {
    try {
      var raw = window.localStorage.getItem(POSITION_KEY);
      if (!raw) return;
      var pos = JSON.parse(raw);
      if (typeof pos.left !== 'number' || typeof pos.top !== 'number') return;
      root.style.left = Math.max(8, Math.min(pos.left, window.innerWidth - 80)) + 'px';
      root.style.top = Math.max(8, Math.min(pos.top, window.innerHeight - 42)) + 'px';
      root.style.right = 'auto';
      root.style.bottom = 'auto';
    } catch (error) {
      log('恢复面板位置失败', error);
    }
  }

  function savePosition(root) {
    var rect = root.getBoundingClientRect();
    window.localStorage.setItem(POSITION_KEY, JSON.stringify({ left: rect.left, top: rect.top }));
  }

  function handleDragStart(event) {
    var root = document.getElementById(ROOT_ID);
    if (!root || event.target.closest('button,input,select')) return;
    var rect = root.getBoundingClientRect();
    state.dragging = true;
    state.dragOffsetX = event.clientX - rect.left;
    state.dragOffsetY = event.clientY - rect.top;
    event.preventDefault();
  }

  function handleDragMove(event) {
    if (!state.dragging) return;
    var root = document.getElementById(ROOT_ID);
    if (!root) return;
    var width = root.offsetWidth;
    var height = root.offsetHeight;
    var left = Math.max(8, Math.min(event.clientX - state.dragOffsetX, window.innerWidth - width - 8));
    var top = Math.max(8, Math.min(event.clientY - state.dragOffsetY, window.innerHeight - height - 8));
    root.style.left = left + 'px';
    root.style.top = top + 'px';
    root.style.right = 'auto';
    root.style.bottom = 'auto';
  }

  function handleDragEnd() {
    if (!state.dragging) return;
    state.dragging = false;
    var root = document.getElementById(ROOT_ID);
    if (root) savePosition(root);
  }

  function buildPanel() {
    if (document.getElementById(ROOT_ID)) return;
    installStyle();

    var root = document.createElement('div');
    root.id = ROOT_ID;
    root.dataset.minimized = window.localStorage.getItem(ROOT_MINIMIZED_KEY) === 'true' ? 'true' : 'false';
    root.innerHTML = [
      '<div class="jwwspj-helper-head" data-role="drag">',
      '  <span class="jwwspj-helper-title" data-role="title">评教辅助</span>',
      '  <button class="jwwspj-helper-toggle" type="button" data-action="toggle" title="收起或展开">-</button>',
      '</div>',
      '<div class="jwwspj-helper-body">',
      '  <p class="jwwspj-helper-summary" data-role="summary">等待页面加载。</p>',
      '  <div class="jwwspj-helper-field">',
      '    <label for="jwwspj-option-text">选项</label>',
      '    <select id="jwwspj-option-text" data-role="option">',
      '      <option value="完全赞同">完全赞同</option>',
      '      <option value="基本赞同">基本赞同</option>',
      '      <option value="一般">一般</option>',
      '      <option value="不太赞同">不太赞同</option>',
      '      <option value="不赞同">不赞同</option>',
      '      <option value="">第一项</option>',
      '    </select>',
      '  </div>',
      '  <div class="jwwspj-helper-field">',
      '    <label for="jwwspj-comment-text">评语</label>',
      '    <input id="jwwspj-comment-text" data-role="comment" type="text">',
      '  </div>',
      '  <div class="jwwspj-helper-actions" data-role="list-actions">',
      '    <button type="button" data-action="open-pending">打开未提交</button>',
      '    <button type="button" data-action="result-tab">结果评教</button>',
      '    <button type="button" data-action="process-tab">过程评教</button>',
      '    <button type="button" data-action="refresh">刷新状态</button>',
      '  </div>',
      '  <div class="jwwspj-helper-actions" data-role="form-actions" hidden>',
      '    <button type="button" data-action="fill">填写当前问卷</button>',
      '    <button type="button" data-action="submit">提交当前问卷</button>',
      '    <button type="button" data-action="close-form">返回列表</button>',
      '    <button type="button" data-action="refresh">刷新状态</button>',
      '  </div>',
      '  <div class="jwwspj-helper-status" data-role="status" data-type="info">等待页面加载。</div>',
      '</div>'
    ].join('');

    root.querySelector('[data-role="option"]').value = CONFIG.preferredOptionText;
    root.querySelector('[data-role="comment"]').value = CONFIG.commentText;
    root.querySelector('[data-action="toggle"]').textContent = root.dataset.minimized === 'true' ? '+' : '-';
    document.body.appendChild(root);
    restorePosition(root);
    bindPanel(root);
    refreshPanel();
  }

  function bindPanel(root) {
    function updateConfigFromControl(event) {
      var role = event.target && event.target.dataset && event.target.dataset.role;
      if (role === 'option') CONFIG.preferredOptionText = event.target.value;
      if (role === 'comment') CONFIG.commentText = event.target.value;
    }

    root.addEventListener('input', updateConfigFromControl);
    root.addEventListener('change', updateConfigFromControl);

    root.addEventListener('click', function (event) {
      var button = event.target.closest('button[data-action]');
      if (!button) return;
      var action = button.dataset.action;
      if (action === 'toggle') {
        var minimized = root.dataset.minimized !== 'true';
        root.dataset.minimized = minimized ? 'true' : 'false';
        button.textContent = minimized ? '+' : '-';
        window.localStorage.setItem(ROOT_MINIMIZED_KEY, minimized ? 'true' : 'false');
      } else if (action === 'open-pending') {
        clickFirstPending();
      } else if (action === 'result-tab') {
        switchTab('result');
      } else if (action === 'process-tab') {
        switchTab('process');
      } else if (action === 'fill') {
        fillCurrentForm();
      } else if (action === 'submit') {
        submitCurrentForm();
      } else if (action === 'close-form') {
        closeFormDialog();
      } else if (action === 'refresh') {
        state.lastSignature = '';
        refreshPanel();
        setStatus('状态已刷新。', 'info');
      }
    });

    var head = root.querySelector('[data-role="drag"]');
    head.addEventListener('mousedown', handleDragStart);
    document.addEventListener('mousemove', handleDragMove);
    document.addEventListener('mouseup', handleDragEnd);
  }

  function installObserver() {
    if (state.observer || !document.body) return;
    state.observer = new MutationObserver(function (mutations) {
      var shouldRefresh = mutations.some(function (mutation) {
        if (mutation.type !== 'childList') return false;
        return mutation.addedNodes.length || mutation.removedNodes.length;
      });
      if (shouldRefresh) scheduleRefresh();
    });
    state.observer.observe(document.body, {
      childList: true,
      subtree: true
    });
    window.addEventListener('hashchange', scheduleRefresh);
  }

  function init() {
    if (!document.body) return;
    buildPanel();
    installObserver();
    window.setInterval(refreshPanel, 2500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
