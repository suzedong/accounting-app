"""
PaddleOCR 独立服务
提供本地图片文字识别能力
"""

import base64
import io
import os
import numpy as np
from PIL import Image

# Disable oneDNN to avoid ConvertPirAttribute2RuntimeAttribute error on Windows + PaddlePaddle 3.x
os.environ['FLAGS_use_mkldnn'] = '0'

_engine = None


def get_engine():
    """懒加载 PaddleOCR 引擎（首次调用时加载模型）"""
    global _engine
    if _engine is None:
        from paddleocr import PaddleOCR
        print("[PaddleOCR] 正在加载模型...")
        _engine = PaddleOCR(use_angle_cls=True, lang='ch', device='cpu')
        print("[PaddleOCR] 模型加载完成")
    return _engine


def recognize_image(base64_str):
    """
    识别图片中的文字
    Args:
        base64_str: data URI 格式的 base64 字符串
    Returns:
        dict: { text: str, lines: list }
    """
    if not base64_str:
        return {'text': '', 'lines': []}

    # 移除 data URI 前缀
    if ',' in base64_str:
        base64_str = base64_str.split(',', 1)[1]

    image_bytes = base64.b64decode(base64_str)

    # 转为 numpy array（PaddleOCR 2.x 需要 numpy 或文件路径）
    img = Image.open(io.BytesIO(image_bytes))
    img_array = np.array(img)

    engine = get_engine()
    # PaddleOCR 3.x 禁用文档方向分类和展开，避免对纯色/简单图片报错
    result = list(engine.predict(img_array, use_doc_orientation_classify=False, use_doc_unwarping=False))

    lines = []
    if result:
        # PaddleOCR 3.x: OCRResult 是 dict-like 对象，包含 rec_texts/rec_scores
        for page in result:
            rec_texts = page.get('rec_texts', []) or []
            rec_scores = page.get('rec_scores', []) or []
            for text, score in zip(rec_texts, rec_scores):
                if score > 0.5 and text:
                    lines.append(text)

    full_text = '\n'.join(lines)
    print(f"[PaddleOCR] 识别完成，共 {len(lines)} 行，文本长度: {len(full_text)}")

    return {
        'text': full_text,
        'lines': lines
    }
