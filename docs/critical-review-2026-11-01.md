# 栖忆 (QiYi AI Companion) 深度架构与工程批判性复查报告

> **复查日期**：2026-11-01  
> **复查基准**：全量源码（`server.mjs`、`lib/*.mjs`、`public/*.js`、`public/*.css`）、测试集及 `docs/` 目录下全部设计与问题归档（含 [semantic-intent-issues.md](file:///e:/tools/wangshen/ai-companion/docs/semantic-intent-issues.md)、[semantic-intent-design.md](file:///e:/tools/wangshen/ai-companion/docs/semantic-intent-design.md)、[troubleshooting.md](file:///e:/tools/wangshen/ai-companion/docs/configuration/troubleshooting.md)、[project-review-2026-10-31.md](file:///e:/tools/wangshen/ai-companion/docs/project-review-2026-10-31.md) 及 [semantic-acceptance-final-audit.json](file:///e:/tools/wangshen/ai-companion/test-reports/semantic-acceptance-final-audit.json)）。  
> **复查视角**：跳出常规代码规范检查，以**系统工程确定性、分布式契约严谨度、实时交互体验（TTFT/流式帧率）、人机认知负荷**四个最严苛的维度进行批判性审视。

---

## 一、 病灶总论：从 `docs/` 错误文档看项目的三大底层悖论

仔细研读 [semantic-intent-issues.md](file:///e:/tools/wangshen/ai-companion/docs/semantic-intent-issues.md) 与 [semantic-intent-design.md](file:///e:/tools/wangshen/ai-companion/docs/semantic-intent-design.md) 可以发现一个极其耐人寻味的工程现象：团队为了解决关键词正则误判，耗费巨大精力引入了“两阶段大模型语义意图架构（`semantic` 模式）”，但历经五轮真实模型压测后，最终在 [response-policy.mjs](file:///e:/tools/wangshen/ai-companion/lib/response-policy.mjs#L11) 与 [semantic-acceptance-final-audit.json](file:///e:/tools/wangshen/ai-companion/test-reports/semantic-acceptance-final-audit.json#L3-L4) 中不得不将 `defaultIntentMode` 锁定回 `'legacy'`（`allAccepted: false`）。

为什么一个为了“更聪明”而设计的架构，最终在真实模型验收中频频遭遇**3200 Tokens 预算耗尽、`<qiyi-media>` 标签复读死循环、连续换表情遗漏、知识库引用漏标、“不吃辣”却推荐“白胡椒猪肚鸡/微辣口味”**？

因为当前系统陷入了三个深层的**架构哲学悖论**：

1. **悖论一：“将概率性生成模型当作确定性编译器”（Prompt-as-Compiler Fallacy）**  
   在 `semantic` 模式的第二阶段（[`generateSemanticAnswer`](file:///e:/tools/wangshen/ai-companion/lib/semantic-answer.mjs#L42-L96)），系统强行要求单次 LLM 调用同时完成 **7 项正交的高复杂度任务**：① 扮演特定人格与文风；② 遵循知识库/指南/记忆片段并精确按段落标注 `sourceIds`；③ 严格执行用户的饮食/禁忌硬约束（如排除辣椒、花椒、胡椒、咖喱、芥末等衍生食材）；④ 评估音乐搜索结果并选择 `musicId`；⑤ 匹配情绪与画面选择 `stickerId`；⑥ 预测用户与角色的 5 个心理状态维度并摘录**一字不差的原文引文（quote）**；⑦ 将上述一切序列化为严丝合缝的嵌套 JSON Schema 或双尾注 XML 协议标签。  
   **批判结论**：当单次生成同时背负“高创意角色扮演”与“高严密协议编译+多维检索对齐+百科级食材排他推理”时，模型的注意力机制必然在多目标博弈中发生**注意力稀释（Attention Dilution）**。只要模型在末尾协议标签上稍有犹豫（或因 `temperature: 0.7` 产生格式漂移），就会触发 [semantic-intent-issues.md](file:///e:/tools/wangshen/ai-companion/docs/semantic-intent-issues.md#L12-L20) 记录的尾注自我修正死循环，或顾此失彼地漏掉表情、漏标引用、放宽“不吃辣”边界。

2. **悖论二：“通用 OpenAI 兼容承诺”与“单一供应商特定模型深度过拟合”的撕裂**  
   项目对外宣称支持任意 OpenAI 兼容接口（见 [troubleshooting.md](file:///e:/tools/wangshen/ai-companion/docs/configuration/troubleshooting.md#L21-L30)），但在核心代码中，[`intentModelOptions`](file:///e:/tools/wangshen/ai-companion/lib/turn-intent.mjs#L129-L138) 与 [`structured`](file:///e:/tools/wangshen/ai-companion/lib/semantic-answer.mjs#L52-L53) 却写了极其刺眼的硬编码：
   ```js
   url.hostname.endsWith('.volces.com') && settings.model === 'ark-code-latest'
   ```
   整个语义模式的结构化 JSON Schema 输出（`responseFormat: 'json_schema'`）与 `thinking: { type: 'disabled' }` **仅对火山方舟的 `ark-code-latest` 生效**！任何接入 OpenAI 官方、DeepSeek、Claude 转发或本地 Ollama/vLLM 的用户，一旦开启 `semantic` 模式，不仅享受不到 JSON Schema 的结构化兜底，反而会退化到脆弱的 `<qiyi-media>` 尾注正则剥离模式，同时还要白白承受每轮对话 **2 次串行大模型调用** 的延迟与 Token 账单。

3. **悖论三：“古典造园极繁主义表象”与“全量 DOM 推土机内核”的撕裂**  
   前端在视觉层堆砌了故宫藻井、掐丝珐琅宫灯、描金海棠开光、五幕 9.2 秒开屏动画等极度繁复的装饰；但在工程状态层，却采用最原始的 `main.innerHTML = ...` 全量字符串覆写，甚至连每次发送消息、切换开关都要通过 `GET /api/bootstrap` 把整个数据库的所有会话、文档、记忆及知识图谱装饰数据全量拉回前端重绘。

---

## 二、 架构设计批判（Architecture Design）

### 2.1 双轨制架构割裂与“状态机精神分裂”（Dual-Brain Split）

当前代码库中同时寄生着两套截然不同、却又在底层数据库表上互相踩踏的对话管线：
- **Legacy 管线**：走 [`responsePolicy.plan`](file:///e:/tools/wangshen/ai-companion/lib/response-policy.mjs#L219-L263) $\rightarrow$ [`media.prepare`](file:///e:/tools/wangshen/ai-companion/lib/media.mjs#L254-L321) $\rightarrow$ [`chatState.beforeTurn`](file:///e:/tools/wangshen/ai-companion/lib/chat-state.mjs#L204-L221) $\rightarrow$ 单次 `model.stream` + [`createChatStreamFilter`](file:///e:/tools/wangshen/ai-companion/lib/chat-stream.mjs#L14-L53)。状态存储在 `conversation_response` 与 `conversation_chat_state` 表中。
- **Semantic 管线**：走 [`analyzeTurn`](file:///e:/tools/wangshen/ai-companion/lib/turn-intent.mjs#L151-L163) $\rightarrow$ [`buildRetrievalPlan`](file:///e:/tools/wangshen/ai-companion/lib/retrieval-plan.mjs#L13-L35) $\rightarrow$ [`media.prepareForIntent`](file:///e:/tools/wangshen/ai-companion/lib/media.mjs#L322-L361) $\rightarrow$ [`generateSemanticAnswer`](file:///e:/tools/wangshen/ai-companion/lib/semantic-answer.mjs#L42-L96)。状态另起炉灶存储在 `conversation_intent_state` 表中。

**严苛批判**：
1. **双源真相污染（Dual Source of Truth）**：音乐静音状态（`musicMuted`）同时存在于 `conversation_response.musicMuted` 列与 `conversation_intent_state.value` 的 JSON 字符串中。以至于 [`responsePolicy.unmute`](file:///e:/tools/wangshen/ai-companion/lib/response-policy.mjs#L199-L205) 必须写出跨模块钻入对方私有表修改 JSON 字段的胶水代码：
   ```js
   const intentRow = store.get('SELECT value FROM conversation_intent_state WHERE conversationId=?', conversationId);
   if (intentRow) store.run('UPDATE conversation_intent_state SET value=? WHERE conversationId=?', JSON.stringify({ ...JSON.parse(intentRow.value), musicMuted: false }), conversationId);
   ```
   而反向路径上，当 `semantic` 模式在 [`saveTurnState`](file:///e:/tools/wangshen/ai-companion/lib/turn-context.mjs#L121-L135) 中因 `intent.music.action === 'reject'` 将 `musicMuted` 设为 `true` 时，**根本没有同步更新 `conversation_response` 表**！这意味着如果用户在 `semantic` 模式下说“别放歌了”，随后切回 `legacy` 模式，静音状态会瞬间失效；前端顶部的静音横幅（依赖 `responsePolicy.session` 读取 `conversation_response` 表，见 [`service.mjs`](file:///e:/tools/wangshen/ai-companion/lib/service.mjs#L220)）在 `semantic` 模式下甚至**永远不会显示静音状态**！
2. **启发式补丁迷宫**：为了掩盖第一阶段意图模型（`analyzeTurn`）在 `current` 与 `history` 归属判断上的摇摆，[`turn-intent.mjs`](file:///e:/tools/wangshen/ai-companion/lib/turn-intent.mjs#L18-L45) 与 [`turn-context.mjs`](file:///e:/tools/wangshen/ai-companion/lib/turn-context.mjs#L7-L95) 编写了极其晦涩的补丁逻辑（`guessedCurrent`、`adjacentCurrent`、`bothActive`、`distinctEvidence`、`hasHistoryCue`）。用百余行确定性正则与字面量比对去猜测和篡改 LLM 的结构化输出，实质上是回到了 `legacy` 正则的老路，却套着 `semantic` 的外壳。

### 2.2 事务边界倒置：长达 165 秒的“用户消息无落库真空期”

审视 [`service.mjs`](file:///e:/tools/wangshen/ai-companion/lib/service.mjs#L67-L185) 与 [`semanticSendMessage`](file:///e:/tools/wangshen/ai-companion/lib/service.mjs#L230-L289) 的持久化生命周期：
- 用户发送消息后，系统**并未立即将 `user` 消息写入 `messages` 表**。
- 系统先执行意图分析（最长 75 秒超时）、知识与指南检索、外部音乐与远端表情包网络请求（最长 6 秒）、再执行主模型流式生成（最长 90 秒超时）。
- 直到 [`service.mjs`](file:///e:/tools/wangshen/ai-companion/lib/service.mjs#L313-L320) 整轮 AI 响应 100% 完成，才开启 `store.transaction` 一次性插入 `user` 消息与 `assistant` 消息！

**严苛批判**：
- **数据丢失隐患**：如果主模型在第 80 秒发生网络抖动、上游 502，或者用户在流式输出到一半时点击“停止生成”并刷新页面，**用户刚刚苦心输入的数百字提问以及已经流式吐出的半截 AI 回复在服务端数据库中片甲不留**。
- **正确的消息架构**：进入会话锁后，应当在首个独立事务中立即落库 `user` 消息（分配确定性 `messageId`），并创建状态为 `streaming` 的 `assistant` 占位消息；流式正常结束、取消或异常中断时，分别将其状态推进为 `completed`、`cancelled`（保留已生成片段）或 `failed`（支持原地重试而无需重新上传用户消息）。

### 2.3 单线程同步阻塞链与伪并发原语

项目完全运行在单个 Node.js 主线程上，却在热路径上密集混用了三大阻塞源：
1. **同步子进程劫持事件循环**：[`readUserEnvironmentKey`](file:///e:/tools/wangshen/ai-companion/lib/local-model-key.mjs#L6-L15) 在每次读取 API Key 时（包括 [`bootstrap`](file:///e:/tools/wangshen/ai-companion/lib/service.mjs#L219) 調用 `model.publicSettings()`、每次测试连接、每次发送消息），只要进程环境变量未命中，就会同步调用 `spawnSync('powershell.exe', ..., { timeout: 15000 })`。在 Windows 冷启动或杀毒软件扫描 PowerShell 时，整个 HTTP 服务器、SSE 流心跳和前端静态资源加载都会瞬间卡死数秒至 15 秒。
2. **SQLite 全表扫描 + JS 内存分词排序 + N+1 查询**：
   - [`knowledge.search`](file:///e:/tools/wangshen/ai-companion/lib/knowledge.mjs#L118-L133) 每次查询执行 `SELECT * FROM chunks` 将所有文档切片全量读入 V8 堆内存再做 bigram 匹配。
   - [`memory.list`](file:///e:/tools/wangshen/ai-companion/lib/memory.mjs#L86-L88) 对每一条记忆调用 [`graph.decorate`](file:///e:/tools/wangshen/ai-companion/lib/graph.mjs#L105-L120)，而 `graph.decorate` 内部对每条记忆的每个三元组循环执行 `SELECT * FROM memory_entities WHERE name = ?` 与 `SELECT * FROM memory_relations WHERE ...`，构成典型的 **O(M × T) N+1 查询风暴**。
   - [`chatState.view`](file:///e:/tools/wangshen/ai-companion/lib/chat-state.mjs#L194-L202) 中的 `familiarity()` 每次都要全表拉取该会话所有历史 `user` 消息并在内存里重新正则分词计算累加分值。

---

## 三、 接口规范批判（API Specification）

### 3.1 `GET /api/bootstrap` 巨石接口反模式（Omnibus God-Endpoint）

查看 [`service.mjs`](file:///e:/tools/wangshen/ai-companion/lib/service.mjs#L206-L228) 与 [`app.js`](file:///e:/tools/wangshen/ai-companion/public/app.js#L168-L185)：
`GET /api/bootstrap` 在单次响应中打包了：所有角色、所有会话、当前会话全量消息、所有知识文档元数据、**全量记忆及其 N+1 图谱实体/关系装饰数据**、所有定时任务、最近 100 条任务运行日志、最近 100 条邮件历史、全部本地与内置表情包列表、宠物状态与配置指南目录。

更致命的是前端 [`app.js`](file:///e:/tools/wangshen/ai-companion/public/app.js) 对它的滥用：
- 每发完一条聊天消息，调用 `await refreshData()` 全量拉取一次 `bootstrap`（[`app.js:530`](file:///e:/tools/wangshen/ai-companion/public/app.js#L530)）；
- 每切换一次会话、置顶/归档一条记忆、开关一个定时任务、保存一个弹窗，全部调用 `await refreshData()` 全量拉取 `bootstrap`；
- 甚至在后台挂载了 `setInterval(() => refreshData(..., { silent: true }), 60000)`（[`app.js:1151`](file:///e:/tools/wangshen/ai-companion/public/app.js#L1151)）每 60 秒全量拉取一次！

**严苛批判**：这是典型的“把全库 Dump 当作状态同步机制”。随着记忆条目、文档与会话增长，`bootstrap` 响应体积与服务端 SQLite N+1 耗时呈线性乃至超线性膨胀。资源应当按领域拆分为按需分页/增量接口（如 `/api/conversations/:id`、`/api/memories?cursor=...`、`/api/tasks`），写操作直接利用返回的局部增量状态更新前端 Store，彻底废除写后全量重拉 `bootstrap`。

### 3.2 违背 HTTP RFC 9110 语义的动词与请求体契约

1. **`DELETE` 请求强制要求 `application/json` 请求体**：  
   在 [`server.mjs`](file:///e:/tools/wangshen/ai-companion/server.mjs#L206) 中：
   ```js
   const input = ['POST', 'PUT', 'DELETE'].includes(method) ? await readJson(request) : {};
   ```
   而 [`readJson`](file:///e:/tools/wangshen/ai-companion/server.mjs#L56-L65) 第一行就强制校验：
   ```js
   if (!String(request.headers['content-type'] || '').toLowerCase().includes('application/json'))
     throw new AppError('写入请求必须使用 application/json。', 415);
   ```
   这导致所有 `DELETE /api/documents/:id`、`DELETE /api/memories/:id`、`DELETE /api/media/stickers/:id` 只要像标准 HTTP 客户端那样不带 `Content-Type: application/json` 和 `{}` 空包体，就会直接被服务端以 **`415 Unsupported Media Type`** 拒绝！前端被迫在 [`app.js:154`](file:///e:/tools/wangshen/ai-companion/public/app.js#L154) 写出 `body !== undefined ? JSON.stringify(body) : undefined` 并在所有 `DELETE` 调用点硬传 `{}` 的畸形代码。
2. **读写动词与幂等性混乱**：
   - 纯只读的知识库检索接口 [`POST /api/knowledge/search`](file:///e:/tools/wangshen/ai-companion/server.mjs#L119) 使用 `POST`，而同为检索的 [`GET /api/music/search`](file:///e:/tools/wangshen/ai-companion/server.mjs#L126) 却使用 `GET`。
   - 状态局部更新在 [`POST /api/chat-state`](file:///e:/tools/wangshen/ai-companion/server.mjs#L117) 与 [`POST /api/response-policy/unmute`](file:///e:/tools/wangshen/ai-companion/server.mjs#L115) 中使用 `POST`，而在配置更新中全部使用 `PUT`，整个 API 体系完全没有引入 `PATCH` 语义。

### 3.3 Base64-in-JSON 二进制上传反模式与主线程内存放大

文档上传（[`POST /api/documents`](file:///e:/tools/wangshen/ai-companion/lib/knowledge.mjs#L86-L108)，上限 8 MiB）与表情包上传（[`POST /api/media/stickers`](file:///e:/tools/wangshen/ai-companion/lib/media.mjs#L143-L162)，上限 4 MiB）均采用将二进制文件编码为 Base64 字符串塞入 JSON 字段 `data` 的方式传输。

在服务端主线程上，一次 8 MiB PDF 上传会经历以下荒谬的内存拷贝链：
1. [`readJson`](file:///e:/tools/wangshen/ai-companion/server.mjs#L56-L64) 收集 `chunks` $\rightarrow$ `Buffer.concat(chunks)`（~11 MiB）$\rightarrow$ `.toString('utf8')`（~11 MiB V8 字符串）$\rightarrow$ `JSON.parse(raw)`（解析出 `input.data` 字符串 ~11 MiB）；
2. [`decodeDocument`](file:///e:/tools/wangshen/ai-companion/lib/knowledge.mjs#L89-L93) 执行 `Buffer.from(data, 'base64')`（8 MiB Buffer），随后为了校验 Base64 合法性，竟然执行了 **`buffer.toString('base64') !== data`**（在主线程上再重新把 8 MiB 二进制编码回 11 MiB Base64 字符串做全等比较！）；
3. 紧接着 [`extractTextInWorker`](file:///e:/tools/wangshen/ai-companion/lib/knowledge.mjs#L67-L78) 将 `buffer` 传入 `workerData: { buffer }`（未使用 `transferList` 转移 `ArrayBuffer` 所有权，触发主线程到 Worker 线程的又一次 8 MiB 克隆），且 Worker 内部 [`document-worker.mjs:51`](file:///e:/tools/wangshen/ai-companion/lib/document-worker.mjs#L51) 与 [`62`](file:///e:/tools/wangshen/ai-companion/lib/document-worker.mjs#L62) 再次复制 `Buffer.from(workerData.buffer)`！

**严苛批判**：上传一个 8 MiB 的文件，瞬间在单进程内存中制造了 **超过 50 MiB 的同步内存分配与字符串编解码峰值**。二进制上传应当走原生 `multipart/form-data` 或 `application/octet-stream` 流式管道，且传入 Worker 时必须使用 `transferList` 零拷贝移交 `ArrayBuffer`。

### 3.4 错误状态码坍缩与非流式取消契约缺失

- **502 状态码泛滥成灾**：无论是上游模型 401 Key 错误、429 限流、网络超时，还是模型返回的 JSON 不符合 [`turn-intent.mjs`](file:///e:/tools/wangshen/ai-companion/lib/turn-intent.mjs#L156) 的预期格式，乃至 GitHub 指南同步被限流（[`guides.mjs:100`](file:///e:/tools/wangshen/ai-companion/lib/guides.mjs#L100)），全部被笼统抛为 `HTTP 502`。前端无法通过结构化 `errorCode` 区分“用户配错了 API Key（应引导去设置页）”、“上游触发速率限制（应提示稍后重试）”还是“模型协议格式幻觉（可自动降级重试）”。
- **非 SSE 慢请求缺乏断连取消传播**：在 [`server.mjs`](file:///e:/tools/wangshen/ai-companion/server.mjs#L204-L231) 中，只有 `/messages/stream` 绑定了 `response.once('close', abort)` 将 `AbortSignal` 传给后端。而耗时同样高达 90 秒的 `POST /api/analyze`、`POST /api/memories/summarize`、`POST /api/graph/extract`、`POST /api/mail/draft` 以及非流式降级路径 `POST /api/conversations/:id/messages` **完全没有向 `model.complete` 传递请求级 `AbortSignal`**。一旦用户刷新或关闭页面，服务端依然在后台孤立地跑完大模型推理并直接修改数据库。

---

## 四、 响应机制与流式管线批判（Responsiveness & AI Pipeline）

### 4.1 结构化输出下的“伪流式 / 段落级卡顿”（Paragraph-Buffered Stuttering）

这是当前 `semantic` 模式在用户体验上最隐蔽却最致命的设计缺陷。
查看 [`semantic-output.mjs`](file:///e:/tools/wangshen/ai-companion/lib/semantic-output.mjs#L48-L61) 中的 `completedParagraphs` 与 [`createSemanticStreamParser`](file:///e:/tools/wangshen/ai-companion/lib/semantic-output.mjs#L130-L157)：
在结构化 JSON Schema 模式下，模型输出形如：
```json
{"paragraphs":[{"text":"第一段长达两百字的回复内容...","sourceIds":["knowledge:1"]}], ...}
```
由于每个段落对象末尾跟随着 `"sourceIds":[...]`，`completedParagraphs()` 必须等待模型把**整段话的所有文字连同 `sourceIds` 数组和闭合花括号 `}` 全部生成完毕**，才会解析出这一个段落并通过 `onDelta` 一次性吐给前端！

**严苛批判**：
- **流式体验退化为“分段蹦字”**：用户看到的不再是丝滑的逐字/逐词流式打字机效果，而是长达数秒的空白等待后，“啪”地一下整段弹出 150 字，再卡顿数秒，再弹出下一段。这彻底违背了 SSE 流式传输降低感知延迟（Perceived Latency）的核心初衷。
- **根治思路**：如果必须保留段落级引用，增量解析器应当在扫描 `"text":"` 字符串值内部时**实时向外流式吐出已反转义的字符增量（Character Delta）**，在该段落对象 `}` 闭合时再单独下发一个 `event: paragraph_meta`（携带该段的 `sourceIds`），而不是扣押整段文本直到段落闭合！

### 4.2 双阶段串行调用对首字延迟（TTFT）的结构性恶化

在 `semantic` 模式下，哪怕用户只发了一句简单的日常寒暄（如“今天天气真好呀”），系统也必须串行经历：
1. **Stage 1 (`analyzeTurn`)**：携带长达数千字的 Schema 规则 Prompt、最近 8 条消息历史、上一轮媒体状态，发起一次完整的非流式 LLM 请求（实测耗时 3,000ms ~ 6,500ms，见 [semantic-acceptance-final-audit.json](file:///e:/tools/wangshen/ai-companion/test-reports/semantic-acceptance-final-audit.json#L26-L115)）；
2. **Stage 1.5 (检索与外部媒体)**：根据意图执行本地检索与远端音乐/表情 API 请求；
3. **Stage 2 (`generateSemanticAnswer`)**：再次发起第二次 LLM 请求，且若命中结构化模式，还需等待第一段 JSON 闭合才能吐出首屏文字。

**严苛批判**：将首字响应时间（TTFT）从单次调用的 `0.8s ~ 1.5s` 硬生生推高到 **`4.5s ~ 10s+`**。对于陪伴类 AI 产品而言，超过 3 秒的静默等待会严重破坏对话的临场感与情绪流动。对于明显不包含外部工具/媒体变动诉求的纯闲聊或简单问候，缺乏零延迟的轻量级 Fast-Path 旁路，或基于原生 Tool/Function Calling 的单次流式架构。

### 4.3 超时配置倒挂与软约束护栏缺失

1. **HTTP 超时与模型超时倒挂**：[`server.mjs:247`](file:///e:/tools/wangshen/ai-companion/server.mjs#L247) 显式设置了 `server.requestTimeout = 30000`（30 秒），而 [`turn-intent.mjs:154`](file:///e:/tools/wangshen/ai-companion/lib/turn-intent.mjs#L154) 将意图超时设为 `75000`（75 秒），[`model.mjs:174`](file:///e:/tools/wangshen/ai-companion/lib/model.mjs#L174) 将生成超时设为 `90000`（90 秒），前端 [`streaming.js:24`](file:///e:/tools/wangshen/ai-companion/public/streaming.js#L24) 又设有 45 秒帧间空闲超时。多层超时阈值缺乏统一协调预算，极易在慢速推理模型（Reasoning Models）思考期间发生非预期的连接截断。
2. **饮食/禁忌硬约束缺乏生成后校验（Post-Generation Guardrail）**：[semantic-intent-issues.md](file:///e:/tools/wangshen/ai-companion/docs/semantic-intent-issues.md#L45-L49) 记录了模型在“我不吃辣”约束下推荐“白胡椒猪肚鸡”或建议“微辣”的典型失误。当前代码试图在 [`semantic-prompt.mjs:21`](file:///e:/tools/wangshen/ai-companion/lib/semantic-prompt.mjs#L21) 的提示词里列举“不推荐辣椒、红油、麻辣、香辣、酸辣、微辣、泡椒、剁椒、藤椒、花椒、胡椒、黑胡椒、白胡椒、麻椒、咖喱、芥末、辣根、辣酱或辣汤底”。把枚举词表塞进 System Prompt 既浪费每次对话的常驻 Token，又无法阻止模型在长文本生成时发生注意力漂移。应当将此类领域硬约束外置为**确定性的轻量后置校验器（Output Guardrail）**，僅在检测到用户存在排除性约束且回复命中违禁词簇时触发局部重写或拦截。

---

## 五、 UI 设计与前端工程批判（UI Design & Frontend Engineering）

### 5.1 视觉美学错位与聊天视口“五重横幅”挤压

打开 [`index.html`](file:///e:/tools/wangshen/ai-companion/public/index.html) 与 [`garden.css`](file:///e:/tools/wangshen/ai-companion/public/garden.css)，项目在视觉包装上投入了惊人的笔墨：从“清宫一码三箭·三交六椀菱花”窗棂、“八角海棠泥金开光”、“剔红描金海水江崖纹”、“汉白玉仰覆莲望柱栏杆”，到长达 **9.2 秒的五幕开屏动画**（[`entrance.js:8`](file:///e:/tools/wangshen/ai-companion/public/entrance.js#L8)）。

**用最严苛的设计尺度审视，这套 UI 存在四大结构性硬伤**：

1. **核心对话视口被“五重顶部横幅”严重挤压**：  
   在 [`app.js`](file:///e:/tools/wangshen/ai-companion/public/app.js#L305-L420) 渲染的聊天主界面中，在用户看到第一条聊天消息之前，垂直方向从上到下依次堆叠了：
   - **第 1 层**：`.topbar`（品牌印章 + 搜索框 + 角色胶囊 + 指南按钮 + 写信按钮）
   - **第 2 层**：`.page-heading`（大号衬线标题 + 副标题 + 园林全景天际线 SVG 插画 `.heading-panorama`）
   - **第 3 层**：`.marble-balustrade-bar`（纯装饰性的汉白玉望柱栏杆通栏 SVG）
   - **第 4 层**：`.chat-toolbar`（角色切换下拉框 + 朱砂闲章“清赏” + 删除按钮）
   - **第 5 层**：`.chat-state-bar`（双行 6 指标关系/情绪/精力状态条 + 展开详情按钮）
   - **第 6 层**：`.garden-session-bar`（“回复联动：宠物 · 音乐 · 表情”提示条）+ 可选的 `.response-mute-banner`（静音状态横幅）  
   在常见的 13/14 寸笔记本屏幕（768px~900px 逻辑高度）上，**顶部装饰与状态横幅加上底部输入区，直接吞噬了超过 55% 的垂直视口高度**，留给核心聊天消息流的展示窗口逼仄不堪。
2. **美学语境冲突（清代皇家重工极繁 vs. 现代高频阅读留白）**：  
   产品的文案自述追求“江南园林、温润如玉、清雅陪伴”，但实际 CSS 实现却滑向了**高饱和朱砂漆红 + 高密度鎏金矢量纹样 + 多重内发光/投影的清宫重工风**。几乎每个 `.button`（[`garden.css:189-300`](file:///e:/tools/wangshen/ai-companion/public/garden.css#L189-L300)）都挂载了 `::before` 与 `::after` 两个伪元素，内嵌数千字节 URL 编码的复杂 SVG Data URI，并叠加 `clip-path: polygon(...)` 与多层 `drop-shadow`。这不仅造成视觉焦点涣散（装饰抢夺了文字内容的呼吸感），更在页面存在数十个按钮时制造了大量不必要的 GPU 合成层（`isolation: isolate` + `filter: drop-shadow`）。
3. **设置页“五合一万字长卷”信息架构失控**：  
   在 [`app.js:625`](file:///e:/tools/wangshen/ai-companion/public/app.js#L625) 中，切到“设置”页会一次性把 **模型接口设置 + 角色管理 + 回复联动设置 + 音乐/表情包图库管理 + 邮件 SMTP 设置 + 小窝宠物设置** 全部纵向拼接在同一个滚动容器里。全页同时出现 **6 个独立的 `<form>` 和 6 个独立的“保存”按钮**，且各模块各自维护独立的 `dirty` 状态，用户在长页面滚动修改极易遗漏点击某一个局部的保存按钮。
4. **无障碍（A11y）与动效克制缺失**：  
   [`styles.css`](file:///e:/tools/wangshen/ai-companion/public/styles.css) 与 [`garden.css`](file:///e:/tools/wangshen/ai-companion/public/garden.css) 均适配了 `@media (prefers-reduced-motion: reduce)`，唯独最剧烈、持续 9.2 秒、包含全屏缩放与强光晕呼吸的 [`entrance.css`](file:///e:/tools/wangshen/ai-companion/public/entrance.css) **完全漏掉了 `prefers-reduced-motion` 媒体查询**（尽管 [`entrance.js:23`](file:///e:/tools/wangshen/ai-companion/public/entrance.js#L23) 有 JS 跳过逻辑，但若首次加载在 CSS 动画触发瞬间或手动重播时，CSS 层缺乏兜底降级）。

### 5.2 “后端精心保代码块、前端裸文本直出”的富文本荒诞剧

对比后端与前端对 AI 回复文本的处理，会发现一个令人啼笑皆非的工程割裂：
- **后端**：[`chat-stream.mjs`](file:///e:/tools/wangshen/ai-companion/lib/chat-stream.mjs#L15-L34)、[`citations.mjs`](file:///e:/tools/wangshen/ai-companion/lib/citations.mjs#L27-L44)、[`media.mjs`](file:///e:/tools/wangshen/ai-companion/lib/media.mjs#L118-L135) 专门编写了精细的 Markdown Fenced Code Block（`` ``` ``）状态机，确保不破坏 AI 输出的代码块。
- **前端配置指南弹窗**：[`guides.js:5-19`](file:///e:/tools/wangshen/ai-companion/public/guides.js#L5-L19) 甚至已经手写了一个支持标题、无序列表、行内 `code` 和 `<pre><code>` 的安全微型 Markdown 渲染函数 `markdown(content)`！
- **前端核心聊天区**：到了最重要的 AI 聊天回复气泡（[`app.js:358`](file:///e:/tools/wangshen/ai-companion/public/app.js#L358) 與 [`streaming.js:110`](file:///e:/tools/wangshen/ai-companion/public/streaming.js#L110)），却直接用：
  ```html
  <div class="message-content plain-text">${e(message.content)}</div>
  ```
  把 AI 回复原封不动地当成纯文本（`white-space: pre-wrap`）打印出来！

**严苛批判**：当用户向 AI 询问配置命令、代码片段或结构化清单时，聊天气泡里直接裸露出满屏未渲染的 `` ```bash ``、`**加粗**` 和 `### 标题` 符号，既没有代码高亮，也没有“一键复制代码”按钮。这让后端保护 Markdown 代码块的全部努力沦为无用功。

### 5.3 `main.innerHTML` 推土机式重绘与 DOM 逃生舱补丁

[`app.js:313`](file:///e:/tools/wangshen/ai-companion/public/app.js#L313) 的 `renderPage()` 每次执行都会直接覆写 `main.innerHTML = ...`。为了对抗这种全量销毁 DOM 带来的副作用，代码库被迫打满了 fragile 的补丁：
1. **音乐播放器 DOM 逃生舱**：因为 `#music-dock` 包含正在播放的 `<audio>` 元素，一旦被 `main.innerHTML` 销毁就会导致音乐中断。于是 [`app.js:284-301`](file:///e:/tools/wangshen/ai-companion/public/app.js#L284-L301) 每次在 `main.innerHTML = ...` 之前，必须先调 `preserveGardenPlayer()` 把 `#music-dock` 节点从 `main` 剪切到隐藏的 `#garden-player-host` 容器中，等 `innerHTML` 刷完后，再调 `placeGardenPlayer()` 把它塞回新 DOM 树！
2. **记忆图谱 Cytoscape 反复销毁重建**：只要用户在 `graph` 视图下触发任何导致 `renderPage()` 的状态更新（包括每 60 秒一次的后台静默定时刷新 `refreshData`！），[`app.js:304,327`](file:///e:/tools/wangshen/ai-companion/public/app.js#L304) 就会调用 `disposeGraph()` 彻底销毁整个 Cytoscape WebGL/Canvas 实例，再重新 `mountMemoryGraph` 跑一遍力导向布局动画，导致用户正在拖拽查看的图谱瞬间重置归零！

---

## 六、 破局重构路线图（Actionable Architectural Blueprint）

为保持项目“**零前端构建步骤、Node.js 原生单文件 SQLite、轻量自托管**”的核心优势，拒绝引入臃肿框架，提出以下高内聚、可逐项落地的重构方案：

### 阶段一：架构收敛与数据一致性修复（P0）

| 改造域 | 现存缺陷定位 | 严苛重构方案 |
| :--- | :--- | :--- |
| **会话消息落库事务** | [`service.mjs:67-185`](file:///e:/tools/wangshen/ai-companion/lib/service.mjs#L67-L185) 整轮结束后才写库 | **前置落库 + 状态机推进**：进入 `withConversationLock` 后立即开启微事务写入 `user` 消息及 `status='streaming'` 的 `assistant` 占位行；流式每满 N 字符或中断/完成时更新同一行，彻底消除刷新丢消息问题。 |
| **状态机双轨合一** | `conversation_response` 与 `conversation_intent_state` 割裂 | **统一会话媒体与策略状态表**：将 `musicMuted`、`lastMusicQuery`、`lastStickerMood` 收敛至单一权威表（Single Source of Truth），废除跨表 JSON 篡改补丁。 |
| **移除同步进程阻塞** | [`local-model-key.mjs:9`](file:///e:/tools/wangshen/ai-companion/lib/local-model-key.mjs#L9) 每次调用 `spawnSync('powershell.exe')` | **启动期单次异步探测 + 内存缓存**：在服务启动时（[`startup.mjs`](file:///e:/tools/wangshen/ai-companion/lib/startup.mjs)）或显式点击“重新读取环境变量”时通过异步 `execFile` 读取一次并缓存于内存，严禁在 HTTP 请求热路径上调用 `spawnSync`。 |
| **消除供应商过拟合** | [`turn-intent.mjs:132`](file:///e:/tools/wangshen/ai-companion/lib/turn-intent.mjs#L132) 硬编码 `.volces.com` + `ark-code-latest` | **能力探测与配置解耦**：在模型设置中提供显式的“结构化输出能力（`json_schema` / `json_object` / `prompt_tags`）”选项或自动降级探测缓存，让所有支持 Structured Outputs 的 OpenAI 兼容模型平权受益。 |

### 阶段二：响应管线与流式体验重塑（P0 ~ P1）

1. **实现真正的字符级增量 JSON 流式解析器（True Token-Level Structured Streaming）**：
   - 改造 [`semantic-output.mjs`](file:///e:/tools/wangshen/ai-companion/lib/semantic-output.mjs#L48-L61)：在流式扫描 `paragraphs[i].text` 字符串字面量内部时，立即将已解码的字符切片通过 `event: delta` 推送至客户端，实现与原生纯文本流完全一致的 **0 缓冲打字机体验**；当该段落对象闭合解析出 `sourceIds` 时，再发送轻量级 `event: citation` 挂载段尾角标。
2. **引入“单轮 Fast-Path 旁路 + 生成后确定性护栏（Post-Generation Guardrail）”**：
   - 对于短句闲聊或无检索/无媒体意图特征的输入，跳过耗时的 Stage 1 独立 LLM 调用，或采用单次流式 Tool Calling 架构将 TTFT 压缩回 1.5 秒以内。
   - 将饮食禁忌等高危硬约束从冗长的提示词枚举中抽离，在 [`semantic-answer.mjs`](file:///e:/tools/wangshen/ai-companion/lib/semantic-answer.mjs) 与 [`service.mjs`](file:///e:/tools/wangshen/ai-companion/lib/service.mjs) 输出侧增加轻量确定性词法校验器（命中用户当前激活的 `exclusions` 衍生词表时触发精准修正）。
3. **打通全链路 `AbortSignal` 与超时预算分级**：
   - 在 [`server.mjs:204`](file:///e:/tools/wangshen/ai-companion/server.mjs#L204) 为所有 HTTP 请求统一构造绑定 `request/response close` 的 `AbortController` 并向下透传至 `route()` 与 `model.complete()`；调谐 `server.requestTimeout` 与上游模型超时关系。

### 阶段三：API 规范正交化与存储引擎加速（P1）

1. **修正 HTTP 契约违规**：
   - 修改 [`server.mjs:56,206`](file:///e:/tools/wangshen/ai-companion/server.mjs#L56)：`DELETE` 请求不再强制要求 `Content-Type: application/json` 与请求体；当 `Content-Length: 0` 或无请求体时直接返回 `{}`。
   - 拆分 `GET /api/bootstrap`：启动仅拉取轻量级首屏壳数据（当前会话消息 + 导航计数摘要）；聊天发送、记忆置顶、任务切换直接消费动作接口返回的增量对象更新前端 `state`，废除 `app.js` 中 15 处冗余的全量 `refreshData()` 调用。
2. **消除 N+1 查询与全表扫描**：
   - 利用 Node.js 内置 SQLite 的 **FTS5 全文检索扩展** 替代 [`knowledge.mjs`](file:///e:/tools/wangshen/ai-companion/lib/knowledge.mjs) 与 [`memory.mjs`](file:///e:/tools/wangshen/ai-companion/lib/memory.mjs) 中的 `SELECT *` 全表内存排序；
   - 重写 [`graph.decorate`](file:///e:/tools/wangshen/ai-companion/lib/graph.mjs#L105-L120)，使用批量 `WHERE name IN (...)` 一次性预取实体与关系字典，将 `O(M × T)` 次查询压缩为常数 **2 次 SQL 查询**。
   - 将 [`chatState.familiarity`](file:///e:/tools/wangshen/ai-companion/lib/chat-state.mjs#L194-L202) 改为增量累加持久化字段，不再每次读取时全表扫描历史消息。

### 阶段四：UI 降噪、视口归还与局部 DOM 更新（P1 ~ P2）

1. **聊天视口“瘦身归还计划”（将首屏消息区占比从 <45% 提升至 >75%）**：
   - 在 `chat` 视图下，默认折叠 `.page-heading`（园林天际线插画）与 `.marble-balustrade-bar`（汉白玉栏杆）；
   - 将 `.chat-toolbar`、`.chat-state-bar` 与 `.garden-session-bar` 整合为**单行紧凑型顶栏（Compact Context Header，高度 ≤ 44px）**，6 项情绪/关系数值改为悬浮胶囊或点击展开抽屉。
2. **聊天消息接入安全富文本渲染**：
   - 复用并增强 [`guides.js`](file:///e:/tools/wangshen/ai-companion/public/guides.js#L5-L19) 已有的无依赖安全 Markdown 渲染器，在聊天气泡中支持代码块（含语言标签与“一键复制”按钮）、列表、加粗与表格，让后端的代码块保护逻辑真正发挥价值。
3. **告别 `main.innerHTML` 全量推土机**：
   - 按视图容器（`#view-chat`、`#view-knowledge`、`#view-memories`、`#view-graph`、`#view-tasks`、`#view-settings`）建立持久化的平级 `<section>` 节点，切换路由仅切换 `hidden` 属性；
   - `#music-dock` 固定挂载于外层应用壳（App Shell），彻底删除 `preserveGardenPlayer / placeGardenPlayer` DOM 搬运补丁；
   - 设置页改为**左侧二级垂直导航标签（模型与角色 / 回复与媒体 / 邮件服务 / 小窝宠物）+ 右侧单表单面板**，消除“五合一万字长卷”。
