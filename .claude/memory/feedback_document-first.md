---
name: document-first-development-strategy
description: 项目采用文档先行的开发策略——任何需求变更、架构调整、界面改动或代码修改，都需先讨论确认，然后同步更新相关文档
metadata:
  type: feedback
---

**规则**：有变动先讨论，确认后再修改文档，代码跟进前文档必须同步。

**Why**：用户明确要求文档先行，避免代码和文档脱节导致后期维护混乱。

**How to apply**：
1. **需求/架构变更** → 先讨论 → 确认后更新 doc/01-requirement-design.md 或 doc/02-architecture-design.md
2. **界面/交互变更** → 先讨论 → 确认后更新 doc/03-ui-design.md
3. **开发计划调整** → 先讨论 → 确认后更新 doc/04-development-plan.md
4. **重构方案变化** → 先讨论 → 确认后更新 doc/05-refactoring-plan.md
5. **代码编写/修改** → 在文档已更新的基础上进行
6. **CLAUDE.md** → 涉及架构/数据模型/目录结构变化时同步更新
