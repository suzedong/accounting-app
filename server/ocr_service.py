"""
PaddleOCR 独立服务
提供本地图片文字识别能力
"""

import base64
import io
import numpy as np
from PIL import Image

_engine = None


def get_engine():
    """懒加载 PaddleOCR 引擎（首次调用时加载模型）"""
    global _engine
    if _engine is None:
        from paddleocr import PaddleOCR
        print("[PaddleOCR] 正在加载模型...")
        _engine = PaddleOCR(use_angle_cls=True, lang='ch', use_gpu=False, show_log=False)
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
    result = engine.ocr(img_array)

    lines = []
    if result and result[0]:
        for line in result[0]:
            text = line[1][0]
            confidence = line[1][1]
            if confidence > 0.5:
                lines.append(text)

    full_text = '\n'.join(lines)
    print(f"[PaddleOCR] 识别完成，共 {len(lines)} 行，文本长度: {len(full_text)}")

    return {
        'text': full_text,
        'lines': lines
    }
