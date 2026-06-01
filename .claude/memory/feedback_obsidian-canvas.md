---
name: obsidian-canvas-for-flowcharts
description: 画流程图/视觉图表时使用 obsidian-canvas-creator skill，不要手写 canvas JSON
metadata: 
  node_type: memory
  type: feedback
  originSessionId: d221db8c-f65f-4664-b85f-245893ca0ff7
---

当需要创建或编辑 Obsidian Canvas 文件（.canvas）时，使用 `obsidian-canvas-creator` skill，不要手动手写 JSON 格式。

**Why:** 手写 canvas JSON 容易出错（ID 冲突、节点重叠、布局混乱），skill 有专业的布局算法和验证规则。

**How to apply:** 当用户提到"画流程图"、"做 canvas"、"编辑 canvas"或涉及 .canvas 文件时，直接调用 `obsidian-canvas-creator` skill。
