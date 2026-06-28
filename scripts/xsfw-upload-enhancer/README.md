---
category: 学生服务
tags:
  - 上传
  - 粘贴
status: stable
verified: 2026-06-28
featured: true
title_en: "Upload Helper for Student Service"
summary_en: "Adds drag-and-drop, clipboard image paste, renaming, and PDF/PNG compression to student-service uploads."
legacy_slugs: []
---

# NWAFU 学生服务上传增强：拖放与粘贴

用于学生服务数据采集附件上传。为 EMAP 上传组件增加拖放、剪贴板图片粘贴、文件重命名和部分 PDF/PNG 压缩处理。

## 功能

- 支持把文件直接拖到附件上传区域。
- 支持 Ctrl+V 粘贴剪贴板图片。
- 自动整理粘贴图片的文件名，按脚本逻辑把粘贴 JPG 转成 PNG。
- 对超过 10MB 的 PDF/PNG 尝试压缩到可上传大小。
- 保留页面原有上传组件的提交流程。

## 适用范围

- 网站：西北农林科技大学学生服务系统。
- 页面：学生服务数据采集相关页面。
- 浏览器：支持 Tampermonkey 的现代浏览器。
- 脚本管理器：Tampermonkey。

## 使用方法

安装后打开数据采集页面，把文件拖进上传区域，或先截图再在上传区域附近按 Ctrl+V。

## 已知限制

- 压缩效果取决于原文件内容，特别大的扫描件可能仍需手动处理。
- 依赖页面现有 EMAP 上传组件结构，若学校页面改版可能需要更新脚本。
