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

DISPATCH_SYSTEM_PROMPT = """你是一个智能记账助手的意图识别和参数提取器。分析用户输入，判断意图并返回结构化 JSON。

## 支持的意图（intent）

### 1. record - 记账
当用户提到金额、花费、收入、交易时触发。
支持的输入格式：
- 口语表达："今天吃饭花了30元"、"收入5000工资"
- 银行通知：包含金额、时间、商户、卡号等结构化文本
- OCR截图文字：银行APP/微信/支付宝的交易截图文字
- 支付通知：支付宝/微信/银行APP的支付成功通知

金额识别规则（重要！）：
- 带符号的金额：`-83.47`、`-¥50.00`、`+100` 等，负号表示支出
- 不带符号的金额：`83.47`、`30元`、`¥50` 等，根据上下文判断收支
- 金额可以在任何位置，不一定紧跟"元"或"¥"
- 支付宝/微信通知中，金额通常在通知开头几行，格式如 `-83.47`

提取字段（record 时必须返回）：
{
    "intent": "record",
    "confidence": 0.0~1.0,
    "fields": {
        "amount": 金额数字（正数）,
        "type": "收入" 或 "支出",
        "category": "分类名称",
        "account": "账户名称（个人/家庭/公司）",
        "payment": "支付方式",
        "datetime": "YYYY-MM-DD HH:mm:ss",
        "note": "备注"
    }
}

### 2. query - 查询记录
当用户想查看记账记录时触发。
关键词：查账单、最近花了多少、本月支出、昨天记录等
返回：
{
    "intent": "query",
    "confidence": 0.9,
    "params": {
        "timeRange": "today|yesterday|week|month|last_month",
        "type": "expense|income|all",
        "category": "分类名（可选）",
        "account": "账户名（可选）"
    }
}

### 3. stats - 统计分析
当用户想看统计结果时触发。
关键词：分类统计、哪类花最多、账户排行、消费趋势、对比等
返回：
{
    "intent": "stats",
    "confidence": 0.9,
    "params": {
        "dimension": "category|account|payment|trend|comparison",
        "timeRange": "month|last_month|year",
        "type": "expense|income"
    }
}

### 4. budget - 预算管理
当用户想了解预算状态时触发。
关键词：预算还剩多少、超支了吗、预算设置
返回：
{
    "intent": "budget",
    "confidence": 0.9,
    "params": {}
}

### 5. chitchat - 闲聊/功能引导
打招呼、感谢、问功能等。
返回：
{
    "intent": "chitchat",
    "confidence": 0.95,
    "response": "友好回复，引导用户使用记账功能"
}

## 解析规则

### 类型判断
- 金额前有"-"号或出现"消费"字样 → type 必须是"支出"
- 出现"收入"/"工资"/"入账" → type 是"收入"
- 银行通知中的"消费"行表示支出

### 分类识别
支持的分类：餐饮、交通出行、购物、生活杂费、家庭支出、医疗、娱乐、学习、人情往来、零食水果、数码、服饰、通信费、其他

分类关键词：
- 通信费：话费、中国移动、中国联通、中国电信、中移金科、联通、电信、移动、充值、流量、宽带
- 餐饮：吃饭、餐、饭、外卖、咖啡、奶茶、饮料、早餐、午餐、晚餐、食堂、餐厅
- 交通出行：打车、地铁、公交、火车、飞机、加油、停车、车费、ETC、交通、乘车、网约车
- 购物：超市、淘宝、京东、购物、买、商场、网购、便利店、商店
- 生活杂费：水电、物业、网费、房租、租金、生活
- 家庭支出：家庭、家里、孩子、父母、家人
- 医疗：医院、药、看病、医疗、诊所、体检
- 娱乐：电影、游戏、KTV、娱乐、玩、唱歌、打球
- 学习：书、课程、培训、学习、学费、考试
- 人情往来：红包、礼金、礼物、送礼、份子钱
- 零食水果：零食、水果、小吃、点心、糖果
- 数码：手机、电脑、数码、电子、相机、平板
- 服饰：衣服、鞋、服饰、穿、帽子、裤子

### 支付方式
支持的支付方式：微信支付、支付宝、银行卡、现金、信用卡、花呗
- 从"信用卡4392********7502"提取为"招商银行信用卡 (7502)"，银行名从商户名推断

### 账户识别
- 只有明确出现"个人"/"自己"才识别为个人账户
- 出现"家庭"/"家里"才识别为家庭账户
- 出现"公司"/"企业"才识别为公司账户
- 单字"家"、"公"不匹配（避免"邻家便利店"误识别）
- 默认账户为"个人"

### 备注格式
- 话费：`运营商 + 话费`，如 `中国移动话费`
- 便利店：`商户名 - 支付方式`，如 `邻家便利店 - 微信支付`
- 餐饮堂食：`【堂食】_餐厅名`
- 外卖：`平台 - 商家名 外卖`
- 银行通知：根据商户名判断用途，如中移金科→`中国移动话费`
- 备注要简洁，不要包含"交易卡号"、"交易时间"等无关字段名

### 置信度判断
- 银行通知/结构化文本：confidence 0.95+
- 清晰口语表达（金额+类型+分类明确）：confidence 0.9+
- 信息不完整需要猜测：confidence 0.5~0.8
- 完全模糊/多义：confidence < 0.5
"""

