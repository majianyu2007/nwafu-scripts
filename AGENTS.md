# AGENT.md

本文件是后续 agent 在本仓库工作的强制执行说明。开始任何任务前，先阅读本文件，再查看相关源码。不要凭印象改动。

## 项目现状

本仓库是 `NWAFU Scripts`，一个面向西北农林科技大学相关网站 Userscript 的 Astro 静态索引站。

- 正式站点：`https://mjy.js.org/nwafu-scripts/`
- GitHub 仓库：`https://github.com/majianyu2007/nwafu-scripts`
- 作者字段：`majianyu2007`
- 许可证：MIT
- 默认分支：`main`
- 部署分支：`web`
- Node：22 LTS
- 包管理器：pnpm `10.17.1`
- 框架：Astro + TypeScript + 原生 CSS + 少量原生 JavaScript
- 不使用 React、Vue、Svelte、Tailwind、运行时 CDN UI 框架或大型组件库

核心维护入口只有：

```text
scripts/<slug>/script.user.js
scripts/<slug>/README.md
scripts/<slug>/assets/    # 可选
```

构建流程会扫描 `scripts/`，校验 README front matter 和 Userscript metadata，生成：

- `src/generated/scripts.json`
- `public/generated/search-index.json`
- `public/generated/userscripts/<slug>.user.js`
- `public/userscripts/<slug>.user.js`
- 脚本详情页
- 中英文页面
- RSS、Atom、Sitemap、robots.txt
- `dist/` 静态站

`src/generated/`、`public/generated/`、`public/userscripts/`、`dist/` 都是生成产物，不要手工编辑。

## 当前脚本清单

当前已有 6 个真实脚本：

| slug | 显示名 | 版本 | 分类 | 状态 |
| --- | --- | --- | --- | --- |
| `bksxk-course-enrollment` | 西农抢课助手 Pro | `6.2.0` | 教务系统 | stable |
| `homework-platform-zip-download` | 110作业平台目录打包下载 | `1.0.0` | 作业平台 | stable |
| `theol-answer-assistant` | THEOL 自动答题助手 | `1.0.0` | 学习平台 | stable |
| `unipus-answer-viewer` | U校园答案显示器 | `1.0.0` | 学习平台 | stable |
| `xsfw-draft-checker` | NWAFU 数据采集草稿检查器 | `0.1.0` | 学生服务 | stable |
| `xsfw-upload-enhancer` | NWAFU 学生服务上传增强：拖放与粘贴 | `0.5.2` | 学生服务 | stable |

这些脚本是用户已有作品。除非用户明确要求，不要改动它们的业务逻辑。

## 工作原则

1. 先检查 `git status --short --branch`，确认是否有用户未提交改动。
2. 不要覆盖、回滚、格式化或重写用户未要求修改的文件。
3. 不要创建假脚本、假截图、假版本号、假功能说明。
4. 不要把归档脚本删除。删除目录会破坏已安装用户的更新地址。
5. 不要手工编辑生成产物。
6. 不要把安装地址指向 GitHub raw、仓库源文件或第三方镜像。
7. 不要在源码中分散硬编码站点 URL。URL 统一走 `site.config.ts` 和 `src/lib/site.ts`。
8. 不要为了视觉整齐写硬撑高度、假内容或多余装饰。先做最小、可解释的修正。
9. 不要使用 Homebrew 安装 pnpm、Astro 或 Node 相关依赖。
10. 提交前必须运行与改动范围匹配的检查。新增或修改脚本时必须运行 `pnpm run ci`。

## 新增脚本的强制流程

新增脚本只能新增一个标准目录：

```text
scripts/<slug>/
  script.user.js
  README.md
  assets/          # 可选
```

步骤：

1. 选择稳定 slug。
2. 编写 `script.user.js`。
3. 编写 `README.md`。
4. 运行 `pnpm generate`。
5. 运行 `pnpm validate`。
6. 运行 `pnpm run ci`。
7. 确认没有改动生成产物以外的不相关文件。
8. 提交并推送，或按用户要求只保留本地改动。

## slug 规则

slug 必须：

- 英文小写。
- kebab-case。
- 简短清晰。
- 能表达脚本用途或目标系统。
- 不包含中文。
- 不包含年份、版本号、随机编号、无意义序号。
- 新增后尽量永久不改。

示例：

```text
xsfw-upload-enhancer
jwxt-schedule-enhancer
bksxk-course-enrollment
```

如果必须更名：

1. 新目录使用新 slug。
2. 在新 README front matter 的 `legacy_slugs` 写旧 slug。
3. 不要删除旧地址兼容逻辑。
4. 运行 `pnpm run ci` 确认旧 `.user.js` 和旧详情页跳转可生成。

## `script.user.js` metadata 规则

源文件必须有 Userscript metadata block：

```js
// ==UserScript==
// @name         脚本中文名
// @version      1.0.0
// @description  一句话说明脚本真实用途
// @match        https://example.nwafu.edu.cn/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==
```

用户维护的允许字段：

