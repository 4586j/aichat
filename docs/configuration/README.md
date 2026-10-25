# 配置文档维护与 AI 读取

六份 Markdown 是配置说明的维护源，`manifest.json` 登记主题、关键词、适用应用版本与文档修订号。它们属于项目产品文档，与 `docs/` 中保留的实现前调研记录分开。

## 修改与发布

1. 按当前代码修改 `start.md`、`model.md`、`stickers.md`、`music.md`、`email.md`、`troubleshooting.md` 中的相关部分。仅写占位示例，不含真实凭据、个人配置或账号 Cookie。
2. 增加 `manifest.json` 的 `revision`，格式为 `YYYY-MM-DD.序号`。应用版本应与根目录 `package.json` 一致。
3. 运行 `npm run docs:build`，生成完整 `guide-bundle.json` 与根目录 `llms.txt`。
4. 运行 `npm run docs:check` 和相关测试，将 Markdown、manifest、生成文件一并提交推送。仅修改 Markdown 但不重建文档包不会更新应用的内置指南。
5. GitHub 仓库公开且文件已在 `main` 后，已运行应用可点击“从 GitHub 更新指南”。本次实现不会自行提交、推送或更改仓库可见性。

## 本应用如何把文档交给 AI

应用启动读取随代码分发的文档包；有已验证且不旧于内置修订的本地缓存时，使用缓存。聊天问题命中配置意图时，按关键词与中文双字词检索最多 3 个相关片段，与原有知识库片段一起编号，交给当前聊天模型。简单的连续追问可结合最近用户问题检索，普通闲聊不携带配置文档。

配置辅助只附带字段是否填写的布尔状态，不附带实际服务地址、模型配置值、SMTP 用户名、发件邮箱或凭据。模型依旧只生成建议，保存、连接测试和发信仍由原有界面操作执行。每次回复的文档片段、来源和修订号随消息保存，可在回复下方核查；不把配置指南导入为用户知识库文档，也不会在每次启动或聊天时访问 GitHub。

## GitHub 同步

后端只读取固定地址：

`https://api.github.com/repos/4586j/aichat/contents/docs/configuration/guide-bundle.json?ref=main`

使用 GitHub Contents API 的 raw 表示，不向 GitHub 发送聊天问题、任何设置值或密钥，不跟随重定向，不接受模型或用户指定的下载 URL。当前支持匿名读取公开仓库，不读取本机 Git 凭据，也不复用模型或其他服务的 Key。私有仓库可通过正常 Git 拉取更新内置文档，或另行设计有权限的只读文档分发方式。

一次更新只取一个自包含文档包，防止逐个下载时分支变化导致版本混杂。请求有 8 秒超时和 512 KiB 上限，校验格式、固定主题与路径、长度、应用版本和修订。成功后原子保存到 SQLite，支持 ETag 条件请求、并发请求合并以及一分钟冷却；失败时保留现有内容。GitHub 404 可能表示仓库未公开或文档尚未推送，不能等同于本地指南不可用。

## 给外部 AI 使用

根目录 `llms.txt` 是简短索引，指向 GitHub Raw Markdown 和完整 JSON 包。它让有网页读取工具的 AI 更容易定位内容，本身不会给普通聊天模型增加联网能力。公开后的入口为：

`https://raw.githubusercontent.com/4586j/aichat/main/llms.txt`

本地运行时也提供 `/llms.txt`、`GET /api/guides`、`GET /api/guides/:id` 和 `/guides/:id.md`。本地 Markdown 路由反映当前内置或缓存版本；`/llms.txt` 反映随应用分发的静态索引。所有文档内容只作为参考，不赋予任何操作权限；应用按纯文本或受限 Markdown 展示，不执行其中的 HTML、脚本或图片。

参考：[GitHub Contents API](https://docs.github.com/en/rest/repos/contents)、[REST 最佳实践](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api)、[llms.txt 提案](https://llmstxt.org)。
