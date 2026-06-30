---
category: 学习平台
tags:
  - 小鹅通
  - 下载
status: beta
verified: 2026-06-30
featured: false
title_en: "Xiaoetong Material Downloader"
summary_en: "Detects loaded PDF material previews on Xiaoetong course pages and adds direct PDF download links."
legacy_slugs: []
---

# 小鹅通资料下载助手

用于小鹅通知识店铺课程页。识别当前页面已经加载的 PDF 资料预览，并提供原始 PDF 下载入口。

## 功能

- 在课程页右下角增加“资料下载”面板。
- 识别资料面板、预览窗口和当前页面中已经加载的 PDF 链接。
- 将小鹅通 PDF 预览地址转换为原始 PDF 地址。
- 为每份资料生成“下载 PDF”按钮。

## 适用范围

- 网站：小鹅通 H5 知识店铺页面。
- 页面：`https://*.h5.xiaoeknow.com/*`，以及小鹅通文档预览域名 `https://resource-tx-cdn.xiaoeeye.com/*`。
- 浏览器：支持 Tampermonkey 的现代浏览器。
- 脚本管理器：Tampermonkey。

## 使用方法

安装后打开已购买课程，进入资料面板并点击资料的预览。页面右下角出现“资料下载”面板后，点击“下载 PDF”即可保存文件。

如果面板提示未发现 PDF，先点击资料预览，等待预览加载完成，再点面板里的“刷新”。

## 已知限制

- 需要你已登录并能在页面内正常打开资料预览。
- 只识别当前页面已经加载出的 PDF 链接，不主动登录、不保存 Cookie、不批量抓取课程资料。
- 如果店铺关闭资料预览、资料不是 PDF，或小鹅通更换预览域名和参数，脚本可能识别不到。
- 下载文件名由浏览器和服务器响应共同决定，部分浏览器可能使用 URL 文件名。