```text
@name
@version
@description
@match
@include
@exclude
@grant
@require
@resource
@run-at
@connect
@icon
@noframes
```

必填：

- `@name`
- `@version`
- `@description`
- 至少一个 `@match` 或 `@include`

`@version` 必须是合法 semver，例如：

```text
0.1.0
1.0.0
1.2.3
```

不要在源文件中手写以下项目级 metadata：

```text
@namespace
@author
@license
@homepageURL
@supportURL
@updateURL
@downloadURL
```

这些字段由 `tools/lib/userscript.ts` 统一注入。发布版安装地址由配置生成：

```text
https://mjy.js.org/nwafu-scripts/userscripts/<slug>.user.js
```

metadata 编写要求：

- `@match` 尽量收窄到真实需要的域名和路径。
- 需要 GM API 时才写对应 `@grant`。
- 不使用 GM API 时写 `@grant none`。
- 访问外部接口时必须写准确 `@connect`。
- 引用外部库时必须写 `@require`，并在 README 说明用途和失效影响。
- 不要请求与功能无关的权限。
- 不要绕过学校权限、业务规则或系统限制。
- 不要收集、上传或泄露用户隐私数据。
- 不要把 token、账号、密码、Cookie、密钥写死进脚本。

## README 规则

每个脚本必须有：

```text
scripts/<slug>/README.md
```

README 必须使用 front matter：

```md
---
category: 学生服务
tags:
  - 上传
  - 粘贴
status: stable
verified: 2026-06-29
featured: false
title_en: ''
summary_en: ''
legacy_slugs: []
---

# 脚本中文名称

一句中文简介。说明脚本用于哪个页面，解决什么具体问题。

## 功能

- 功能一
- 功能二

## 适用范围

- 网站：
- 页面：
- 浏览器：支持 Tampermonkey 的现代浏览器。
- 脚本管理器：Tampermonkey。

## 使用方法

安装后打开对应页面即可。

## 已知限制

- 限制一
```

front matter 规则：

- `category`：必填，字符串。
- `tags`：必填，非空字符串数组。
- `status`：必填，只能是 `stable`、`beta`、`paused`、`deprecated`。
- `verified`：必填，`YYYY-MM-DD`。
- `featured`：可选，布尔值。
- `title_en`：可选，英文标题。
- `summary_en`：可选，英文简介。
- `legacy_slugs`：可选，旧 slug 数组。

正文规则：

- 正文使用中文。
- 第一段会成为首页卡片中文摘要，必须短、准、真实。
- 不要写夸张营销文案。
- 不要写“智能”“一站式”“极致体验”等空泛词。
- 不要承诺脚本永久可用。
- 不要编造未实现功能。
- 没有截图就不要写截图说明。
- 如脚本依赖外部服务、外部库或特定页面结构，必须写入“已知限制”。

摘要建议：

```text
用于 <具体系统/页面>。<一句话说明主要能力>。
```

示例：

```text
用于学生服务数据采集附件上传。为 EMAP 上传组件增加拖放、剪贴板图片粘贴、文件重命名和部分 PDF/PNG 压缩处理。
```

## 标签规则

标签要少。通常 1 到 3 个即可。

优先使用：

- 系统名：`学生服务`、`教务系统`、`U校园`、`THEOL`
- 功能名：`上传`、`下载`、`选课`、`草稿`、`题库`

不要添加大量近义标签。不要为了搜索堆关键词。

## 资产规则

截图和说明图放在：

```text
scripts/<slug>/assets/
```

支持：

```text
webp
png
jpg
jpeg
gif
svg
```

README 中使用相对路径引用：

```md
![说明](assets/screenshot.webp)
```

没有真实截图时不要创建占位图。

## 修改已有脚本的版本规则

CI 根据 Git diff 校验版本：

- 修改 `scripts/<slug>/script.user.js`：必须提升 `@version`。
- 修改 metadata：必须提升 `@version`。
- 只修改 README：不需要提升 `@version`。
- 新增脚本：不做旧版本比较。
- 版本不变、版本降低都会失败。

版本提升建议：

- 修 bug：patch，例如 `1.0.0` -> `1.0.1`。
- 新功能：minor，例如 `1.0.0` -> `1.1.0`。
- 破坏性变化：major，例如 `1.0.0` -> `2.0.0`。

不要为了绕过 CI 随便大幅提高版本。

## 归档脚本

归档不删除目录。改 README front matter：

```md
status: paused
```

或：

```md
status: deprecated
```

含义：

- `paused`：暂时暂停维护，未来可能恢复。
- `deprecated`：确认失效或不再维护。

归档流程：

1. 保留 `scripts/<slug>/`。
2. 修改 README 的 `status`。
3. 在 README 正文说明原因、最后可用范围、替代方式。
4. 如果需要给已安装用户推送提示，修改 `script.user.js` 并提升 `@version`。
5. 运行 `pnpm run ci`。

归档脚本不会出现在首页默认主列表，会进入 `/archive/`。

## 写脚本前必须做的判断

