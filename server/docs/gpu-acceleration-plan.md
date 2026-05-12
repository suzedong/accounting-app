# PaddleOCR GPU 自动检测与加速方案

> 状态：待执行
> 创建时间：2026-05-12

## 背景

当前 `server/ocr_service.py` 硬编码 `device='cpu'`，即使用户机器有 GPU 也不会使用。
需要实现程序自动检测 GPU 硬件和驱动，自动选择最高适配的 paddlepaddle/paddleocr 版本并安装，根据硬件类型选择 OCR 引擎。

## 硬件 → 最佳版本映射

| GPU 类型 | OCR 引擎 | 程序自动安装的包 |
|---------|---------|----------------|
| NVIDIA | 标准 PaddleOCR (PP-OCRv5) | `paddlepaddle-gpu` (最新) + `paddleocr` (最新) |
| AMD | 标准 PaddleOCR (PP-OCRv5) | `paddlepaddle-gpu[rocm]` (最新) + `paddleocr` (最新) |
| Intel Arc | PaddleOCR-VL | `paddlepaddle-gpu` (最新) + `paddleocr-vl` (最新) |
| Apple Silicon | PaddleOCR-VL | `paddlepaddle` (arm64 最新) + `paddleocr-vl` (最新) |
| 无 GPU | 标准 PaddleOCR (CPU) | `paddlepaddle` (最新) + `paddleocr` (最新) |

**不写死版本号**，程序通过 pip 获取最新稳定版。

## 检测策略

**硬件检测**：
- Windows: `nvidia-smi` → NVIDIA；`rocm-smi` → AMD；WMI `Win32_VideoController` → Intel/其他
- macOS: `system_profiler SPDisplaysDataType` + `uname -m` → Apple Silicon / Intel
- Linux: `lspci | grep -i vga` → GPU 类型

**PaddlePaddle API 检测**（装好后验证）：
- `paddle.device.is_compiled_with_cuda()` → 是否 GPU 版
- `paddle.device.device_count()` → 可用 GPU 数

## 修改清单

### 1. `.env` — 新增配置

```env
# OCR 设备选择: auto (自动检测+自动安装), cpu (强制CPU), gpu (强制GPU)
OCR_DEVICE=auto
```

### 2. `server/ocr_service.py` — 核心逻辑

**`_detect_hardware()`** — 跨平台 GPU 检测
- Windows: `nvidia-smi` / `rocm-smi` / WMI
- macOS: `system_profiler` / `uname -m`
- Linux: `lspci`

**`_get_current_package_info()`** — 当前环境检查
- paddlepaddle 包名 + 版本
- paddleocr / paddleocr-vl 是否安装
- `paddle.device.is_compiled_with_cuda()`

**`_get_latest_version(package_name)`** — 获取 PyPI 最新版本
- `pip index versions <package>` 或 PyPI JSON API

**`_switch_package(target_config)`** — 自动切换包
- 卸载旧包 → 安装目标包（最新版本）
- 打印进度

**`_select_and_setup()`** — 主流程
```
auto: 检测硬件 → 确定目标配置 → 对比当前 → 不同则切换 → 返回 device
cpu: 不切换，返回 cpu
gpu: 切换到 GPU 包 → 返回 gpu
```

**`get_engine()`** — 懒加载，调用 `_select_and_setup()`

### 3. `server/server.py` — `/api/ai/ocr/info` 端点

返回 OCR 状态：设备类型、GPU 是否可用、硬件信息、包版本。

### 4. `server/scripts/check_ocr_gpu.py` — 独立检测脚本

用户可手动运行 `python server/scripts/check_ocr_gpu.py` 查看检测结果或触发安装。

### 5. `server/requirements.txt` — 仅基础声明

```
# PaddleOCR 依赖（程序自动检测硬件并安装最高适配版本）
# 无需手动指定版本
```

## 运行日志示例

**首次启动（RTX 4060 + CPU 版）**：
```
[OCR] 检测到 GPU: NVIDIA GeForce RTX 4060
[OCR] 当前 paddlepaddle 为 CPU 版本，正在切换到 GPU 版本...
[OCR] 正在安装 paddlepaddle-gpu (最新版)...
[OCR] 安装完成，GPU 数量: 1
[OCR] GPU 加速已启用
```

**后续启动（已安装 GPU 版）**：
```
[OCR] 检测到 GPU: NVIDIA GeForce RTX 4060
[OCR] paddlepaddle-gpu 已安装，GPU 数量: 1
[OCR] GPU 加速已启用
```

**Apple Silicon**：
```
[OCR] 检测到 Apple Silicon (M3 Pro)
[OCR] 此平台建议使用 PaddleOCR-VL
[OCR] 正在安装 paddleocr-vl...
[OCR] 当前使用: PaddleOCR-VL (CPU)
```

## 验证步骤

1. 首次启动（RTX 4060 + CPU 版）：自动检测 → 自动装 GPU 版 → 启用加速
2. 后续启动：检测到 GPU 版已装 → 直接启用
3. `OCR_DEVICE=cpu`：强制 CPU，不切换包
4. macOS Apple Silicon：自动装 paddleocr-vl
5. `/api/ai/ocr/info`：返回完整状态
