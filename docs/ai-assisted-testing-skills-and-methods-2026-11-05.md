# AI 辅助测试设计与测试执行:GitHub 上的 Skill 与方法整理

> 整理日期:2026-11-05
> 来源:联网检索摘要(GitHub 仓库、技术博客、论文)。
> **注意**:仓库名与功能来自搜索摘要,未逐个克隆验证。采用前请先打开仓库确认活跃度、许可证与实际内容。

---

## 一、总览

| 层次 | 目标 | 代表方案 |
|---|---|---|
| 1. 流程约束类 Skill | 让 AI 先写测试、按纪律写测试 | TDD Skill(`SKILL.md`)、Superpowers、mattpocock/skills、addyosmani/agent-skills |
| 2. 单元测试生成与覆盖补全 | 自动生成、运行、过滤并提交有效测试 | Qodo Cover(原 CodiumAI Cover-Agent)、Meta TestGen-LLM |
| 3. 测试有效性验证 | 防止"高覆盖率、弱断言" | 变异测试 + LLM(如 Mutahunter) |
| 4. E2E / 浏览器测试智能体 | 探索用户旅程、生成并自愈 Playwright 用例 | Playwright Test Agents、TestOptim、Agent-QA 等 |
| 5. 导航型资源清单 | 持续发现新工具 | `awesome-ai-testing`、GitHub topic `ai-testing` |

---

## 二、流程约束类:Agent Skill(`SKILL.md`)

### 1. 核心思想
- Skill 放在 `.claude/skills/<name>/SKILL.md` 或 `.github/skills/`。
- frontmatter 的 `name` 与 `description` 决定何时触发,正文写步骤与禁忌(渐进式披露,按需加载)。
- 全局约束(如"统一使用 node:test")放 `GEMINI.md` / `CLAUDE.md`,流程性步骤放 Skill。

### 2. 典型 TDD Skill 要点
1. **Red**:先在公共接口层写行为测试,运行并确认因预期原因失败。
2. **Green**:只写让测试通过的最小实现。
3. **Refactor**:测试通过后才重构。
4. **反模式清单**:
   - 测私有方法或内部状态(与实现耦合)。
   - 同义反复断言、过度 mock 导致测试永远不会失败。
   - 水平切片(一次写完整层测试),应改为一个行为对应一个测试再对应一次实现的垂直切片。

### 3. 值得关注的仓库
| 仓库 / 项目 | 特点 |
|---|---|
| `mattpocock/skills` | 偏 TS/JS,强调公共接口缝(seam)、测试反模式 |
| `addyosmani/agent-skills` | 测试模式、Definition of Done、test smell 检查;可用 `npx skills add addyosmani/agent-skills/test-driven-development` 安装 |
| Superpowers(Jesse Vincent) | 规划、头脑风暴与严格 TDD 循环,防止模型先写实现 |
| `TestMu AI` Agent Skills | 教编码助手编写、执行、迁移 Playwright/Cypress/Selenium 脚本 |

### 4. 防止 AI "作弊"的实践
- **上下文污染问题**:同一上下文既有测试意图又有实现计划,模型容易同时写。对策是用子智能体分阶段,一个只写测试,另一个只写实现。
- **Hook 门禁**:用 pre-commit / agent hook 检查"改了源码但 diff 中没有测试改动"则阻断。
- **强制运行证据**:要求 AI 贴出测试命令和输出,尤其是红灯输出。

---

## 三、单元测试自动生成:"生成 → 运行 → 过滤 → 保留"闭环

核心原则:**不信任一次性生成,只保留经执行验证有价值的测试**。

### 1. Qodo Cover(前 Cover-Agent,AGPL-3.0)
- 流程:读取覆盖率报告 → 生成候选测试 → 运行 → 只有通过且覆盖率提升的才保留。
- 可接入 CI,定期补覆盖缺口。

### 2. Meta TestGen-LLM(论文《Automated Unit Test Improvement using LLMs at Meta》)
- 多层过滤:能编译 → 能通过 → 可重复运行不 flaky → 覆盖率确有增加。
- 定位是增强人工测试,而非替代。

