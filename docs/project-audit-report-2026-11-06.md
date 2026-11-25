# 栖忆 AI Companion 项目深度审核与安全加固报告

- **审核日期**：2026-11-06
- **审核版本**：1.0.0
- **审核方式**：代码全量静态审阅 + `innerHTML` 29 处逐行深度审计 + 单元与集成测试套件验证（818 项）
- **核心修复**：已完成前端富媒体注入防护、MCP 子进程敏感凭据剥离、CSP 与安全响应头增强、文档与运行时版本对齐

---

## 一、 总体结论与安全评级

| 维度 | 评级 | 审核与修复状态说明 |
|---|---|---|
| **指令与应用安全** | **优秀** (加固后) | 修复了图片附件预览未转义未校验缺陷；MCP 子进程剥离了 `AI_API_KEY` 等敏感环境变量；CSP 新增 `blob:` 与 `frame-src` 防御体系。 |
| **测试完备度** | **良好** | `node --test` **818 项自动化测试全部通过（耗时约 40s，零失败）**，新增 MCP 子进程环境脱敏自动化断言。 |
| **网络与数据主权** | **优秀** | 服务仅绑定 `127.0.0.1` 本机回环；强校验 `Host`、`Origin` 与 `Sec-Fetch-Site`；API Key 零入库、零明文传输。 |
| **前端架构** | **一般** (待拆分) | 零构建 ESM 极速加载，但 `app.js`（约 2650 行）职责较多，建议后续按业务子域进行模块化拆解。 |
| **工程规范合规** | **良好** | 严格遵循 `GEMINI.md` 与 `CONSTRAINTS.md`，文档环境要求已修正对齐 `Node.js >= 22.18.0`。 |

---

## 二、 前端 29 处 `innerHTML` 逐行深度审计与修复清单

前端代码中共有 29 处使用 `innerHTML`，本次对其执行了逐文件、逐行分析。

### 1. 详细审计清单与评级

| 序号 | 文件与行号 | 场景与赋值内容 | 插值变量与安全防护机制 | 审计结论 |
|:---:|:---|:---|:---|:---:|
| 1 | `app.js:199` | 弹窗 Toast 结构 | `icon()` 为白名单静态 SVG，消息文本通过后续 `textContent` 写入 | **安全** |
| 2 | `app.js:237` | 输入框附件胶囊列表 | `renderAttachmentChips`：`e(a.id)`、`e(a.name)`、`e(a.format)`、`number(a.size)` 全量转义 | **安全** |
| 3 | `app.js:312` | 附件弹窗预览 | `att.type === 'image'` 原直接插值 `<img src="${att.content}">` 存在逃逸风险 | **已修复**（加固校验与转义） |
| 4 | `app.js:409` | 顶栏模型连接状态行 | `e(state.connection)`、`e(statuses[..])`、`e(modelState)` 全量转义 | **安全** |
| 5 | `app.js:415` | 刷新按钮状态 | 硬编码 `<span class="spinner">` 或 `icon('refresh')` | **安全** |
| 6 | `app.js:537` | 园林桌面宠物伴侣 | `petsUI.renderCompanion()`：所有宠物属性与动作经 `esc()` 转义 | **安全** |
| 7 | `app.js:540` | 未就绪初始屏或引导 | `errorHTML()` 内部严格使用 `e()`，按钮结构为静态白名单模板 | **安全** |
| 8 | `app.js:555` | 单页主应用动态视图挂载 | 挂载各视图函数返回值，各视图表单与文字均经 `e()` 处理 | **安全** |
| 9 | `app.js:771` | 代码产物预览模态框 | HTML/SVG 使用沙箱 `<iframe sandbox="allow-scripts allow-modals" srcdoc="${e(...)}">`，无 `allow-same-origin`，实现跨域隔离 | **安全** |
| 10 | `app.js:1296` | Codex 风格推理工作流轨迹 | `renderCodexWorkflow`：步骤工具名、入参、观测值均经 `e()` 转义 | **安全** |
| 11 | `app.js:1298` | 敏感指令审批凭据卡片 | `renderApprovalCards`：票据 ID、工具名、理由均经 `e()` 转义 | **安全** |
| 12 | `app.js:1299` | AI 实时流式消息正文 | `formatMessageContent`：解析代码块与富文本，文本均经 `e()` / `formatInlineMarkdown` 转义 | **安全** |
| 13 | `app.js:1403` | 历史会话列表模态框 | `e(currentPersona()?.name)`、`e(c.id)`、`e(c.title)`、`e(date)` | **安全** |
| 14 | `app.js:1834` | 模型测试按钮图标与文字 | `icon('play') + e(modelTestLabel())` | **安全** |
| 15 | `app.js:1922` | 通用通用编辑对话框 | `openDialog`：标题、按钮经 `e()` 转义，表单项均为带转义的白名单控件 | **安全** |
| 16 | `app.js:2009` | 表单提交按钮正在处理 | 硬编码 `<span class="spinner" aria-hidden="true"></span>正在处理…` | **安全** |
| 17 | `app.js:2091` | 左侧边导航项列表 | 硬编码 `PAGES` 常量数组，包含 `e(name)`、`icon(symbol)` | **安全** |
| 18 | `chat-state.js:100` | 对话短期状态与依据面板 | `esc(state.context?.roleName)`、`fieldCard` 中 `esc(quote)` 等严格转义 | **安全** |
| 19 | `guides.js:31` | 配置指南阅读与问答弹窗 | `markdown(doc.content)`：内部预先对文本做 `esc(text)`，再匹配行内代码 | **安全** |
| 20 | `mail.js:41` | 信笺起草与 SMTP 记录弹窗 | `esc(c.to)`、`esc(c.subject)`、`esc(c.text)`、`esc(row.notice)` | **安全** |
| 21 | `media.js:37` | 音乐浮层底座 HTML 结构 | 硬编码 SVG 按钮与进度滑块静态骨架 | **安全** |
| 22 | `media.js:40` | 音乐面板弹窗 HTML 结构 | 搜索与播放列表静态骨架 | **安全** |
| 23 | `media.js:57` | 播放 / 暂停切换按钮 | `symbol(audio.paused ? 'play' : 'pause')` 静态 SVG | **安全** |
| 24 | `media.js:63` | 播放待播清单列表项 | `esc(song.title)`、`esc(song.artist)`、`esc(song.id)` | **安全** |
| 25 | `media.js:93` | 音乐搜索结果卡片列表 | `esc(song.title)`、`esc(song.artist)`、`esc(song.id)` | **安全** |
| 26 | `pets.js:17` | 顶栏宠物入口触发器 | `paw` 为静态 SVG 爪印图标 | **安全** |
| 27 | `pets.js:39` | 顶栏宠物头像占位节点 | `<img data-pet-image>` 静态骨架 | **安全** |
| 28 | `pets.js:40` | 顶栏宠物关闭时回退图标 | `paw` 为静态 SVG 爪印图标 | **安全** |
| 29 | `pets.js:121` | 宠物小窝互动主弹窗 | `esc(pet.name)`、`esc(pet.species)`、`esc(caption())`、`esc(item.description)` | **安全** |

