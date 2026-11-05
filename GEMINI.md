# 栖忆 (QiYi AI Companion) · 项目规范与架构治理手册
# GEMINI.md - Project Guidelines, Architecture & Engineering Constraints

> 本文件是栖忆 (QiYi AI Companion) 项目在与 Gemini / Antigravity 协同编程、后续迭代开发及工程维护时的核心上下文约束文件。所有代码改动、文档撰写、依赖引入及测试执行必须严格遵守本文件定义的规范与约束。

---

## 一、 项目概览与设计哲学

- **项目定位**：本地优先 (Local-First) 的单用户 AI 伴侣与智能个人工作台。集成了角色对话、多轮可解释推理循环 (ReAct)、指令安全审批、知识库精细检索、长短期记忆图谱、多媒体伴随与中国古典园林视觉系统。
- **本地优先与数据主权**：聊天记录、知识文档、人设、记忆与多媒体元数据持久化保存在本地 SQLite 数据库中。任何外部大模型仅充当无状态计算节点，严禁向外泄露本地数据库。
- **零构建原生前端 (Zero-Build Vanilla Architecture)**：前端采用原生 Modern JavaScript (ESM) + 原生 CSS Variables，不使用 Webpack/Vite/Babel/React/Vue 等重量级编译打包工具，浏览器直接加载，毫秒级冷启动。
- **原生极简后端**：基于 Node.js 原生内置库（`node:http`, `node:sqlite`, `node:crypto`, `node:fs` 等）开发，最小化第三方依赖，彻底规避 npm 供应链风险。

---

## 二、 常用命令与开发工作流

### 1. 服务运行
```bash
# 启动本地服务（默认端口 4317，后台调度器默认开启）
node server.mjs

# 自定义端口启动
PORT=8080 node server.mjs
```

### 2. 自动化测试
```bash
# 运行全部单元与集成测试（约 800+ 项测试，秒级完成）
node --test (Get-ChildItem tests/*.test.mjs).FullName

# 运行特定模块测试
node --test tests/agent-loop.test.mjs tests/instruction-inspector.test.mjs
node --test tests/tool-registry.test.mjs tests/http.test.mjs

# 运行 Playwright 浏览器端到端测试（多视口渲染、交互断言）
node ./node_modules/playwright/cli.js test tests/browser.spec.mjs
node ./node_modules/playwright/cli.js test tests/garden-browser.spec.mjs

# 运行真实用户全链路操作模拟测试套件（7 大核心用户旅程闭环）
node ./node_modules/playwright/cli.js test tests/user-journey-simulation.spec.mjs
```

### 3. Git 协同规范
- **开发前**：必须运行 `git status` 确保工作区纯净，了解分支状态。
- **开发中**：每完成一个独立模块或修复，必须先运行自动化测试验证。
- **提交时**：验证通过后立即提交，遵循 Conventional Commits 格式（如 `feat(...)`, `fix(...)`, `docs(...)` 等）。
- **同步**：开发完成并验证无误后，推送到远程仓库 `git push origin main`。

---

## 三、 技术选型与架构决策 (ADR)

### 1. 运行时与后端 (Node.js ESM)
- **选型**：`Node.js >= 22.0.0` (ESM 模块规范 `"type": "module"`，文件后缀 `.mjs`)。
- **依据**：Node.js 22 内置原生的 SQLite (`node:sqlite`)、`fetch`、`ReadableStream` 与加密库，免除了跨平台本地 C++ 二进制包编译问题。

### 2. 存储与状态引擎 (node:sqlite)
- **选型**：Node.js 原生内置 `node:sqlite`（嵌入式 SQLite 3，开启 WAL 模式与外键约束）。
- **依据**：极致轻量、零外部网络延迟、全事务 ACID 保障（`store.transaction(() => { ... })`）。
- **严格红线**：**严禁在 SQLite 数据表中明文持久化存储 API Key 等机密凭据**。API Key 仅能保存在受操作系统权限保护的独立文件（如 `data/model-key.local`）或作为内存临时凭据。

### 3. ReAct 多轮可解释推理循环引擎 (`lib/agent-loop.mjs`)
- **动态可调轮数 (0～100 轮)**：默认 20 轮。当配置为 `0` 时，系统自动跳过工具调用逻辑，直接单轮归纳回复。
- **5 次调用熔断机制 (5-Time Duplicate Breaker)**：对工具入参进行规范化哈希指纹追踪，连续 5 次发起相同调用的死循环将被立即熔断，强制要求模型根据已有信息收敛输出。
- **5 次失败阻断机制 (5-Time Failure Breaker)**：当外部工具发生网络故障或执行错误连续达 5 次时，立即阻断后续工具链尝试，保护系统资源。
- **透明可解释流**：每一轮步骤输出思考意图解释 (`explanation`)，通过 SSE 以 `thought_step` 实时同步给前端。

