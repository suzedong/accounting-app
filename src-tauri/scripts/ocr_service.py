"""
PaddleOCR 服务 — GPU 自动检测与加速
自动检测硬件类型，选择并安装最适配的 PaddlePaddle/PaddleOCR 版本。
"""

import base64
import io
import os
import platform
import subprocess
import sys
import warnings
from contextlib import contextmanager, redirect_stderr, redirect_stdout
from importlib.metadata import PackageNotFoundError, version

import numpy as np
from PIL import Image

import sys

def _log(msg):
    """打印日志到 stderr，避免与 OCR 识别结果（stdout）混在一起"""
    print(f'[OCR] {msg}', file=sys.stderr)

@contextmanager
def _suppress_paddle_output():
    """抑制 PaddleX/PaddleOCR 的冗长日志（模型下载提示、颜色编码等）"""
    with open(os.devnull, 'w') as devnull:
        with redirect_stdout(devnull), redirect_stderr(devnull):
            yield

# 过滤 PaddlePaddle 的 ccache 警告
warnings.filterwarnings('ignore', message='No ccache found')

# ==================== 硬件 → 目标配置 ====================

class TargetConfig:
    def __init__(self, label, paddle_pkg, ocr_pkg, device, use_vl=False, extra_deps=None):
        self.label = label          # 人类可读名称
        self.paddle_pkg = paddle_pkg # paddlepaddle 包名
        self.ocr_pkg = ocr_pkg       # paddleocr 包名
        self.device = device         # 'cpu' / 'gpu'
        self.use_vl = use_vl         # 是否使用 VL 引擎
        self.extra_deps = extra_deps or []  # 额外依赖（VL 需要 paddlex[ocr]）

def _detect_hardware():
    """跨平台 GPU 检测，返回 TargetConfig"""
    system = platform.system()
    machine = platform.machine()

    if system == 'Darwin':  # macOS
        if machine in ('arm64', 'aarch64'):
            chip = _detect_apple_chip()
            return TargetConfig(
                label=f'Apple Silicon ({chip})',
                paddle_pkg='paddlepaddle',
                ocr_pkg='paddleocr',
                device='cpu',
                use_vl=False,
            )
        return TargetConfig(
            label='macOS Intel',
            paddle_pkg='paddlepaddle',
            ocr_pkg='paddleocr',
            device='cpu',
            use_vl=False
        )

    if system == 'Linux':
        gpu = _detect_linux_gpu()
        if 'nvidia' in gpu.lower():
            return TargetConfig(
                label=f'NVIDIA ({gpu})',
                paddle_pkg='paddlepaddle-gpu',
                ocr_pkg='paddleocr',
                device='gpu',
                use_vl=False
            )
        if 'amd' in gpu.lower() or 'radeon' in gpu.lower():
            return TargetConfig(
                label=f'AMD ({gpu})',
                paddle_pkg='paddlepaddle-gpu',
                ocr_pkg='paddleocr',
                device='gpu',
                use_vl=False
            )
        return TargetConfig(
            label='Linux (无 GPU)',
            paddle_pkg='paddlepaddle',
            ocr_pkg='paddleocr',
            device='cpu',
            use_vl=False
        )

    if system == 'Windows':
        gpu = _detect_windows_gpu()
        if 'nvidia' in gpu.lower():
            return TargetConfig(
                label=f'NVIDIA ({gpu})',
                paddle_pkg='paddlepaddle-gpu',
                ocr_pkg='paddleocr',
                device='gpu',
                use_vl=False
            )
        if 'amd' in gpu.lower() or 'radeon' in gpu.lower():
            return TargetConfig(
                label=f'AMD ({gpu})',
                paddle_pkg='paddlepaddle-gpu',
                ocr_pkg='paddleocr',
                device='gpu',
                use_vl=False
            )
        if 'intel' in gpu.lower():
            return TargetConfig(
                label=f'Intel Arc ({gpu})',
                paddle_pkg='paddlepaddle-gpu',
                ocr_pkg='paddleocr',
                device='gpu',
                use_vl=False
            )
        return TargetConfig(
            label='Windows (无 GPU)',
            paddle_pkg='paddlepaddle',
            ocr_pkg='paddleocr',
            device='cpu',
            use_vl=False
        )

    # 未知平台
    return TargetConfig(
        label=f'{system}/{machine} (未知)',
        paddle_pkg='paddlepaddle',
        ocr_pkg='paddleocr',
        device='cpu',
        use_vl=False
    )