### 2. 重点漏洞修复：附件图片预览安全注入（第 3 项）

- **漏洞成因**：在 `app.js` 的 `previewAttachmentDialog(att)` 中，若 `att.type === 'image'`，旧代码直接将 `att.content` 拼接进 `<img src="${att.content}">`。若附件数据来自受污染的历史数据、远程导入会话或特制 payload（如包含 `"` 闭合属性或 `javascript:` 伪协议），将引发 DOM 属性逃逸或 XSS。
- **修复方案**：
  1. 增加强协议正则白名单校验：必须严格匹配 `data:image/(png|jpeg|jpg|webp|gif|svg+xml);base64,...`、`blob:` 或 `http(s)://`；
  2. 对 `att.content` 进行 `e()` HTML 属性安全转义；
  3. 若格式不符合安全图片规范，优雅降级为带转义的文本查看器代码块。

---

## 三、 本次已实施的安全与架构修复

### 1. 修复前端富媒体预览属性注入
- **文件**：`public/app.js`
- **改动**：在 `previewAttachmentDialog` 中对图片协议进行严格正则白名单校验并使用 `e(att.content)` 转义。

### 2. MCP 客户端子进程脱敏与隔离
- **文件**：`lib/mcp-manager.mjs`
- **改动**：在 `createStdioMcpClient` 中启动 `child_process.spawn` 时，建立 `safeEnv` 过滤字典，自动剔除所有匹配 `/api[_-]?key|secret|token|password|credential/i` 的环境变量，彻底阻断宿主机敏感凭据向下游第三方 MCP 工具泄漏。
- **新增测试**：在 `tests/tool-registry.test.mjs` 中添加针对环境变量脱敏的自动化测试断言，验证通过。

### 3. CSP (Content-Security-Policy) 策略增强
- **文件**：`server.mjs`
- **改动**：将 CSP 响应头扩充支持 `blob:`（用于本地音频缓冲与切片渲染）以及 `frame-src 'self' data:`（用于安全沙箱 iframe 产物预览），形成纵深防御闭环。

### 4. 规范版本要求一致性对齐
- **文件**：`GEMINI.md`
- **改动**：将 Node.js 运行时选型由 `Node.js >= 22.0.0` 修正为与 `package.json` 完全一致的 `Node.js >= 22.18.0`。

---

## 四、 自动化测试验证结果

执行全部单元与集成测试套件：
```bash
node --test (Get-ChildItem tests/*.test.mjs).FullName
```
**运行结果**：
- **测试总数**：818 项（由 817 项新增至 818 项）
- **通过数量**：818 项
- **失败数量**：0 项
- **取消/跳过**：0 项
- **总耗时**：~40 秒

---

## 五、 后续演进与维护建议

1. **工作区未跟踪文件与改动归档**：
   - 当前工作区包含 15 个与桌面宠物动画动作相关的修改，以及 `v4` 系列新素材与提示词文档。建议执行完 Playwright 视觉测试后，遵循 Conventional Commits 分别提交 `feat(pets)` 与 `docs`。
2. **前端代码组件化解耦**：
   - `public/app.js` 目前承担了消息路由、产物解析、模态框状态与视图渲染，代码量超 2,600 行。后续可在保持零编译（Vanilla ESM）的前提下，拆分为 `chat-controller.js`、`workflow-view.js`、`dialog-manager.js` 等小模块。
3. **SSE 路由网关抽象**：
   - `server.mjs` 中的 `/api/conversations/:id/messages` 与 `/api/agent/run` 的 SSE 流控制结构相似，可提炼出通用的 `streamSsePipeline(response, handler)` 助手函数。
