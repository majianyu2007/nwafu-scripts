---
category: 学生服务
tags:
  - 数据采集
  - 草稿
status: stable
verified: 2026-06-28
featured: true
title_en: "Draft Checker for Student Data Collection"
summary_en: "Finds draft records in student data collection and links back to each item."
legacy_slugs: []
---

# NWAFU 数据采集草稿检查器

用来检查学生服务数据采集里还有哪些记录停在“草稿”状态，适合提交前快速扫一遍。

## 功能

- 扫描数据采集应用中的记录列表。
- 把草稿态条目集中列出来。
- 每条记录提供跳转入口，方便回到对应页面继续处理。
- 面板可移动，不挡住原页面主要内容。

## 适用范围

- 网站：西北农林科技大学学生服务系统。
- 页面：学生数据采集应用默认入口。
- 浏览器：支持 Tampermonkey 的现代浏览器。
- 脚本管理器：Tampermonkey。

## 使用方法

安装后打开数据采集页面，使用右侧面板开始检查。发现草稿后，点对应条目回到记录页面。

## 已知限制

- 依赖学生服务数据采集接口和页面结构。
- 只检查当前账号能看到的数据采集记录。
