# NWAFU Scripts

西北农林科技大学网站增强脚本集。

- 站点：<https://mjy.js.org/nwafu-scripts/>
- 仓库：<https://github.com/majianyu2007/nwafu-scripts>
- 许可证：MIT

本站是一个 Astro 静态站。脚本维护入口固定为：

```text
scripts/<slug>/script.user.js
scripts/<slug>/README.md
```

构建流程会扫描 `scripts/`，校验 Userscript metadata 和 README front matter，生成脚本索引、详情页、搜索索引、RSS、Atom、安装用 `.user.js` 文件，并部署到 `web` 分支根目录。

## 环境要求

- Node.js 22 LTS
- pnpm 10.17.1

建议使用 Corepack，不需要 Homebrew：

```bash
corepack enable
corepack prepare pnpm@10.17.1 --activate
pnpm install
```

## 本地运行

```bash
pnpm run ci
pnpm dev
```

常用命令：

```bash
pnpm generate   # 生成脚本 manifest、发布版 user.js、搜索索引等
pnpm validate   # 校验脚本和 README
pnpm test       # 运行 Vitest
pnpm check      # Astro check 和 TypeScript 检查
pnpm build      # 生成 dist/
pnpm preview    # 本地预览 dist/
pnpm run ci     # 完整检查
```

说明：`pnpm ci` 是 pnpm 自身命令名。执行本项目 CI 脚本时使用 `pnpm run ci`。

## 复刻本站

适用于把本站改造成自己的 Userscript 索引站。

1. Fork 本仓库，或直接 clone 后推送到新仓库。

```bash
git clone https://github.com/majianyu2007/nwafu-scripts.git
cd nwafu-scripts
corepack enable
corepack prepare pnpm@10.17.1 --activate
pnpm install
```

2. 修改站点配置。

优先改 `.env.local`。也可以直接改 `site.config.ts` 的默认值。

```text
SITE_URL=https://example.com
BASE_PATH=/your-repo-name
REPOSITORY_URL=https://github.com/<owner>/<repo>
AUTHOR=<owner>
LICENSE_NAME=MIT
PUBLIC_ADSENSE_CLIENT=
PUBLIC_UMAMI_SCRIPT_URL=
PUBLIC_UMAMI_WEBSITE_ID=
```

配置含义：

- `SITE_URL`：域名，不带末尾斜杠。
- `BASE_PATH`：项目站路径。用户页根站可设为空；项目仓库通常为 `/<repo>`。
- `REPOSITORY_URL`：GitHub 仓库地址。
- `AUTHOR`：写入发布版 Userscript metadata 的作者名。
- `LICENSE_NAME`：写入发布版 Userscript metadata 的许可证名。
- `PUBLIC_ADSENSE_CLIENT`：AdSense 自动广告 client，留空则不注入。
- `PUBLIC_UMAMI_SCRIPT_URL`、`PUBLIC_UMAMI_WEBSITE_ID`：Umami 统计配置，任一为空则不注入。

3. 替换脚本内容。

删除或替换 `scripts/` 下的现有目录。每个脚本目录只需要保留：

```text
scripts/<slug>/script.user.js
scripts/<slug>/README.md
scripts/<slug>/assets/    # 可选
```

不要把安装地址指向 GitHub raw。构建器会生成固定安装地址：

```text
https://example.com/your-repo-name/userscripts/<slug>.user.js
```

4. 修改站点名称与页面文案。

主要文件：

```text
src/pages/index.astro
src/pages/about.astro
src/pages/guide/install.astro
src/pages/en/index.astro
src/pages/en/about.astro
src/pages/en/guide/install.astro
public/favicon.svg
DESIGN.md
```

5. 本地检查。

```bash
pnpm run ci
pnpm build
pnpm preview
```

6. 配置 GitHub Actions Secret。

见下文 `PAGES_DEPLOY_TOKEN`。

7. 推送到默认分支 `main`。

```bash
git add .
git commit -m "Initialize userscript index"
git push origin main
```

8. 第一次部署完成后，在 GitHub 设置 Pages：

```text
Settings -> Pages
Source: Deploy from a branch
Branch: web
Folder: /(root)
```

## 新增脚本

最短流程：

1. 新建 `scripts/<slug>/`。
2. 放入 `script.user.js`。
3. 编写 `README.md`。
4. 修改脚本代码时提升 `@version`。
5. 运行 `pnpm run ci`。
6. 提交并 push 到 `main`。

`slug` 规则：

- 英文小写。
- 使用 kebab-case。
- 保持稳定。
- 不写年份、版本号、随机编号。
- 更名时在 README front matter 中写入旧 slug。

示例：

```text
scripts/xsfw-upload-enhancer/
scripts/jwxt-schedule-enhancer/
```

## `script.user.js` metadata

脚本源文件由维护者填写脚本自身 metadata：

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

必填项：

- `@name`
- `@version`
- `@description`
- `@match` 或 `@include`

`@version` 必须是合法 semver，例如 `1.0.0`、`1.2.3`。

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

这些字段由构建器统一注入。发布版脚本会得到：

