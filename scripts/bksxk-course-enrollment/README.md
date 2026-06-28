---
category: 教务系统
tags:
  - 选课
  - 验证码
status: stable
verified: 2026-06-28
featured: false
title_en: "Course Selection Helper"
summary_en: "Helps track target classes, retry enrollment requests, and handle course-selection page details."
legacy_slugs: []
---

# 西农抢课助手 Pro

用于西北农林科技大学本科生选课系统。脚本围绕目标教学班列表工作，提供轮询、重试、提醒和登录页验证码辅助。

## 功能

- 维护一组目标教学班 ID，并按设定间隔尝试处理。
- 支持课程类型、请求间隔、重试频率、成功后停止等配置。
- 在页面上显示运行面板，便于添加目标、查看日志和调整参数。
- 登录页带本地 OCR 验证码辅助逻辑，不依赖外部识别服务。
- 可用声音和桌面通知提示处理结果。

## 适用范围

- 网站：西北农林科技大学本科生选课系统。
- 页面：`https://bksxk.nwafu.edu.cn/*`。
- 浏览器：支持 Tampermonkey 的现代浏览器。
- 脚本管理器：Tampermonkey。

## 使用方法

安装后进入选课系统，在页面面板中添加目标教学班并启动。建议先用较长的请求间隔确认配置无误，再按实际情况调整。

## 已知限制

- 需要你知道目标教学班 ID 和课程类型。
- 页面接口、登录流程或验证码样式变化后，部分功能可能需要跟进。
