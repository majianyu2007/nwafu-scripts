---
category: 作业平台
tags:
  - 下载
  - ZIP
status: stable
verified: 2026-06-28
featured: false
title_en: "ZIP Download for Homework Platform"
summary_en: "Adds one-click ZIP packing to directory pages on the older homework platform."
legacy_slugs: []
---

# 110作业平台目录打包下载

给旧作业平台的目录页加一个打包入口。遇到一整个目录的资料时，可以直接压成 ZIP 下载。

## 功能

- 在资源目录页面增加“打包当前目录”等入口。
- 递归扫描子目录和文件。
- 在浏览器里用 JSZip 生成压缩包。
- 对文件名、下载失败和目录规模做基础处理。

## 适用范围

- 网站：`http://202.117.179.110/` 下的作业平台页面。
- 页面：包含 `ListDir.jsp` / `Download.jsp` 资源列表的页面。
- 浏览器：支持 Tampermonkey 的现代浏览器。
- 脚本管理器：Tampermonkey。

## 使用方法

安装后打开作业平台目录页，点击新增的打包链接，等待扫描和压缩完成。

## 已知限制

- 依赖 JSZip CDN 资源；若网络阻断 CDN，脚本会提示 JSZip 未加载。
- 大目录会占用较多内存，浏览器卡住时建议分目录下载。
