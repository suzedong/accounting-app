#!/bin/bash
# 下载 RapidOCR ONNX 模型文件
# 使用方法: ./download_models.sh [输出目录]
#
# macOS 用户注意：如果已安装 macOS 快捷指令「提取图像中的文本」，则无需下载这些模型。

set -e

MODEL_DIR="${1:-./models}"
mkdir -p "$MODEL_DIR"

echo "下载 RapidOCR ONNX 模型到: $MODEL_DIR"

# RapidOCR v4 模型 (来自 HuggingFace)
BASE_URL="https://huggingface.co/SWHL/RapidOCR/resolve/main"

echo "1/3 下载检测模型..."
curl -L -o "$MODEL_DIR/ch_PP-OCRv4_det_infer.onnx" \
  "${BASE_URL}/PP-OCRv4/det/ch_PP-OCRv4_det_infer.onnx" \
  2>/dev/null || echo "  ⚠️  下载失败，请手动从 ${BASE_URL} 下载"

echo "2/3 下载分类模型..."
curl -L -o "$MODEL_DIR/ch_ppocr_mobile_v2.0_cls_infer.onnx" \
  "${BASE_URL}/PP-OCRv4/cls/ch_ppocr_mobile_v2.0_cls_infer.onfer.onnx" \
  2>/dev/null || echo "  ⚠️  下载失败，请手动从 HuggingFace 下载"

echo "3/3 下载识别模型..."
curl -L -o "$MODEL_DIR/ch_PP-OCRv4_rec_infer.onnx" \
  "${BASE_URL}/PP-OCRv4/rec/ch_PP-OCRv4_rec_infer.onnx" \
  2>/dev/null || echo "  ⚠️  下载失败，请手动从 HuggingFace 下载"

echo ""
echo "下载完成！"
echo "请将 $MODEL_DIR 目录放在应用可访问的位置。"
echo "然后在 Tauri 应用中通过 load_ocr_models 命令加载。"
