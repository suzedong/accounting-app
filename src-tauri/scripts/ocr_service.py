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
    # GPU 模式下使用 device='gpu'，否则 'cpu'
    device = 'gpu' if target.device == 'gpu' else 'cpu'
    with _suppress_paddle_output():
        from paddleocr import PaddleOCR
        _engine = PaddleOCR(use_angle_cls=True, lang='ch', device=device)
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
    if not base64_str:
        return {'text': '', 'lines': []}

    # 移除 data URI 前缀
    if ',' in base64_str:
        base64_str = base64_str.split(',', 1)[1]

    image_bytes = base64.b64decode(base64_str)
    img = Image.open(io.BytesIO(image_bytes))
    img_array = np.array(img)

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
        # 标准 PaddleOCR
        result = list(engine.predict(img_array, use_doc_orientation_classify=False, use_doc_unwarping=False))
        lines = []
        if result:
            for page in result:
                rec_texts = page.get('rec_texts', []) or []
                rec_scores = page.get('rec_scores', []) or []
                for text, score in zip(rec_texts, rec_scores):
                    if score > 0.5 and text:
                        lines.append(text)

    full_text = '\n'.join(lines)
    _log(f'识别完成，共 {len(lines)} 行，文本长度: {len(full_text)}')

    return {
        'text': full_text,
        'lines': lines
    }


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
