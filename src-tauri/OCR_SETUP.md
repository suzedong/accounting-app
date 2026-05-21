# OCR 设置指南

## 方式一：macOS 快捷指令（推荐，零配置）

应用使用 macOS 内置的 Vision.framework 进行 OCR 识别，无需下载额外模型。

### 设置步骤

1. 打开 **快捷指令** App（macOS 自带）
2. 点击 **+** 新建快捷指令
3. 添加操作：搜索 **"从输入中提取文本"**（属于"文本"分类）
4. 将快捷指令命名为 **`提取图像中的文本`**
5. 保存

### 加载模型

在应用中调用 `load_ocr_models` 命令，传入任意存在的目录路径（macOS 模式下实际使用快捷指令，不读取模型文件）：

```typescript
import { loadOcrModels } from '@/api/tauri';
await loadOcrModels('/tmp'); // 任意有效路径即可
```

## 方式二：RapidOCR ONNX 模型（跨平台）

适用于 Windows/Linux 或需要更高精度的场景。

### 下载模型

```bash
cd src-tauri
mkdir -p models
./scripts/download_models.sh models
```

或手动从 [HuggingFace - RapidOCR](https://huggingface.co/SWHL/RapidOCR) 下载：
- `ch_PP-OCRv4_det_infer.onnx` — 文本检测
- `ch_ppocr_mobile_v2.0_cls_infer.onnx` — 文字方向分类
- `ch_PP-OCRv4_rec_infer.onnx` — 文字识别

### 加载模型

```typescript
import { loadOcrModels } from '@/api/tauri';
await loadOcrModels('/path/to/models');
```

## 前端使用

聊天窗口已内置图片上传功能：
1. 点击输入框左侧的 **🖼️** 按钮选择图片
2. 或直接粘贴截图
3. 图片会自动通过 OCR 识别文字，识别结果与用户输入的文本一起发送给 AI

```typescript
import { useOCR } from '@/composables/useOCR';

const { recognize, fileToBase64 } = useOCR();

// 识别图片
const file = event.target.files[0];
const dataUrl = await fileToBase64(file);
const text = await recognize(dataUrl.split(',')[1]);
console.log(text);
```
