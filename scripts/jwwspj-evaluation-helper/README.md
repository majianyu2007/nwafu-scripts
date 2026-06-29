---
category: 教务系统
tags:
  - 教务系统
  - 评教
status: beta
verified: 2026-06-29
featured: false
title_en: "NWAFU Teaching Evaluation Helper"
summary_en: "Adds a control panel for filling evaluation forms, locating pending items, and submitting only after manual review."
legacy_slugs: []
---

# NWAFU 网上评教辅助

用于网上评教应用。增加浮动控制面板，辅助填写当前问卷、定位未提交项目，并把提交动作留给用户手动触发。

## 功能

- 在评教列表页统计当前可见项目数量、未提交数量和已提交数量。
- 支持一键打开当前列表中的第一个未提交项目。
- 支持在结果性评教和过程评教入口之间切换。
- 在问卷页按下拉框选择的档位填写单选题，默认选择“完全赞同”。
- 为空白评语框填写默认评语，默认内容为“无意见”。
- 提供“提交当前问卷”按钮，但不会自动点击确认弹窗。
- 面板可移动、可收起，避免遮挡页面内容。

## 适用范围

- 网站：西北农林科技大学网上评教应用。
- 页面：`newehall.nwafu.edu.cn` 下 `jwwspj` 网上评教页面。
- 浏览器：支持 Tampermonkey 的现代浏览器。
- 脚本管理器：Tampermonkey。

## 使用方法

安装后打开网上评教页面。列表页可用面板打开未提交项目；问卷页先用“填写当前问卷”，检查内容无误后再按页面需要提交并手动确认。

面板中的“选项”可从下拉框选择，“评语”可以直接修改，修改后会用于下一次填写。

## 已知限制

- 依赖网上评教页面当前 DOM 结构，学校页面改版后可能需要更新选择器。
- 已提交或只读问卷不会被改写。
- 脚本只辅助当前账号可见的评教页面，不绕过登录、权限、截止时间或学校系统规则。
- “提交当前问卷”只点击页面里的提交按钮；确认弹窗仍需用户自行确认。