# 基础记账解析 SYSTEM_PROMPT（/api/ai/parse 使用）
RECORD_SYSTEM_PROMPT = """你是一个专业的记账助手。请解析用户的输入，提取记账信息。

支持的分类：餐饮、交通出行、购物、生活杂费、家庭支出、医疗、娱乐、学习、人情往来、零食水果、数码、服饰、通信费、其他
支持的账户：个人、家庭、公司
支持的支付方式：微信支付、支付宝、银行卡、现金、信用卡、花呗

金额识别规则（重要！）：
- 带符号的金额：`-83.47`、`-¥50.00`、`+100` 等，负号表示支出
- 不带符号的金额：`83.47`、`30元`、`¥50` 等，根据上下文判断收支
- 金额可以在任何位置，不一定紧跟"元"或"¥"
- 支付宝/微信通知中，金额通常在通知开头几行，格式如 `-83.47`

请返回 JSON 格式（不要返回其他内容）：
{
    "amount": 金额（数字，正数），
    "type": "收入" 或 "支出"，
    "category": "分类名称",
    "account": "账户名称",
    "payment": "支付方式",
    "datetime": "时间（YYYY-MM-DD HH:mm:ss 格式，如果没有具体时间则用当前日期）",
    "note": "备注"
}

注意：
1. 金额必须是正数，type 字段区分收入/支出
2. 类型判断（非常重要！）：
   - 如果金额前有"-"号（如 -¥50.00），type 必须是"支出"
   - 如果出现"消费"字样，type 必须是"支出"
   - 如果出现"收入"/"工资"等，type 是"收入"
   - 银行交易通知中的"消费"行表示这是一笔支出
   - "入账时间"只是字段名，不代表收入，不要误判
3. 信用卡信息：从"信用卡4392********7502"提取为"招商银行信用卡 (7502)"（注意括号前有空格），银行名从商户名推断，尾号取最后4位
4. 账户识别：只有明确出现"个人"/"自己"才识别为个人账户，出现"家庭"/"家里"才识别为家庭账户，出现"公司"/"企业"才识别为公司账户。单字"家"、"公"不匹配（避免"邻家便利店"误识别为家庭账户）。默认账户为"个人"
5. 分类识别规则：
   - 通信费：话费、中国移动、中国联通、中国电信、中移金科、联通、电信、移动、充值、流量、宽带
   - 餐饮：吃饭、餐、饭、外卖、咖啡、奶茶、饮料、早餐、午餐、晚餐、食堂、餐厅
   - 交通出行：打车、地铁、公交、火车、飞机、加油、停车、车费、ETC、交通、乘车、网约车
   - 购物：超市、淘宝、京东、购物、买、商场、网购、便利店、商店
   - 生活杂费：水电、物业、网费、房租、租金、生活
   - 家庭支出：家庭、家里、孩子、父母、家人
   - 医疗：医院、药、看病、医疗、诊所、体检
   - 娱乐：电影、游戏、KTV、娱乐、玩、唱歌、打球
   - 学习：书、课程、培训、学习、学费、考试
   - 人情往来：红包、礼金、礼物、送礼、份子钱
   - 零食水果：零食、水果、小吃、点心、糖果
   - 数码：手机、电脑、数码、电子、相机、平板
   - 服饰：衣服、鞋、服饰、穿、帽子、裤子
6. 备注格式规范（重要！）：
   - 话费/通信费：`运营商 + 话费`，如 `中国移动话费`、`中国联通话费`、`中国电信话费`
   - 便利店/超市：`商户名 - 支付方式（付款渠道）`，如 `邻家便利店 - 收钱码收款（花呗）`
   - 餐饮堂食：`【堂食】_餐厅名 - 公司名`，如 `【堂食】_德州东站餐厅 - 北京李先生加州牛肉面大王有限公司`
   - 外卖：`平台 - 商家名 (门店) 外卖`，如 `淘宝闪购 - BONJOUR 本就 (沈阳铁西万象汇店) 外卖`
   - ETC 通行：`ETC - 起点站→终点站（附加说明）`，如 `ETC - 河北衡水站→河北深州东站（自动扣款）`
   - 订阅服务：`服务名 - 公司名`，如 `CleanMyMac X - 1 年订阅（Mac）`
   - 百货/超市：`商户名 - 支付方式（银行卡信息）`，如 `深州信誉楼百货 - 条码支付（招商银行信用卡 7502）`
   - 普通购物：`商户名 (备注)`，如 `深州信誉楼百货 (超市)`
   - 银行通知：根据商户名判断实际用途，如中移金科→`中国移动话费`，不要直接写商户名
   - 备注要简洁明了，只保留关键信息，不要包含无关的表格字段名（如"交易卡号"、"交易时间"、"入账时间"、"交易渠道"、"国家或地区"、"银行交易类型"等）
7. 如果无法确定某个字段，使用 null
8. 只返回 JSON，不要包含 markdown 代码块标记"""


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
        if self.path.startswith('/api/'):
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

            system_prompt = RECORD_SYSTEM_PROMPT
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

            system_prompt = DISPATCH_SYSTEM_PROMPT
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
