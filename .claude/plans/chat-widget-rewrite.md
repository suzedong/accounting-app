# 补全 AI 对话核心交互链路

## Context

ChatWidget.vue 目前只实现了"发送 → LLM → 立即创建记录 → 显示结果"的简单流程。旧版 `web/js/modules/chat-widget.js` 有完整的交互链路：欢迎页 → 识别 → 确认卡片（✅确认/✏️修改/❌取消）→ 追问补充 → 修改记录。

**核心问题**：当前 `handleCreateRecord` 直接 `invoke('create_record')` 入库，没有给用户确认的机会。需要改为两步：先返回 `render: "card"` 显示待确认卡片，用户点击确认后才真正入库。

## 方案概述

### 状态管理（ChatWidget.vue 内）

```
conversationState: {
  waitingForConfirm: false   // 等待确认卡片
  pendingRecord: null        // 待确认的记录数据（fields）
  awaitingFollowUp: false    // 等待用户补充信息
  pendingFollowUp: null      // followUp 数据（question, missingFields, originalFields）
  editingField: null         // 正在编辑的字段
}
```

### 修改点

#### 1. `src/ai/actions.ts` — create_record 改为不直接入库

当前 `handleCreateRecord` 直接调用 `createRecord()`。改为返回 `render: "card"` + `data: fields`，让前端展示确认卡片。

新增 `handleConfirmRecord` — 前端确认后调用此 handler 才真正入库。

修改 `handleAskFollowUp` — 返回结构化 followUp 数据（question, missingFields, originalFields），前端渲染为追问卡片。

#### 2. `src/components/chat/ChatMessage.vue` — 增强渲染

新增 `render: "followUp"` 类型：显示追问 + 缺少的字段按钮。

增强 `render: "card"` 类型：添加 ✅确认 / ✏️修改 / ❌取消 按钮（当前 RecordCard 只有 修正/删除，不符合确认场景）。

#### 3. `src/components/chat/ConfirmCard.vue` — 新建确认卡片组件

替代 RecordCard 用于确认场景。显示：
- 记账字段列表（类型、金额、分类、账户、支付、时间、备注）
- ✅ 确认 / ✏️ 修改 / ❌ 取消 三个按钮

#### 4. `src/components/chat/ChatWidget.vue` — 核心改造

- **欢迎页**：无消息时显示欢迎 + 快捷按钮（"今天吃饭35元"、"工资收入5000"等）
- **sendMessage 改造**：
  - `dispatchLLM` 返回后，按 action 分流：
    - `create_record` (render=card) → 显示确认卡片，不入库
    - `ask_follow_up` → 显示追问卡片 + 字段按钮
    - `render_stats`/`render_budget`/`query_records` → 已有渲染
    - `reply_text`/其他 → 纯文本
  - 用户在确认卡片点确认 → 调用 `confirmRecord()` 入库
  - 用户点取消 → 清除状态
  - 用户点修改 → 进入字段选择 → 输入新值 → 更新 pendingRecord
  - 用户点追问按钮 → 补充缺失字段 → 重新 dispatch
- **onMounted**：从 SQLite 加载历史消息，适配新的消息格式（content + data + render + status）

#### 5. `src/types/index.ts` — 新增类型

`FollowUpResult` 接口（question, missingFields, originalFields）

### 持久化策略

SQLite `chat_messages` 表已有字段：`{ role, content, data(json), skill, confidence }`。

新消息格式：`data` JSON 中增加 `_render`（card/text/list/chart/followUp）和 `_status`（pending/confirmed/cancelled/success）。

加载历史时解析这些字段恢复渲染。`_status: 'pending'` 的确认卡片显示可操作按钮，其余显示为确认成功消息。

## 文件清单

| 文件 | 操作 | 说明 |
|---|---|---|
| `src/ai/actions.ts` | 修改 | create_record 返回 card 不入库；新增 confirmRecord handler；增强 ask_follow_up |
| `src/ai/dispatch.ts` | 修改 | 增加 checkApiConfig 检查 ai_services 而非 legacy ai_api_key |
| `src/types/index.ts` | 修改 | 新增 FollowUpResult |
| `src/components/chat/ConfirmCard.vue` | 新建 | 确认卡片（含确认/修改/取消按钮） |
| `src/components/chat/ChatMessage.vue` | 修改 | 新增 followUp 渲染；使用 ConfirmCard 替代 RecordCard 用于 card 场景 |
| `src/components/chat/ChatWidget.vue` | 重写 | 核心交互状态管理 + 欢迎页 + 分流渲染 + 确认/追问/修改流程 |

## 数据流

```
用户: "今天吃饭30"
  → dispatchLLM → { action: "create_record", params: { fields: {...} }, render: "card" }
  → ChatWidget 显示 ConfirmCard（不入库）

用户: 点击 ✅ 确认
  → handleConfirmRecord(fields) → createRecord() → 显示成功

用户: 点击 ✏️ 修改
  → 显示字段选择 → 用户选"分类" → 输入"餐饮" → 更新 pendingRecord.category → 重新显示 ConfirmCard

用户: 点击 ❌ 取消
  → 清除 pendingRecord，显示"好的，请重新输入"

---

用户: "今天打车"
  → dispatchLLM → { action: "ask_follow_up", params: { question: "缺少金额", missingFields: ["amount"], originalFields: {...} }, render: "text" }
  → ChatWidget 显示追问卡片 + "金额"按钮
  → 用户点击"金额" → 输入框提示"请输入金额" → 发送"30"
  → 合并 originalFields + amount=30 → 重新 dispatch → create_record → 确认卡片
```

## 验证

1. `npm run dev` 启动
2. 打开 AI 对话 → 应看到欢迎页 + 快捷按钮
3. 点击"今天吃饭35元" → 显示确认卡片 → 点击确认 → 成功创建
4. 输入"今天打车" → 显示追问 → 补充金额 → 显示确认卡片
5. 确认后点修改 → 修改分类 → 重新确认
6. 点取消 → 清除并回到欢迎状态
