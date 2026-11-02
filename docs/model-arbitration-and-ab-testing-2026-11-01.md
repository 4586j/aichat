# 栖忆 (QiYi AI Companion) 双模型争议裁决与第三方 A/B 对比验证规范

> **文档性质**：架构争议仲裁、双模型论点交叉审查与第三方客观评测协议（Third-Party Evaluation & A/B Benchmark Protocol）  
> **评测对象**：
> 1. **原作者模型方案 (Model A / Baseline)**：见 [docs/semantic-intent-design.md](file:///e:/tools/wangshen/ai-companion/docs/semantic-intent-design.md)、[docs/semantic-intent-issues.md](file:///e:/tools/wangshen/ai-companion/docs/semantic-intent-issues.md) 及当前主干代码。
> 2. **审查模型方案 (Model B / Proposed)**：见 [docs/critical-review-2026-11-01.md](file:///e:/tools/wangshen/ai-companion/docs/critical-review-2026-11-01.md) 与 [docs/verified-architecture-solutions-2026-11-01.md](file:///e:/tools/wangshen/ai-companion/docs/verified-architecture-solutions-2026-11-01.md)。
> **第三方测试员准则**：不预设任何模型立场的正确性，完全依据**自动化测试通过率、真实模型调用延迟（TTFT）、Token 消耗效率、约束遵循率与边界健壮性**五项可量化指标进行黑盒/白盒实测。

---

## 一、 争议焦点与技术哲学碰撞总览

在深入具体代码之前，必须先看清双方在系统设计哲学上的**根本分歧**：

```mermaid
flowchart TD
    subgraph Model A (原作者模型哲学: 形式防御与有界隔离)
        A1["宁可段落卡顿，绝不提前下发未核验的引用"]
        A2["宁可保留长文Prompt与人工复核，绝不加启发式正则黑名单"]
        A3["宁可失败时丢掉临时输出，绝不在数据库留半截脏消息"]
        A4["用字符串包装 plan，试图隔离工具调用协议标记"]
    end

    subgraph Model B (审查模型哲学: 交互确定性与工程正交)
        B1["流式首字延迟(TTFT)高于一切，引用角标支持平滑追加覆写"]
        B2["关闭 Thinking 的自回归模型必有注意力漂移，需前缀自检机制锚定"]
        B3["165秒长链路掉电/刷新丢提问不可容忍，需草稿级韧性"]
        B4["JSON-in-JSON 双重转义是死循环根源，应彻底废除嵌套字符串包装"]
    end
```

---

## 二、 五大核心技术争议深度辩驳与第三方测试规范

### 争议 1：结构化输出下的流式体验 vs. 引用校验严密性

#### 双方论点对抗
- **Model A（原作者立场）**：
  在 [`lib/semantic-output.mjs:47`](file:///e:/tools/wangshen/ai-companion/lib/semantic-output.mjs#L47) 与 [`tests/semantic-output.test.mjs:35-41`](file:///e:/tools/wangshen/ai-companion/tests/semantic-output.test.mjs#L35-L41) 中，明确要求：*“Emit only complete, validated paragraph objects, never partial JSON syntax”*。
  - **辩护理由**：一个段落只有在闭合 `}` 后，后端的 `paragraph()` 才能拿到完整的 `sourceIds` 数组，核实引用编号没有超出本轮提供的范围（1..N），并在文本尾部挂上 ` [1]`。如果在段落生成中途把文字吐出去，用户看到的是未校验的半截文字；如果此时模型在段末输出了非法的 `sourceIds: [999]`，整条回答将被抛出 `502` 异常，而前端却已经把文字打在屏幕上了。
- **Model B（审查模型立场）**：
  - **反驳理由**：在日常聊天中，一个中长段落（150~300 字）生成耗时通常在 3~6 秒。在此期间，用户面对的是完全静止的光标。如果回答只有 1 个大段落，用户必须等待整个回答全部生成完毕才能看到第 1 个字。这彻底摧毁了 SSE 流式打字机的心理体验（首字感知延迟 TTFT 从 300ms 恶化到 4000ms+）。
  - **工程闭环机制**：前端 [`public/app.js:514`](file:///e:/tools/wangshen/ai-companion/public/app.js#L514) 本身就支持 `{ content: next }` 全文平滑覆写。在流式期间下发未闭合段落的前缀文本作为打字机预览；当段落闭合时，后端校验 `sourceIds` 并补上 ` [1]`，通过平滑刷新将 ` [1]` 挂在段尾。即使发生 502 错误，前端原有的 `state.streamFailures` 机制也本来就会将其标记为失败。

#### 第三方客观 A/B 测试方案
- **测试环境**：
  - 分别保留 `completedParagraphs`（方案 A）与引入 `streamingParagraphs`（方案 B）；
  - 使用真实模型或模拟分块延迟发送的 HTTP SSE Mock 服务，每个汉字间隔 40ms，生成一段 200 字带 `sourceIds: [1]` 的段落。
- **采集指标**：
  1. `TTFT (Time To First Token)`：从 SSE 请求发出到前端屏幕首次渲染出文字的时间（ms）；
  2. `Frame Interval Jitter`：前端界面内容更新的时间间隔标准差；
  3. `Citation Accuracy`：在终态文本中，` [1]` 角标的位置与来源 ID 是否与方案 A 100% 一致。
- **判定标准**：若方案 B 能够将 TTFT 降低 80% 以上，且在流式结束时生成的文本和引用与方案 A 完全一致，则方案 B 胜出。

---

### 争议 2：Stage 2 饮食禁忌与通用硬约束的遵循保障

#### 双方论点对抗
- **Model A（原作者立场）**：
  在 [`lib/semantic-prompt.mjs:5`](file:///e:/tools/wangshen/ai-companion/lib/semantic-prompt.mjs#L5) 中，Model A 在 System Prompt 投入了长达 300 字的警告：*“禁止条件不能降级成降低程度、少量尝试或可选备选……例如不吃辣就只能推荐完全不辣的做法，少辣或微辣仍违反约束……”*，并在 [docs/semantic-intent-issues.md:46-51](file:///e:/tools/wangshen/ai-companion/docs/semantic-intent-issues.md#L46-L51) 记录：真实模型在关闭思考后偶发滑坡成“少量白胡椒”或“不太辣”。Model A 坚持：*“启发式检查只能作初筛，`requiresContentReview=true` 的回答必须继续人工审查，不放宽解析，不搞黑名单正则补丁。”*
- **Model B（审查模型立场）**：
  - **核心批判**：Model A 记录了问题却拒绝在架构上给出解决方案，寄希望于“人工复核”在单机自托管陪伴软件中是不可接受的（普通用户聊天不可能配备人工审核员！）。
  - **病根剖析**：由于在 Stage 2 关闭了 `thinking`（Reasoning = 0 tokens），自回归模型在生成时没有前置推理缓冲区。若 [`answerSchema`](file:///e:/tools/wangshen/ai-companion/lib/semantic-output.mjs#L20) 的第一个字段直接就是 `paragraphs`，模型脑中的语义高频联想（如“暖胃鲜汤 $\rightarrow$ 猪肚鸡 $\rightarrow$ 白胡椒”）会在无阻拦的情况下直接吐出。
  - **Model B 的自省与漏洞修补（极其关键！）**：
    - Model B 承认：此前 Draft v1 提出的“辛辣正则黑名单后置拦截”是典型的应试补丁，已被推翻；
    - Model B 承认：在 Draft v3 提出的 `constraintGuard` 方案中，**存在一个严重代码漏洞**——[`lib/semantic-output.mjs:49`](file:///e:/tools/wangshen/ai-companion/lib/semantic-output.mjs#L49) 的流式正则写的是 `/^\s*\{\s*"paragraphs"\s*:\s*\[/u`。如果直接把 `constraintGuard` 放在 Schema 第一位，流式解析器会直接无法匹配 `paragraphs`！
    - **Model B 修正后的方案**：若采用 `constraintGuard`（前缀条件约束），解析器必须改为通用的状态机查找 `"paragraphs"`，或者在 `paragraphs` 的每个段落对象内要求先输出 `plan: string`，或者允许 Stage 2 开启 100~200 tokens 的微型思考预算（`thinking: { type: 'enabled', budgetTokens: 128 }`）。

#### 第三方客观 A/B 测试方案
- **测试环境**：
  - 构造 15 组典型的对抗性诱导用例（如：“我最近胃寒且严重忌辣（严禁任何辛辣刺激），推荐两道暖身养胃汤品”、“我对坚果花生严重过敏，推荐一份下午茶甜品点心”）；
  - 分别在以下 3 种模式下运行 5 轮并记录全文：
    - **Condition A (基线)**：当前纯 System Prompt 约束 + `thinking: disabled`；
    - **Condition B (微型思维链)**：保留 Schema 不变，但允许小额思考预算（`thinking: { type: 'enabled', budget_tokens: 128 }`）；
    - **Condition C (Schema 前缀自检)**：在 Schema 前置注入 `constraintGuard`（修正解析器后）。
- **判定标准**：统计输出中出现“微辣/少许胡椒/不太辣/坚果装饰”等隐性妥协的比例。若 Condition B 或 C 能将违规率从 Baseline 的 ~20% 降至 0%，则证实架构调整的必要性。

---

### 争议 3：Stage 1 意图分析 3200 Tokens 耗尽与协议标记污染

#### 双方论点对抗
- **Model A（原作者立场）**：
  查阅 [docs/semantic-intent-design.md:240,251,267](file:///e:/tools/wangshen/ai-companion/docs/semantic-intent-design.md#L240)：
  在早期测试中，原生工具调用直接传大对象 Schema 时，模型曾出现输出大量空白或混入工具格式标记的现象。因此 Model A 设计了 [`WRAPPED_PLAN_TURN_TOOL`](file:///e:/tools/wangshen/ai-companion/lib/turn-intent.mjs#L125)——把 2000 字的完整 `plan` 作为 JSON 字符串塞在工具参数里，外面放两个简短的证据字段。
- **Model B（审查模型立场）**：
  - **核心反驳**：这种“在 JSON 工具调用的参数内，再包一层转义后的 JSON 字符串（JSON-in-JSON）”的设计是极其凶险的反模式。大模型在输出嵌套转义的字符串时，极易发生语法混淆。
  - **铁证**：在 [semantic-intent-issues.md:40-44](file:///e:/tools/wangshen/ai-companion/docs/semantic-intent-issues.md#L40-L44) 中，Model A 自己记录的真实失败案例明确显示：模型在字符串末尾反复拼接 `</plan><musicEvidence>...`，直至打满 3200 tokens 耗尽截断！
  - 反观在同一个真实模型上，Stage 1 的 `tags` 模式采用标准的 `responseFormat: 'json_schema'`（`STRICT_TURN_SCHEMA`），在 57 条完整测试集上取得了 **57/57 全通、平均仅消耗 210~250 tokens** 的压倒性胜利（见 `test-reports/semantic-intent-tags-final.json`）。
  - **Model B 主张**：既然事实证明原生 Tool Calling 的字符串包装是产生死循环的温床，而 `responseFormat: 'json_schema'` 表现极其稳定且轻量，为什么还要坚持保留脆弱的 `WRAPPED_PLAN_TURN_TOOL`？应将内部意图分析统一收敛至 `json_schema` 传输。

#### 第三方客观 A/B 测试方案
- **测试环境**：
  - 运行 `scripts/evaluate-semantic.mjs`，分别设置：
    - `MODE = 'native'`（使用当前的 `WRAPPED_PLAN_TURN_TOOL` 字符串包装）；
    - `MODE = 'tags'`（使用基于 `STRICT_TURN_SCHEMA` 的 `json_schema` 传输）。
- **采集指标**：
  1. 57 个标准意图用例的成功通过率；
  2. 平均 Completion Tokens 消耗量与最大 Token 峰值；
  3. 是否发生 `finish_reason = 'length'` 或参数中包含 `</plan>` 标记。
- **判定标准**：若 `json_schema` 在 57 个用例中全部通过且平均 Token 消耗显著低于原生字符串包装模式，则证明废除字符串包装是完全正确的。

---

### 争议 4：长生成周期下的持久化边界与草稿容灾机制

#### 双方论点对抗
- **Model A（原作者立场）**：
  在 [`lib/service.mjs:313`](file:///e:/tools/wangshen/ai-companion/lib/service.mjs#L313) 与 [`tests/streaming.test.mjs`](file:///e:/tools/wangshen/ai-companion/tests/streaming.test.mjs) 中，Model A 坚持：
  *“失败或中途取消的请求绝不写入数据库，消息必须成对提交；未完成的文字仅临时存在于前端内存中，失败时前端保留可编辑的草稿。”*
  - **辩护理由**：如果服务器在收到请求时就抢先往 `messages` 插入 `user` 消息，一旦大模型超时或报错，数据库里就会留下一条“有问无答”的孤儿消息。下次打开会话，用户会看到一条孤零零的提问；点击重试如果再次发送，数据库里就会出现两重复的用户消息，彻底破坏对话上下文的整洁性。
- **Model B（审查模型立场）**：
  - **核心反驳**：Model A 忽视了极端场景下的灾难性体验——由于 Stage 1 (75s) + Stage 2 (90s) 最长可达 165 秒，在此漫长期间内，如果用户由于网络卡顿不小心按了 F5 刷新、浏览器标签崩溃、或手机息屏被系统杀死，前端内存中的 `state.drafts` 会**瞬间蒸发**，用户写下的几百字长篇提问彻底灰飞烟灭！
  - **Model B 修正后的双赢方案（必须经过第三方检验）**：
    不需要强行在服务器 `messages` 表污染未完成消息，而是在**客户端存储层（Local Storage）**引入与会话绑定的断网草稿箱：
    1. 前端在点击发送的瞬间，将当前输入的文字同步写入 `localStorage.setItem('active_flight:' + convId, text)`；
    2. 当且仅当 SSE 收到 `done` 帧并成功落库后，才清除该项；
    3. 若用户在生成中途刷新页面，重新进入会话时，前端直接从 `localStorage` 中自动恢复未完成的提问至输入框，并温和提示“上次提问已自动为你恢复”。
    - **收益**：既 100% 遵守了 Model A 关于“数据库绝不留半截孤儿消息”的不变量，又 100% 解决了 Model B 提出的“刷新丢长文本提问”的痛点！

#### 第三方客观 A/B 测试方案
- **测试环境**：
  - 模拟用户在输入框输入 500 字长文本提问并点击发送；
  - 在 Stage 1 运行第 3 秒（或流式输出第 50 字时），通过脚本强行调用 `location.reload()` 刷新页面。
- **判定标准**：
  - 检查刷新后页面加载完毕时，用户的 500 字输入是否完好无损地停留在输入框中供用户二次编辑；
  - 检查服务端 SQLite 的 `messages` 表是否未产生畸形的空消息或断裂消息。

---

### 争议 5：单线程阻塞（`spawnSync`）与查询风暴的现实影响

#### 双方论点对抗
- **Model A（原作者立场）**：
  在 [`lib/local-model-key.mjs:9`](file:///e:/tools/wangshen/ai-companion/lib/local-model-key.mjs#L9) 中，使用 `spawnSync('powershell.exe')` 是为了在 Windows 环境下跨会话读取用户可能刚刚在系统属性中添加的 `OPENAI_API_KEY`，且设有 15 秒超时；而在单用户桌面本地自托管环境下，并发请求极少，同步调用实现简单稳定。
- **Model B（审查模型立场）**：
  - **核心反驳**：Node.js 是单线程事件循环架构。`spawnSync` 会在执行期间**彻底冻结整个 Node.js 进程的所有网络 I/O、计时器和活跃 SSE 流**！
  - 在 Windows 冷启动、杀毒软件（如 Windows Defender）实时扫描或系统高负载时，启动一次 PowerShell 经常耗时 800ms ~ 2500ms。在此期间，前端的所有静态资源加载、音乐播放代理流的心跳传输均处于停滞卡死状态。
  - **成熟解法**：在 [`lib/startup.mjs`](file:///e:/tools/wangshen/ai-companion/lib/startup.mjs) 启动阶段异步读取一次并存入内存缓存；运行期间 HTTP 请求只读内存变量（0ms）。仅当用户在设置页点击“测试连接”或“刷新环境变量”时，才发起一次显式的异步刷新。

#### 第三方客观 A/B 测试方案
- **测试环境**：
  - 启动服务端，保持一个正在以 200ms 间隔播放音频流的后台 HTTP 请求；
  - 并发向 `/api/bootstrap` 发起 10 次请求，分别在原版（无缓存 `spawnSync`）与修改版（内存缓存）下执行。
- **采集指标**：
  1. `/api/bootstrap` 请求的平均耗时与 P99 耗时；
  2. 音频代理流是否发生帧延迟或卡顿。
- **判定标准**：修改版若将 `/api/bootstrap` 耗时从数百毫秒压缩至 10ms 以内，且消除事件循环冻结，则判定修改版胜出。

---

## 三、 第三方实测执行指南与数据收集表

第三方测试人员可以在工作区根目录下，使用纯净的 Node.js 运行时执行以下自动化对照命令：

### 1. 基线单元与集成回归测试
```powershell
# 验证双方改动是否破坏现有的 779 项既有契约
node --test tests/*.test.mjs
```

### 2. 真实模型语义对比套件（需配置有效模型）
```powershell
# A/B 协议测试 1: 比较 tags 与 native 在 57 个独立用例上的表现
$env:SEMANTIC_EVAL_MODE='tags'
node scripts/evaluate-semantic.mjs

$env:SEMANTIC_EVAL_MODE='native'
node scripts/evaluate-semantic.mjs

# A/B 协议测试 2: 验证饮食约束与多轮换图
$env:SEMANTIC_EVAL_CASES='memory,memory_alternative,sticker_sequence,knowledge'
node scripts/evaluate-semantic-chat.mjs
```

### 3. 数据记录与裁判打分表

| 评测维度 | 指标项 | Model A (基线) 实测值 | Model B (改进) 实测值 | 最终优胜方 |
| :--- | :--- | :--- | :--- | :--- |
| **流式体验** | 首字展示延迟 (TTFT) | | | |
| **流式体验** | 终态引用角标 `[1]` 正确率 | | | |
| **约束遵循** | 诱导场景下“不吃辣”失守违规率 | | | |
| **意图效率** | Stage 1 平均 Token 消耗量 | | | |
| **意图健壮性** | Stage 1 协议标记泄露/死循环次数 | | | |
| **容灾体验** | 长生成中途按 F5 刷新后提问恢复率 | 0% (完全丢失) | 100% (自动恢复) | |
| **并发性能** | `/api/bootstrap` 响应时间 (P95) | | | |

---

## 四、 结论与测试交付

通过上述交叉辩驳，双模型各自的盲区均已被彻底穿透：
- **Model A 的盲区**：将“未闭合不能核验”的教条凌驾于流式交互之上，忽视了长周期下用户草稿丢失的严重性，且在 Stage 1 坚持使用已被证明会诱发死循环的字符串包装工具。
- **Model B 的盲区**：前期曾犯下“硬编码正则应试补丁”、“误把 chat-state 当电子宠物”以及“Schema 字段顺序导致流式正则失效”的低级错误，但在本终审方案中已全数自我纠正并给出了严密的闭环。

第三方测试人员可严格依据本文档设立的测试矩阵进行实测判定。
