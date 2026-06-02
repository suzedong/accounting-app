# AI 记账 Agent 修正流程设计

> 日期：2026-06-02
> 范围：AI 记账 Agent 在新增、修正、支付方式识别、StepList 展示中的安全性与可解释性改进。

## 背景

测试中暴露出几类问题：

1. 用户没有提支付方式时，LLM 仍可能编造 `payment: "微信支付"`。
2. `correct_record` 当前会直接修改数据库，没有区分简单修正和高风险修正。
3. 用户说“上一条”时，LLM 可能幻觉出错误的 `context`，例如把真实备注 `午餐` 推断成 `【堂食】_吃饭`。
4. StepList 对 `correct_record` 的嵌套对象展示为裸 JSON，不利于用户理解。

目标是保持自然语言记账的顺滑体验，同时避免误改账本。

## 设计目标

- 简单明确的修正可以直接执行，避免每次都打断用户。
- 高风险或不明确的修正必须确认后才修改数据库。
- “上一条”优先使用应用本地已确认记录，而不是依赖 LLM 编造的 context。
- 支付方式必须来自用户输入或 OCR 文本，不允许由 LLM 编造。
- StepList 结构化展示目标记录和修改 diff，避免裸 JSON。

## 总体方案

采用“风险分级修正流”：

```text
用户输入
  → LLM 识别意图和字段
  → 应用定位目标记录
  → 应用生成修改 diff
  → 风险分级
      ├─ 低风险：直接 updateRecord
      └─ 高风险：返回修正确认卡
  → StepList 展示目标记录、修改内容、执行状态
```

LLM 只负责理解“用户想改什么”。应用负责判断“改哪条记录”和“是否安全”。

## 最近确认记录

`ChatStore` 增加当前会话级状态：

```typescript
lastConfirmedRecord: AccountRecord | null
```

更新时机：

- 用户确认新增记录后，`confirm_record` 返回真实入库记录，写入 `lastConfirmedRecord`。
- 低风险修正直接成功后，写入更新后的记录。
- 高风险修正确认成功后，写入更新后的记录。

恢复策略：

- 不从历史消息中恢复 `lastConfirmedRecord`。
- 避免跨会话把“上一条”错误指向旧记录。

目标定位优先级：

1. 当前会话的 `lastConfirmedRecord`。
2. 用户明确说“上一条/刚才那条/这条”时，使用数据库最新记录。
3. 最后才使用 LLM `context` 做模糊匹配。

## 支付方式防编造

在 `AgentEngine` 解析 LLM 参数后执行确定性清洗：

```text
如果原始用户输入和 OCR 文本都没有支付方式关键词：
  删除 payment
  删除 payment_method
  删除 payment_source
  删除 payment_method_source
```

初始支付方式关键词：

```text
微信、支付宝、刷卡、银行卡、信用卡、现金、花呗、零钱、储蓄卡、招商、浦发、尾号、卡号
```

规则：

- 用户说“今天中午吃饭花了35元”时，即使 LLM 返回 `payment: "微信支付"`，也删除。
- 用户说“今天中午微信吃饭花了35元”时，保留支付方式。
- OCR 文本里包含支付渠道时，保留支付方式。

## 修正风险分级

### 低风险：直接执行

必须同时满足：

1. 目标记录唯一明确。
2. 只修改 1 个低风险字段。
3. 不修改金额、时间、收支类型。
4. LLM context 与目标记录没有明显冲突。

低风险字段：

```text
account
category
note
payment_method
payment
```

示例：

```text
上一条改成家庭支出
```

如果上一条已确认记录是：

```text
个人 / 支出 / 35元 / 餐饮 / 午餐
```

则直接执行：

```text
account: 个人 → 家庭
```

### 高风险：必须确认

出现任一情况即高风险：

- 目标记录不唯一。
- 找不到最近确认记录，只能模糊匹配。
- 修改字段超过 1 个。
- 修改 `amount`。
- 修改 `datetime`。
- 修改 `type`。
- LLM context 与本地目标记录冲突。
- 用户表达含糊，例如“那条改一下”“这个不对”。

高风险时不落库，返回修正确认卡。

## ToolRuntimeContext

扩展工具执行接口：

```typescript
interface ToolRuntimeContext {
  userMessage: string;
  lastConfirmedRecord?: AccountRecord | null;
}

toolRegistry.execute(name, args, context?)
```

设计原则：

