---
name: project-multi-machine-development
description: 本项目在两台电脑、两个操作系统上开发，涉及跨平台兼容性（macOS + Windows）
metadata:
  type: project
---

项目使用两台电脑开发，运行 macOS 和 Windows 两个系统。

**Why**：跨平台环境可能导致路径、构建工具、依赖安装等差异，需要在代码和配置中保持兼容性。

**How to apply**：
- 避免硬编码绝对路径或系统特定的路径分隔符
- 涉及系统特定命令（如 macOS 的 `open` vs Windows 的 `start`）时需考虑跨平台
- `settings.json` 中的 Windows 路径权限（如 `C:\Users\SZD\...`）应放在 `settings.local.json` 中，避免污染共享配置
- Tauri 构建和测试应在两个平台上验证
