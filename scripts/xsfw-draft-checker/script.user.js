// ==UserScript==
// @name         NWAFU 数据采集草稿检查器
// @version      0.1.0
// @description  扫描学生服务数据采集记录，集中列出草稿项并提供跳转入口。
// @match        https://xsfw.nwafu.edu.cn/xsfw/sys/sjcjyqapp/*default/index.do*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const ROOT = '/xsfw/sys/sjcjyqapp';
  const PANEL_ID = 'nwafu-draft-checker';
  const STYLE_ID = 'nwafu-draft-checker-style';
  const POSITION_KEY = 'nwafu-draft-checker-position';
  const PAGE_SIZE = 100;
  const state = {
    cards: [],
    drafts: [],
    scanning: false,
    minimized: false,
    lastError: '',
    dragging: false,
  };

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${PANEL_ID} {
        position: fixed;
        right: 22px;
        top: 120px;
        z-index: 2147483647;
        width: min(380px, calc(100vw - 24px));
        max-height: 56vh;
        display: flex;
        flex-direction: column;
        font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
        color: #1f2937;
        background: #ffffff;
        border: 1px solid #d1d5db;
        box-shadow: 0 18px 48px rgba(15, 23, 42, 0.20);
      }
      #${PANEL_ID} * { box-sizing: border-box; }
      #${PANEL_ID} .ndc-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 14px;
        padding: 14px 16px;
        border-bottom: 1px solid #e5e7eb;
        background: #ffffff;
        cursor: move;
        user-select: none;
      }
      #${PANEL_ID} .ndc-title-wrap { min-width: 0; }
      #${PANEL_ID} .ndc-title {
        display: flex;
        align-items: center;
        gap: 8px;
        font-weight: 700;
        color: #111827;
        font-size: 15px;
      }
      #${PANEL_ID} .ndc-subtitle {
        margin-top: 3px;
        color: #64748b;
        font-size: 12px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      #${PANEL_ID} .ndc-actions {
        display: flex;
        gap: 6px;
        flex: none;
        cursor: default;
      }
      #${PANEL_ID} button {
        border: 1px solid #cbd5e1;
        background: #fff;
        color: #1f2937;
        cursor: pointer;
      }
      #${PANEL_ID} .ndc-actions button {
        height: 32px;
        padding: 0 12px;
      }
      #${PANEL_ID} button:hover { background: #f1f5f9; }
      #${PANEL_ID} button:disabled {
        color: #94a3b8;
        cursor: not-allowed;
      }
      #${PANEL_ID} .ndc-body {
        flex: 1;
        min-height: 0;
        overflow: auto;
        padding: 14px 16px 16px;
        background: #f8fafc;
      }
      #${PANEL_ID}.is-min .ndc-body { display: none; }
      #${PANEL_ID}.is-min {
        width: 280px;
        max-height: none;
      }
      @media (max-width: 900px) {
        #${PANEL_ID} {
          right: 12px;
          top: 80px;
          width: calc(100vw - 24px);
          max-height: 52vh;
        }
      }
      #${PANEL_ID} .ndc-status {
        margin-bottom: 12px;
        padding: 9px 10px;
        color: #475569;
        background: #ffffff;
        border: 1px solid #e2e8f0;
      }
      #${PANEL_ID} .ndc-error {
        margin: 8px 0;
        padding: 8px;
        color: #991b1b;
        background: #fef2f2;
        border: 1px solid #fecaca;
      }
      #${PANEL_ID} .ndc-empty {
        padding: 28px 0;
        color: #64748b;
        text-align: center;
      }
      #${PANEL_ID} .ndc-group {
        margin-top: 14px;
      }
      #${PANEL_ID} .ndc-group-title {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        margin: 0 0 8px;
        font-weight: 700;
        color: #0f172a;
      }
      #${PANEL_ID} .ndc-group-name {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      #${PANEL_ID} .ndc-item {
        width: 100%;
        display: block;
        height: auto;
        margin: 8px 0;
        padding: 12px 13px;
        text-align: left;
        border: 1px solid #dbe3ee;
        border-left: 4px solid #2563eb;
        background: #fff;
        cursor: pointer;
        box-shadow: 0 1px 2px rgba(15, 23, 42, 0.06);
      }
      #${PANEL_ID} .ndc-item:hover {
        border-color: #93b4e8;
        border-left-color: #1d4ed8;
        background: #fbfdff;
      }
      #${PANEL_ID} .ndc-item-top {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 10px;
      }
      #${PANEL_ID} .ndc-name {
        font-weight: 650;
        color: #111827;
        overflow-wrap: anywhere;
        font-size: 14px;
        min-width: 0;
      }
      #${PANEL_ID} .ndc-meta {
        margin-top: 6px;
        color: #64748b;
        font-size: 12px;
        overflow-wrap: anywhere;
      }
      #${PANEL_ID} .ndc-reason {
        margin-top: 10px;
        padding: 8px 10px;
        color: #78350f;
        background: #fffbeb;
        border: 1px solid #fde68a;
      }
      #${PANEL_ID} .ndc-reason-label {
        margin-right: 4px;
        font-weight: 650;
      }
      #${PANEL_ID} .ndc-tag {
        display: inline-block;
        padding: 0 5px;
        color: #92400e;
        background: #fffbeb;
        border: 1px solid #fde68a;
        font-weight: 700;
      }
      #${PANEL_ID} .ndc-state {
        flex: none;
        padding: 1px 7px;
        color: #1d4ed8;
        background: #eff6ff;
        border: 1px solid #bfdbfe;
        font-size: 12px;
        font-weight: 700;
      }
    `;
    document.head.appendChild(style);
  }

  function ensurePanel() {
    ensureStyle();
    let panel = document.getElementById(PANEL_ID);
    if (panel) return panel;

    panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <div class="ndc-head">
        <div class="ndc-title-wrap">
          <div class="ndc-title">学生数据采集草稿检查 <span class="ndc-tag" data-role="count">0</span></div>
          <div class="ndc-subtitle">学生服务 / 学生数据采集</div>
        </div>
        <div class="ndc-actions">
          <button type="button" data-action="refresh">刷新</button>
          <button type="button" data-action="toggle">收起</button>
        </div>
      </div>
      <div class="ndc-body"></div>
    `;
    panel.addEventListener('click', onPanelClick);
    panel.querySelector('.ndc-head').addEventListener('pointerdown', onDragStart);
    document.body.appendChild(panel);
    restorePanelPosition(panel);
    return panel;
  }

  function onDragStart(event) {
    if (event.target.closest('button')) return;
    const panel = ensurePanel();
    const rect = panel.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const startLeft = rect.left;
    const startTop = rect.top;
    state.dragging = false;
    panel.setPointerCapture(event.pointerId);

    function onMove(moveEvent) {
      state.dragging = true;
      const nextLeft = clamp(startLeft + moveEvent.clientX - startX, 8, window.innerWidth - rect.width - 8);
      const nextTop = clamp(startTop + moveEvent.clientY - startY, 8, window.innerHeight - 48);
      setPanelPosition(panel, nextLeft, nextTop);
    }

    function onEnd(endEvent) {
      panel.releasePointerCapture(endEvent.pointerId);
      panel.removeEventListener('pointermove', onMove);
      panel.removeEventListener('pointerup', onEnd);
      panel.removeEventListener('pointercancel', onEnd);
      savePanelPosition(panel);
      setTimeout(() => {
        state.dragging = false;
      }, 0);
    }

    panel.addEventListener('pointermove', onMove);
    panel.addEventListener('pointerup', onEnd);
    panel.addEventListener('pointercancel', onEnd);
  }

  function setPanelPosition(panel, left, top) {
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
  }

  function savePanelPosition(panel) {
    const rect = panel.getBoundingClientRect();
    localStorage.setItem(POSITION_KEY, JSON.stringify({ left: rect.left, top: rect.top }));
  }

  function restorePanelPosition(panel) {
    try {
      const saved = JSON.parse(localStorage.getItem(POSITION_KEY) || 'null');
      if (!saved) return;
      const width = panel.offsetWidth || 380;
      const left = clamp(Number(saved.left) || 0, 8, window.innerWidth - width - 8);
      const top = clamp(Number(saved.top) || 0, 8, window.innerHeight - 48);
      setPanelPosition(panel, left, top);
    } catch (error) {
      localStorage.removeItem(POSITION_KEY);
    }
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(value, max));
  }

  function onPanelClick(event) {
    if (state.dragging) return;
    const actionButton = event.target.closest('button[data-action]');
    if (actionButton) {
      const action = actionButton.dataset.action;
      if (action === 'refresh') scanAndRender();
      if (action === 'toggle') {
        state.minimized = !state.minimized;
        render();
      }
      return;
    }

    const itemButton = event.target.closest('[data-draft-index]');
    if (!itemButton) return;
    const draft = state.drafts[Number(itemButton.dataset.draftIndex)];
    if (draft) openDraftFromCurrentPage(draft);
  }

  function render() {
    const panel = ensurePanel();
    panel.classList.toggle('is-min', state.minimized);
    panel.querySelector('[data-action="toggle"]').textContent = state.minimized ? '展开' : '收起';
    panel.querySelector('[data-action="refresh"]').disabled = state.scanning;
    panel.querySelector('[data-role="count"]').textContent = state.scanning ? '...' : String(state.drafts.length);

    const body = panel.querySelector('.ndc-body');
    const parts = [];
    const summary = state.scanning
      ? `正在扫描 ${state.cards.length ? state.cards.length : ''} 个采集项...`
      : `发现 ${state.drafts.length} 条草稿`;
    parts.push(`<div class="ndc-status">${escapeHtml(summary)}</div>`);

    if (state.lastError) {
      parts.push(`<div class="ndc-error">${escapeHtml(state.lastError)}</div>`);
    }

    if (!state.scanning && state.drafts.length === 0) {
      parts.push('<div class="ndc-empty">暂无草稿态条目</div>');
    } else {
      parts.push(renderDrafts());
    }

    body.innerHTML = parts.join('');
  }

  function renderDrafts() {
    const groups = new Map();
    state.drafts.forEach((draft, index) => {
      const key = `${draft.category} / ${draft.itemName}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ draft, index });
    });

    return [...groups.entries()].map(([groupName, entries]) => `
      <div class="ndc-group">
        <div class="ndc-group-title">
          <span class="ndc-group-name">${escapeHtml(groupName)}</span>
          <span class="ndc-tag">${entries.length}</span>
        </div>
        ${entries.map(({ draft, index }) => `
          <button type="button" class="ndc-item" data-draft-index="${index}">
            <div class="ndc-item-top">
              <div class="ndc-name">${escapeHtml(getRecordName(draft.row))}</div>
              <div class="ndc-state">${escapeHtml(draft.row.SHZT_DISPLAY || '草稿')}</div>
            </div>
            <div class="ndc-meta">${escapeHtml(draft.category)} / ${escapeHtml(draft.itemName)}</div>
            ${draft.row.THYY ? `<div class="ndc-reason"><span class="ndc-reason-label">退回原因</span>${escapeHtml(draft.row.THYY)}</div>` : ''}
          </button>
        `).join('')}
      </div>
    `).join('');
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, char => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[char]));
  }

  async function scanAndRender() {
    if (state.scanning) return;
    state.scanning = true;
    state.lastError = '';
    state.drafts = [];
    render();

    try {
      const cards = await fetchCards();
      const items = cards.flatMap(category => (category.items || []).map(item => ({
        category: category.NRFLMC || category.NRFLDM || '未命名分类',
        categoryCode: category.NRFLDM,
        itemName: item.NRMC || item.NRDM || item.SJLY || '未命名采集项',
        itemId: item.NRDM,
        sjly: item.SJLY,
      }))).filter(item => item.sjly);

      state.cards = items;
      render();

      const drafts = [];
      for (let i = 0; i < items.length; i += 1) {
        const item = items[i];
        const rows = await fetchAllRows(item);
        rows.filter(isDraftRow).forEach(row => drafts.push({ ...item, row }));
        state.drafts = drafts.slice();
        render();
      }
    } catch (error) {
      state.lastError = error && error.message ? error.message : String(error);
    } finally {
      state.scanning = false;
      render();
    }
  }

  async function fetchCards() {
    const data = await postJson(`${ROOT}/xssjcj/getXssjcjCards.do`);
    if (Array.isArray(data)) return data;
    if (Array.isArray(data.data)) return data.data;
    throw new Error('读取采集项失败：返回结构不符合预期');
  }

  async function fetchAllRows(item) {
    const action = `${item.sjly}_grid_action`;
    const url = `${ROOT}/sjcjymmxzdsc/${item.sjly}_page/${action}.do`;
    const first = await postJson(url, { pageSize: PAGE_SIZE, pageNumber: 1 });
    const bucket = getActionBucket(first, action);
    const total = Number(bucket.totalSize || bucket.total || 0);
    const rows = Array.isArray(bucket.rows) ? bucket.rows.slice() : [];
    const pageCount = Math.ceil(total / PAGE_SIZE);

    for (let pageNumber = 2; pageNumber <= pageCount; pageNumber += 1) {
      const pageData = await postJson(url, { pageSize: PAGE_SIZE, pageNumber });
      rows.push(...(getActionBucket(pageData, action).rows || []));
    }

    return rows;
  }

  function getActionBucket(data, action) {
    const bucket = data && data.datas && data.datas[action];
    if (!bucket) return { rows: [] };
    return bucket;
  }

  async function postJson(url, params) {
    const body = new URLSearchParams(params || {});
    const response = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body,
    });
    if (!response.ok) {
      throw new Error(`请求失败 ${response.status}: ${url}`);
    }
    return response.json();
  }

  function isDraftRow(row) {
    return String(row.SHZT) === '0' || row.SHZT_DISPLAY === '草稿';
  }

  function getRecordName(row) {
    const nameFields = [
      'BY1',
      'HDMC',
      'XMMC',
      'LWMC',
      'ZLMC',
      'ZSMC',
      'HJMC',
      'ZWMC',
      'MC',
      'BT',
      'BZ',
      'WID',
    ];
    for (const field of nameFields) {
      if (row[field]) return row[field];
    }
    return row.WID || '未命名条目';
  }

  function isEditingFormOpen() {
    const headings = [...document.querySelectorAll('h2, h3, .bh-dialog-title')];
    const hasEditTitle = headings.some(node => (node.textContent || '').trim() === '编辑');
    const hasFormActions = [...document.querySelectorAll('button, a, div, span')]
      .some(node => ['保存', '提交', '关闭'].includes((node.textContent || '').trim()));
    return hasEditTitle && hasFormActions;
  }

  async function openDraftFromCurrentPage(draft) {
    const pageState = getPageState(draft);

    if (pageState.kind === 'editing') {
      setStatus('请先关闭当前编辑页，再打开其他草稿。');
      return;
    }

    setStatus(`正在打开：${draft.category} / ${draft.itemName}`);

    if (pageState.kind === 'target-list') {
      openRowInCurrentGrid(draft);
      return;
    }

    if (pageState.kind === 'other-list') {
      await closeCurrentList();
    }

    const opened = await openTargetList(draft);
    if (!opened) {
      return;
    }

    openRowInCurrentGrid(draft);
  }

  function openRowInCurrentGrid(draft) {
    const selector = `[data-wid="${cssEscape(draft.row.WID)}"]`;
    const edit = getLastVisibleElement(`.main_edit${selector}`);
    const detail = getLastVisibleElement(`.main_detail${selector}`);
    const target = edit || detail;
    if (target) {
      target.scrollIntoView({ block: 'center', inline: 'center' });
      target.click();
      return;
    }

    openDraftBySyntheticAction(draft);
  }

  function getPageState(draft) {
    if (isEditingFormOpen()) {
      return { kind: 'editing' };
    }

    const listTitle = getCurrentListTitle();
    if (!listTitle) {
      return { kind: 'home' };
    }

    return {
      kind: listTitle === draft.itemName ? 'target-list' : 'other-list',
      listTitle,
    };
  }

  function getCurrentListTitle() {
    if (!getLastVisibleElement('#main_grid')) return '';
    const titles = [...document.querySelectorAll('h2')]
      .map(node => (node.textContent || '').trim())
      .filter(title => title && title !== '学生数据采集' && title !== '编辑');
    return titles[titles.length - 1] || '';
  }

  async function closeCurrentList() {
    const closeButton = getLastVisibleElement('.bh-paper-pile-closeIcon, .bh-paper-pile-dialog-close, .bh-paper-pile-close, [class*="paper"] [class*="close"]');
    if (closeButton) {
      closeButton.click();
      await sleep(250);
    }
    await waitFor(() => !getLastVisibleElement('#main_grid') || !!findCardElementSync(), 4000);
  }

  async function openTargetList(draft) {
    const card = await findCardElement(draft);
    if (!card) {
      state.lastError = `未找到采集项入口：${draft.itemName}`;
      render();
      return false;
    }

    card.scrollIntoView({ block: 'center', inline: 'center' });
    card.click();
    await waitFor(() => getCurrentListTitle() === draft.itemName && !!getLastVisibleElement('#main_grid'), 8000);
    await sleep(300);
    return true;
  }

  function getLastVisibleElement(selector) {
    const elements = [...document.querySelectorAll(selector)]
      .filter(element => element.offsetParent !== null || element.getClientRects().length);
    return elements[elements.length - 1] || null;
  }

  function openDraftBySyntheticAction(draft) {
    const host = getLastVisibleElement('#main_grid') || document.body;
    const link = document.createElement('a');
    link.href = 'javascript:void(0)';
    link.className = 'main_edit';
    link.dataset.wid = draft.row.WID;
    link.dataset.xsbh = draft.row.XSBH || '';
    link.style.cssText = 'position:fixed;left:-9999px;top:-9999px;';
    host.appendChild(link);
    link.click();
    setTimeout(() => link.remove(), 1000);
  }

  async function findCardElement(draft) {
    let card = findCardElementSync(draft);
    if (card) return card;

    document.querySelectorAll('.xssjcj-stu-cards-card .showOrHide[data-type="1"], .xssjcj-stu-cards-card .showOrHide')
      .forEach(button => {
        if ((button.textContent || '').trim() === '展开') button.click();
      });
    await sleep(200);

    card = findCardElementSync(draft);
    return card;
  }

  function findCardElementSync(draft) {
    if (!draft) {
      return getLastVisibleElement('.xssjcj-stu-cards-card-item');
    }
    return getLastVisibleElement(`.xssjcj-stu-cards-card-item[data-cjxdm="${cssEscape(draft.sjly)}"]`);
  }

  function setStatus(text) {
    const panel = ensurePanel();
    const status = panel.querySelector('.ndc-status');
    if (status) status.textContent = text;
  }

  async function waitFor(check, timeout) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeout) {
      const result = check();
      if (result) return result;
      await sleep(100);
    }
    return null;
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') {
      return window.CSS.escape(String(value));
    }
    return String(value).replace(/["\\]/g, '\\$&');
  }

  function boot() {
    ensurePanel();
    render();
    scanAndRender();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();