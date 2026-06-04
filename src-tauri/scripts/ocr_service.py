"""
PaddleOCR 服务 — CPU 模式
使用 PaddleOCR 2.7.0 + PaddlePaddle 2.6.2 CPU 版本
"""

import base64
import io
import os
import sys
import warnings
from contextlib import contextmanager, redirect_stderr, redirect_stdout

import numpy as np
from PIL import Image

def _log(msg):
    """打印日志到 stderr，避免与 OCR 识别结果（stdout）混在一起"""
    print(f'[OCR] {msg}', file=sys.stderr)

@contextmanager
def _suppress_paddle_output():
    """抑制 PaddleOCR 的冗长日志"""
    with open(os.devnull, 'w') as devnull:
        with redirect_stdout(devnull), redirect_stderr(devnull):
            yield

# 过滤 PaddlePaddle 的 ccache 警告
warnings.filterwarnings('ignore', message='No ccache found')

# ==================== OCR 引擎 ====================

_engine = None

def get_engine():
    """懒加载 OCR 引擎（首次调用时加载模型）"""
    global _engine

    if _engine is not None:
        return _engine

    _log('正在加载 PaddleOCR 模型...')
    
    with _suppress_paddle_output():
        from paddleocr import PaddleOCR
        
        # PaddleOCR 2.7.0 使用 use_gpu=False 强制 CPU 模式
        _engine = PaddleOCR(
            use_angle_cls=True, 
            lang='ch', 
            use_gpu=False,
            det_db_score_mode='fast'
        )
    
    _log('PaddleOCR 模型加载完成 (CPU 模式)')
    return _engine


# ==================== 对外接口 ====================

def recognize_image(base64_str):
    """
    识别图片中的文字
    Args:
        base64_str: data URI 格式的 base64 字符串
    Returns:
        dict: { text: str, lines: list }
    """
    import threading
    
    timeout_event = threading.Event()
    
    def timeout_checker(timeout_sec):
        timeout_event.wait(timeout_sec)
        if not timeout_event.is_set():
            _log(f'OCR 识别超时（{timeout_sec}秒）')
    
    timeout_thread = threading.Thread(target=timeout_checker, args=(45,), daemon=True)
    timeout_thread.start()
    
    try:
        if not base64_str:
            return {'text': '', 'lines': []}
        
        # 移除 data URI 前缀
        if ',' in base64_str:
            base64_str = base64_str.split(',', 1)[1]

        # 验证 Base64 数据
        if len(base64_str) > 50 * 1024 * 1024:
            _log('图片过大，超过 50MB 限制')
            return {'text': '', 'lines': []}

        # 安全解码 Base64
        try:
            image_bytes = base64.b64decode(base64_str)
        except Exception as e:
            _log(f'Base64 解码失败: {e}')
            return {'text': '', 'lines': []}

        if len(image_bytes) == 0:
            _log('图片数据为空')
            return {'text': '', 'lines': []}

        # 打开并验证图片
        img = Image.open(io.BytesIO(image_bytes))

        supported_formats = {'JPEG', 'PNG', 'BMP', 'GIF', 'WEBP'}
        if img.format and img.format not in supported_formats:
            _log(f'不支持的图片格式: {img.format}')
            return {'text': '', 'lines': []}

        # 转换为 RGB 模式
        if img.mode not in ('RGB', 'L'):
            img = img.convert('RGB')

        # 图片尺寸限制
        max_size = 4096
        if img.width > max_size or img.height > max_size:
            _log(f'图片尺寸过大 ({img.width}x{img.height})，正在缩小')
            ratio = min(max_size / img.width, max_size / img.height)
            img = img.resize((int(img.width * ratio), int(img.height * ratio)), Image.LANCZOS)

        # 转换为 numpy 数组
        img_array = np.array(img)

        # 获取引擎并识别
        engine = get_engine()
        result = engine.ocr(img_array, cls=True)
        lines = []
        
        # PaddleOCR 2.7.0 返回格式: [[[[bbox], (text, score)], ...], ...]
        if result and len(result) > 0:
            for page in result:
                if isinstance(page, list):
                    for item in page:
                        if isinstance(item, list) and len(item) >= 2:
                            text_info = item[1]
                            if isinstance(text_info, tuple) and len(text_info) >= 2:
                                text, score = text_info[0], float(text_info[1])
                                if score > 0.3 and text and text.strip():
                                    lines.append(text.strip())
                        elif isinstance(item, tuple) and len(item) >= 2:
                            text, score = item[0], float(item[1])
                            if score > 0.3 and text and text.strip():
                                lines.append(text.strip())

        full_text = '\n'.join(lines)
        _log(f'识别完成，共 {len(lines)} 行，文本长度: {len(full_text)}')

        return {
            'text': full_text,
            'lines': lines
        }

    except Exception as e:
        _log(f'OCR 识别异常: {type(e).__name__}: {e}')
        import traceback
        _log(f'异常堆栈: {traceback.format_exc()[:2000]}')
        return {'text': '', 'lines': []}
    finally:
        timeout_event.set()


# ==================== 命令行入口 ====================

if __name__ == '__main__':
    import json
    
    if len(sys.argv) < 2:
        print(json.dumps({'error': '缺少 base64 参数'}))
        sys.exit(1)
    
    base64_input = sys.argv[1]
    result = recognize_image(base64_input)
    print(json.dumps(result, ensure_ascii=False))