### 3. 可借鉴的通用管线
```
选目标(低覆盖文件/函数)
  → 提示词(源码 + 已有测试风格 + 覆盖缺口)
  → LLM 生成候选
  → 运行(含重复 N 次防 flaky)
  → 覆盖率差分
  → 通过全部门槛才落盘
```

---

## 四、变异测试 + LLM:验证测试质量

- **问题**:覆盖率可被刷高(执行了代码但无有效断言)。
- **方法**:对源码注入小变更(变异体),存活的变异体说明测试没抓住。
- **闭环**:把存活变异体反馈给 LLM,例如"该变异在第 42 行存活,写一个对原代码通过、对变异体失败的测试"。
- **工具**:Mutahunter 等 LLM 变异测试工具;传统工具(Stryker、mutmut、PIT)也可与 LLM 组合。
- **价值**:迫使 AI 写出精确断言,而非填充式测试。

---

## 五、E2E 与浏览器测试智能体

- **Playwright Test Agents / Playwright MCP**:让 AI 通过浏览器或 MCP 探索页面,生成原生 Playwright 用例。
  - 典型三角色:Planner(探索与出计划)、Generator(生成用例)、Healer(修复失败用例)。
- 其他方案(摘要提及,需自行核实):Validate.QA、TestOptim(输入 URL,输出可维护的 Playwright 套件)、Checksum.ai、Agent-QA(持续生成、执行、自愈)。
- **注意**:自愈需限制范围(只修定位器,不改业务断言),否则会把真实缺陷"修"掉。

---

## 六、测试设计方法(提示词层面)

1. **先让 AI 做测试设计,再写代码**:输出等价类、边界值、状态转移、错误路径、并发与取消、安全注入场景清单,由人评审后再生成用例。
2. **按风险分层**:核心逻辑用单元测试,跨模块用集成测试,关键用户旅程用 E2E。
3. **基于需求或缺陷生成回归测试**:每个 bug 先写复现测试(红),再修复(绿)。
4. **提供"好测试"样例**:给 AI 仓库中既有高质量测试作为风格参照。
5. **属性测试**:让 AI 提炼不变量,配合 fast-check / Hypothesis。
6. **评审环节**:让另一个独立 AI 或会话,以"挑刺者"角色审查测试是否有同义反复、过度 mock、断言缺失。

---

## 七、导航型资源(持续跟踪)

- `tugkanboz/awesome-ai-testing`:AI 测试生成、变异测试、自愈自动化清单。
- `TestOptim-AI/awesome-ai-testing`:偏自主 QA 智能体、API/单元测试生成器。
- GitHub topic:`ai-testing`。
- agentskills.io:Skill 规范说明。

---

## 八、对栖忆项目(ai-companion)的落地建议

结合项目现有的 `node:test` 套件(800+ 用例)与 Playwright 七大用户旅程:

1. **新增项目级 TDD Skill**:放入 `.agents/skills/` 或 `.claude/skills/`,固定要求"红 → 绿 → 重构",并引用 `GEMINI.md` 中的测试命令与清理规范。
2. **覆盖缺口补全**:用覆盖率(`node --test --experimental-test-coverage`)找 `lib/` 低覆盖模块,采用第三节管线生成候选测试并设门槛。
3. **变异测试抽样**:先对安全关键模块(`instruction-inspector.mjs`、`tool-registry.mjs` 的 `safeEvaluateMath`、`agent-loop.mjs` 熔断逻辑)试跑 Stryker,把存活变异体交给 AI 补断言。
4. **E2E 智能体**:用 Playwright Test Agents 探索新页面并生成草稿,再并入 `tests/user-journey-simulation.spec.mjs` 的风格。每次跑完需按规范清理 `test-results/` 等产物。
5. **门禁**:用 pre-commit 检查"改 `lib/` 或 `public/` 必须伴随 `tests/` 变更"。

---

## 九、风险与局限

- AI 生成的测试可能锁定当前(含错误)行为,必须由人审查断言的业务含义。
- 过度 mock、同义反复断言、flaky 用例是最常见的低质量模式。
- 开源协议需注意(例如 Qodo Cover 为 AGPL-3.0)。
- 本文基于搜索摘要,具体仓库的星标、维护状态与用法需二次核实。