- LLM args 表示模型理解出的意图。
- runtimeContext 表示应用掌握的事实。
- 不把 `lastConfirmedRecord` 塞进 LLM 参数中。

## 修正结果数据结构

`correct_record` 返回结构化数据：

```typescript
interface CorrectionChange {
  field: string;
  label: string;
  oldValue: unknown;
  newValue: unknown;
}

interface CorrectionResultData {
  targetRecord: Record<string, unknown>;
  changes: CorrectionChange[];
  risk: 'low' | 'high';
  reason?: string;
  pendingUpdate?: {
    recordId: number;
    fields: Record<string, unknown>;
  };
  updatedRecord?: Record<string, unknown>;
}
```

低风险：

- 直接调用 `updateRecord`。
- 返回 `render: 'text'`。
- `data` 包含 `targetRecord`、`changes`、`updatedRecord`。

高风险：

- 不调用 `updateRecord`。
- 返回 `render: 'correctionCard'`。
- `data` 包含 `targetRecord`、`changes`、`risk`、`reason`、`pendingUpdate`。

## 高风险修正确认卡

高风险卡片展示：

```text
请确认修改（尚未保存）

目标记录
2026-06-02 12:00
支出 ¥35.00
餐饮 / 午餐
账户：个人

修改内容
金额：¥35.00 → ¥50.00

原因：修改金额，需要确认

点击“确认”后才会更新账本

[确认修改] [取消]
```

确认后执行：

```text
confirm_correction
  → updateRecord(recordId, fields)
  → 返回“已修正记录”
  → 更新 lastConfirmedRecord
```

`confirm_correction` 保持与 `confirm_record` 类似的工具执行风格，但只应由 UI 确认流程调用。

## StepList 展示

`StepDetail` 增加 correction 信息：

```typescript
correction?: {
  targetRecord: Record<string, unknown>;
  changes: CorrectionChange[];
  risk: 'low' | 'high';
  reason?: string;
}
```

展示方式：

```text
目标记录
时间 2026-06-02 12:00
金额 ¥35.00
分类 餐饮
账户 个人
备注 午餐

修改内容
账户：个人 → 家庭
```

不再展示裸 JSON：

```text
context {...}
fields {...}
```

## 错误处理

### 找不到目标记录

返回：

```text
未找到可修正的记录，请说明要修改哪一条。
```

不落库。

### 多条候选记录

返回：

```text
找到多条可能的记录，请说明要修改哪一条。
```

本期不做候选记录选择卡。

### context 冲突

如果 LLM context 与本地目标记录明显冲突，转高风险确认，并显示原因：

```text
检测到目标信息不一致，请确认修改。
```

## 测试用例

### 新增记录

输入：

```text
今天中午吃饭花了35元
```

期望：

- 时间为当前日期中午。
- 未提支付方式时不显示支付字段。
- 确认卡显示“尚未保存”。
- 点击确认后才调用 `create_record`。
- `lastConfirmedRecord` 更新为创建结果。

### 低风险修正

前置：刚确认上一条记录。

输入：

```text
上一条改成家庭支出
```

期望：

- 目标记录使用 `lastConfirmedRecord`。
- 修改字段为 `account: 个人 → 家庭`。
- 直接调用 `update_record`。
- StepList 展示目标记录和 diff。
- `lastConfirmedRecord` 更新为修改后的记录。

### 高风险修正

输入：

```text
上一条金额改成50
```

期望：

- 判断为高风险。
- 不立即调用 `update_record`。
- 显示修正确认卡。
- 点击确认后才更新数据库。

### 明确支付方式

输入：

```text
今天中午微信吃饭花了35元
```

期望：

- 保留支付方式：微信支付。
- StepList 显示支付字段。

### 支付方式被 LLM 编造

输入：

```text
今天中午吃饭花了35元
```

即使 LLM 返回：

```json
{"payment":"微信支付"}
```

期望：

- AgentEngine 删除支付字段。
- 确认卡不显示支付。
- 数据库 `payment_method` 为空。

## 不纳入本期

以下内容不纳入本期实现，已记录到 [开发计划](../../02-development-roadmap.md) 的 Phase 4.3「AI Agent 后续增强」，后续逐项确认后再开发：

- 候选记录选择卡。
- 全部修正都强制确认。
- 跨会话恢复“上一条”。
- 删除记录的风险分级确认。
- 差旅补助修正流程重构。
