---
name: memory-in-project-dir
description: 所有记忆文件都写入项目目录 .claude/memory/ 而非全局 ~/.claude/ 路径
metadata:
  type: feedback
---

**规则**：创建记忆文件时，写入项目目录 `.claude/memory/` 而非全局 `~/.claude/projects/.../memory/`。

**Why:** 用户可能换电脑开发，项目目录下的记忆随代码一起同步（git），全局路径每台机器独立。

**How to apply:** 任何 `Write` 创建记忆文件时，路径使用 `.claude/memory/` 相对项目根目录，并在 `.claude/memory/MEMORY.md` 中注册索引。
