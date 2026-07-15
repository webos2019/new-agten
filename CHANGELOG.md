# 项目开发进度 — Git 提交记录

> 自动生成于 2026-07-15
> 分支: `main` | 共 15 次提交

---

## 阶段五：修复与优化 (2026-07-15 19:29 ~ 22:07)

### `8305018` fix: Agent入口检测支持纯文本中嵌入的URI
- **时间**: 2026-07-15 22:07
- **变更**: 2 文件, +6 -3
- **内容**:
  - 新增无锚点搜索模式 `VERSION_PLAN_URI_SEARCH_PATTERN`
  - 支持纯文本中嵌入的 URI（如 `doc:docs://versions/xxx.md`）
  - 支持多种输入格式：`/tasklist docs://...`、`/tasklist doc:docs://...`、`/tasklist @docs://...`

### `dc37792` fix: 滚动条移到屏幕边缘 + 文件上传区域缩小
- **时间**: 2026-07-15 21:47
- **变更**: 2 文件, +23 -16
- **内容**:
  - 历史侧边栏改为 `position: absolute` 浮动定位
  - `.chat-body` 占满全宽，滚动条移到屏幕最右边
  - 桌面端 `.chat-content` 添加 `padding-right: calc(1rem + 280px)` 避免内容被遮挡
  - 文件上传区域 padding 从 `1rem` 缩小到 `0.5rem 0.75rem`
  - 去除无效 Tailwind 类（`mb-2`、`text-center`、`h-6 w-6` 等），替换为自定义 CSS 类

### `0760701` fix: 首页自适应 + 输入框上移 + 移动端响应式布局
- **时间**: 2026-07-15 21:32
- **变更**: 7 文件, +397 -17
- **内容**:
  - 空状态 `min-height` 从 `70vh` 缩小到 `45vh`，输入框上移
  - 输入区域 padding 从 `1rem` 缩小到 `0.625rem 1rem 0.5rem`
  - 新增 `@media (max-width: 768px)` 平板自适应（Header 缩小、侧边栏隐藏等）
  - 新增 `@media (max-width: 480px)` 手机自适应（进一步缩小所有元素）
  - 新增 `HistorySidebar.tsx` 历史记录侧边栏组件
  - 新增 `useInputHistory.ts` 输入历史 hook

### `b166cd3` fix: @引用支持URI字符 + 新增长文件名版本方案
- **时间**: 2026-07-15 19:42
- **变更**: 3 文件, +50 -3
- **内容**:
  - `@` 触发正则从 `@(\w*)$` 改为 `@([\w:\/.\-]*)$`，支持 URI 中的 `:` `/` `.` `-` 字符
  - 新增 `docs/versions/v0.1.0-controlled-version-plan-to-tasklist-agent.md`（完整名版本方案）
  - `types.ts` 的 `@` 引用列表新增完整名 URI
  - `/` 命令"引用版本方案 v0.1.0"改为指向完整名文件

### `c446f5c` fix: 斜杠命令菜单缓存问题 + 过滤逻辑改进
- **时间**: 2026-07-15 19:29
- **变更**: 2 文件, +4 -2
- **内容**:
  - `app.py` HTML 响应添加 `Cache-Control: no-cache, no-store, must-revalidate` 头
  - 清除 dist 目录重新构建，生成新 hash 文件名
  - 斜杠命令过滤逻辑新增 `cmd.desc` 搜索

---

## 阶段四：Tasklist Agent 受控运行时 (2026-07-15 18:46 ~ 19:11)

### `b6cd121` test: 完整 Tasklist Agent 测试套件 (38项全通过)
- **时间**: 2026-07-15 19:11
- **变更**: 2 文件, +699 -120
- **内容**:
  - 25 项单元测试（validate_tasklist_structure 7项 + extract_plan_structure 8项 + resolve_version_plan_uri 4项 + AgentState 6项）
  - 13 项 API 端到端测试（缺少引用提示 + 不存在方案报错 + v0.1.0完整链路 + v0.2.0完整链路 + 无tasklist不触发Agent）
  - 修复 `extract_plan_structure` 中"目标"匹配到"非目标"的子串 bug
  - 修复 `validate_tasklist_structure` 中 `test` 关键词与 URI `test.md` 误匹配 bug

