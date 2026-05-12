#!/usr/bin/env python3
"""
记账本 HTTP 服务器
提供静态文件服务 + AI 解析代理 + NocoBase API 代理
"""

import http.server
import json
import urllib.request
import urllib.error
import os
import sys
import warnings

# 过滤各类第三方库警告
warnings.filterwarnings('ignore', message='No ccache found')
warnings.filterwarnings('ignore', message='.*urllib3.*')
warnings.filterwarnings('ignore', message='.*OpenSSL.*')

def load_env():
    """从项目根目录的 .env 文件加载环境变量（纯标准库实现）"""
    env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '.env')
    if not os.path.exists(env_path):
        return
    with open(env_path, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            key, value = line.split('=', 1)
            os.environ.setdefault(key.strip(), value.strip())

load_env()

# OCR 服务（可选依赖，paddleocr 未安装时降级）
try:
    import ocr_service
    ocr_recognize = ocr_service.recognize_image
    from ocr_service import _detect_hardware, _get_installed_package, _get_device_status
    _hw_target = _detect_hardware()
    _hw_pkg = _get_installed_package(_hw_target.paddle_pkg)
    _hw_status = f'v{_hw_pkg[1]}' if _hw_pkg else '未安装'
    _ocr_device = os.environ.get('OCR_DEVICE', 'auto')
    _vl_tag = 'PaddleOCR-VL' if _hw_target.use_vl else 'PP-OCRv5'
    _device_status = _get_device_status()
    print(f"[OCR] PaddleOCR 模块已加载 | 硬件: {_hw_target.label} | PaddlePaddle: {_hw_status} | 引擎: {_vl_tag} | 运行: {_device_status} | 设备: {_ocr_device}")
except ImportError:
    ocr_recognize = None
    print("[OCR] PaddleOCR 未安装，OCR 功能不可用")

# AI 配置（环境变量优先，无则用默认值）
AI_CONFIG = {
    'API_URL': os.environ.get('AI_API_URL', 'https://coding.dashscope.aliyuncs.com/v1'),
    'API_KEY': os.environ.get('AI_API_KEY', ''),
    'MODEL': os.environ.get('AI_MODEL', 'qwen3.6-plus')
}

# NocoBase 配置
NOCOBASE_CONFIG = {
    'API_URL': os.environ.get('NOCOBASE_API_URL', 'http://121.17.49.100:13000/api'),
    'API_TOKEN': os.environ.get('NOCOBASE_API_TOKEN', '')
}

PROMPTS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'prompts')

def load_prompt(name):
    """从 prompts/ 目录读取 prompt 文件"""
    filepath = os.path.join(PROMPTS_DIR, f'{name}.md')
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            return f.read()
    except FileNotFoundError:
        print(f"[Prompt] 文件未找到: {filepath}")
        return ""


MAX_CONTEXT_CHARS = 2000


def build_learning_context(learning_data):
    """根据学习数据构建个性化规则文本"""
    if not learning_data:
        return ""

    context = "\n\n用户个性化规则（优先级最高，必须遵守）：\n"
    corrections = learning_data.get('corrections', {})

    if corrections:
        for keyword, correction in corrections.items():
            if correction.get('category'):
                context += f"- 提到「{keyword}」时，分类必须是「{correction['category']}」\n"
            if correction.get('payment'):
                context += f"- 提到「{keyword}」时，支付方式必须是「{correction['payment']}」\n"

    prefs = learning_data.get('preferences', {})
    if prefs.get('defaultAccount'):
        context += f"- 用户默认账户：{prefs['defaultAccount']}\n"
    if prefs.get('defaultPayment'):
        context += f"- 用户默认支付方式：{prefs['defaultPayment']}\n"

    return context


