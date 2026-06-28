---
category: 学习平台
tags:
  - U校园
  - 答案
status: stable
verified: 2026-06-28
featured: false
title_en: "Unipus Answer Viewer"
summary_en: "Shows parsed answers on Unipus exercise pages and can fill common question types."
legacy_slugs: []
---

# U校园答案显示器

用于 U校园练习页面。脚本会在页面侧边提供答案读取、显示和填充相关操作。

## 功能

- 在 U校园相关域名中识别练习页面。
- 读取并解析页面所需的作答数据。
- 在浮动面板中展示答案和处理状态。
- 支持部分题型的一键填充和题目切换后的刷新。
- 提供日志开关，便于排查页面更新后的问题。

## 适用范围

- 网站：U校园相关域名。
- 页面：`sso.unipus.cn`、`uai.unipus.cn`、`ucontent.unipus.cn`。
- 浏览器：支持 Tampermonkey 的现代浏览器。
- 脚本管理器：Tampermonkey。

## 使用方法

安装后进入 U校园练习页面，使用页面上的浮动按钮读取或填充当前题目。

## 已知限制

- 依赖 U校园当前前端接口和页面结构。
- 不同课程、题型和页面版本的显示效果可能不完全一致。
