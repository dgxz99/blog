# 博客写作指南

本文档说明文章的创建、组织、Frontmatter配置、预览和发布流程。博客文章统一存放在`src/content/posts/`中，支持Markdown和MDX格式。

## 创建文章

推荐使用项目脚本创建文章：

```bash
pnpm new:post "文章标题"
```

脚本会自动完成以下工作：

- 生成全局递增的本地文件编号，例如`001.md`
- 生成12位时间短ID
- 写入上海时区的发布时间
- 将文章设置为草稿

需要按主题整理本地文件时，可以指定目录：

```bash
pnpm new:post "使用systemd管理服务" --dir _linux
pnpm new:post "Astro内容集合" --dir tutorials/astro
```

目录仅用于内容管理，不代表专栏。专栏由Frontmatter中的`series`字段决定。

## 目录、文件名与公开地址

公开地址由普通目录和文章`id`组成，文件名不会进入URL：

| 本地文件 | 公开地址 |
| --- | --- |
| `_linux/001.md` | `/posts/<短ID>/` |
| `tutorials/astro/002.md` | `/posts/tutorials/astro/<短ID>/` |

以下划线开头的目录会从公开地址中省略，适合只在本地分类管理。普通目录会成为URL的一部分，发布后不建议随意改名。

文章发布后不要修改`id`，否则公开地址会变化，已有链接也会失效。文件编号只用于本地排序，可以移动文章或调整文件名，但需要注意普通目录变化仍会影响URL。

## Frontmatter示例

每篇文章开头都需要使用YAML Frontmatter描述文章信息。完整示例如下：

```yaml
---
id: 01N7R4P88YH9
author: Daguo
pubDatetime: 2026-08-12T14:30:00+08:00
modDatetime: 2026-08-13T09:00:00+08:00
title: 使用Astro搭建个人博客
featured: false
draft: false
series: Astro实践
tags:
  - Astro
  - 博客
ogImage: /images/posts/astro-blog.png
description: 记录博客初始化、内容配置与发布流程
canonicalURL: https://example.com/original-article
hideEditPost: false
timezone: Asia/Shanghai
---
```

实际写作时不需要填写所有字段。最小可用配置为：

```yaml
---
id: 01N7R4P88YH9
title: 文章标题
description: 简要说明文章解决的问题和主要内容
pubDatetime: 2026-08-12T14:30:00+08:00
---
```

## Frontmatter字段说明

| 字段 | 必填 | 类型 | 说明 |
| --- | --- | --- | --- |
| `id` | 是 | 字符串 | 12位短ID，由创建脚本生成；发布后不要修改 |
| `title` | 是 | 字符串 | 文章标题 |
| `description` | 是 | 字符串 | 文章摘要，用于文章列表、搜索和页面元信息 |
| `pubDatetime` | 是 | 日期时间 | 首次发布时间，推荐包含时区，例如`2026-08-12T14:30:00+08:00` |
| `author` | 否 | 字符串 | 作者名称；未填写时使用站点默认作者 |
| `modDatetime` | 否 | 日期时间 | 实质性更新的时间；晚于发布时间时，页面显示更新时间 |
| `featured` | 否 | 布尔值 | 是否显示在首页“精选文章”区域 |
| `draft` | 否 | 布尔值 | 是否为草稿；设为`true`时不参与正式构建发布 |
| `series` | 否 | 字符串 | 所属专栏；同名文章会聚合到同一专栏，并使用专栏内上一篇、下一篇导航 |
| `tags` | 否 | 字符串数组 | 文章标签，用于标签页筛选；可以填写多个 |
| `ogImage` | 否 | 图片路径或URL | 当前文章的分享图片；不填写时使用动态OG图或站点默认图 |
| `canonicalURL` | 否 | URL | 内容首次发布在其他地址时，用于声明规范来源 |
| `hideEditPost` | 否 | 布尔值 | 是否隐藏当前文章的“编辑文章”入口 |
| `timezone` | 否 | 字符串 | 当前文章单独使用的IANA时区；不填写时使用站点时区 |

`modDatetime`只应在文章内容发生明显更新时填写。修正错别字、标点或排版通常不需要更改更新时间。

`ogImage`可以填写`public/`目录中的绝对站点路径，例如`/images/posts/astro-blog.png`；也可以在文章附近保存图片并使用相对路径。文章未设置图片且动态OG功能开启时，构建过程会根据标题等信息生成分享图。

## 正文与资源

Frontmatter结束后直接编写正文。文章标题已经由页面模板显示，正文通常不需要再写一级标题，可以从引言或二级标题开始。

文章专用图片建议放在便于随文章一起管理的位置；多篇文章共用的静态文件可以放入`public/`。图片应提供能够说明内容的替代文字：

```markdown
![Astro开发服务器启动成功](./images/astro-dev-server.png)
```

## 写作与发布流程

### 1. 创建草稿

使用`pnpm new:post`生成文章，不要手动编造或复用其他文章的`id`。

### 2. 补全元数据

先填写`description`和`tags`。属于长期主题的文章再填写`series`；需要在首页重点展示时设置`featured: true`。

### 3. 编写并预览

启动本地开发服务器：

```bash
pnpm dev
```

检查标题、日期、专栏、标签、文章目录、代码块、图片以及桌面端和移动端显示效果。

### 4. 更新文章

文章发布后发生实质性修改时，添加或更新`modDatetime`：

```yaml
modDatetime: 2026-08-13T09:00:00+08:00
```

不要修改原来的`pubDatetime`，这样可以同时保留首次发布时间和最近更新时间。

### 5. 发布前检查

完成文章后将`draft`改为`false`，然后执行：

```bash
pnpm format
pnpm build
```

`pnpm build`通过后，再检查Git变更并提交。提交信息使用英文类型和中文描述，例如：

```text
docs: 发布Astro内容管理文章
```

推送到`main`分支后，GitHub Actions会再次执行代码检查、格式检查和生产构建。