def build_conversation_context(history_entries, max_entries=10):
    """将最近对话历史格式化为 LLM 可读的上下文文本"""
    if not history_entries:
        return ""

    recent = history_entries[-max_entries:]

    context = "\n\n## 最近对话上下文（供参考，不要重复执行已完成的记录）\n"
    for entry in recent:
        msg_type = entry.get('type', '')
        content = entry.get('content', '')
        data = entry.get('data', {})

        if msg_type == 'user':
            context += f"[用户] {content}\n"
        elif msg_type == 'ai':
            truncated = content[:200] + '...' if len(content) > 200 else content
            context += f"[助手] {truncated}\n"
        elif msg_type == 'record-card':
            if data:
                context += (
                    f"[助手-已记录] {data.get('type', '')} "
                    f"{data.get('amount', '')}元 - {data.get('category', '')} "
                    f"({data.get('note', '')})\n"
                )
        # 跳过 query-result, stats-result, thinking 等冗长内容

    # 控制总长度
    if len(context) > MAX_CONTEXT_CHARS:
        while len(context) > MAX_CONTEXT_CHARS and len(recent) > 3:
            recent.pop(0)
            context = "\n\n## 最近对话上下文（供参考，不要重复执行已完成的记录）\n"
            for entry in recent:
                msg_type = entry.get('type', '')
                content = entry.get('content', '')
                data = entry.get('data', {})
                if msg_type == 'user':
                    context += f"[用户] {content}\n"
                elif msg_type == 'ai':
                    truncated = content[:200] + '...' if len(content) > 200 else content
                    context += f"[助手] {truncated}\n"
                elif msg_type == 'record-card':
                    if data:
                        context += (
                            f"[助手-已记录] {data.get('type', '')} "
                            f"{data.get('amount', '')}元 - {data.get('category', '')} "
                            f"({data.get('note', '')})\n"
                        )

    return context


class AccountingHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, directory=None, **kwargs):
        if directory is None:
            directory = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'web')
        self.directory = directory
        super().__init__(*args, directory=directory, **kwargs)

    def do_OPTIONS(self):
        """处理 CORS 预检请求"""
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        self.end_headers()

    def do_GET(self):
        """代理 NocoBase GET 请求"""
        if self.path == '/api/ai/ocr/info':
            self.handle_ocr_info()
        elif self.path.startswith('/api/ai/prompt/'):
            self.handle_get_prompt()
        elif self.path == '/api/ai/preference':
            self.handle_get_preference()
        elif self.path.startswith('/api/'):
            self.handle_nocobase_proxy('GET')
        elif self.path in ('/', '/index.html'):
            self.send_response(302)
            self.send_header('Location', '/pages/index.html')
            self.end_headers()
        else:
            super().do_GET()

    def do_POST(self):
        if self.path == '/api/ai/parse':
            self.handle_ai_parse()
        elif self.path == '/api/ai/dispatch':
            self.handle_ai_dispatch()
        elif self.path == '/api/ai/ocr':
            self.handle_ocr()
        elif self.path.startswith('/api/'):
            self.handle_nocobase_proxy('POST')
        else:
            self.send_error(404, 'Not Found')

    def do_PUT(self):
        if self.path == '/api/ai/preference':
            self.handle_update_preference()
        elif self.path.startswith('/api/ai/prompt/'):
            self.handle_update_prompt()
        elif self.path.startswith('/api/'):
            self.handle_nocobase_proxy('PUT')
        else:
            self.send_error(404, 'Not Found')

    def do_PATCH(self):
        if self.path.startswith('/api/'):
            self.handle_nocobase_proxy('PATCH')
        else:
            self.send_error(404, 'Not Found')

    def do_DELETE(self):
        if self.path.startswith('/api/'):
            self.handle_nocobase_proxy('DELETE')
        else:
            self.send_error(404, 'Not Found')

    def handle_nocobase_proxy(self, method):
        """代理 NocoBase API 请求"""
        try:
            # 构建目标 URL
            target_url = NOCOBASE_CONFIG['API_URL'] + self.path[len('/api'):]

            # 读取请求体
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length) if content_length > 0 else None

            # 构建请求
            headers = {
                'Content-Type': 'application/json',
                'Authorization': f"Bearer {NOCOBASE_CONFIG['API_TOKEN']}"
            }

            req = urllib.request.Request(
                target_url,
                data=body,
                headers=headers,
                method=method
            )

            print(f"[NocoBase 代理] {method} {target_url}")
            with urllib.request.urlopen(req, timeout=30) as response:
                response_data = response.read()
                response_status = response.status
                response_headers = dict(response.headers)

            # 返回响应
            self.send_response(response_status)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
            self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
            self.end_headers()
            self.wfile.write(response_data)

        except urllib.error.HTTPError as e:
            error_data = e.read()
            print(f"[NocoBase 代理] HTTP 错误 {e.code}: {error_data[:500]}")
            self.send_response(e.code)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(error_data)
        except Exception as e:
            print(f"[NocoBase 代理] 错误: {e}")
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({'error': str(e)}).encode('utf-8'))

    def handle_ai_parse(self):
        """代理 AI 解析请求（支持 learning_context）"""
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length)
            data = json.loads(body)
            user_text = data.get('text', '')
            learning_context = data.get('learning_context', '')
            print(f"[AI 代理] 收到请求，文本长度: {len(user_text)}")

            system_prompt = load_prompt('record')

            # 注入用户个性化偏好
            pref_filepath = os.path.join(PROMPTS_DIR, 'preferences.md')
            if os.path.exists(pref_filepath):
                with open(pref_filepath, 'r', encoding='utf-8') as f:
                    pref_content = f.read()
                system_prompt += '\n\n## 用户个性化偏好（优先级最高，必须遵守）\n' + pref_content

            if learning_context:
                system_prompt += learning_context

            # 调用阿里云百炼 API
            request_data = {
                'model': AI_CONFIG['MODEL'],
                'messages': [
                    {'role': 'system', 'content': system_prompt},
                    {'role': 'user', 'content': user_text}
                ],
                'temperature': 0.1,
                'response_format': {'type': 'json_object'}
            }

            req = urllib.request.Request(
                f"{AI_CONFIG['API_URL']}/chat/completions",
                data=json.dumps(request_data).encode('utf-8'),
                headers={
                    'Content-Type': 'application/json',
                    'Authorization': f"Bearer {AI_CONFIG['API_KEY']}"
                },
                method='POST'
            )

            print(f"[AI 代理] 调用 API: {AI_CONFIG['API_URL']}")
            with urllib.request.urlopen(req, timeout=60) as response:
                ai_response = json.loads(response.read().decode('utf-8'))
                print(f"[AI 代理] API 返回: {json.dumps(ai_response)[:200]}...")
                content = ai_response['choices'][0]['message']['content'].strip()
                # 移除可能的 markdown 代码块标记
                content = content.replace('```json', '').replace('```', '').strip()
                ai_result = json.loads(content)
                print(f"[AI 代理] 解析结果: {json.dumps(ai_result)}")

            # 返回结果
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps(ai_result).encode('utf-8'))

        except Exception as e:
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({'error': str(e)}).encode('utf-8'))

    def handle_ocr(self):
        """OCR 识别端点（委托给 ocr-service）"""
        try:
            if not ocr_recognize:
                self.send_response(503)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({'error': 'OCR 服务未安装'}).encode('utf-8'))
                return

            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length)
            data = json.loads(body)

            print(f"[OCR] 收到识别请求")
            result = ocr_recognize(data.get('base64', ''))

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps(result).encode('utf-8'))

        except Exception as e:
            print(f"[OCR] 错误: {e}")
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({'error': str(e)}).encode('utf-8'))

    def handle_ocr_info(self):
        """OCR 状态信息端点"""
        try:
            if not ocr_recognize:
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({'available': False, 'reason': 'OCR 服务未安装'}).encode('utf-8'))
                return

            # 从 ocr_service 导入 get_ocr_info
            from ocr_service import get_ocr_info
            info = get_ocr_info()
            info['available'] = True

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps(info).encode('utf-8'))
        except Exception as e:
            print(f"[OCR Info] 错误: {e}")
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({'error': str(e)}).encode('utf-8'))

    def handle_ai_dispatch(self):
        """AI 意图识别和参数提取（纯文本，OCR 由前端完成）"""
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length)
            data = json.loads(body)
            user_text = data.get('text', '')
            learning_context = data.get('learning_context', '')
            print(f"[AI 分发] 收到请求，文本长度: {len(user_text)}")

            system_prompt = load_prompt('dispatch')

            # 注入用户个性化偏好
            pref_filepath = os.path.join(PROMPTS_DIR, 'preferences.md')
            if os.path.exists(pref_filepath):
                with open(pref_filepath, 'r', encoding='utf-8') as f:
                    pref_content = f.read()
                system_prompt += '\n\n## 用户个性化偏好（优先级最高，必须遵守）\n' + pref_content

            if learning_context:
                system_prompt += learning_context

            conversation_history = data.get('conversation_history', [])
            conversation_context = build_conversation_context(conversation_history)
            if conversation_context:
                system_prompt += conversation_context

            # 调用阿里云百炼 API
            request_data = {
                'model': AI_CONFIG['MODEL'],
                'messages': [
                    {'role': 'system', 'content': system_prompt},
                    {'role': 'user', 'content': user_text}
                ],
                'temperature': 0.1,
                'response_format': {'type': 'json_object'}
            }

            req = urllib.request.Request(
                f"{AI_CONFIG['API_URL']}/chat/completions",
                data=json.dumps(request_data).encode('utf-8'),
                headers={
                    'Content-Type': 'application/json',
                    'Authorization': f"Bearer {AI_CONFIG['API_KEY']}"
                },
                method='POST'
            )

            print(f"[AI 分发] 调用 API: {AI_CONFIG['API_URL']}, 模型: {AI_CONFIG['MODEL']}")
            try:
                with urllib.request.urlopen(req, timeout=120) as response:
                    ai_response = json.loads(response.read().decode('utf-8'))
                    content = ai_response['choices'][0]['message']['content'].strip()
                    content = content.replace('```json', '').replace('```', '').strip()
                    dispatch_result = json.loads(content)
                    print(f"[AI 分发] 意图: {dispatch_result.get('intent')}, 置信度: {dispatch_result.get('confidence')}")
            except urllib.error.HTTPError as e:
                error_body = e.read().decode('utf-8')
                print(f"[AI 分发] HTTP 错误: {e.code} {e.reason}")
                print(f"[AI 分发] 响应体: {error_body}")
                raise

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps(dispatch_result).encode('utf-8'))

        except Exception as e:
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({'error': str(e)}).encode('utf-8'))

    def handle_update_prompt(self):
        """更新 prompt 文件（Agent 自修改能力）"""
        try:
            # 从 URL 提取 prompt 名称，如 /api/ai/prompt/dispatch
            prompt_name = self.path.split('/')[-1]
            # 安全校验：只允许 dispatch 和 record
            if prompt_name not in ('dispatch', 'record'):
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({'error': '只允许修改 dispatch 或 record'}).encode('utf-8'))
                return

            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length)
            data = json.loads(body)
            new_content = data.get('content', '')

            if not new_content:
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({'error': 'content 不能为空'}).encode('utf-8'))
                return

            filepath = os.path.join(PROMPTS_DIR, f'{prompt_name}.md')
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(new_content)

            print(f"[Prompt 更新] {prompt_name}.md 已更新，长度: {len(new_content)}")

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({'success': True, 'file': f'{prompt_name}.md'}).encode('utf-8'))

        except Exception as e:
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({'error': str(e)}).encode('utf-8'))

    def handle_get_prompt(self):
        """读取 prompt 文件内容"""
        try:
            prompt_name = self.path.split('/')[-1]
            if prompt_name not in ('dispatch', 'record'):
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({'error': '只允许读取 dispatch 或 record'}).encode('utf-8'))
                return

            content = load_prompt(prompt_name)
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({'content': content, 'file': f'{prompt_name}.md'}).encode('utf-8'))
        except Exception as e:
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({'error': str(e)}).encode('utf-8'))

    def handle_get_preference(self):
        """读取 preferences.md 文件内容"""
        try:
            filepath = os.path.join(PROMPTS_DIR, 'preferences.md')
            if not os.path.exists(filepath):
                default_content = '# 用户个性化偏好\n\n> 由用户自然语言反馈自动生成，优先级高于系统默认规则。\n\n## 备注格式\n（待用户反馈后填充）\n\n## 默认值\n- 默认账户：（空）\n- 默认支付方式：（空）\n'
                with open(filepath, 'w', encoding='utf-8') as f:
                    f.write(default_content)
                content = default_content
            else:
                with open(filepath, 'r', encoding='utf-8') as f:
                    content = f.read()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({'content': content, 'file': 'preferences.md'}).encode('utf-8'))
        except Exception as e:
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({'error': str(e)}).encode('utf-8'))

    def handle_update_preference(self):
        """更新 preferences.md 文件内容"""
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length)
            data = json.loads(body)
            new_content = data.get('content', '')
            if not new_content:
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({'error': 'content 不能为空'}).encode('utf-8'))
                return
            filepath = os.path.join(PROMPTS_DIR, 'preferences.md')
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(new_content)
            print(f"[Preference 更新] preferences.md 已更新，长度: {len(new_content)}")
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({'success': True, 'file': 'preferences.md'}).encode('utf-8'))
        except Exception as e:
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({'error': str(e)}).encode('utf-8'))

    def end_headers(self):
        """添加 CORS 头"""
        self.send_header('Access-Control-Allow-Origin', '*')
        super().end_headers()

    def log_message(self, format, *args):
        """简化日志"""
        print(f"[{self.log_date_time_string()}] {format % args}")


def main(port=8081):
    directory = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'web')
    os.chdir(directory)

    server = http.server.HTTPServer(('0.0.0.0', port), AccountingHandler)
    server.allow_reuse_address = True
    print(f"记账本服务器启动: http://0.0.0.0:{port}")
    print(f"静态文件目录: {directory}")
    print(f"AI 解析端点: http://localhost:{port}/api/ai/parse")
    print(f"AI 分发端点: http://localhost:{port}/api/ai/dispatch")
    
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n服务器已停止")
        server.server_close()


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8081
    main(port)
