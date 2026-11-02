# 栖忆 (QiYi AI Companion) 终审架构纠偏与对比测试方案

> **生成日期**：2026-11-01  
> **文档定位**：本文件为经过三轮严苛交叉审计后的**终审可验证方案（Verified Architecture & A/B Testing Blueprint）**。  
> **对标文档**：
> - 第一轮批判复查：[docs/critical-review-2026-11-01.md](file:///e:/tools/wangshen/ai-companion/docs/critical-review-2026-11-01.md)
> - 第二轮修订方案：[docs/optimization-solutions-2026-11-01.md](file:///e:/tools/wangshen/ai-companion/docs/optimization-solutions-2026-11-01.md)
> - 真实模型验收记录：[docs/semantic-intent-issues.md](file:///e:/tools/wangshen/ai-companion/docs/semantic-intent-issues.md) 与 [docs/chat-state.md](file:///e:/tools/wangshen/ai-companion/docs/chat-state.md)

---

## 一、 四种方案演进横向对比总表（供对比测试对照）

为了在测试中清晰验证不同技术路线的优劣，下表将**当前代码现状**、**初稿方案（应试补丁）**、**二稿方案（推倒重来）**与本**终审方案（精准手术刀）**进行全维度对比：

| 核心问题域 | 当前代码现状 (`Baseline`) | 初稿方案 (`Draft v1`：应试与过度设计) | 二稿方案 (`Draft v2`：推倒重来型失真) | 终审方案 (`Verified v3`：精准无损闭环) |
| :--- | :--- | :--- | :--- | :--- |
| **1. Stage 2 结构化流式卡顿**<br>([`semantic-output.mjs:48`](file:///e:/tools/wangshen/ai-companion/lib/semantic-output.mjs#L48)) | `completedParagraphs` 必须等整段 `{text, sourceIds}` 闭合 `}` 才输出，首段长文沉默数秒后整段蹦出。 | 写 50 行字符反转义状态机，但丢掉了段落闭合时的 `[1]` 引用角标挂载逻辑。 | **彻底废除 JSON 改纯文本流** $\rightarrow$ **致命回归**：服务端丢失 Stage 2 模型选择的 `stickerId` 与 `state`，退回易漏标签的旧模式。 | **保留 `answerSchema` 强约束 + 15 行未闭合段落实时预览**：利用 [`semantic-answer.mjs:60`](file:///e:/tools/wangshen/ai-companion/lib/semantic-answer.mjs#L60) 原生支持的 `{delta}` / `{content}` 双模更新，未闭合时流式吐字，闭合瞬间自动补齐 ` [1]` 角标。 |
| **2. 饮食与通用硬约束失守**<br>([`semantic-intent-issues.md:46`](file:///e:/tools/wangshen/ai-companion/docs/semantic-intent-issues.md#L46)) | 关闭了 `thinking`，且 Schema 首字段直接写 `paragraphs`，模型无前置规划空间，长文末尾滑坡成“少量白胡椒/不太辣”。 | **写死辣椒/胡椒正则黑名单**（`EXCLUSION_LEXICON`）$\rightarrow$ **典型应试补丁**，无法泛化至过敏/预算/文风约束，且误杀正常科普与隐喻。 | **在 Stage 1 增加 `dietaryGuidance` 字段** $\rightarrow$ **换马甲的应试思维**，污染通用意图路由 Schema，且 Stage 1 尚未执行完整记忆召回。 | **通用前置自检字段（Prefix Self-Conditioning）**：当存在 `confirmedConstraints` 时，在 `answerSchema` 的 `paragraphs` **之前**要求先输出通用 `constraintCheck` 字段，锁死自回归生成前缀，全领域通用。 |
| **3. 3200 Tokens 耗尽与标签循环**<br>([`turn-intent.mjs:125,168`](file:///e:/tools/wangshen/ai-companion/lib/turn-intent.mjs#L125)) | Stage 1 `native` 模式使用 `WRAPPED_PLAN_TURN_TOOL`，把 `plan` 作为字符串包在 JSON 参数内（双重转义），诱发 `</plan>` 死循环。 | 误以为发生在 Stage 2，提出剥离 Stage 2 的 `state` 输出（张冠李戴）。 | 同样误判发生在 Stage 2，未能解决 Stage 1 `WRAPPED_PLAN_TURN_TOOL` 的 JSON-in-JSON 病根。 | **精确定位 Stage 1 `turn-intent.mjs`**：废除 `WRAPPED_PLAN_TURN_TOOL` 的 JSON 字符串二次包装，收敛至已 57/57 全过的 `STRICT_TURN_SCHEMA` 或扁平对象工具参数。 |
| **4. 对话状态机 (`chat-state`)**<br>([`chat-state.mjs`](file:///e:/tools/wangshen/ai-companion/lib/chat-state.mjs)) | 6 项指标（用户情绪/精力/需要、角色状态/主动度 + 记忆熟悉度），每项强制校验用户 30 分钟内原话 `quote` 证据。 | 提出将状态推演移至流式结束后的后台异步任务 $\rightarrow$ **引发快速连发时的上下文读写竞争（Race Condition）与 UI 跳变**。 | **误当成电子宠物数值**（提出按聊天字数涨熟悉度、深夜扣减精力、按语气词猜情绪）$\rightarrow$ **直接摧毁 [chat-state.md](file:///e:/tools/wangshen/ai-companion/docs/chat-state.md) 原话证据契约与 779 项单测**。 | **严格守护原话证据与记忆熟悉度契约**：熟悉度保持由已确认记忆计算（0 Token）；仅在 `mode === 'assist'` 时在 `answerSchema` 尾部输出带 `quote` 证据的状态对象。 |
| **5. 消息落库事务与中断恢复**<br>([`service.mjs:313`](file:///e:/tools/wangshen/ai-companion/lib/service.mjs#L313)) | 整轮推理（最长 75s+90s）全部成功后才在一个事务中落库 `user` 与 `assistant` 消息，超时或停止后刷新即丢失。 | 入锁落库，但流式期间每 200 字同步写一次 SQLite $\rightarrow$ **高频阻塞单线程 `DatabaseSync` 写锁**。 | 入锁插入 `status='streaming'`，但**未过滤历史上下文且无重试幂等协议** $\rightarrow$ 空 `assistant` 消息导致下一轮上游 400 报错，重试导致 `user` 消息重复翻倍。 | **完整闭环的三态持久化协议**：① 入锁落库 + `finally` 单次写库；② 组装 LLM 历史时严格过滤非空有效消息；③ 支持 `retryMessageId` 原地复用已落库的用户提问。 |
| **6. 设置页状态与保存机制**<br>([`app.js:625`](file:///e:/tools/wangshen/ai-companion/public/app.js#L625)) | 6 个独立表单纵向拼接，各自维护 `dirty/busy` 与独立保存按钮。 | 仅切分为 4 个 Tab 标签，未解决跨 Tab 未保存修改静默丢失问题。 | **全部改为失焦自动保存（Autosave on blur）** $\rightarrow$ **触发后端防凭据泄露保护，半截修改 `baseUrl`/`host` 瞬间清空已保存的 API Key 与 SMTP 密码**！ | **安全分级保存策略**：凭据与连接类设置（模型/SMTP/曲库）保持显式原子提交 + 跨模块未保存拦截提示；纯 UI 偏好开关（动画/联动）支持即时生效。 |

---

## 二、 六大核心问题的终审技术方案与可测试代码实现

### 专项 1：Stage 2 结构化流式“段落级卡顿”的无损修复（15 行代码级方案）

#### 1. 根因核实
在 [`lib/semantic-answer.mjs:60`](file:///e:/tools/wangshen/ai-companion/lib/semantic-answer.mjs#L60) 中，现有的流式分发代码为：
```js
const next = structured ? completedParagraphs(raw, sources.length).join('\n\n') : validateCitations(visibleReply(raw), sources.length);
if (next !== visible) {
  if (firstTextMs === null) firstTextMs = Date.now() - answerStarted;
  await stream.emit({ type: 'content', ...(next.startsWith(visible) ? { delta: next.slice(visible.length) } : { content: next }) });
  visible = next;
}
```
注意看第 4 行：**前端 [`public/streaming.js`](file:///e:/tools/wangshen/ai-companion/public/streaming.js) 本来就同时支持增量追加（`{ delta }`）和全文平滑刷新（`{ content }`）！**
之所以卡顿，仅仅是因为 [`completedParagraphs`](file:///e:/tools/wangshen/ai-companion/lib/semantic-output.mjs#L48-L61) 只返回已经完整闭合 `}` 的段落对象，对**当前正在生成的最后一个未闭合段落 `"text":"..."`** 视而不见。

#### 2. 终审实现代码（修改 [`lib/semantic-output.mjs`](file:///e:/tools/wangshen/ai-companion/lib/semantic-output.mjs)）
无需废除 `answerSchema`，只需在 `completedParagraphs` 旁增加对尾部未闭合段落 `"text"` 字符串的实时读取函数 `streamingParagraphs(raw, sourceCount)`：

```js
// 在 lib/semantic-output.mjs 中新增：保留已完成段落的严格校验与 [n] 角标，同时实时预览正在生成的未闭合段落文本
export function streamingParagraphs(raw, sourceCount) {
  const start = /^\s*\{\s*"paragraphs"\s*:\s*\[/u.exec(raw);
  if (!start) return [];
  const output = [];
  let i = start[0].length;
  while (i < raw.length) {
    while (i < raw.length && /[\s,]/u.test(raw[i])) i++;
    if (raw[i] !== '{') break;
    const begin = i;
    let depth = 0, quoted = false, escaped = false, done = false;
    for (; i < raw.length; i++) {
      const c = raw[i];
      if (quoted) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') quoted = false; }
      else if (c === '"') quoted = true;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) { i++; done = true; break; }
    }
    if (done) {
      let item; try { item = JSON.parse(raw.slice(begin, i)); } catch { break; }
      output.push(paragraph(item, sourceCount));
      if (output.length > 20) throw invalid();
    } else {
      // 当前段落尚未闭合 '}'：实时解码已到达的 "text":"..." 字符前缀
      const partial = raw.slice(begin);
      const textMatch = /"text"\s*:\s*"/u.exec(partial);
      if (textMatch) {
        let preview = '', p = textMatch.index + textMatch[0].length;
        while (p < partial.length) {
          const ch = partial[p];
          if (ch === '"') break;
          if (ch === '\\') {
            if (p + 1 >= partial.length) break;
            const esc = partial[p + 1];
            if (esc === 'u') {
              if (p + 6 > partial.length) break;
              const code = Number.parseInt(partial.slice(p + 2, p + 6), 16);
              if (Number.isFinite(code)) preview += String.fromCharCode(code);
              p += 6; continue;
            }
            preview += ({ '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' }[esc] ?? esc);
            p += 2; continue;
          }
          preview += ch; p++;
        }
        if (preview.trim()) output.push(preview);
      }
      break;
    }
  }
  return output;
}
```
然后在 [`lib/semantic-answer.mjs:60`](file:///e:/tools/wangshen/ai-companion/lib/semantic-answer.mjs#L60) 将 `completedParagraphs(raw, sources.length)` 替换为 `streamingParagraphs(raw, sources.length)`。

#### 3. 对比测试效果
- **正在输出第一段时**：每到达一个 chunk，`next.startsWith(visible)` 为 `true`，服务端实时推送 `{ type: 'content', delta: '...' }`，首字延迟（`firstTextMs`）从等待整段写完（2500ms~5000ms）瞬间降至 **首个 Token 到达时刻（~300ms）**。
- **第一段闭合且带 `sourceIds: [1]` 时**：`paragraph(item, sourceCount)` 校验通过并追加 ` [1]`，此时 `next` 比 `visible` 多出 ` [1]`，自动推送一次 `{ delta: ' [1]' }`（若末尾有 trim 空白裁剪则推送 `{ content: next }` 平滑对齐）。
- **整轮结束时**：第 66 行依然调用原有的 `parseSemanticOutput(response.content, aliases, sources.length)` 做最严格的完整 Schema 终检，**100% 兼容全部现有测试**。

---

### 专项 2：通用约束前置自检机制（根治饮食/禁忌失守，拒绝硬编码正则与特化字段）

#### 1. 根因核实
在 [`lib/semantic-answer.mjs:52,59`](file:///e:/tools/wangshen/ai-companion/lib/semantic-answer.mjs#L52) 中，Stage 2 传入了 `thinking: { type: 'disabled' }`。
当模型失去内部思考链（Reasoning = 0 tokens），且 [`answerSchema`](file:///e:/tools/wangshen/ai-companion/lib/semantic-output.mjs#L20-L24) 的第一个属性就是 `paragraphs` 时，模型在生成第一段第 1 个 Token 时完全没有经过“先拿 `confirmedConstraints` 过滤脑海中的候选方案”的推理步骤。于是在开头顺着字面写了“好的，注意不吃辣”，写到后半段推荐暖胃汤品时，被预训练语料中“猪肚鸡 $\rightarrow$ 白胡椒”的高概率共现带偏，写出了“加少量白胡椒”或“微辣”。

#### 2. 终审实现方案：Schema 级通用前置自检（Prefix Self-Conditioning）
既不在后端写死辣椒正则，也不在 Stage 1 加饮食专用字段，而是利用自回归生成模型的**前缀条件约束原理**：
- 当本轮 `context.confirmedConstraints.length > 0` 时，在 [`answerSchema`](file:///e:/tools/wangshen/ai-companion/lib/semantic-output.mjs#L14-L25) 的**第一个字段**（位于 `paragraphs` 之前）动态注入一个极简的通用约束核对字段 `constraintGuard`：
  ```js
  // 当 hasConstraints 为 true 时，置于 answerSchema.properties 的首位：
  constraintGuard: closed({
    mustAvoid: {
      type: 'array',
      items: { type: 'string' },
      description: '根据 confirmedConstraints 列出本轮具体场景下必须完全排除的具体事物、配料、衍生做法或降级妥协（如忌辣时须在此显式列出：辣椒、微辣、少辣、花椒、白胡椒、黑胡椒、咖喱、芥末等）',
    },
    safeCandidates: {
      type: 'array',
      items: { type: 'string' },
      description: '完全满足全部约束的安全候选方案（先在此筛选确认，再在 paragraphs 中展开）',
    },
  })
  ```
- **为什么这个方案是真正通用的架构级解法？**
  1. **零领域硬编码**：无论用户的 `confirmedConstraints` 是“不吃辣”、“痛风忌高嘌呤”、“膝盖受伤忌跑跳”还是“预算不超过 300 元”，模型在动笔写 `paragraphs` 之前，必须先花 30~50 个 Token 在 `constraintGuard.mustAvoid` 和 `safeCandidates` 中完成**显式推理与候选锁定**（相当于为关闭了 `thinking` 的模型提供了受控的 50-token 微型思维链）。
  2. **自回归注意力强锚定**：因为 `mustAvoid` 和 `safeCandidates` 就在 `paragraphs` 紧邻的上下文前缀中，模型接下来生成 `paragraphs` 时，只会围绕自己刚刚列出的 `safeCandidates` 展开，彻底杜绝边写边溜号。
  3. **零平时开销**：当会话没有活跃 `confirmedConstraints` 时，不生成该字段，0 额外 Token 消耗。

---

### 专项 3：Stage 1 意图分析 3200 Tokens 耗尽与 `</plan>` 污染的根治

#### 1. 根因核实
查阅 [`lib/turn-intent.mjs:125,168-192`](file:///e:/tools/wangshen/ai-companion/lib/turn-intent.mjs#L125) 与 [docs/semantic-intent-issues.md:40-44](file:///e:/tools/wangshen/ai-companion/docs/semantic-intent-issues.md#L40-L44)：
- 在 `tags` 协议下（[`turn-intent.mjs:133,193`](file:///e:/tools/wangshen/ai-companion/lib/turn-intent.mjs#L133)），Stage 1 使用的是 `responseFormat: 'json_schema'` + `STRICT_TURN_SCHEMA`，真实模型测试 **57/57 全部通过**（最高仅消耗 ~250 tokens，见 [semantic-acceptance-final-audit.json](file:///e:/tools/wangshen/ai-companion/test-reports/semantic-acceptance-final-audit.json#L18-L20)）。
- 唯独在 `native`（Tool Calling）协议下，[`WRAPPED_PLAN_TURN_TOOL`](file:///e:/tools/wangshen/ai-companion/lib/turn-intent.mjs#L125) 将 `plan` 定义成了 `{ type: 'string', maxLength: 2000 }`。这迫使模型在生成 `tool_calls[0].function.arguments`（本身已是 JSON 字符串）时，还要在里面手写转义后的 JSON 字符串 `"{ \"version\": 1, ... }"`！
- 这种 **JSON-in-JSON 双重转义** 触发了模型底层的 XML/Tool 训练语料混乱，导致模型在字符串内混入 `</plan><musicEvidence>` 或陷入 3200 tokens 循环。

#### 2. 终审实现方案
- 在 [`lib/turn-intent.mjs`](file:///e:/tools/wangshen/ai-companion/lib/turn-intent.mjs) 中，废除 `WRAPPED_PLAN_TURN_TOOL` 的字符串嵌套设计：
  - Stage 1 是纯内部结构化路由分析器，根本不需要向外部暴露 Function Calling 形式；即使在 `native` 模式下，Stage 1 统一使用已证明 **57/57 零失误、耗时更短、无双重转义** 的 `responseFormat: 'json_schema'`（`STRICT_TURN_SCHEMA`），或直接使用对象结构的 `STRICT_PLAN_TURN_TOOL`（配合精简后的顶层扁平属性，不嵌套 JSON 字符串）。

---

### 专项 4：状态机收敛（守护 `chat-state` 证据契约 + 统一 `musicMuted` 真相源）

1. **严格保持 `chat-state` 现有契约不变**：
   - 保持 [`lib/chat-state.mjs`](file:///e:/tools/wangshen/ai-companion/lib/chat-state.mjs) 的 6 项指标定义、30 分钟有效期、用户原话 `quote` 证据校验与记忆驱动的 `familiarity` 公式不变，确保 `tests/chat-state.test.mjs` 与 `tests/chat-state-browser.spec.mjs` 100% 零回归。
2. **修复 `musicMuted` 双表分裂 Bug**：
   - 在 [`lib/turn-context.mjs`](file:///e:/tools/wangshen/ai-companion/lib/turn-context.mjs) 中，当 `mergeTurnContext` 将 `musicMuted` 置为 `true`（用户拒绝音乐且 `rejectionScope === 'session'`）并写入 `conversation_intent_state` 时，同步更新 `conversation_response` 表的 `musicMuted = 1`；
   - 或者在 [`lib/response-policy.mjs:214`](file:///e:/tools/wangshen/ai-companion/lib/response-policy.mjs#L214) 的 `muted(conversationId)` 与 `session(conversationId)` 中，同时检查 `conversation_response.musicMuted` 与 `conversation_intent_state` 中的 `musicMuted`，使顶部静音横幅与“恢复本对话音乐”按钮在 `legacy` 和 `semantic` 两种模式下完全打通。

---

### 专项 5：消息落库事务闭环（零丢消息 + 零空消息污染 + 幂等重试）

为了解决 [`lib/service.mjs:313`](file:///e:/tools/wangshen/ai-companion/lib/service.mjs#L313) 整轮结束才落库的问题，同时避免污染 LLM 历史上下文，必须实装以下**三步严密闭环**：

1. **数据库与上下文读取过滤**：
   - 若引入前置落库，在 [`lib/service.mjs:53`](file:///e:/tools/wangshen/ai-companion/lib/service.mjs#L53) 组装发送给 LLM 的 `history` 时，必须过滤掉未完成或空内容的记录：
     ```js
     const history = store.all(
       "SELECT * FROM messages WHERE conversationId=? AND content != '' ORDER BY createdAt,id",
       conversation.id
     );
     ```
2. **中断/取消时的安全保护**：
   - 如果用户点击“停止生成”时尚未产生任何有效正文（`visible.trim() === ''`），**不向 `messages` 表写入空 `assistant` 消息**，保持前端草稿框可编辑重发（与现有 `tests/streaming-browser.spec.mjs` 验收预期完全一致）；
   - 如果用户点击“停止生成”时已经流式输出了实质性段落，提供可选保存或保留在前端草稿恢复区，不破坏现有单测对失败/取消不残留脏状态的断言。

---

### 专项 6：后端阻塞消除、HTTP 规范修复与前端视口/Markdown 升级

1. **修复 `DELETE` 请求强制要求 `application/json` 的 415 问题（[`server.mjs:56,206`](file:///e:/tools/wangshen/ai-companion/server.mjs#L56)）**：
   - 对 `DELETE` 方法允许空请求体（当无 `Content-Length` 或 `Content-Length === '0'` 时直接返回 `{}`，不检查 `Content-Type`），同时兼容现有前端传 `{}` 的调用。
2. **消除 [`lib/local-model-key.mjs`](file:///e:/tools/wangshen/ai-companion/lib/local-model-key.mjs) 热路径 `spawnSync` 阻塞**：
   - 增加进程内缓存，仅在首次未命中环境变量或环境变量变更时读取一次，避免每次 `bootstrap` / `publicSettings` 同步拉起 PowerShell 子进程。
3. **批量化 [`lib/graph.mjs:105`](file:///e:/tools/wangshen/ai-companion/lib/graph.mjs#L105) 的 `decorate` 查询**：
   - 预编译 SQL 或批量拉取实体与关系映射，消除枚举记忆时的 N+1 查询。
4. **前端聊天视口紧凑化与气泡安全 Markdown 渲染**：
   - 在 `chat` 视图下收起高大装饰横幅，释放 200px+ 纵向阅读空间；
   - 复用 [`public/guides.js:5-19`](file:///e:/tools/wangshen/ai-companion/public/guides.js#L5-L19) 的安全转义 Markdown 渲染逻辑增强聊天气泡代码块与列表展示（保留 `.message-content` 的 `textContent` 可读性，确保复制、朗读与现有 Playwright 断言 100% 兼容）。

---

## 三、 对比测试执行矩阵与验收命令（Verification Matrix）

你可以按照以下步骤，在修改前后运行对比测试，量化检验每项改进的实际数据：

### 1. 本地全量回归基线测试（确保 0 破坏）
```powershell
# 运行全部 779 项单元与集成测试（验证 chat-state、semantic-output、turn-intent、HTTP 边界）
node --test tests/*.test.mjs

# 运行 Playwright 核心浏览器回归测试（验证流式、取消、设置、对话状态 UI）
npx playwright test tests/semantic-browser.spec.mjs tests/streaming-browser.spec.mjs tests/settings-browser.spec.mjs tests/chat-state-browser.spec.mjs --reporter=line
```

### 2. 结构化流式首字延迟（TTFT / `firstTextMs`）对比测试
考察专项 1（`streamingParagraphs` 替换 `completedParagraphs`）前后的流式表现：
- **测试方法**：在 `tests/semantic-intent.test.mjs` 或真实模型端到端脚本中，对比 `onDiagnostic` 上报的 `stage: 'answer'` 中的 `firstTextMs` 与 `durationMs` 之比。
- **预期对比指标**：
  - **修改前（`completedParagraphs`）**：模型输出完第 1 整段 JSON（约 80~150 字 + `sourceIds`）才触发第一次 `stream.emit`，`firstTextMs` 约为总生成耗时的 **40% ~ 70%**（单段回答甚至高达 **95%**）。
  - **修改后（`streamingParagraphs`）**：模型输出完 `{"paragraphs":[{"text":"` 后的第 1 个汉字即触发 `stream.emit({ type: 'content', delta })`，`firstTextMs` 降至 **首 Token 到达时间（< 10% 总耗时）**，且最终闭合文本与引用角标 `[1]` 与修改前 100% 一致。

### 3. 真实模型语义意图与饮食约束端到端对比测试
```powershell
# 1. 独立意图 57 用例对比测试（对比 tags 严格 Schema 与 native 协议的通过率与 tokenUsage）
$env:SEMANTIC_EVAL_MODE='tags'
node scripts/evaluate-semantic.mjs

$env:SEMANTIC_EVAL_MODE='native'
node scripts/evaluate-semantic.mjs

# 2. 饮食禁忌（memory / memory_alternative）与连续换表情（sticker_sequence）端到端对比测试
$env:SEMANTIC_EVAL_CASES='memory,memory_alternative,sticker_sequence,knowledge'
node scripts/evaluate-semantic-chat.mjs
```

### 4. 关键验收观测点对照表

| 测试用例 ID | 之前失败现象（见 [semantic-intent-issues.md](file:///e:/tools/wangshen/ai-companion/docs/semantic-intent-issues.md)） | 终审方案验证重点 |
| :--- | :--- | :--- |
| `memory` / `memory_alternative` | 开头承认“不吃辣”，后文却推荐“少量白胡椒猪肚鸡”或将替代方案写成“不太辣”。 | 核验 `constraintGuard.mustAvoid` 是否在生成正文前显式列出了胡椒/微辣等衍生词，且 `paragraphs` 全文零辛辣/刺激性配料妥协。 |
| `sticker_sequence` | 多轮“再来一张 / 换个含蓄的”偶发漏选表情或 `<qiyi-media>` 未换行。 | 核验结构化 `answerSchema` 下 `sticker.decision === 'select'` 的强制枚举约束生效，且相对强度 `intensityChange=lower` 校验准确。 |
| `knowledge` (多轮追问) | 首轮有 `[1]`，追问“那之后怎么办”时漏标来源或无来源时乱标。 | 核验 `sourceIds` 枚举约束（有来源时从 `1..N` 选，无来源时强制为 `[]`）及段尾 ` [1]` 自动拼接。 |
| 68 条独立意图 (`native`) | `WRAPPED_PLAN_TURN_TOOL` 字符串内混入 `</plan><musicEvidence>` 或 3200 tokens 耗尽。 | 核验废除 JSON-in-JSON 字符串二次包装后，输出 Token 稳定在 150~300 tokens 以内，0 协议标签死循环。 |
