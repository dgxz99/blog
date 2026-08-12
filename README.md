# blog

基于 [AstroPaper](https://github.com/satnaing/astro-paper) 搭建的个人博客，使用 Astro、TypeScript、Tailwind CSS 和 pnpm。

## 环境要求

- Node.js >= 22.12.0
- pnpm 10.33.0

## 本地开发

```bash
pnpm install
pnpm dev
```

开发服务器默认运行在 <http://localhost:4321>。

## 常用命令

```bash
pnpm dev          # 启动开发服务器
pnpm build        # 类型检查并构建生产版本
pnpm preview      # 本地预览生产版本
pnpm lint         # 检查代码规范
pnpm format:check # 检查代码格式
pnpm format       # 格式化代码
```

## 目录说明

- `src/content/posts/`：博客文章
- `src/content/pages/`：独立页面内容
- `public/`：静态资源
- `astro-paper.config.ts`：站点及功能配置

## 构建产物

执行 `pnpm build` 后，生产文件生成在 `dist/` 目录。

## 创建文章

推荐使用命令创建文章，脚本会自动生成 12 位时间短 ID、发布时间和全局递增的本地编号：

```bash
pnpm new:post "文章标题"
```

默认生成 `src/content/posts/NNN.md`。也可以指定用于本地管理的目录：

```bash
pnpm new:post "文章标题" --dir _linux
pnpm new:post "文章标题" --dir tutorials/astro
```

文章公开地址由目录和 Frontmatter 中的 `id` 组成：

- `_linux/001.md` → `/posts/<短 ID>/`
- `tutorials/astro/002.md` → `/posts/tutorials/astro/<短 ID>/`

以下划线开头的目录不会出现在公开地址中。文章发布后不要修改 `id`；文件名和本地目录可以调整，只要公开目录片段没有变化即可。

新文章默认以草稿状态创建。完成正文后，建议按以下顺序检查并发布：

1. 补全 `description`、`tags`，按需设置 `series`
2. 使用 `pnpm dev`预览文章、目录和图片
3. 将 `draft`改为`false`
4. 执行`pnpm format`和`pnpm build`
5. 确认无误后提交并推送

常用 Frontmatter 示例：

```yaml
---
id: 01N7R4P88YH9
title: 使用Astro搭建个人博客
description: 记录博客初始化、内容配置与发布流程
pubDatetime: 2026-08-12T14:30:00+08:00
modDatetime: 2026-08-13T09:00:00+08:00
featured: false
draft: false
series: Astro实践
tags:
  - Astro
  - 博客
---
```

字段含义、目录与URL规则、图片写法及完整写作流程见[写作指南](docs/writing-guide.md)。

## 提交规范

提交信息遵循 Conventional Commits，类型使用英文，描述使用中文：

```text
feat: 添加中文界面支持
fix: 修复文章分页问题
docs: 更新项目说明
chore: 调整构建配置
```

## 持续集成

推送到 `main` 分支或提交 Pull Request 时，GitHub Actions 会自动执行代码检查、格式检查和生产构建。

## 致谢与许可

本项目基于 MIT 许可的 [AstroPaper](https://github.com/satnaing/astro-paper) 修改，原项目版权信息见 [LICENSE](LICENSE)。
