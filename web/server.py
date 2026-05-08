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

# AI 配置
AI_CONFIG = {
    'API_URL': 'https://coding.dashscope.aliyuncs.com/v1',
    'API_KEY': 'sk-sp-4cf0ff7b598444949af23ee397b4cdf9',
    'MODEL': 'qwen3.6-plus'
}

# NocoBase 配置
NOCOBASE_CONFIG = {
    'API_URL': 'http://121.17.49.100:13000/api',
    'API_TOKEN': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjEsInJvbGVOYW1lIjoicm9vdCIsImlhdCI6MTc3Nzk2NDY0NiwiZXhwIjoxODA5NTAwNjQ2LCJqdGkiOiIyMzhkYjk1Mi1hOWU0LTRjZmUtODM2NC05MTQzMDRhMDMzYzIifQ.CsK-Tj2kkfGr0DSR6QgcobwFJvy64s4fAYn3hEMjHS4'
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


class AccountingHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, directory=None, **kwargs):
        if directory is None:
            directory = os.path.dirname(os.path.abspath(__file__))
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
        if self.path.startswith('/api/'):
            self.handle_nocobase_proxy('GET')
        else:
            super().do_GET()

    def do_POST(self):
        if self.path == '/api/ai/parse':
            self.handle_ai_parse()
        elif self.path == '/api/ai/dispatch':
            self.handle_ai_dispatch()
        elif self.path.startswith('/api/'):
            self.handle_nocobase_proxy('POST')
        else:
            self.send_error(404, 'Not Found')

    def do_PUT(self):
        if self.path.startswith('/api/ai/prompt/'):
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

    def handle_ai_dispatch(self):
        """AI 意图识别和参数提取"""
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length)
            data = json.loads(body)
            user_text = data.get('text', '')
            learning_context = data.get('learning_context', '')
            print(f"[AI 分发] 收到请求，文本长度: {len(user_text)}")

            system_prompt = load_prompt('dispatch')
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

            print(f"[AI 分发] 调用 API: {AI_CONFIG['API_URL']}")
            with urllib.request.urlopen(req, timeout=60) as response:
                ai_response = json.loads(response.read().decode('utf-8'))
                content = ai_response['choices'][0]['message']['content'].strip()
                content = content.replace('```json', '').replace('```', '').strip()
                dispatch_result = json.loads(content)
                print(f"[AI 分发] 意图: {dispatch_result.get('intent')}, 置信度: {dispatch_result.get('confidence')}")

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

    def end_headers(self):
        """添加 CORS 头"""
        self.send_header('Access-Control-Allow-Origin', '*')
        super().end_headers()

    def log_message(self, format, *args):
        """简化日志"""
        print(f"[{self.log_date_time_string()}] {format % args}")


def main(port=8081):
    directory = os.path.dirname(os.path.abspath(__file__))
    os.chdir(directory)
    
    server = http.server.HTTPServer(('0.0.0.0', port), AccountingHandler)
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
