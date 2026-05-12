#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
OCR GPU 检测与自动安装脚本
用法:
    python check_ocr_gpu.py          # 显示检测结果
    python check_ocr_gpu.py --install # 强制执行安装/切换
    python check_ocr_gpu.py --info    # JSON 格式输出
"""

import json
import os
import sys

# 确保能导入 ocr_service（在 server/ 目录下）
_script_dir = os.path.dirname(os.path.abspath(__file__))
_server_dir = os.path.dirname(_script_dir)
sys.path.insert(0, _server_dir)


def main():
    args = sys.argv[1:]

    try:
        from ocr_service import (
            _detect_hardware,
            _get_installed_package,
            _get_paddle_info,
            _get_latest_version,
            _switch_package,
            _check_extra_deps,
            TargetConfig,
        )
    except ImportError as e:
        print(f'[错误] 无法导入 ocr_service: {e}')
        print('请确保在 server/ 目录下运行此脚本')
        sys.exit(1)

    mode = os.environ.get('OCR_DEVICE', 'auto').strip().lower()
    print(f'[OCR] 当前 OCR_DEVICE 设置: {mode or "auto (未设置)"}')

    target = _detect_hardware()
    print(f'[OCR] 检测到硬件: {target.label}')
    print(f'[OCR] 推荐配置: {target.paddle_pkg} + {target.ocr_pkg} (device={target.device})')
    if target.use_vl:
        print(f'[OCR] 引擎: PaddleOCR-VL (需要额外依赖: {", ".join(target.extra_deps)})')

    # 当前已安装包
    paddle_info = _get_paddle_info()
    print()
    print('[OCR] 当前环境:')

    for pkg in ['paddlepaddle', 'paddlepaddle-gpu']:
        installed = _get_installed_package(pkg)
        if installed:
            mark = ' ✅' if installed[0] == target.paddle_pkg else ' (不匹配)'
            print(f'  {pkg}: v{installed[1]}{mark}')

    ocr_installed = _get_installed_package('paddleocr')
    if ocr_installed:
        print(f'  paddleocr: v{ocr_installed[1]}')

    for dep in target.extra_deps:
        pkg_name = dep.split('[')[0]
        installed = _get_installed_package(pkg_name)
        if installed:
            print(f'  {dep}: v{installed[1]} ✅')
        else:
            print(f'  {dep}: 未安装 ❌')

    print(f'  VL 引擎可用: {"是" if _check_extra_deps(target) else "否"}')

    if paddle_info:
        print(f'  PaddlePaddle 版本: {paddle_info["version"]}')
        print(f'  GPU 可用: {"是" if paddle_info["has_cuda"] else "否"} (数量: {paddle_info["gpu_count"]})')

    # 最新版本
    print()
    latest_pp = _get_latest_version(target.paddle_pkg)
    latest_ocr = _get_latest_version(target.ocr_pkg)
    if latest_pp:
        print(f'[OCR] {target.paddle_pkg} 最新版: {latest_pp}')
    if latest_ocr:
        print(f'[OCR] {target.ocr_pkg} 最新版: {latest_ocr}')

    # --install: 强制安装/切换
    if '--install' in args:
        print()
        print('[OCR] 正在安装/切换...')
        ok = _switch_package(target)
        if ok:
            print(f'[OCR] ✅ 安装成功')
            paddle_info = _get_paddle_info()
            if paddle_info:
                print(f'[OCR] GPU 数量: {paddle_info.get("gpu_count", 0)}')
        else:
            print(f'[OCR] ❌ 安装失败')
            sys.exit(1)

    # --info: JSON 输出
    if '--info' in args:
        info = {
            'mode': mode,
            'hardware': target.label,
            'target_paddle_pkg': target.paddle_pkg,
            'target_ocr_pkg': target.ocr_pkg,
            'target_device': target.device,
            'use_vl': target.use_vl,
            'paddle_info': paddle_info,
            'latest_paddle': latest_pp,
            'latest_ocr': latest_ocr,
        }
        print()
        print(json.dumps(info, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
