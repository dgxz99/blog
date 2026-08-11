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