def _detect_apple_chip():
    """检测 Apple Silicon 芯片型号"""
    try:
        result = subprocess.run(
            ['sysctl', '-n', 'machdep.cpu.brand_string'],
            capture_output=True, text=True, timeout=5
        )
        if result.returncode == 0 and result.stdout.strip():
            return result.stdout.strip()
    except Exception:
        pass
    return 'Apple Silicon'


def _detect_linux_gpu():
    """检测 Linux GPU"""
    try:
        result = subprocess.run(
            'lspci 2>/dev/null | grep -i vga',
            shell=True, capture_output=True, text=True, timeout=5
        )
        if result.stdout.strip():
            return result.stdout.strip()
    except Exception:
        pass
    return ''


def _detect_windows_gpu():
    """检测 Windows GPU"""
    try:
        result = subprocess.run(
            'wmic path win32_videocontroller get name',
            shell=True, capture_output=True, text=True, timeout=5
        )
        if result.stdout.strip():
            return result.stdout.strip()
    except Exception:
        pass
    # 回退：nvidia-smi
    try:
        result = subprocess.run(
            ['nvidia-smi', '--query-gpu=name', '--format=csv,noheader'],
            capture_output=True, text=True, timeout=5
        )
        if result.stdout.strip():
            return result.stdout.strip()
    except Exception:
        pass
    return ''


# ==================== 包管理 ====================

def _get_installed_package(package_name):
    """获取已安装包信息，返回 (name, version) 或 None"""
    try:
        v = version(package_name)
        return (package_name, v)
    except PackageNotFoundError:
        return None


def _get_paddle_info():
    """获取当前 PaddlePaddle 运行时信息"""
    try:
        import paddle
        info = {
            'version': paddle.__version__,
            'has_cuda': False,
            'gpu_count': 0,
        }
        try:
            info['has_cuda'] = paddle.device.is_compiled_with_cuda()
            info['gpu_count'] = paddle.device.device_count()
        except Exception:
            pass
        return info
    except ImportError:
        return None


def _get_latest_version(package_name):
    """通过 PyPI JSON API 获取最新稳定版本"""
    import json
    import urllib.request
    try:
        url = f'https://pypi.org/pypi/{package_name}/json'
        req = urllib.request.Request(url, headers={'User-Agent': 'accounting-app/1.0'})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            return data['info']['version']
    except Exception as e:
        _log(f'获取 {package_name} 最新版本失败: {e}')
        return None


def _pip_install(package_name):
    """pip install 指定包（最新版）"""
    _log(f'正在安装 {package_name} (最新版)...')
    result = subprocess.run(
        [sys.executable, '-m', 'pip', 'install', '-q', '--upgrade', package_name],
        capture_output=True, text=True, timeout=600
    )
    if result.returncode == 0:
        _log(f'{package_name} 安装成功')
        return True
    else:
        _log(f'{package_name} 安装失败: {result.stderr[-500:]}')
        return False


def _pip_uninstall(package_name):
    """pip uninstall 指定包"""
    _log(f'正在卸载 {package_name}...')
    subprocess.run(
        [sys.executable, '-m', 'pip', 'uninstall', '-y', '-q', package_name],
        capture_output=True, text=True, timeout=60
    )


def _check_extra_deps(target):
    """检查 VL 额外依赖是否完整"""
    if not target.extra_deps:
        return True
    for dep in target.extra_deps:
        pkg_name = dep.split('[')[0]  # paddlex[ocr] → paddlex
        if not _get_installed_package(pkg_name):
            return False
    # 验证 VL 引擎能否加载
    try:
        from paddleocr import PaddleOCRVL
        return True
    except Exception:
        return False


