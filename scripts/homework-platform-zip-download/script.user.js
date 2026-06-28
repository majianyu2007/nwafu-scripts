// ==UserScript==
// @name         110作业平台目录打包下载
// @version      1.0.0
// @description  为 202.117.179.110 作业平台目录页增加递归扫描和 ZIP 打包下载。
// @match        http://202.117.179.110/*
// @require      https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const CFG = {
    downloadConcurrency: 4,

    // 扫描保护：不是按文件夹名字判断，而是按规模判断
    warnTotalEntries: 800,
    warnTotalEntriesStep: 800,
    warnChildrenInOneDir: 300,
    hardStopEntries: 20000,
    maxDepth: 50,

    // 下载前确认
    warnFilesBeforeZip: 500,
    warnKnownSizeBeforeZip: 500 * 1024 * 1024,

    // 下载失败重试次数
    retry: 2,

    // STORE 速度快、省 CPU；DEFLATE 会尝试压缩但更慢
    zipCompression: "STORE",
  };

  if (!isResourceListPage()) return;

  addPageActions();
  addDirectoryPackLinks();

  let running = false;

  function isResourceListPage() {
    const text = document.body?.innerText || document.body?.textContent || "";
    const hasListDir = !!document.querySelector('a[href*="ListDir.jsp?Dir="]');
    const hasDownload = !!document.querySelector('a[href*="Download.jsp?FileName="]');
    const hasMarker = text.includes("[目录]") || text.includes("[文件]");
    return hasMarker && (hasListDir || hasDownload);
  }

  function addPageActions() {
    const titleLine = findTitleLine();
    if (!titleLine) return;

    const span = document.createElement("span");
    span.style.marginLeft = "16px";
    span.style.fontSize = "14px";
    span.innerHTML = `
      <a href="javascript:void(0)" id="pack-current-dir">[打包当前目录]</a>
      &nbsp;
      <a href="javascript:void(0)" id="scan-current-dir">[扫描当前目录]</a>
      &nbsp;
      <span id="pack-status" style="color:#666;"></span>
    `;

    titleLine.appendChild(span);

    document.getElementById("pack-current-dir").addEventListener("click", function () {
      startJob({
        type: "download",
        rootUrl: location.href,
        rootName: guessCurrentDirName() || "当前目录",
        includeRootFolder: false,
      });
    });

    document.getElementById("scan-current-dir").addEventListener("click", function () {
      startJob({
        type: "scan",
        rootUrl: location.href,
        rootName: guessCurrentDirName() || "当前目录",
        includeRootFolder: false,
      });
    });
  }

  function addDirectoryPackLinks() {
    const rows = Array.from(document.querySelectorAll("tr"));

    for (const row of rows) {
      if (!getText(row).includes("[目录]")) continue;
      if (getText(row).includes("上级目录")) continue;

      const a = row.querySelector('a[href*="ListDir.jsp?Dir="]');
      if (!a) continue;

      const dirName = sanitizeName(getText(a));
      if (!dirName) continue;

      const pack = document.createElement("a");
      pack.href = "javascript:void(0)";
      pack.textContent = "[打包]";
      pack.title = "递归打包下载这个目录";
      pack.style.marginLeft = "10px";
      pack.style.fontSize = "14px";

      pack.addEventListener("click", function (ev) {
        ev.preventDefault();
        ev.stopPropagation();

        startJob({
          type: "download",
          rootUrl: absUrl(a.getAttribute("href"), location.href),
          rootName: dirName,
          includeRootFolder: true,
        });
      });

      a.insertAdjacentText("afterend", " ");
      a.insertAdjacentElement("afterend", pack);
    }
  }

  async function startJob(options) {
    if (running) {
      alert("已经有一个任务在运行。");
      return;
    }

    if (typeof JSZip === "undefined") {
      alert("JSZip 没有加载成功。可能是 CDN 被拦截了，可以把 @require 换成其他 JSZip 地址。");
      return;
    }

    running = true;
    setStatus("准备扫描……");

    const state = {
      visitedDirs: new Set(),
      dirs: 0,
      files: [],
      skippedDirs: [],
      totalKnownSize: 0,
      unknownSizeFiles: 0,
      totalEntries: 0,
      nextEntryWarning: CFG.warnTotalEntries,
      pathSet: new Set(),
    };

    try {
      const rootPath = options.includeRootFolder ? [sanitizeName(options.rootName)] : [];

      await scanDir({
        url: options.rootUrl,
        pathParts: rootPath,
        depth: 0,
        state,
        isRoot: true,
      });

      const summary = makeSummary(state);

      if (options.type === "scan") {
        setStatus("扫描完成");
        alert(summary);
        return;
      }

      if (state.files.length === 0) {
        setStatus("没有文件");
        alert("这个目录下没有扫描到可下载文件。");
        return;
      }

      const warnings = [];

      if (state.files.length >= CFG.warnFilesBeforeZip) {
        warnings.push(`文件数较多：${state.files.length} 个`);
      }

      if (state.totalKnownSize >= CFG.warnKnownSizeBeforeZip) {
        warnings.push(`已知体积较大：${formatBytes(state.totalKnownSize)}`);
      }

      if (state.unknownSizeFiles > 0) {
        warnings.push(`有 ${state.unknownSizeFiles} 个文件体积未知`);
      }

      if (state.skippedDirs.length > 0) {
        warnings.push(`有 ${state.skippedDirs.length} 个目录被跳过`);
      }

      if (warnings.length > 0) {
        const ok = confirm(
          "这个目录规模可能比较大：\n\n" +
          warnings.join("\n") +
          "\n\n浏览器端打包会占用内存。确定继续生成 ZIP 吗？"
        );

        if (!ok) {
          setStatus("已取消");
          return;
        }
      }

      const zipName = sanitizeName(options.rootName || "作业平台资源") + "_" + nowStamp() + ".zip";
      await downloadZip(state.files, zipName);

      setStatus("完成");
    } catch (err) {
      console.error(err);
      setStatus("失败");
      alert("任务失败：\n" + (err && err.message ? err.message : String(err)));
    } finally {
      running = false;
    }
  }

  async function scanDir({ url, pathParts, depth, state, isRoot }) {
    if (depth > CFG.maxDepth) {
      state.skippedDirs.push(pathParts.join("/") || "当前目录");
      return;
    }

    const normalized = normalizeUrl(url);
    if (state.visitedDirs.has(normalized)) return;

    state.visitedDirs.add(normalized);
    state.dirs++;
    state.totalEntries++;

    if (state.totalEntries > CFG.hardStopEntries) {
      throw new Error(
        `扫描条目已经超过 ${CFG.hardStopEntries}，为避免浏览器卡死，已强制停止。`
      );
    }

    if (state.totalEntries >= state.nextEntryWarning) {
      const ok = confirm(
        `已经扫描到 ${state.totalEntries} 个条目。\n\n` +
        `这个目录可能非常大，继续扫描可能会比较慢。\n\n` +
        `确定继续吗？`
      );

      if (!ok) {
        throw new Error("用户取消：目录规模较大。");
      }

      state.nextEntryWarning += CFG.warnTotalEntriesStep;
    }

    setStatus(`扫描中：${state.files.length} 文件 / ${state.dirs} 目录`);

    const doc = normalizeUrl(location.href) === normalized
      ? document
      : await fetchHtml(url);

    const parsed = parseListPage(doc, url);
    const childCount = parsed.dirs.length + parsed.files.length;

    if (!isRoot && childCount >= CFG.warnChildrenInOneDir) {
      const ok = confirm(
        `目录「${pathParts.join("/") || "当前目录"}」下直接包含 ${childCount} 个条目。\n\n` +
        `这通常意味着文件很多，继续扫描可能较慢。\n\n` +
        `确定继续扫描这个目录吗？`
      );

      if (!ok) {
        state.skippedDirs.push(pathParts.join("/") || "当前目录");
        return;
      }
    }

    for (const file of parsed.files) {
      const filePath = uniquePath([...pathParts, file.name].join("/"), state.pathSet);

      state.files.push({
        url: file.url,
        path: filePath,
        sizeText: file.sizeText,
        sizeBytes: file.sizeBytes,
        mtime: file.mtime,
      });

      if (Number.isFinite(file.sizeBytes)) {
        state.totalKnownSize += file.sizeBytes;
      } else {
        state.unknownSizeFiles++;
      }

      state.totalEntries++;
    }

    for (const dir of parsed.dirs) {
      await scanDir({
        url: dir.url,
        pathParts: [...pathParts, dir.name],
        depth: depth + 1,
        state,
        isRoot: false,
      });
    }
  }

  function parseListPage(doc, pageUrl) {
    const dirs = [];
    const files = [];
    const rows = Array.from(doc.querySelectorAll("tr"));

    for (const row of rows) {
      const rowText = getText(row);
      const link = row.querySelector("a[href]");
      if (!link) continue;

      const href = link.getAttribute("href") || "";
      const name = sanitizeName(getText(link));

      if (!name) continue;
      if (rowText.includes("上级目录")) continue;

      const cells = Array.from(row.querySelectorAll("td")).map(td => {
        return getText(td).replace(/\s+/g, " ").trim();
      });

      if (rowText.includes("[目录]") && href.includes("ListDir.jsp?Dir=")) {
        dirs.push({
          name,
          url: absUrl(href, pageUrl),
        });
        continue;
      }

      if (rowText.includes("[文件]") && href.includes("Download.jsp?FileName=")) {
        const sizeText = findSizeText(cells);
        const mtime = findTimeText(cells);

        files.push({
          name,
          url: absUrl(href, pageUrl),
          sizeText,
          sizeBytes: parseSize(sizeText),
          mtime,
        });
      }
    }

    return { dirs, files };
  }

  async function downloadZip(files, zipName) {
    const zip = new JSZip();
    const errors = [];

    let cursor = 0;
    let done = 0;

    setStatus(`下载中：0/${files.length}`);

    async function worker() {
      while (cursor < files.length) {
        const file = files[cursor++];

        try {
          const data = await fetchArrayBuffer(file.url);
          const opts = {};

          if (file.mtime) {
            const d = new Date(file.mtime.replace(/-/g, "/"));
            if (!Number.isNaN(d.getTime())) opts.date = d;
          }

          zip.file(file.path, data, opts);
        } catch (err) {
          console.error("下载失败：", file.path, err);
          errors.push({ file, err });
        } finally {
          done++;
          setStatus(`下载中：${done}/${files.length}`);
        }
      }
    }

    const workers = [];
    const n = Math.min(CFG.downloadConcurrency, files.length);

    for (let i = 0; i < n; i++) {
      workers.push(worker());
    }

    await Promise.all(workers);

    if (errors.length > 0) {
      const preview = errors.slice(0, 12).map(x => " - " + x.file.path).join("\n");
      const ok = confirm(
        `有 ${errors.length} 个文件下载失败。\n\n` +
        preview +
        (errors.length > 12 ? "\n……" : "") +
        "\n\n是否继续生成不完整 ZIP？"
      );

      if (!ok) {
        setStatus("已取消");
        return;
      }
    }

    setStatus("正在生成 ZIP……");

    const blob = await zip.generateAsync(
      {
        type: "blob",
        compression: CFG.zipCompression,
      },
      function (meta) {
        setStatus(`生成 ZIP：${meta.percent.toFixed(1)}%`);
      }
    );

    saveBlob(blob, zipName);
  }

  async function fetchHtml(url) {
    const resp = await fetch(url, {
      credentials: "include",
      cache: "no-store",
    });

    if (!resp.ok) {
      throw new Error(`读取目录失败：HTTP ${resp.status}`);
    }

    const buf = await resp.arrayBuffer();
    const html = decodeHtml(buf, resp.headers.get("content-type") || "");
    return new DOMParser().parseFromString(html, "text/html");
  }

  async function fetchArrayBuffer(url) {
    let lastErr = null;

    for (let i = 0; i <= CFG.retry; i++) {
      try {
        const resp = await fetch(url, {
          credentials: "include",
          cache: "no-store",
        });

        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}`);
        }

        return await resp.arrayBuffer();
      } catch (err) {
        lastErr = err;
        await sleep(500 * (i + 1));
      }
    }

    throw lastErr;
  }

  function decodeHtml(buf, contentType) {
    let charset = "gb18030";
    const m = contentType.match(/charset=([^;]+)/i);

    if (m) {
      charset = m[1].trim().toLowerCase();
    }

    if (charset === "gb2312" || charset === "gbk") {
      charset = "gb18030";
    }

    try {
      return new TextDecoder(charset).decode(buf);
    } catch {
      return new TextDecoder("gb18030").decode(buf);
    }
  }

  function findTitleLine() {
    const candidates = Array.from(document.body.childNodes);

    for (const node of candidates) {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent.trim();
        if (text.includes("发布的资源列表")) {
          const wrapper = document.createElement("div");
          wrapper.textContent = node.textContent;
          node.replaceWith(wrapper);
          return wrapper;
        }
      }

      if (node.nodeType === Node.ELEMENT_NODE) {
        const text = getText(node);
        if (text.includes("发布的资源列表")) {
          return node;
        }
      }
    }

    const bodyText = document.body.innerHTML;
    if (bodyText.includes("发布的资源列表")) {
      const div = document.createElement("div");
      div.style.margin = "6px 0";
      div.innerHTML = `<span>目录操作：</span>`;
      const table = document.querySelector("table");
      if (table) {
        table.parentNode.insertBefore(div, table);
      } else {
        document.body.insertBefore(div, document.body.firstChild);
      }
      return div;
    }

    return null;
  }

  function guessCurrentDirName() {
    const title = document.title && document.title.trim();
    if (title && title !== "选择类型") return title;

    const firstLine = (document.body.innerText || "")
      .split("\n")
      .map(s => s.trim())
      .find(Boolean);

    if (firstLine && firstLine.length <= 40) return firstLine;

    return "作业平台资源";
  }

  function findSizeText(cells) {
    return cells.find(x => /^\d+(?:\.\d+)?\s*(?:B|KB|MB|GB|TB)$/i.test(x)) || "";
  }

  function findTimeText(cells) {
    return cells.find(x => /\d{4}-\d{1,2}-\d{1,2}/.test(x)) || "";
  }

  function parseSize(text) {
    if (!text) return NaN;

    const m = String(text)
      .replace(/,/g, "")
      .trim()
      .match(/^(\d+(?:\.\d+)?)\s*(B|KB|MB|GB|TB)?$/i);

    if (!m) return NaN;

    const n = Number(m[1]);
    const unit = (m[2] || "B").toUpperCase();

    const mul = {
      B: 1,
      KB: 1024,
      MB: 1024 ** 2,
      GB: 1024 ** 3,
      TB: 1024 ** 4,
    }[unit] || 1;

    return n * mul;
  }

  function sanitizeName(name) {
    let s = String(name || "")
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .replace(/[\\/:*?"<>|]/g, "_")
      .replace(/\s+/g, " ")
      .trim();

    s = s.replace(/[.\s]+$/g, "");

    if (!s || s === "." || s === "..") s = "未命名";
    if (s.length > 180) s = s.slice(0, 180);

    return s;
  }

  function uniquePath(path, used) {
    path = path
      .split("/")
      .map(sanitizeName)
      .filter(Boolean)
      .join("/");

    if (!used.has(path)) {
      used.add(path);
      return path;
    }

    const slash = path.lastIndexOf("/");
    const dir = slash >= 0 ? path.slice(0, slash + 1) : "";
    const file = slash >= 0 ? path.slice(slash + 1) : path;
    const dot = file.lastIndexOf(".");

    const stem = dot > 0 ? file.slice(0, dot) : file;
    const ext = dot > 0 ? file.slice(dot) : "";

    let i = 2;

    while (true) {
      const candidate = `${dir}${stem} (${i})${ext}`;

      if (!used.has(candidate)) {
        used.add(candidate);
        return candidate;
      }

      i++;
    }
  }

  function makeSummary(state) {
    return [
      "扫描完成。",
      "",
      `目录数：${state.dirs}`,
      `文件数：${state.files.length}`,
      `总条目：${state.totalEntries}`,
      `已知体积：${formatBytes(state.totalKnownSize)}`,
      `体积未知文件：${state.unknownSizeFiles}`,
      state.skippedDirs.length ? `跳过目录数：${state.skippedDirs.length}` : "",
    ].filter(Boolean).join("\n");
  }

  function formatBytes(n) {
    if (!Number.isFinite(n)) return "未知";
    if (n < 1024) return `${n.toFixed(0)} B`;
    if (n < 1024 ** 2) return `${(n / 1024).toFixed(2)} KB`;
    if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(2)} MB`;
    return `${(n / 1024 ** 3).toFixed(2)} GB`;
  }

  function absUrl(href, base) {
    return new URL(href, base || location.href).href;
  }

  function normalizeUrl(url) {
    const u = new URL(url, location.href);
    u.hash = "";
    return u.href;
  }

  function getText(el) {
    return (el && (el.innerText || el.textContent) || "").trim();
  }

  function nowStamp() {
    const d = new Date();

    return [
      d.getFullYear(),
      String(d.getMonth() + 1).padStart(2, "0"),
      String(d.getDate()).padStart(2, "0"),
      "_",
      String(d.getHours()).padStart(2, "0"),
      String(d.getMinutes()).padStart(2, "0"),
    ].join("");
  }

  function saveBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");

    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();

    setTimeout(function () {
      URL.revokeObjectURL(url);
      a.remove();
    }, 3000);
  }

  function setStatus(text) {
    const el = document.getElementById("pack-status");
    if (el) el.textContent = text || "";
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
})();