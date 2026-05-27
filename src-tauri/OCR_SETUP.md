# AI 记账 — OCR 设置指南

## 工作原理

应用通过 Python 子进程调用 PaddleOCR 进行 OCR 识别。首次使用时会自动检测系统 Python 并安装所需依赖。

## 前置要求

需要系统已安装 **Python 3.11+**。

- **Windows**：从 https://www.python.org/downloads/ 下载安装，安装时勾选 "Add Python to PATH"
- **macOS**：`brew install python3` 或使用系统自带
- **Linux**：`apt install python3` 或 `dnf install python3`

## 自动安装

首次使用 OCR 时，前往设置页点击「安装 PaddleOCR 依赖」，应用会自动：

1. 探测系统中的 Python（跨平台多路径尝试）
2. 自动执行 `pip install paddlepaddle paddleocr`
3. 安装完成后 OCR 即可使用

## 手动安装

如果自动安装失败，可以手动执行：

```bash
pip install paddlepaddle paddleocr
```

## Settings 页管理

设置页 OCR 区域显示：
- Python 路径和版本
- PaddleOCR 安装状态（已安装 / 未安装）
- 安装依赖按钮（首次安装或重装）
- 启用 / 禁用开关（持久化到数据库）