def _switch_package(target):
    """切换到目标配置"""
    current = _get_installed_package(target.paddle_pkg)
    if current:
        _log(f'{target.paddle_pkg} 已安装 (v{current[1]})，跳过安装')
    else:
        # 卸载不匹配的 paddle 包
        for pkg in ['paddlepaddle', 'paddlepaddle-gpu']:
            if pkg != target.paddle_pkg and _get_installed_package(pkg):
                _pip_uninstall(pkg)
        _pip_install(target.paddle_pkg)

    # 确保 paddleocr 已安装
    ocr_installed = _get_installed_package(target.ocr_pkg)
    if ocr_installed:
        _log(f'{target.ocr_pkg} 已安装 (v{ocr_installed[1]})')
    else:
        _pip_install(target.ocr_pkg)

    # 安装额外依赖（VL 需要 paddlex[ocr]）
    if target.extra_deps and not _check_extra_deps(target):
        for dep in target.extra_deps:
            pkg_name = dep.split('[')[0]
            existing = _get_installed_package(pkg_name)
            if existing:
                _log(f'正在升级 {dep}...')
            else:
                _log(f'正在安装 {dep}...')
            _pip_install(dep)
    elif target.extra_deps:
        for dep in target.extra_deps:
            pkg_name = dep.split('[')[0]
            existing = _get_installed_package(pkg_name)
            if existing:
                _log(f'{dep} 已安装 (v{existing[1]})')

    return True


# ==================== 主流程 ====================

_engine = None
_device_mode = None

def _select_and_setup():
    """
    根据 OCR_DEVICE 环境变量选择并设置 OCR 环境
    返回 (target_config, setup_ok)
    """
    mode = os.environ.get('OCR_DEVICE', 'auto').strip().lower()

    if mode == 'cpu':
        target = TargetConfig('强制 CPU', 'paddlepaddle', 'paddleocr', 'cpu', use_vl=False)
        _log('强制 CPU 模式')
        return target, True

    if mode == 'gpu':
        target = _detect_hardware()
        _log(f'强制 GPU 模式: {target.label}')
        return target, _switch_package(target)

    # auto 模式
    target = _detect_hardware()
    _log(f'检测到硬件: {target.label}')

    if target.device == 'gpu':
        # 检查 GPU 版是否已装
        gpu_pkg = _get_installed_package(target.paddle_pkg)
        if gpu_pkg:
            _log(f'{target.paddle_pkg} 已安装 (v{gpu_pkg[1]})')
            paddle_info = _get_paddle_info()
            if paddle_info and paddle_info.get('gpu_count', 0) > 0:
                _log(f'GPU 加速已启用，GPU 数量: {paddle_info["gpu_count"]}')
                return target, True
            else:
                _log('GPU 版已安装但 GPU 不可用，尝试切换...')
                return target, _switch_package(target)
        else:
            _log('当前未安装 GPU 版 PaddlePaddle，正在安装...')
            return target, _switch_package(target)
    else:
        # CPU 设备（含 Apple Silicon）
        cpu_pkg = _get_installed_package(target.paddle_pkg)
        if cpu_pkg:
            _log(f'{target.paddle_pkg} 已安装 (v{cpu_pkg[1]})')
        else:
            _log(f'未安装 {target.paddle_pkg}，正在安装...')
            _switch_package(target)
        _log('使用 CPU 推理')
        return target, True


