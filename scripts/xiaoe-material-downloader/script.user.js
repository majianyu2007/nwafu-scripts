// ==UserScript==
// @name         小鹅通资料下载助手
// @version      0.1.0
// @description  在小鹅通知识店铺课程页识别已加载的 PDF 资料预览，并提供原始 PDF 下载入口。
// @match        https://*.h5.xiaoeknow.com/*
// @match        https://resource-tx-cdn.xiaoeeye.com/*
// @grant        none
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
  "use strict";

  const ROOT_ID = "xet-material-downloader";
  const PANEL_ID = `${ROOT_ID}-panel`;
  const STYLE_ID = `${ROOT_ID}-style`;
  const OPEN_TEXT = "资料下载";
  const REFRESH_TEXT = "刷新";

  const state = {
    collapsed: false,
    items: [],
    message: "",
    lastScanAt: 0,
  };

  const observer = new MutationObserver(handleMutations);
  let scanTimer = 0;

  if (!isSupportedPage()) return;

  injectStyle();
  render();
  scan();
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["src", "href"],
  });

  function isSupportedPage() {
    return /(^|\.)h5\.xiaoeknow\.com$/.test(location.hostname) || location.hostname === "resource-tx-cdn.xiaoeeye.com";
  }

  function scheduleScan() {
    window.clearTimeout(scanTimer);
    scanTimer = window.setTimeout(scan, 500);
  }

  function handleMutations(mutations) {
    const hasPageChange = mutations.some((mutation) => !isOwnNode(mutation.target));
    if (hasPageChange) scheduleScan();
  }

  function isOwnNode(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
    return node.id === STYLE_ID || !!node.closest(`#${PANEL_ID}`);
  }

  function scan() {
    state.lastScanAt = Date.now();
    state.items = collectPdfItems();
    state.message = state.items.length > 0 ? "" : "未发现已加载的 PDF 资料。请先打开资料面板并点击预览。";
    render();
  }

  function collectPdfItems() {
    const candidates = [];

    collectFromDocument(document, candidates);
    for (const frame of document.querySelectorAll("iframe")) {
      try {
        if (frame.contentDocument) collectFromDocument(frame.contentDocument, candidates);
      } catch (_) {
        // Cross-origin iframe contents are not readable. The iframe src is collected below.
      }
    }

    if (/\.pdf(?:[?#]|$)/i.test(location.href)) {
      candidates.push({
        url: location.href,
        label: document.title || decodePdfFileName(location.href) || "小鹅通资料.pdf",
        source: "当前页面",
      });
    }

    const seen = new Set();
    return candidates
      .map(normalizeItem)
      .filter(Boolean)
      .filter((item) => {
        if (seen.has(item.url)) return false;
        seen.add(item.url);
        return true;
      });
  }

  function collectFromDocument(doc, candidates) {
    const selectors = [
      "a[href]",
      "iframe[src]",
      "embed[src]",
      "object[data]",
      "source[src]",
      "img[src]",
      "[data-src]",
    ];

    for (const el of doc.querySelectorAll(selectors.join(","))) {
      const rawUrl =
        el.getAttribute("href") ||
        el.getAttribute("src") ||
        el.getAttribute("data") ||
        el.getAttribute("data-src") ||
        "";
      if (!rawUrl || !/\.pdf(?:[?#]|$)/i.test(rawUrl)) continue;

      candidates.push({
        url: toAbsoluteUrl(rawUrl, doc.location?.href || location.href),
        label: findNearbyTitle(el) || el.getAttribute("title") || el.textContent || "",
        source: elementSourceName(el),
      });
    }
  }

  function normalizeItem(item) {
    const url = cleanPreviewUrl(item.url);
    if (!url || !/\.pdf(?:[?#]|$)/i.test(url)) return null;

    return {
      url,
      label: sanitizeText(item.label) || decodePdfFileName(url) || "小鹅通资料.pdf",
      source: item.source || "页面",
    };
  }

  function cleanPreviewUrl(url) {
    try {
      const parsed = new URL(url, location.href);
      parsed.searchParams.delete("ci-process");
      parsed.searchParams.delete("dstType");
      return parsed.href;
    } catch (_) {
      return "";
    }
  }

  function toAbsoluteUrl(url, base) {
    try {
      return new URL(url, base).href;
    } catch (_) {
      return "";
    }
  }

  function decodePdfFileName(url) {
    try {
      const pathname = new URL(url, location.href).pathname;
      const file = pathname.split("/").filter(Boolean).pop();
      return file ? decodeURIComponent(file) : "";
    } catch (_) {
      return "";
    }
  }

  function findNearbyTitle(el) {
    const text = sanitizeText(el.textContent || el.getAttribute("aria-label") || "");
    if (text) return text;

    let node = el;
    for (let i = 0; i < 4 && node; i += 1) {
      const parentText = sanitizeText(node.parentElement?.textContent || "");
      const match = parentText.match(/[^\n\r]+?\.pdf\b/i);
      if (match) return match[0];
      node = node.parentElement;
    }

    const docText = sanitizeText(el.ownerDocument?.body?.innerText || "");
    const match = docText.match(/[^\n\r]+?\.pdf\b/i);
    return match ? match[0] : "";
  }

  function sanitizeText(text) {
    return String(text || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120);
  }

  function elementSourceName(el) {
    const tag = el.tagName ? el.tagName.toLowerCase() : "元素";
    if (tag === "iframe") return "预览窗口";
    if (tag === "a") return "页面链接";
    return tag;
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${PANEL_ID} {
        position: fixed;
        right: 16px;
        bottom: 86px;
        z-index: 2147483647;
        width: 320px;
        max-width: calc(100vw - 32px);
        color: #1f2328;
        font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        box-sizing: border-box;
      }
      #${PANEL_ID} * {
        box-sizing: border-box;
      }
      #${PANEL_ID} .xet-md-card {
        border: 1px solid rgba(31, 35, 40, 0.16);
        border-radius: 8px;
        background: #fff;
        box-shadow: 0 12px 32px rgba(31, 35, 40, 0.18);
        overflow: hidden;
      }
      #${PANEL_ID} .xet-md-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 10px 12px;
        border-bottom: 1px solid rgba(31, 35, 40, 0.1);
        background: #f6f8fa;
      }
      #${PANEL_ID} .xet-md-title {
        min-width: 0;
        font-weight: 700;
      }
      #${PANEL_ID} .xet-md-actions {
        display: flex;
        gap: 6px;
      }
      #${PANEL_ID} button,
      #${PANEL_ID} a.xet-md-link {
        min-height: 30px;
        border: 1px solid rgba(31, 35, 40, 0.16);
        border-radius: 6px;
        background: #fff;
        color: #1f2328;
        cursor: pointer;
        font: inherit;
        text-decoration: none;
      }
      #${PANEL_ID} button {
        padding: 4px 9px;
      }
      #${PANEL_ID} a.xet-md-link {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        padding: 6px 10px;
      }
      #${PANEL_ID} button:hover,
      #${PANEL_ID} a.xet-md-link:hover {
        border-color: #0969da;
        color: #0969da;
      }
      #${PANEL_ID} .xet-md-body {
        padding: 12px;
      }
      #${PANEL_ID} .xet-md-empty {
        margin: 0;
        color: #57606a;
      }
      #${PANEL_ID} .xet-md-list {
        display: grid;
        gap: 10px;
      }
      #${PANEL_ID} .xet-md-item {
        display: grid;
        gap: 7px;
        padding: 10px;
        border: 1px solid rgba(31, 35, 40, 0.12);
        border-radius: 7px;
        background: #fff;
      }
      #${PANEL_ID} .xet-md-name {
        overflow-wrap: anywhere;
        font-weight: 600;
      }
      #${PANEL_ID} .xet-md-meta {
        color: #6e7781;
        font-size: 12px;
      }
      #${PANEL_ID} .xet-md-footer {
        margin-top: 10px;
        color: #6e7781;
        font-size: 12px;
      }
      #${PANEL_ID}.xet-md-collapsed {
        width: auto;
      }
      #${PANEL_ID}.xet-md-collapsed .xet-md-body {
        display: none;
      }
      @media (max-width: 520px) {
        #${PANEL_ID} {
          right: 10px;
          bottom: 72px;
          width: calc(100vw - 20px);
        }
      }
    `;
    document.head.appendChild(style);
  }

  function render() {
    let root = document.getElementById(PANEL_ID);
    if (!root) {
      root = document.createElement("div");
      root.id = PANEL_ID;
      document.body.appendChild(root);
    }

    root.className = state.collapsed ? "xet-md-collapsed" : "";
    root.innerHTML = `
      <div class="xet-md-card">
        <div class="xet-md-header">
          <div class="xet-md-title">${escapeHtml(OPEN_TEXT)}${state.items.length ? ` (${state.items.length})` : ""}</div>
          <div class="xet-md-actions">
            <button type="button" data-xet-md-action="refresh">${escapeHtml(REFRESH_TEXT)}</button>
            <button type="button" data-xet-md-action="toggle">${state.collapsed ? "展开" : "收起"}</button>
          </div>
        </div>
        <div class="xet-md-body">
          ${renderBody()}
        </div>
      </div>
    `;

    root.querySelector('[data-xet-md-action="refresh"]')?.addEventListener("click", scan);
    root.querySelector('[data-xet-md-action="toggle"]')?.addEventListener("click", () => {
      state.collapsed = !state.collapsed;
      render();
    });
  }

  function renderBody() {
    if (!state.items.length) {
      return `<p class="xet-md-empty">${escapeHtml(state.message)}</p>`;
    }

    const list = state.items
      .map(
        (item) => `
          <div class="xet-md-item">
            <div class="xet-md-name">${escapeHtml(item.label)}</div>
            <div class="xet-md-meta">${escapeHtml(item.source)}</div>
            <a class="xet-md-link" href="${escapeAttr(item.url)}" download target="_blank" rel="noopener noreferrer">下载 PDF</a>
          </div>
        `,
      )
      .join("");

    return `
      <div class="xet-md-list">${list}</div>
      <div class="xet-md-footer">只识别当前页面已经加载的 PDF 资料链接。</div>
    `;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, "&#96;");
  }
})();