```text
@namespace    https://mjy.js.org/nwafu-scripts/
@author       majianyu2007
@license      MIT
@homepageURL  https://mjy.js.org/nwafu-scripts/scripts/<slug>/
@supportURL   https://github.com/majianyu2007/nwafu-scripts/issues
@updateURL    https://mjy.js.org/nwafu-scripts/userscripts/<slug>.user.js
@downloadURL  https://mjy.js.org/nwafu-scripts/userscripts/<slug>.user.js
```

复刻本站后，上述地址会按你的 `SITE_URL`、`BASE_PATH`、`REPOSITORY_URL`、`AUTHOR` 自动生成。

## README front matter

每个脚本必须有 `scripts/<slug>/README.md`。

```md
---
category: 学生服务
tags:
  - 上传
  - 粘贴
status: stable
verified: 2026-06-28
featured: false
title_en: ''
summary_en: ''
legacy_slugs: []
---

# 脚本中文名称

一句中文简介。
```

字段规则：

- `category`：必填，字符串。
- `tags`：必填，非空字符串数组。
- `status`：必填，只能是 `stable`、`beta`、`paused`、`deprecated`。
- `verified`：必填，ISO 日期，格式为 `YYYY-MM-DD`。
- `featured`：可选，布尔值。
- `title_en`：可选，英文标题。
- `summary_en`：可选，英文简介。
- `legacy_slugs`：可选，旧 slug 数组。

正文使用中文。英文页面没有英文正文时，会显示中文 README，并标注尚未提供完整英文说明。

图片放在：

```text
scripts/<slug>/assets/
```

支持 `webp`、`png`、`jpg`、`gif`、`svg`。README 内使用相对路径引用即可。

## 版本检查

CI 会比较 Git diff：

- 脚本代码或 metadata 改动，`@version` 必须升高。
- README 改动不要求升版本。
- 新增脚本不做旧版本比较。
- 版本降级或版本不变会失败。

版本比较基于 Git 历史。GitHub Actions 使用 `fetch-depth: 0`。

## 归档脚本

归档不等于删除。删除目录会让已安装用户失去固定更新地址。

暂停维护：

```md
---
status: paused
---
```

确认失效或不再维护：

```md
---
status: deprecated
---
```

建议流程：

1. 保留 `scripts/<slug>/` 目录。
2. 在 `README.md` 中把 `status` 改为 `paused` 或 `deprecated`。
3. 在正文说明停止维护原因、最后可用范围、替代方式。
4. 如脚本仍需给已安装用户推送提示，修改 `script.user.js` 并提升 `@version`。
5. 运行 `pnpm run ci`。
6. 提交并 push。

归档脚本不会出现在首页默认主列表，会进入 `/archive/`。

## 更名脚本

更名时保留旧地址：

```md
---
legacy_slugs:
  - old-slug
---
```

构建器会为旧 slug 生成兼容 `.user.js`，旧脚本的更新地址会指向新的 canonical slug。旧详情页会生成跳转页。

## 自动构建与部署

工作流文件：

```text
.github/workflows/deploy.yml
```

触发条件：

- push 到 `main`：构建、测试、部署。
- pull request：构建、测试，不部署。
- workflow_dispatch：手动构建、测试、部署。
- schedule：定时构建、测试，不部署。

部署规则：

- 构建产物来自 `dist/`。
- `dist/.nojekyll` 自动创建。
- 不创建 `CNAME`。
- 产物强制推送到 `web` 分支根目录。
- `web` 分支只保存静态文件。
- PR 和定时任务不会推送 `web`。

## 配置 `PAGES_DEPLOY_TOKEN`

部署使用 fine-grained personal access token，不依赖默认 `GITHUB_TOKEN`。

创建 token：

1. 打开 GitHub -> Settings -> Developer settings -> Personal access tokens -> Fine-grained tokens。
2. 选择 Resource owner。
3. Repository access 只选择目标仓库。
4. Repository permissions 只给 `Contents: Read and write`。
5. 生成 token。

添加 Secret：

1. 打开仓库 Settings -> Secrets and variables -> Actions。
2. 新建 Repository secret。
3. 名称填写：

```text
PAGES_DEPLOY_TOKEN
```

4. 值填写刚创建的 token。

缺少该 Secret 时，PR 和定时构建仍可运行；push 到 `main` 或手动部署会在部署步骤失败并输出原因。

## GitHub Pages 设置

首次成功生成 `web` 分支后，打开：

```text
Settings -> Pages
```

选择：

```text
Source: Deploy from a branch
Branch: web
Folder: /(root)
```

本项目不写 `CNAME`。如果使用用户主页域名下的项目路径，域名配置应由用户主页仓库负责。

## 广告与统计

生产构建按配置注入：

- Google AdSense 自动广告。
- Umami 访问统计。

本地开发不注入外部统计或广告脚本。

关闭方式：将以下变量留空。

```text
PUBLIC_ADSENSE_CLIENT=
PUBLIC_UMAMI_SCRIPT_URL=
PUBLIC_UMAMI_WEBSITE_ID=
```

## 目录说明

```text
scripts/              人工维护的脚本和 README
src/                  Astro 页面、组件、样式
src/generated/        构建生成，不手动编辑
public/generated/     构建生成，不手动编辑
public/assets/        前端脚本和静态资源
tools/                生成、校验、feed、changelog、收尾脚本
tests/                Vitest 测试
.github/workflows/    GitHub Actions
```

`src/generated/`、`public/generated/`、`dist/`、`node_modules/` 不提交。

## 许可证

MIT。