def get_engine():
    """懒加载 OCR 引擎（首次调用时检测硬件并加载模型）"""
    global _engine, _device_mode

    if _engine is not None:
        return _engine

    target, ok = _select_and_setup()
    _device_mode = target

    if not ok:
        raise RuntimeError(f'[OCR] 无法安装 {target.paddle_pkg}，请手动安装')

    if target.use_vl:
        try:
            _log('正在加载 PaddleOCR-VL 模型...')
            with _suppress_paddle_output():
                from paddleocr import PaddleOCRVL
                _engine = PaddleOCRVL()
            _log('PaddleOCR-VL 模型加载完成')
            return _engine
        except Exception as e:
            _log(f'PaddleOCR-VL 加载失败 ({e})，回退到标准 PaddleOCR')
            target.use_vl = False

    _log('正在加载 PaddleOCR 模型...')
    
    # 强制使用 CPU 模式，避免 GPU 版本兼容性问题
    device = 'cpu'
    
    with _suppress_paddle_output():
        from paddleocr import PaddleOCR
        
        # 尝试多种初始化方式，处理版本兼容性问题
        try:
            # 方式1: 尝试禁用文档预处理功能（解决 PaddleOCR 3.x 与 PaddlePaddle 2.x 不兼容问题）
            _engine = PaddleOCR(
                use_angle_cls=True, 
                lang='ch', 
                device=device,
                use_doc_orientation_classify=False,
                use_doc_unwarping=False,
                use_table=False,
                det_db_score_mode='fast'
            )
        except AttributeError as e:
            _log(f'方式1 失败 ({e})，尝试方式2...')
            try:
                # 方式2: 新版本 API（PaddleOCR 3.x）
                _engine = PaddleOCR(use_angle_cls=True, lang='ch', device=device)
            except AttributeError as e2:
                _log(f'方式2 失败 ({e2})，尝试方式3...')
                try:
                    # 方式3: 仅基础参数
                    _engine = PaddleOCR(lang='ch', device=device)
                except Exception as e3:
                    _log(f'方式3 失败 ({e3})，尝试方式4...')
                    try:
                        # 方式4: 禁用角度分类
                        _engine = PaddleOCR(use_angle_cls=False, lang='ch', device=device)
                    except Exception as e4:
                        _log(f'所有方式都失败 ({e4})，尝试自动降级安装兼容版本...')
                        # 方式5: 自动降级安装兼容版本的 PaddleOCR
                        try:
                            _log('正在安装兼容版本的 PaddleOCR...')
                            _pip_install('paddleocr==2.7.0')
                            
                            # 重新导入
                            import importlib
                            import paddleocr as paddleocr_module
                            importlib.reload(paddleocr_module)
                            from paddleocr import PaddleOCR
                            
                            _engine = PaddleOCR(use_angle_cls=True, lang='ch', device=device)
                            _log('降级安装 PaddleOCR 2.7.0 成功')
                        except Exception as e5:
                            raise RuntimeError(f'无法初始化 OCR 引擎: {e5}')
    
    _log('PaddleOCR 模型加载完成')

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
    
    # 设置函数级超时（防止无限循环）
    class TimeoutException(Exception):
        pass
    
    timeout_event = threading.Event()
    
    def timeout_checker(timeout_sec):
        timeout_event.wait(timeout_sec)
        if not timeout_event.is_set():
            _log(f'OCR 识别超时（{timeout_sec}秒）')
    
    # 启动超时检查线程（跨平台兼容）
    timeout_thread = threading.Thread(target=timeout_checker, args=(45,), daemon=True)
    timeout_thread.start()
    
    try:
        if not base64_str:
            return {'text': '', 'lines': []}
        # 移除 data URI 前缀
        if ',' in base64_str:
            base64_str = base64_str.split(',', 1)[1]

        # 验证 Base64 数据
        if len(base64_str) > 50 * 1024 * 1024:  # 限制最大 50MB
            _log('图片过大，超过 50MB 限制')
            return {'text': '', 'lines': []}

        # 安全解码 Base64
        try:
            image_bytes = base64.b64decode(base64_str)
        except Exception as e:
            _log(f'Base64 解码失败: {e}')
            return {'text': '', 'lines': []}

        # 验证图片数据大小
        if len(image_bytes) == 0:
            _log('图片数据为空')
            return {'text': '', 'lines': []}

        # 打开并验证图片
        img = Image.open(io.BytesIO(image_bytes))

        # 检查图片格式是否支持
        supported_formats = {'JPEG', 'PNG', 'BMP', 'GIF', 'WEBP'}
        if img.format and img.format not in supported_formats:
            _log(f'不支持的图片格式: {img.format}')
            return {'text': '', 'lines': []}

        # 转换为 RGB 模式（处理灰度、RGBA、CMYK 等模式）
        if img.mode not in ('RGB', 'L'):
            img = img.convert('RGB')

        # 图片尺寸限制（防止超大图片导致内存不足）
        max_size = 4096
        if img.width > max_size or img.height > max_size:
            _log(f'图片尺寸过大 ({img.width}x{img.height})，正在缩小')
            ratio = min(max_size / img.width, max_size / img.height)
            new_width = int(img.width * ratio)
            new_height = int(img.height * ratio)
            img = img.resize((new_width, new_height), Image.LANCZOS)

        # 转换为 numpy 数组
        img_array = np.array(img)

        # 获取引擎
        engine = get_engine()

        # 根据引擎类型选择调用方式
        if _device_mode and _device_mode.use_vl:
            # PaddleOCR-VL — 结果从 page.json['res']['parsing_res_list'] 提取
            result = engine.predict(img_array)
            lines = []
            if result:
                for page in result:
                    res = page.json.get('res', {})
                    parsing_list = res.get('parsing_res_list', [])
                    for block in parsing_list:
                        content = block.get('block_content', '').strip()
                        if content:
                            lines.append(content)
        else:
            # 标准 PaddleOCR - 支持多种返回格式
            result = engine.predict(img_array, use_doc_orientation_classify=False, use_doc_unwarping=False)
            lines = []
            
            # 尝试将结果转换为列表
            try:
                result_list = list(result) if not isinstance(result, list) else result
            except:
                result_list = []
            
            _log(f'PaddleOCR 返回类型: {type(result).__name__}, 长度: {len(result_list) if result_list else 0}')
            
            if result_list:
                # 调试：打印第一个结果的结构
                import json
                _log(f'第一个结果结构: {json.dumps(result_list[0], default=str, ensure_ascii=False)[:500]}')
                
                for page in result_list:
                    # 格式1: 字典格式，包含 rec_texts 和 rec_scores
                    if isinstance(page, dict):
                        rec_texts = page.get('rec_texts', []) or []
                        rec_scores = page.get('rec_scores', []) or []
                        if rec_texts:
                            _log(f'找到 {len(rec_texts)} 个识别结果')
                            for text, score in zip(rec_texts, rec_scores):
                                score = float(score) if score else 0
                                if score > 0.3 and text and text.strip():
                                    lines.append(text.strip())
                            continue
                    
                    # 格式2: 标准 PaddleOCR 格式 [[[bbox], (text, score)], ...]
                    # 外层列表，每个元素是 [[位置], (文字, 置信度)]
                    if isinstance(page, list):
                        _log(f'处理列表格式，长度: {len(page)}')
                        for item in page:
                            # 检查是否为 [[bbox], (text, score)] 格式
                            if isinstance(item, list) and len(item) >= 2:
                                # item[0] 是 bbox，item[1] 应该是 (text, score)
                                text_info = item[1]
                                if isinstance(text_info, tuple) and len(text_info) >= 2:
                                    text, score = text_info[0], float(text_info[1])
                                    _log(f'识别到文字: "{text}" (置信度: {score})')
                                    if score > 0.2 and text and text.strip():
                                        lines.append(text.strip())
                            # 也可能是直接的 (text, score) 元组
                            elif isinstance(item, tuple) and len(item) >= 2:
                                text, score = item[0], float(item[1])
                                _log(f'识别到文字(元组): "{text}" (置信度: {score})')
                                if score > 0.2 and text and text.strip():
                                    lines.append(text.strip())
                    
                    # 格式3: 直接是 (text, score) 元组
                    elif isinstance(page, tuple) and len(page) >= 2:
                        text, score = page[0], float(page[1])
                        _log(f'识别到文字(直接元组): "{text}" (置信度: {score})')
                        if score > 0.2 and text and text.strip():
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
        # 取消超时检查
        timeout_event.set()