如果用户要求写新脚本，先从本地文件和用户提供的信息判断：

1. 目标网站是什么。
2. 具体页面 URL 或域名是什么。
3. 用户要增强的是页面交互、信息展示、下载、上传、填表还是其他操作。
4. 是否需要登录态。
5. 是否需要外部接口。
6. 是否涉及隐私数据、账号数据、成绩、课程、作业、文件。
7. 是否可能绕过权限或系统规则。

如果需求明显会绕过权限、业务规则、访问控制或安全限制，不要实现。可以改为只做合规的页面辅助、信息整理或用户手动操作增强。

## 脚本实现要求

写 Userscript 时：

- 使用原生 JavaScript。
- 默认用 IIFE 包裹。
- 默认开启 `'use strict';`。
- 尽量减少全局变量。
- DOM 选择器要有容错。
- 页面元素不存在时应安静退出或显示清晰提示。
- 异步请求要处理失败。
- UI 注入要有唯一 ID，避免重复注入。
- 样式作用域必须绑定唯一根节点或唯一 class/id。
- 不要污染学校页面的全局样式。
- 不要长时间高频轮询；需要轮询时提供间隔、停止条件和错误退避。
- 不要默认自动提交关键表单，除非用户明确要求且行为合规。
- 不要隐藏学校页面原有提示、规则、确认信息。
- 不要在控制台刷大量日志。需要调试日志时提供开关，默认关闭。

## 站点代码改动限制

如果任务只是新增或修改脚本，通常只允许改：

```text
scripts/<slug>/script.user.js
scripts/<slug>/README.md
scripts/<slug>/assets/
```

不要顺手改：

```text
src/
tools/
site.config.ts
astro.config.mjs
package.json
pnpm-lock.yaml
.github/
```

只有用户明确要求修改站点、构建器、部署或样式时，才改上述文件。

## 构建和检查命令

常用命令：

```bash
pnpm generate
pnpm validate
pnpm test
pnpm check
pnpm build
pnpm run ci
```

新增或修改脚本后必须运行：

```bash
pnpm run ci
```

说明：

- 本项目 CI 脚本是 `pnpm run ci`。
- 不要把它写成 `pnpm ci`。
- `pnpm ci` 是 pnpm 自身命令，不是本项目脚本。

如果只改文档，可以至少运行：

```bash
pnpm validate
```

但涉及脚本、README front matter、metadata、构建器、页面、样式时，必须运行 `pnpm run ci`。

## Git 和提交规则

开始前：

```bash
git status --short --branch
```

提交前：

1. 再次查看 `git status --short --branch`。
2. 查看 `git diff --stat`。
3. 如果改了脚本，确认 `@version` 已提升。
4. 如果用户要求不改脚本业务逻辑，检查 `git diff -- scripts/*/script.user.js`。
5. 运行必要检查。

提交信息使用简短英文，例如：

```text
Add xsfw upload helper
Update script documentation
Fix userscript metadata
```

不要把生成产物提交到源码分支，除非仓库规则未来改变。

## 部署规则

`.github/workflows/deploy.yml` 会在以下情况运行：

- push 到 `main`：构建、测试、部署。
- pull request：构建、测试，不部署。
- workflow_dispatch：手动构建、测试、部署。
- schedule：定时构建、测试，不部署。

部署使用 `PAGES_DEPLOY_TOKEN` 推送 `dist/` 到 `web` 分支根目录。

不要手工向 `web` 分支提交源码。

## 设计和文案要求

视觉规范以 `DESIGN.md` 为准。

站点文案要求：

- 克制。
- 具体。
- 短句优先。
- 不口语化堆砌。
- 不写 AI 味明显的套话。
- 不写“近期提交由 Git 历史生成”这类访客不需要看的内部实现解释。

脚本说明文案要求：

- 写真实功能。
- 写适用范围。
- 写已知限制。
- 不替用户夸大功能。
- 不把风险免责声明塞得到处都是；必要说明放 README 或 About。

## 禁止事项

严禁：

- 创建虚构脚本或占位脚本。
- 编造脚本功能。
- 编造截图。
- 修改脚本业务逻辑却不提升版本。
- 删除已有脚本目录来“归档”。
- 手动改生成产物。
- 把 `@updateURL` 或安装按钮指向 GitHub raw。
- 在源脚本中手写项目级 metadata。
- 把 token、Cookie、账号、密码写进代码。
- 绕过学校权限、审批、访问控制或业务限制。
- 为了视觉整齐强制塞空内容、假高度或重复卡片。
- 未经要求重构站点大结构。

## 新增脚本交付清单

新增脚本任务完成时，最终回复必须说明：

- 新增 slug。
- 新增文件路径。
- 脚本显示名。
- `@version`。
- `@match` / `@include` 范围。
- 是否使用 `@grant`、`@require`、`@connect`。
- 是否有 assets。
- 运行过的检查命令。
- 检查结果。
- 是否已提交、是否已推送。

如果有未完成事项，必须明确列出，不要说“基本完成”。

