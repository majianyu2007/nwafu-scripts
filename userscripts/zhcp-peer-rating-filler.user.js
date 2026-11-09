// ==UserScript==
// @name        西农综测班级互评填分助手
// @version     1.1.0
// @description 在综合测评班级互评弹窗内按档位批量生成分数，档位按各项分值区间换算，可调浮动幅度和满分数量上限，保存由用户点击。
// @match       https://xsfw.nwafu.edu.cn/xsfw/sys/zhcptybbapp/*default/index.do*
// @grant       none
// @run-at      document-idle
// @namespace   https://mjy.js.org/nwafu-scripts/
// @author      majianyu2007
// @license     MIT
// @homepageURL https://mjy.js.org/nwafu-scripts/scripts/zhcp-peer-rating-filler/
// @supportURL  https://github.com/majianyu2007/nwafu-scripts/issues
// @updateURL   https://mjy.js.org/nwafu-scripts/userscripts/zhcp-peer-rating-filler.user.js
// @downloadURL https://mjy.js.org/nwafu-scripts/userscripts/zhcp-peer-rating-filler.user.js
// ==/UserScript==

(function () {
  'use strict';

  const PANEL_ID = 'nwafu-zhcp-filler';
  const STYLE_ID = 'nwafu-zhcp-filler-style';
  const MODAL_ID = 'nwafu-zhcp-filler-modal';
  const SETTINGS_KEY = 'nwafu-zhcp-filler-settings';
  const POSITION_KEY = 'nwafu-zhcp-filler-position';
  const TABLE_ID = 'hpdf_table';
  const DECIMALS = 2;
  const STEP = 0.01;

  const DEFAULT_SETTINGS = {
    mode: 'ratio',
    ratioLevel: 99.25,
    ratioSpread: 0.5,
    absLevel: 3.97,
    absSpread: 0.02,
    limitFull: false,
    maxFull: 3,
    skipFilled: true,
  };

  const state = {
    minimized: false,
    dialogOpen: false,
    isDormitory: false,
    cells: [],
    indicators: [],
    message: '',
    signature: '',
    dragging: false,
    settings: loadSettings(),
  };

  function loadSettings() {
    const merged = Object.assign({}, DEFAULT_SETTINGS);
    try {
      const raw = window.localStorage.getItem(SETTINGS_KEY);
      if (!raw) return merged;
      const saved = JSON.parse(raw);
      Object.keys(DEFAULT_SETTINGS).forEach(key => {
        if (saved[key] !== undefined && saved[key] !== null) merged[key] = saved[key];
      });
    } catch (error) {
      /* 读取失败时使用默认值 */
    }
    return merged;
  }

  function saveSettings() {
    try {
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
    } catch (error) {
      /* 存储不可用时忽略 */
    }
  }

  function sleep(ms) {
    return new Promise(resolve => window.setTimeout(resolve, ms));
  }

  async function waitFor(check, timeout) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeout) {
      if (check()) return true;
      await sleep(150);
    }
    return check();
  }

  function round(value) {
    return Number(value.toFixed(DECIMALS));
  }

  function clamp(value, min, max) {
    if (value < min) return min;
    if (value > max) return max;
    return value;
  }

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, ch => {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${PANEL_ID} {
        position: fixed;
        right: 24px;
        top: 110px;
        z-index: 2147483646;
        width: min(340px, calc(100vw - 24px));
        max-height: 76vh;
        display: flex;
        flex-direction: column;
        font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
        color: #1f2937;
        background: #ffffff;
        border: 1px solid #d1d5db;
        box-shadow: 0 18px 48px rgba(15, 23, 42, 0.2);
      }
      #${PANEL_ID} * { box-sizing: border-box; }
      #${PANEL_ID} .nzf-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 12px 14px;
        border-bottom: 1px solid #e5e7eb;
        cursor: move;
        user-select: none;
      }
      #${PANEL_ID} .nzf-title { font-weight: 700; font-size: 14px; color: #111827; }
      #${PANEL_ID} .nzf-sub { margin-top: 2px; font-size: 12px; color: #64748b; }
      #${PANEL_ID} .nzf-body {
        flex: 1;
        min-height: 0;
        overflow: auto;
        padding: 12px 14px 14px;
        background: #f8fafc;
      }
      #${PANEL_ID}.is-min { width: 220px; max-height: none; }
      #${PANEL_ID}.is-min .nzf-body { display: none; }
      #${PANEL_ID} button {
        border: 1px solid #cbd5e1;
        background: #fff;
        color: #1f2937;
        cursor: pointer;
        border-radius: 3px;
        padding: 5px 10px;
        font-size: 12px;
      }
      #${PANEL_ID} button:hover:not(:disabled) { background: #f1f5f9; }
      #${PANEL_ID} button:disabled { color: #94a3b8; cursor: not-allowed; }
      #${PANEL_ID} .nzf-primary {
        width: 100%;
        padding: 8px;
        margin-top: 10px;
        font-size: 13px;
        font-weight: 600;
        color: #fff;
        background: #2195f2;
        border-color: #2195f2;
      }
      #${PANEL_ID} .nzf-primary:hover:not(:disabled) { background: #1a7fd0; }
      #${PANEL_ID} .nzf-primary:disabled { background: #cbd5e1; border-color: #cbd5e1; color: #fff; }
      #${PANEL_ID} .nzf-section { margin-bottom: 12px; }
      #${PANEL_ID} .nzf-label {
        display: block;
        margin-bottom: 5px;
        font-size: 12px;
        font-weight: 600;
        color: #334155;
      }
      #${PANEL_ID} .nzf-presets { display: flex; flex-wrap: wrap; gap: 5px; }
      #${PANEL_ID} .nzf-row { display: flex; align-items: center; gap: 6px; }
      #${PANEL_ID} .nzf-row input[type="number"] {
        width: 100%;
        min-width: 0;
        padding: 5px 6px;
        border: 1px solid #cbd5e1;
        border-radius: 3px;
        font-size: 12px;
      }
      #${PANEL_ID} .nzf-check {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-top: 6px;
        font-size: 12px;
        color: #334155;
      }
      #${PANEL_ID} .nzf-check input { margin: 0; flex: none; }
      #${PANEL_ID} .nzf-status {
        padding: 8px 10px;
        margin-bottom: 12px;
        background: #fff;
        border: 1px solid #e2e8f0;
        border-radius: 3px;
        font-size: 12px;
        color: #475569;
      }
      #${PANEL_ID} .nzf-status b { color: #111827; }
      #${PANEL_ID} .nzf-warn { color: #b45309; }
      #${PANEL_ID} .nzf-list { display: flex; flex-direction: column; gap: 4px; }
      #${PANEL_ID} .nzf-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 6px 8px;
        background: #fff;
        border: 1px solid #e2e8f0;
        border-radius: 3px;
        font-size: 12px;
      }
      #${PANEL_ID} .nzf-item-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      #${PANEL_ID} .nzf-done { color: #15803d; flex: none; }
      #${PANEL_ID} .nzf-todo { color: #b45309; flex: none; }
      #${PANEL_ID} .nzf-slider { width: 100%; margin: 2px 0 0; }
      #${PANEL_ID} .nzf-preview {
        margin: 8px 0 0;
        font-size: 12px;
        color: #475569;
        word-break: break-all;
      }
      #${PANEL_ID} button.nzf-item {
        width: 100%;
        text-align: left;
        font: inherit;
        cursor: pointer;
      }
      #${PANEL_ID} .nzf-hint { margin-top: 10px; font-size: 12px; color: #64748b; }
      #${MODAL_ID} {
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(15, 23, 42, 0.45);
        font: 13px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
      }
      #${MODAL_ID} .nzf-modal-box {
        width: min(420px, calc(100vw - 32px));
        background: #fff;
        border-radius: 4px;
        box-shadow: 0 24px 60px rgba(15, 23, 42, 0.35);
        overflow: hidden;
      }
      #${MODAL_ID} .nzf-modal-head {
        padding: 14px 18px;
        font-size: 15px;
        font-weight: 700;
        color: #111827;
        border-bottom: 1px solid #e5e7eb;
      }
      #${MODAL_ID} .nzf-modal-body { padding: 16px 18px; color: #334155; }
      #${MODAL_ID} .nzf-modal-body dl {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: 6px 14px;
        margin: 0 0 12px;
      }
      #${MODAL_ID} .nzf-modal-body dt { color: #64748b; }
      #${MODAL_ID} .nzf-modal-body dd { margin: 0; color: #111827; font-weight: 600; }
      #${MODAL_ID} .nzf-modal-note { color: #b45309; }
      #${MODAL_ID} .nzf-modal-foot {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        padding: 12px 18px;
        border-top: 1px solid #e5e7eb;
        background: #f8fafc;
      }
      #${MODAL_ID} button {
        padding: 7px 16px;
        border: 1px solid #cbd5e1;
        border-radius: 3px;
        background: #fff;
        color: #1f2937;
        cursor: pointer;
        font-size: 13px;
      }
      #${MODAL_ID} button.nzf-modal-ok {
        background: #2195f2;
        border-color: #2195f2;
        color: #fff;
        font-weight: 600;
      }
      @media (max-width: 900px) {
        #${PANEL_ID} { right: 12px; top: 70px; width: calc(100vw - 24px); max-height: 60vh; }
      }
    `;
    document.head.appendChild(style);
  }

  function collectCells() {
    const table = document.getElementById(TABLE_ID);
    if (!table) return [];
    const inputs = table.querySelectorAll('input[type="number"][data-zdz]');
    const cells = [];
    inputs.forEach(input => {
      const min = Number(input.dataset.zxz);
      const max = Number(input.dataset.zdz);
      if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) return;
      cells.push({ input, min, max });
    });
    return cells;
  }

  function collectIndicators() {
    const spans = document.querySelectorAll('span[data-action="gotoHp"]');
    return Array.prototype.map.call(spans, span => {
      const parent = span.parentElement;
      const status = parent ? parent.querySelector('span[data-zbmc]') : null;
      const note = status ? (status.textContent || '').replace(/\s+/g, ' ').trim() : '';
      const done = note ? !note.includes('未完成') : status && status.dataset.hpzt !== '0';
      return { name: status ? status.dataset.zbmc || '未命名指标' : '未命名指标', done, el: span };
    });
  }

  function describeRanges(cells) {
    const seen = new Map();
    cells.forEach(cell => {
      const key = `${round(cell.min)}-${round(cell.max)}`;
      seen.set(key, (seen.get(key) || 0) + 1);
    });
    return Array.from(seen.keys());
  }

  // 档位与浮动都按各单元格自身的 [min, max] 换算，同一档位可适配 0-4、0-10、3-6 等不同区间。
  function bandFor(cell, settings) {
    if (settings.mode === 'ratio') {
      const span = cell.max - cell.min;
      const level = clamp(settings.ratioLevel, 0, 100);
      const spread = Math.max(0, settings.ratioSpread);
      return [
        cell.min + (span * clamp(level - spread, 0, 100)) / 100,
        cell.min + (span * clamp(level + spread, 0, 100)) / 100,
      ];
    }
    const level = settings.absLevel;
    const spread = Math.max(0, settings.absSpread);
    return [clamp(level - spread, cell.min, cell.max), clamp(level + spread, cell.min, cell.max)];
  }

  function buildValues(cells, settings) {
    const plans = cells.map(cell => {
      const band = bandFor(cell, settings);
      const value = round(clamp(band[0] + Math.random() * (band[1] - band[0]), cell.min, cell.max));
      return { cell, value };
    });
    if (settings.limitFull) {
      applyFullMarkLimit(plans, Math.max(0, Math.floor(settings.maxFull)));
    }
    return plans;
  }

  // 把超出上限的满分单元格下调一个最小步长，保留的满分位置随机选取。
  function applyFullMarkLimit(plans, allowed) {
    const fullPlans = plans.filter(plan => plan.value >= plan.cell.max - 1e-9);
    if (fullPlans.length <= allowed) return;
    for (let i = fullPlans.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = fullPlans[i];
      fullPlans[i] = fullPlans[j];
      fullPlans[j] = tmp;
    }
    fullPlans.slice(allowed).forEach(plan => {
      const lowered = plan.cell.max - STEP;
      plan.value = round(Math.max(plan.cell.min, lowered));
    });
  }

  function setInputValue(input, text) {
    const descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
    if (descriptor && descriptor.set) {
      descriptor.set.call(input, text);
    } else {
      input.value = text;
    }
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    // 页面在 blur 上做范围校验并标记“未保存”，这里补触发一次，保持与手工输入一致。
    input.dispatchEvent(new Event('blur', { bubbles: false }));
  }

  function applyPlans(plans) {
    let written = 0;
    plans.forEach(plan => {
      setInputValue(plan.cell.input, plan.value.toFixed(DECIMALS));
      written += 1;
    });
    return written;
  }

  function clearCells(cells) {
    cells.forEach(cell => setInputValue(cell.input, ''));
  }

  function closeModal() {
    const existing = document.getElementById(MODAL_ID);
    if (existing) existing.remove();
  }

  function showConfirm(options) {
    closeModal();
    const overlay = document.createElement('div');
    overlay.id = MODAL_ID;
    const rows = options.rows
      .map(row => `<dt>${escapeHtml(row[0])}</dt><dd>${escapeHtml(row[1])}</dd>`)
      .join('');
    const note = options.note
      ? `<p class="nzf-modal-note">${escapeHtml(options.note)}</p>`
      : '';
    overlay.innerHTML = `
      <div class="nzf-modal-box" role="dialog" aria-modal="true">
        <div class="nzf-modal-head">${escapeHtml(options.title)}</div>
        <div class="nzf-modal-body"><dl>${rows}</dl>${note}
          <p>脚本只写入分值，保存和提交仍由你点击。</p>
        </div>
        <div class="nzf-modal-foot">
          <button type="button" class="nzf-modal-cancel">取消</button>
          <button type="button" class="nzf-modal-ok">${escapeHtml(options.okText)}</button>
        </div>
      </div>
    `;
    overlay.addEventListener('click', event => {
      if (event.target === overlay) closeModal();
    });
    overlay.querySelector('.nzf-modal-cancel').addEventListener('click', closeModal);
    overlay.querySelector('.nzf-modal-ok').addEventListener('click', () => {
      closeModal();
      options.onConfirm();
    });
    document.body.appendChild(overlay);
  }

  function handleFill() {
    const cells = collectCells();
    if (!cells.length) {
      setMessage('未检测到可填写的分值输入框。');
      return;
    }
    const targets = state.settings.skipFilled
      ? cells.filter(cell => String(cell.input.value).trim() === '')
      : cells;
    if (!targets.length) {
      setMessage('所有单元格都已填写，已跳过。可关闭“跳过已填写”后重填。');
      return;
    }

    const plans = buildValues(targets, state.settings);
    const values = plans.map(plan => plan.value);
    const lowest = Math.min.apply(null, values);
    const highest = Math.max.apply(null, values);
    const fullCount = plans.filter(plan => plan.value >= plan.cell.max - 1e-9).length;
    const ranges = describeRanges(targets);
    const settings = state.settings;
    const band =
      settings.mode === 'ratio'
        ? `档位 ${round(settings.ratioLevel)}% ± ${round(settings.ratioSpread)}%`
        : `档位 ${round(settings.absLevel)} 分 ± ${round(settings.absSpread)}`;
    const rows = [
      ['待填单元格', `${targets.length} 个（共 ${cells.length} 个）`],
      ['本项分值范围', ranges.join('、')],
      ['填写方式', band],
      ['实际生成', `${lowest.toFixed(DECIMALS)} ~ ${highest.toFixed(DECIMALS)}`],
      ['其中满分', `${fullCount} 个`],
    ];
    const note =
      settings.mode === 'absolute' && ranges.length > 1
        ? '本弹窗有多种分值范围，按分值档位会被各自上下限裁剪，建议改用比例档位。'
        : '';

    showConfirm({
      title: '确认填写班级互评分数',
      okText: '确认填写',
      rows,
      note,
      onConfirm: () => {
        const written = applyPlans(plans);
        setMessage(`已填写 ${written} 个单元格，保存请自行点击。`);
      },
    });
  }

  function handleClear() {
    const cells = collectCells();
    if (!cells.length) {
      setMessage('未检测到可清空的分值输入框。');
      return;
    }
    const filled = cells.filter(cell => String(cell.input.value).trim() !== '');
    if (!filled.length) {
      setMessage('当前没有已填写的分值。');
      return;
    }
    showConfirm({
      title: '确认清空当前弹窗分数',
      okText: '确认清空',
      rows: [['将清空', `${filled.length} 个单元格`]],
      note: '只清空页面上的输入框，已保存的数据不受影响。',
      onConfirm: () => {
        clearCells(filled);
        setMessage(`已清空 ${filled.length} 个单元格。`);
      },
    });
  }

  // 页面同时打开两个互评弹窗会把已渲染的表格藏起来，所以切换前先关掉当前弹窗。
  async function gotoIndicator(index) {
    const item = state.indicators[index];
    if (!item) return;
    if (document.getElementById(TABLE_ID)) {
      const cancel = document.querySelector('a[data-action="hpzbCancel"]');
      if (!cancel) {
        setMessage('当前弹窗没有取消按钮，请手动关闭后再切换。');
        return;
      }
      setMessage('正在关闭当前弹窗。');
      cancel.click();
      // 有未保存内容时页面会自己弹确认框，等用户回答，脚本不代点。
      const closed = await waitFor(() => !document.getElementById(TABLE_ID), 30000);
      if (!closed) {
        setMessage('当前弹窗仍然开着，未切换。');
        return;
      }
    }
    setMessage(`正在打开“${item.name}”。`);
    item.el.click();
  }

  function setMessage(text) {
    state.message = text;
    render();
  }

  function ensurePanel() {
    let panel = document.getElementById(PANEL_ID);
    if (panel) return panel;
    ensureStyle();
    panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <div class="nzf-head">
        <div>
          <div class="nzf-title">综测互评填分助手</div>
          <div class="nzf-sub">综合测评 · 班级互评</div>
        </div>
        <button type="button" class="nzf-toggle">收起</button>
      </div>
      <div class="nzf-body"></div>
    `;
    document.body.appendChild(panel);
    restorePosition(panel);
    panel.querySelector('.nzf-toggle').addEventListener('click', () => {
      state.minimized = !state.minimized;
      render();
    });
    enableDrag(panel, panel.querySelector('.nzf-head'));
    return panel;
  }

  function restorePosition(panel) {
    try {
      const raw = window.localStorage.getItem(POSITION_KEY);
      if (!raw) return;
      const pos = JSON.parse(raw);
      if (typeof pos.left !== 'number' || typeof pos.top !== 'number') return;
      panel.style.left = `${clamp(pos.left, 0, Math.max(0, window.innerWidth - 80))}px`;
      panel.style.top = `${clamp(pos.top, 0, Math.max(0, window.innerHeight - 40))}px`;
      panel.style.right = 'auto';
    } catch (error) {
      /* 位置读取失败时使用默认位置 */
    }
  }

  function enableDrag(panel, handle) {
    let startX = 0;
    let startY = 0;
    let baseLeft = 0;
    let baseTop = 0;

    const onMove = event => {
      if (!state.dragging) return;
      const left = clamp(baseLeft + event.clientX - startX, 0, window.innerWidth - 60);
      const top = clamp(baseTop + event.clientY - startY, 0, window.innerHeight - 30);
      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
      panel.style.right = 'auto';
    };

    const onUp = () => {
      if (!state.dragging) return;
      state.dragging = false;
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('mouseup', onUp, true);
      try {
        window.localStorage.setItem(
          POSITION_KEY,
          JSON.stringify({ left: panel.offsetLeft, top: panel.offsetTop }),
        );
      } catch (error) {
        /* 存储不可用时忽略 */
      }
    };

    handle.addEventListener('mousedown', event => {
      if (event.button !== 0 || event.target.closest('button')) return;
      state.dragging = true;
      startX = event.clientX;
      startY = event.clientY;
      baseLeft = panel.offsetLeft;
      baseTop = panel.offsetTop;
      document.addEventListener('mousemove', onMove, true);
      document.addEventListener('mouseup', onUp, true);
      event.preventDefault();
    });
  }

  function cellBounds() {
    if (!state.cells.length) return { min: 0, max: 100 };
    return {
      min: Math.min.apply(null, state.cells.map(cell => cell.min)),
      max: Math.max.apply(null, state.cells.map(cell => cell.max)),
    };
  }

  // 把当前档位换算成每种分值范围的实际取值，便于调档时直接看到结果。
  function previewText() {
    const seen = new Map();
    state.cells.forEach(cell => {
      const key = `${round(cell.min)}-${round(cell.max)}`;
      if (seen.has(key)) return;
      const band = bandFor(cell, state.settings);
      const lo = round(clamp(band[0], cell.min, cell.max)).toFixed(DECIMALS);
      const hi = round(clamp(band[1], cell.min, cell.max)).toFixed(DECIMALS);
      seen.set(key, `${key} → ${lo === hi ? lo : `${lo}~${hi}`}`);
    });
    return Array.from(seen.values()).join('；');
  }

  function renderControls() {
    const s = state.settings;
    const ratio = s.mode === 'ratio';
    const bounds = cellBounds();
    const level = ratio ? s.ratioLevel : s.absLevel;
    const spread = ratio ? s.ratioSpread : s.absSpread;
    const levelField = ratio ? 'ratioLevel' : 'absLevel';
    const spreadField = ratio ? 'ratioSpread' : 'absSpread';
    const step = ratio ? 0.25 : 0.01;
    const unit = ratio ? '%' : '分';
    return `
      <div class="nzf-section">
        <span class="nzf-label">档位方式</span>
        <div class="nzf-row">
          <button type="button" data-mode="ratio"${ratio ? ' disabled' : ''}>按区间比例</button>
          <button type="button" data-mode="absolute"${!ratio ? ' disabled' : ''}>按分值</button>
        </div>
      </div>
      <div class="nzf-section">
        <span class="nzf-label">档位 ${round(level)}${unit}，浮动 ±${round(spread)}${unit}</span>
        <input class="nzf-slider" type="range" data-field="${levelField}"
          min="${ratio ? 0 : bounds.min}" max="${ratio ? 100 : bounds.max}" step="${step}" value="${level}">
        <div class="nzf-row" style="margin-top:6px">
          <input type="number" step="${step}" data-field="${levelField}" value="${level}">
          <span>±</span>
          <input type="number" min="0" step="${step}" data-field="${spreadField}" value="${spread}">
        </div>
        <p class="nzf-preview">${escapeHtml(previewText())}</p>
        <label class="nzf-check">
          <input type="checkbox" data-field="limitFull"${s.limitFull ? ' checked' : ''}>
          <span>限制满分数量，最多</span>
          <input type="number" min="0" step="1" style="width:56px" data-field="maxFull" value="${s.maxFull}">
          <span>个</span>
        </label>
        <label class="nzf-check">
          <input type="checkbox" data-field="skipFilled"${s.skipFilled ? ' checked' : ''}>
          <span>跳过已填写的单元格</span>
        </label>
      </div>
    `;
  }

  function renderIndicators() {
    if (!state.indicators.length) return '';
    const items = state.indicators
      .map((item, index) => {
        const badge = item.done
          ? '<span class="nzf-done">已完成</span>'
          : '<span class="nzf-todo">未完成</span>';
        return `<button type="button" class="nzf-item" data-goto="${index}">
          <span class="nzf-item-name">${escapeHtml(item.name)}</span>${badge}</button>`;
      })
      .join('');
    const pending = state.indicators.filter(item => !item.done).length;
    const tip = state.dialogOpen
      ? '<p class="nzf-hint">切换到别的项会先关掉当前弹窗。</p>'
      : '<p class="nzf-hint">点击任意一项直接打开。</p>';
    return `
      <div class="nzf-section">
        <span class="nzf-label">班级互评项（未完成 ${pending} / ${state.indicators.length}）</span>
        <div class="nzf-list">${items}</div>
        ${tip}
      </div>
    `;
  }

  function render() {
    const panel = ensurePanel();
    panel.classList.toggle('is-min', state.minimized);
    panel.querySelector('.nzf-toggle').textContent = state.minimized ? '展开' : '收起';
    if (state.minimized) return;

    const body = panel.querySelector('.nzf-body');
    let status;
    if (state.isDormitory) {
      status = '<span class="nzf-warn">当前弹窗是宿舍互评（选项式），本脚本只支持班级互评打分。</span>';
    } else if (state.dialogOpen) {
      const cells = state.cells;
      const ranges = describeRanges(cells);
      const filled = cells.filter(cell => String(cell.input.value).trim() !== '').length;
      const students = new Set(cells.map(cell => String(cell.input.name).split('-')[0])).size;
      status =
        `已识别班级互评弹窗：<b>${cells.length}</b> 个单元格` +
        `（${students} 名同学）<br>分值范围：<b>${escapeHtml(ranges.join('、'))}</b>` +
        `<br>已填写：<b>${filled}</b> 个`;
    } else {
      status = '未检测到班级互评弹窗。请在“规则说明&打分”中点击“班级互评打分”。';
    }
    const message = state.message ? `<br>${escapeHtml(state.message)}` : '';

    body.innerHTML = `
      <div class="nzf-status">${status}${message}</div>
      ${renderIndicators()}
      ${state.dialogOpen && !state.isDormitory ? renderControls() : ''}
      ${
        state.dialogOpen && !state.isDormitory
          ? '<button type="button" class="nzf-primary nzf-fill">一键填写当前弹窗</button>' +
            '<button type="button" class="nzf-clear" style="width:100%;margin-top:6px">清空当前弹窗</button>' +
            '<p class="nzf-hint">填完后核对一遍，再点页面上的“保存”。</p>'
          : ''
      }
    `;
    bindBodyEvents(body);
  }

  function bindBodyEvents(body) {
    body.querySelectorAll('[data-mode]').forEach(button => {
      button.addEventListener('click', () => {
        state.settings.mode = button.dataset.mode;
        saveSettings();
        render();
      });
    });

    body.querySelectorAll('[data-goto]').forEach(button => {
      button.addEventListener('click', () => gotoIndicator(Number(button.dataset.goto)));
    });

    body.querySelectorAll('[data-field]').forEach(input => {
      const field = input.dataset.field;
      const commit = rerender => {
        if (input.type === 'checkbox') {
          state.settings[field] = input.checked;
        } else {
          const value = Number(input.value);
          if (!Number.isFinite(value)) return;
          state.settings[field] = value;
        }
        saveSettings();
        if (rerender) render();
      };
      if (input.type === 'range') {
        // 拖动过程中只更新读数，避免重建 DOM 打断拖动。
        input.addEventListener('input', () => {
          commit(false);
          updateReadout(body);
        });
        input.addEventListener('change', () => commit(true));
        return;
      }
      input.addEventListener('change', () => commit(true));
    });

    const fill = body.querySelector('.nzf-fill');
    if (fill) fill.addEventListener('click', handleFill);
    const clear = body.querySelector('.nzf-clear');
    if (clear) clear.addEventListener('click', handleClear);
  }

  function updateReadout(body) {
    const s = state.settings;
    const ratio = s.mode === 'ratio';
    const unit = ratio ? '%' : '分';
    const level = ratio ? s.ratioLevel : s.absLevel;
    const spread = ratio ? s.ratioSpread : s.absSpread;
    const slider = body.querySelector('.nzf-slider');
    if (slider && slider.previousElementSibling) {
      slider.previousElementSibling.textContent =
        `档位 ${round(level)}${unit}，浮动 ±${round(spread)}${unit}`;
    }
    const preview = body.querySelector('.nzf-preview');
    if (preview) preview.textContent = previewText();
    const mirror = body.querySelector(
      `input[type="number"][data-field="${ratio ? 'ratioLevel' : 'absLevel'}"]`,
    );
    if (mirror) mirror.value = String(level);
  }

  function sync() {
    const table = document.getElementById(TABLE_ID);
    const cells = collectCells();
    const radios = table ? table.querySelectorAll('input[type="radio"]').length : 0;
    const indicators = collectIndicators();
    const dialogOpen = Boolean(table) && (cells.length > 0 || radios > 0);
    const signature = [
      dialogOpen ? '1' : '0',
      cells.length,
      radios,
      indicators.map(item => `${item.name}:${item.done ? 1 : 0}`).join(','),
    ].join('|');
    if (signature === state.signature) return;

    if (state.signature && dialogOpen !== state.dialogOpen) state.message = '';
    state.signature = signature;
    state.dialogOpen = dialogOpen;
    state.isDormitory = dialogOpen && cells.length === 0 && radios > 0;
    state.cells = cells;
    state.indicators = indicators;
    render();
  }

  function boot() {
    ensurePanel();
    sync();
    let timer = null;
    const observer = new MutationObserver(() => {
      if (timer) return;
      timer = window.setTimeout(() => {
        timer = null;
        sync();
      }, 250);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('hashchange', sync);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
