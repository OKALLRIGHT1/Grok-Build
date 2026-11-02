# 计划审批可读布局与后台任务状态实施计划

> **For agentic workers:** 按任务顺序实施。每项生产代码修改前先让对应测试以预期原因失败。本仓库没有可用 Git 元数据，完成后以测试输出作为检查点。

**Goal:** 让桌面/移动计划审批窗口可读、可关可开、危险操作有确认；同时把主动停止的后台任务从「执行失败（信号 killed）」里摘出来，并在对话里展示任务输出。

**Architecture:** 计划窗不再复用权限弹窗 `.modal-body` 网格，改为独立单列 flex。会话标签和后台任务分类放进已有 UMD/Node 共享模块。渲染端用现有活动行展示 `task_completed`，不新增协议。

**Tech Stack:** Electron 桌面渲染器、手机网页、Node 内置测试、现有 `ux-policy` / `agent-events` / `tool-presentation`。

## 全局约束

- 关闭审批窗口不得向 CLI 发送结果。
- 空白修改意见不得提交 `cancelled`。
- `killed` / `cancelled` / `explicitly_killed` 不得再发 turn-error。
- 保留现有主题、毛玻璃、权限/信任弹窗网格。
- 不改 `desktop/package.json` 版本。

## 文件

- `desktop/src/ux-policy.js` + `desktop/test/ux-policy.test.js`
- `desktop/src/agent-events.js` + `desktop/test/agent-events.test.js`
- `desktop/src/renderer/index.html` / `styles.css` / `renderer.js`
- `desktop/src/mobile/index.html` / `styles.css` / `app.js`
- `desktop/test/usability-contract.test.js`

---

## Task 1: 共享策略

**Files:** `desktop/src/ux-policy.js`, `desktop/test/ux-policy.test.js`, `desktop/src/agent-events.js`, `desktop/test/agent-events.test.js`

- [x] **Step 1:** 在 `ux-policy.test.js` 增加 `describePlanApprovalContext` 断言：工作区取末段；长 session id 缩短；空值回退「当前会话」。
- [x] **Step 2:** 在 `agent-events.test.js` 增加：`signal: "killed"` / `explicitlyKilled: true` 返回 `null`；`timeout` / 退出码 1 仍失败且文案不含「信号 killed」；失败消息包含输出摘要。
- [x] **Step 3:** 跑测试，确认因 API 不存在而失败。
- [x] **Step 4:** 实现 `describePlanApprovalContext(request)`。
- [x] **Step 5:** 重写 `backgroundTaskFailure`：停止类返回 `null`；其余映射中文原因并附带 `output`。
- [x] **Step 6:** 跑 `node --test test/ux-policy.test.js test/agent-events.test.js` 通过。

---

## Task 2: 桌面计划审批布局与重开

**Files:** `desktop/src/renderer/index.html`, `styles.css`, `renderer.js`, `desktop/test/ux-policy.test.js`

- [x] **Step 1:** 契约测试要求：`.plan-approval-body` 不再依赖 `.modal-body` 的 40px 网格；存在 `#plan-approval-banner`、`#reopen-plan-approval`、`#defer-plan`；`confirm(` 放弃；`describePlanApprovalContext`；空意见禁用修改按钮。
- [x] **Step 2:** HTML：表单只保留 `plan-approval-body`；增加关闭按钮和输入区横幅。
- [x] **Step 3:** CSS：单列 flex；预览区滚动；按钮固定高度且 `width: auto`；补 `.eyebrow`；Markdown 不撑破。
- [x] **Step 4:** JS：填充可读会话名；横幅随 pending 显隐；Esc/关闭不提交；放弃确认；意见框 input 控制修改按钮；打开时焦点到批准。
- [x] **Step 5:** 跑相关测试通过。

---

## Task 3: 移动端对齐

**Files:** `desktop/src/mobile/index.html`, `styles.css`, `app.js`

- [x] **Step 1:** 文案与桌面一致；增加横幅、关闭按钮。
- [x] **Step 2:** 同样的关闭/重开/确认/空意见禁用。
- [x] **Step 3:** 契约测试覆盖移动横幅 id。

---

## Task 4: 后台任务完成进入活动流

**Files:** `desktop/src/renderer/renderer.js`, `desktop/src/mobile/app.js`, `desktop/test/usability-contract.test.js`

- [x] **Step 1:** 测试断言桌面和移动 `handleUpdate` / `handleAgentUpdate` 处理 `task_completed`。
- [x] **Step 2:** 从 `params.update` 或顶层读取 snapshot，调用现有 `updateTool` 画一行终端活动。
- [x] **Step 3:** 主动停止不调用 `showTurnError`；真实失败的错误文案带输出。
- [x] **Step 4:** 跑 `node --test test/ux-policy.test.js test/agent-events.test.js test/usability-contract.test.js` 通过。

---

## 验收

1. 计划窗标题横向可读，三键是正常按钮而不是整列色条，计划正文可滚动。
2. Esc 后输入区出现「查看计划」，再打开仍是同一份计划；放弃有确认；空意见不能提交修改。
3. 主动停止的 pytest 不再弹出「执行失败（信号 killed）」。
4. 非 0 退出或超时仍报失败，并能在活动行/错误详情里看到输出。