### 4. 指令安全检测与审批凭据 (`lib/instruction-inspector.mjs`)
- **静态安全评级**：将只读工具（计算器、知识检索、系统时间）标记为 `safe` 直接放行；高危破坏性工具（命令执行、写文件、删库、邮件外发）标记为 `sensitive` 或 `critical` 实施拦截。
- **防重放审批凭据**：高危指令签发 **64 位密码级随机 Token**、**10 分钟 TTL 时效**，并通过 `consume()` 实现**一次性原子消费**，杜绝重放风险。

### 5. 统一工具注册中心 (Skill) 与 MCP 客户端
- **内置 Skill**：
  - `calculator`：采用词法白名单 + 严格沙箱解析器 [`safeEvaluateMath`](file:///e:/tools/wangshen/ai-companion/lib/tool-registry.mjs#L1-L20)，完全防止代码注入与沙箱逃逸。
  - `knowledge_deep_search`：两段式知识库精细化检索。
  - `get_system_time`：系统时间标准化受控输出。
- **MCP (Model Context Protocol) 支持**：
  - 基于 stdio 管道的标准 JSON-RPC 2.0 MCP Client ([`lib/mcp-manager.mjs`](file:///e:/tools/wangshen/ai-companion/lib/mcp-manager.mjs))，支持协议初始化握手、`tools/list` 动态拉取与统一工具注册中心同步。

### 6. 前端视觉设计系统 (Classical Garden UI)
- **视觉风格**：中国古典园林视觉系统（春园/秋庭/夜雨三套主题），八角海棠泥金开光、朱漆棂条、松鹤梅三友纹理。
- **主题与色彩规范**：所有组件、弹窗、下拉卡片必须严格继承 CSS 变量（`var(--paper-card)`, `var(--ink)`, `var(--frame-accent)`, `var(--bamboo)` 等），严禁硬编码纯白（`#ffffff`）导致暗色夜雨模式下出现白底刺眼与文字冲突。
- **双轨组件机制**：自定义卡片下拉组件 (`.persona-picker-dropdown`) 在视觉上承载典雅国风排版；隐式可访问的原生控件 (`<select id="chat-persona" class="persona-native-select">`) 作为 DOM 底座并存，确保 Playwright 端到端测试与屏幕阅读器无障碍化。

---

## 四、 项目目录与文档结构

```
ai-companion/
├── GEMINI.md                  # 本规范与架构治理手册（最高约束标准）
├── CONSTRAINTS.md             # 架构决策与工程硬性约束速查
├── README.md                  # 项目对外说明文档
├── package.json               # 项目依赖与运行脚本
├── playwright.config.mjs      # Playwright 端到端浏览器测试配置
├── server.mjs                 # 主 HTTP/SSE 服务入口与路由网关
├── lib/                       # 核心业务逻辑与服务层（ESM）
│   ├── agent-loop.mjs         # ReAct 多轮推理循环引擎（含工具链与 Critic 反思闭环）
│   ├── chat-state.mjs         # 会话短期情感与意图状态机
│   ├── chat-stream.mjs        # 流式传输协议与可见正文解析
│   ├── instruction-inspector.mjs # 指令安全检测与审批凭据管理
│   ├── intent-critic.mjs      # 回答意图对齐与事实一致性独立审核器 (Intent Critic)
│   ├── knowledge.mjs          # 本地知识库分块、FTS5 全文索引与 RRF 混合向量检索
│   ├── mail.mjs               # 本地/SMTP 邮件收发与草稿引擎
│   ├── mcp-manager.mjs        # MCP JSON-RPC 2.0 客户端管理器
│   ├── media.mjs              # 音乐搜索播放与表情包资源管理
│   ├── memory.mjs             # 长期记忆衰减、图谱与召回
│   ├── model.mjs              # OpenAI 兼容大模型客户端协议适配（支持首包前退避重试与多模型路由）
│   ├── pets.mjs               # 桌面宠物伴侣交互与动作调度
│   ├── response-policy.mjs    # 伴侣回应策略与意图裁决
│   ├── scheduler.mjs          # 本地定时任务调度器（后台静默模式）
│   ├── semantic-answer.mjs    # 语义对话编排与知识图谱融合
│   ├── service.mjs            # 核心业务聚合 API 服务层
│   ├── store.mjs              # SQLite 数据库模型、PRAGMA user_version 迁移与事务底座
│   ├── tool-registry.mjs      # 统一 Skill/MCP 工具注册中心
│   └── turn-pipeline.mjs      # 统一对话回合管线（上下文构建、提示词组装、AgentLoop 编排与 Trace 记录）
├── public/                    # 前端原生静态资源（零编译）
│   ├── index.html             # 单页应用入口与 SVG 园林窗格图案定义
│   ├── app.js                 # 前端核心交互控制器与组件渲染
│   ├── styles.css             # 基础工作台布局与样式
│   ├── garden.css             # 中国古典园林色彩与视觉系统（核心）
│   ├── sse-protocol.js        # 前后端共享的 SSE 事件与阶段枚举协议契约
│   └── streaming.js           # 前端 SSE 流解析器
├── docs/                      # 架构评审、演进方案与工程复盘文档
│   ├── system-architecture-and-remediation-analysis-2026-11-02.md # 系统缺陷与深度修复架构分析
│   ├── vector-knowledge-base-analysis-2026-11-02.md               # 向量知识库选型与混合检索原理分析
│   ├── music-player-and-media-ui-guide.md                         # 媒体播放与浮层穿透工程避坑指南
│   └── ...                    # 领域特性与历史评审报告
├── tests/                     # 自动化测试套件
│   ├── *.test.mjs             # 单元与集成测试（node:test 执行，>800 用例）
│   ├── *.spec.mjs             # Playwright 浏览器端到端测试（桌面与移动端视口）
│   └── helpers.mjs            # 测试辅助函数与 Mock 桩
└── data/                      # 运行时本地数据目录（Git 忽略）
    ├── agent.sqlite           # SQLite 运行时数据库
    ├── model-key.local        # 本地加密隔离存储的 API Key（绝不入库）
    └── music-cache/           # 音乐媒体本地分片缓存
```

---

## 五、 开发规范与硬性约束（红线）

### 1. 安全与合规红线
1. **凭据零入库**：任何新增功能中，涉及 API Key、密码、Token 的字段，严禁写入 `agent.sqlite` 数据表。
2. **禁止裸代码执行**：严禁直接使用裸 `eval()`、`new Function(rawUserInput)` 执行不可信代码。数学表达式计算必须经过词法分析白名单过滤。
3. **外部输入屏障隔离**：用户导入的文档、外部检索的网页、历史记忆片段在组装进 Prompt 时，一律包裹在系统级指令边界标签内，并明确告知模型为不可信参考数据，防止 Prompt 注入攻击。
4. **敏感指令强审批**：凡涉及执行外部系统命令、覆写本地文件、删除持久化数据或向外发送邮件的工具调用，必须挂起并签发 Ticket，等待用户明确确认。

### 2. 状态并发与生命周期控制
1. **会话单并发互斥锁**：针对同一 `conversationId`，在模型生成期间必须上锁（`chatLocks.add(id)`），阻断并发重叠提问，生成完成或异常终止时必须在 `finally` 块释放。
2. **全链路取消信号传导**：所有的异步请求、流式传输、工具执行均必须向下透传 `AbortSignal`。客户端连接关闭时，服务端需立即触发 `abort()` 中断上游推理与模型计费。

### 3. API 与通信协议规范
- **REST 规范**：遵循语义化 HTTP 动词，统一响应结构；错误发生时必须返回标准化状态码（400/404/409/410/413/415/416/499/500/502）与统一 `{ error: string }` 结构。
- **SSE 帧规范**：流式推送事件名必须使用标准枚举：`status`, `reasoning`, `content`, `thought_step`, `approval_requested`, `tool_result`, `done`, `error`。

### 4. 前端交互与响应式准则
1. **多视口自适应**：核心页面必须完整通过 320px、390px（移动端）与 1024px、1280px、1366px（桌面端）视口测试。移动端输入框必须稳定固定在触手可及的底部，不得被侧边栏高度撑开导致全页双滚动条。
2. **浮层穿透防御**：原生 `<dialog>` 元素在关闭状态下禁止与 CSS `display: flex` 产生优先级冲突，避免形成不可见的幽灵拦截层。
3. **动效减弱适配**：必须完整支持 `@media (prefers-reduced-motion: reduce)`，在该模式下静默跳过开场动画并停止无休止的鱼池或游园动画，保持即刻可交互。

---

## 六、 真实用户全链路模拟测试方法论与测试产物清理规范

### 1. 真实用户操作模拟测试设计原则 (`tests/user-journey-simulation.spec.mjs`)
单纯的单元测试无法发现跨模块状态流转、SSE 事件过滤或 DOM 挂载时序导致的交互断裂。每次重大特性演进或架构重构后，必须从**真实用户的完整操作旅程**出发，在真实 Chromium 浏览器与完整 HTTP/SSE + SQLite 实例下验证以下 **7 大核心用户场景**：
1. **设置工作台与古典园林三主题切换**：覆盖 `01 模型连接`、`02 记忆设置`、`03 Agent 推理与指令安全`、`04 园林外观与主题` 四大分区，验证任意表单项（含 `criticEnabled`、`criticMaxRetries` 等）修改即时触发「有尚未保存的修改」脏状态提示，并校验 `春园`、`秋庭`、`夜雨` 切换后无硬编码 `#ffffff` 白底泄露。
2. **人设创建、双轨选择器与对话状态折叠面板**：验证新建角色自动同步至双轨角色选择器 (`#persona-picker-trigger`)，「当前状态」按钮 (`#toggle-chat-status`) 与抽屉 (`#chat-status-drawer`) 的 `aria-expanded` 显隐状态严格同步，状态编辑弹窗关闭后无遮挡。
3. **新会话剪贴板粘贴附件 + 多轮 ReAct 工具调用 + Critic 审核反思闭环**：模拟用户在尚未创建会话 ID（`new:${personaId}`）的新对话输入框中直接 `Ctrl+V` 粘贴文件，验证首条消息发送后附件不丢失并渲染 `.attachment-chip.is-message`；验证多轮工具执行与 Critic 打回重修轨迹实时写入并持久化至 `<details class="message-reasoning">`（思考过程），且 `/api/traces` 准确记录回合指标。
4. **流式生成中途点击“停止”与会话锁释放恢复**：验证流式输出期间点击「停止生成」能立即中断上游请求、保留输入框草稿，且后端 `chatLocks` 在 `finally` 中可靠释放，随后立即重发消息不会触发 `409 Conflict`。
5. **知识库 FTS5 + 混合向量检索、记忆三元组与定时任务后台运行**：验证 Markdown 文档导入后中英文 FTS5 + 向量混合检索精准召回；验证定时任务「立即运行」在 `isBackgroundTask: true` 下自动跳过交互式工具与 Critic 审批，顺利生成执行记录。
6. **移动端极窄视口 (`320×568` / `390×844`) 自适应与闭合 `<dialog>` 零穿透**：验证页面无横向滚动条、底部输入区稳固锚定，且所有 `dialog:not([open])` 均为 `display: none`。
7. **严格模式敏感指令实时审批卡片交互闭环**：验证开启 `strict` 模式或调用敏感指令时，SSE 推送 `approval_requested` 并在后端通过 `inspector.waitForDecision` 挂起等待，前端 `#live-reply` 实时弹出 `.approval-ticket-card`（「允许执行 / 拒绝执行」），点击后调用 `/api/chat/approve` 放行并完成最终回复。

### 2. 附件与上下文隔离准则
- **新会话草稿与附件同步迁移**：当用户在未创建会话（`state.conversationId === null`）时添加附件并发送首条消息，前端必须将 `state.attachments` 与 `state.drafts` 一并从 `new:${personaId}` 迁移至新创建的 `conversationId`。
- **图片附件与文本附件分离**：图片附件（`type === 'image'`）保留完整 Base64 供前端预览（不按 40,000 字符截断损坏），且严禁将图片 Base64 原文混入 `<user_attachment>` 文本标签塞入大模型上下文。
- **纯净提问与大附件检索解耦**：`guides.search`、`knowledge.search`、`memory.recall`、`responsePolicy.plan` 与 `media.prepare` 必须仅針對用户纯净提问 `queryText` 执行，严禁将高达数万字的附件正文直接传入检索与点歌意图判断器，防止附件内容中的词汇误触发点歌或配置指南。

### 3. 测试产物清理规范
每次执行完 Playwright 端到端测试或视觉回归测试后，必须清理测试运行生成的临时报告、截图与中间产物，保持工作区整洁：
- 清理目录：`test-reports/`、`test-results/`、`playwright-report/` 以及 `data/` 下非运行时必要的测试快照文件（如 `data/pet-scale-review/`、`data/pet-*.png`、`data/pet-cadence-profile.jsonl` 等）。
- **严禁误删用户运行时核心数据**：清理时必须保留 `data/agent.sqlite`（及其 `-wal`/`-shm`）、`data/model-key.local` 与 `data/music-cache/`。