### `91ffdee` feat: 实现 Tasklist Agent 受控运行时 ★
- **时间**: 2026-07-15 18:46
- **变更**: 13 文件, +962 -1
- **内容**:
  - **Agent Runtime** (`agent_runtime.py`): 入口检测 + 状态机 + runner
    - `AgentState`: 草稿 v1/v2、校验结果、修正次数（仅本轮内存）
    - `validate_tasklist_structure`: 确定性质量门（5 项检查：标题/来源URI/步骤/勾选项/验证内容）
    - `extract_plan_structure`: planExtract 版本方案结构提取
    - `run_tasklist_agent`: read→extract→draft→validate→(revise)→final 主流程
    - 最多一次自动修正，不会无限循环
    - 最终输出：可复制草稿 + 校验结论 + 人工确认点
  - **流式协议** (`stream/protocol.py`): 新增 `agent_step_start` / `agent_step_end` chunk 类型
  - **Chat Orchestrator** (`chat_orchestrator.py`): Agent 受控分支（主链路最优先短路）
  - **Chat Service** (`chat_service.py`): 透传 `structured` 结构化请求到编排器
  - **版本方案文件**: `docs/versions/v0.1.0-controlled-tasklist-agent.md` + `v0.2.0-agent-trace-panel.md`
  - **前端**:
    - `types.ts`: `/tasklist` 斜杠命令 + `@docs://versions` 引用 + `ChatBlock` 增加 agent step 字段
    - `AIInputEditor.tsx`: `insertSkillReference` / `insertDocReference` 方法
    - `useChat.ts`: `agent_step_start` / `agent_step_end` chunk 处理
    - `ChatBody.tsx`: `renderBlock('agent_step')` Agent 轨迹面板渲染
    - `styles.css`: `.agent-step-block` 深色青色科技感样式

---

## 阶段三：React 前端分离 + UI 改造 (2026-07-15 16:05 ~ 16:56)

### `8586bea` style: 参考 misakanet.org 深色终端科技感主题
- **时间**: 2026-07-15 16:56
- **变更**: 1 文件, +229 -199
- **内容**:
  - 深色背景 `#070b15` + 青色霓虹 `#00e5ff` + 终端美学
  - Tech grid 背景网格 + Scanline 扫描线叠加
  - 所有组件统一深色科技感配色

### `da9b95f` style: 背景色改为淡绿色科技感主题
- **时间**: 2026-07-15 16:33
- **变更**: 1 文件, +116 -116
- **内容**: 整体配色调整

### `2a5745b` style: 首页淡蓝色科技感 UI 改造
- **时间**: 2026-07-15 16:23
- **变更**: 2 文件, +297 -142
- **内容**:
  - `ChatBody.tsx`: 空状态 Feature Grid 卡片布局
  - `styles.css`: 完整 UI 主题改造

### `eb3e552` feat: 首页分离为 React 项目 (Vite + React + TypeScript)
- **时间**: 2026-07-15 16:05
- **变更**: 多文件
- **内容**:
  - `frontend/` 目录: Vite + React + TypeScript 项目结构
  - `app.py`: 优先返回 React 构建产物 (`static/dist/index.html`)，回退到旧版
  - 组件化: `Header` / `ChatBody` / `Footer` / `AIInputEditor` / `ChatBody`
  - Hooks: `useChat` 聊天状态管理

---

## 阶段二：编辑器与结构化请求 (2026-07-15 13:04 ~ 15:33)

### `b2efc10` fix: 修复app.js语法错误导致编辑器无法初始化
- **时间**: 2026-07-15 15:33
- **内容**: 修复 JavaScript 语法错误

### `29ec257` fix: 修复编辑器CSS大括号缺失导致无法输入文字的问题
- **时间**: 2026-07-15 15:27
- **内容**: 修复 CSS 语法错误

### `c1ba1c9` feat: 实现Tiptap编辑器、斜杠命令、@引用、结构化请求、Tool Runtime ★
- **时间**: 2026-07-15 13:04
- **内容**:
  - 富文本编辑器: `/` 斜杠命令菜单 + `@` 引用菜单 + 内联 chip
  - 结构化请求: `rawText` + `segments` + `chips`
  - Tool Runtime: 工具注册表 + OpenAI function calling 格式
  - 流式协议: NDJSON chunk（text / tool_call / tool_result / resource / error / done）

---

## 阶段一：基础项目搭建 (2026-07-14)

### `2940d93` feat: Python版AI代码助手 - FastAPI + DeepSeek + 工具调用 + 流式响应 ★
- **时间**: 2026-07-14 19:01
- **内容**:
  - **FastAPI** 后端: `/api/chat` 流式 NDJSON 响应
  - **DeepSeek** 模型集成: `chat_completion()` 异步调用
  - **工具调用**: 数学计算、日期时间、单位换算、文本转换、天气查询、文件读取等
  - **技能系统**: `utility-skill`（工具模式）+ `reader-skill`（文件天气模式）
  - **流式生命周期**: `StreamLifecycle` + `StreamWriter` + 错误自动恢复（最多 3 次重试）
  - **聊天编排**: `ChatOrchestrator` 模型调用 → 工具执行 → 结果汇总

---

## 统计

| 指标 | 数值 |
|------|------|
| 总提交数 | 15 |
| feat (功能) | 4 |
| fix (修复) | 6 |
| style (样式) | 3 |
| test (测试) | 1 |
| style (其他) | 1 |
| 时间跨度 | 2026-07-14 ~ 2026-07-15 |
