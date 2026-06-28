---
category: 学习平台
tags:
  - THEOL
  - 题库
status: stable
verified: 2026-06-28
featured: false
title_en: "THEOL Answer Assistant"
summary_en: "Adds an in-page THEOL answer panel that can query enncy or an OpenAI-compatible service and fill or copy answers."
legacy_slugs: []
---

# THEOL 在线教育综合平台自动答题助手

用于 THEOL 在线教育综合平台。页面内提供答题面板，可连接 enncy 题库或 OpenAI 兼容接口，辅助查询、填入和复制答案。

## 功能

- 在 THEOL 页面显示可拖动的操作面板。
- 支持 enncy 题库查询，并显示查询次数等信息。（enncy可能有bug）
- 支持配置 OpenAI 兼容接口、密钥和模型。
- 可按题处理，也可连续运行并记录过程日志。
- 对编辑器填入、复制答案和跳转下一题提供页面内操作。

## 适用范围

- 网站：THEOL 平台。
- 页面：`https://eol.nwafu.edu.cn/*`。
- 浏览器：支持 Tampermonkey 的现代浏览器。
- 脚本管理器：Tampermonkey。

## 使用方法

安装后进入 THEOL 页面，先在面板中填好题库或 LLM 配置，再按当前题目使用。

## 已知限制

- 题库和 LLM 服务需要你自己准备可用配置。LLM api提供方可能需要支持跨域。
- THEOL 页面结构、编辑器实现或外部接口变化后，脚本可能需要更新。