def _get_device_status():
    """返回当前设备运行模式（CPU/GPU）"""
    try:
        import paddle
        if paddle.device.is_compiled_with_cuda():
            count = paddle.device.device_count()
            if count > 0:
                return f'GPU (x{count})'
        return 'CPU'
    except Exception:
        return '未知'


def get_ocr_info():
    """返回 OCR 状态信息（供 /api/ai/ocr/info 端点使用）"""
    target = _device_mode
    paddle_info = _get_paddle_info()

    paddle_pkg = target.paddle_pkg if target else None
    paddle_ver = None
    if target:
        pkg = _get_installed_package(target.paddle_pkg)
        if pkg:
            paddle_ver = pkg[1]

    latest_pp = _get_latest_version(paddle_pkg) if paddle_pkg else None
    latest_ocr = _get_latest_version(target.ocr_pkg) if target else None

    return {
        'mode': os.environ.get('OCR_DEVICE', 'auto'),
        'hardware': target.label if target else '未检测',
        'device': target.device if target else 'unknown',
        'use_vl': target.use_vl if target else False,
        'paddle_package': paddle_pkg,
        'paddle_version': paddle_ver,
        'paddle_latest_version': latest_pp,
        'ocr_package': target.ocr_pkg if target else None,
        'ocr_latest_version': latest_ocr,
        'gpu_available': paddle_info.get('gpu_count', 0) if paddle_info else 0,
        'engine_loaded': _engine is not None,
    }
