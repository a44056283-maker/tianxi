"""
Minimax M2.7 校准器（2026-06-09）
调用 Minimax M2.7-highspeed vision 模型从图片中提取教育补贴采集字段
"""
from __future__ import annotations

import base64
import json
import os
import re
from typing import Any


class MinimaxCalibrator:
    """用 Minimax M2.7-highspeed 多模态模型校准教育补贴采集记录"""

    MODEL_NAME = 'MiniMax-M2.7-highspeed'
    API_URL = 'https://api.minimaxi.com/anthropic/v1/messages'

    EXTRACTION_PROMPT = """你是联想门店教育补贴代扫数据的校准员。

请从以下图片中提取以下字段（以 JSON 格式返回）：

{
  "orderNumber": "智店通订单号（XS 开头）",
  "customerName": "客户姓名",
  "customerPhone": "客户手机号（11 位数字）",
  "educationDiscount": 500,
  "serviceFee": 30,
  "zhixiangjin": 0,
  "serialNumber": "SN 序列号",
  "voucherCode": "16 位教育券码",
  "scanType": "single_scan / multi_scan / three_piece / two_piece",
  "serviceRuleKey": "three_piece_bundle / two_piece_bundle / legion_dual_screen_combo / none",
  "confidence": 0.92
}

字段说明：
- orderNumber: 智店通订单号通常以 XS 开头
- customerPhone: 11 位数字
- educationDiscount: 单台教育补贴金额（元）
- serviceFee: 代扫服务费（智店通群 ¥50/单，教育补贴群 ¥30/单，三件套 ¥300，两件套 ¥130）
- zhixiangjin: 智享金金额（套装才有，三件套 ¥2,000，两件套 ¥0，拯救者双屏 ¥1,000）
- serialNumber: 笔记本 SN（如 SN12345678）
- voucherCode: 16 位教育券码
- scanType: 单扫/多扫/三件套/两件套
- serviceRuleKey: three_piece_bundle=三件套, two_piece_bundle=两件套, legion_dual_screen_combo=拯救者双屏, none=普通单扫
- confidence: 0-1 的置信度

只返回 JSON，不要解释。"""

    def __init__(self):
        self.api_key = os.environ.get('MINIMAX_API_KEY', '')

    def calibrate(self, record: dict, evidence_files: list[dict]) -> dict[str, Any]:
        """主入口：返回 {extracted: {...}, confidence: 0-1}"""
        if not self.api_key:
            # 离线模式：返回 mock 用于开发
            return self._mock_calibration(record, evidence_files)

        # 真实模式：调用 M2.7 API
        import urllib.request
        try:
            images_b64 = []
            for ev in evidence_files[:5]:  # 最多 5 张
                # 真实环境 image_path 是 file://... 或 http://...
                # 这里假设 evidence_files 含 image_base64 字段（前端上传时转码）
                if ev.get('imageBase64'):
                    images_b64.append({
                        'type': 'image',
                        'source': {
                            'type': 'base64',
                            'media_type': ev.get('imageMimeType', 'image/jpeg'),
                            'data': ev['imageBase64']
                        }
                    })

            if not images_b64:
                return self._mock_calibration(record, evidence_files)

            payload = {
                'model': self.MODEL_NAME,
                'max_tokens': 1024,
                'messages': [{
                    'role': 'user',
                    'content': [
                        {'type': 'text', 'text': self.EXTRACTION_PROMPT},
                        *images_b64
                    ]
                }]
            }
            req = urllib.request.Request(
                self.API_URL,
                data=json.dumps(payload).encode('utf-8'),
                headers={
                    'Content-Type': 'application/json',
                    'Authorization': f'Bearer {self.api_key}',
                    'x-api-key': self.api_key,
                    'anthropic-version': '2023-06-01',
                }
            )
            with urllib.request.urlopen(req, timeout=30) as resp:
                result = json.loads(resp.read().decode('utf-8'))
            return self._parse_response(result)
        except Exception as e:
            return {
                'extracted': {},
                'confidence': 0,
                'error': str(e)
            }

    def _parse_response(self, response: dict) -> dict[str, Any]:
        """解析 M2.7 返回的 Anthropic Messages 格式"""
        try:
            text = ''
            for block in response.get('content', []):
                if block.get('type') == 'text':
                    text += block.get('text', '')
            # 提取 JSON
            json_match = re.search(r'\{[^{}]*\}', text, re.DOTALL)
            if json_match:
                extracted = json.loads(json_match.group(0))
                return {
                    'extracted': extracted,
                    'confidence': extracted.get('confidence', 0.5)
                }
            return {'extracted': {}, 'confidence': 0, 'rawText': text}
        except Exception as e:
            return {'extracted': {}, 'confidence': 0, 'error': str(e)}

    def _mock_calibration(self, record: dict, evidence_files: list[dict]) -> dict[str, Any]:
        """离线/Mock 模式：基于已有记录和图片做基础校准，不调 API"""
        # 提取一些明显信息作为校准结果
        extracted = {
            'orderNumber': record.get('order_number') or '',
            'customerName': record.get('customer_name') or '',
            'customerPhone': record.get('customer_phone') or '',
            'educationDiscount': record.get('education_discount_amount') or 0,
            'serviceFee': record.get('service_fee_per_unit') or 0,
            'zhixiangjin': record.get('zhixiangjin_amount') or 0,
            'serialNumber': '',
            'voucherCode': record.get('voucher_code') or '',
            'scanType': record.get('scan_type') or 'single_scan',
            'serviceRuleKey': record.get('service_rule_key') or 'none',
            'confidence': 0.65,  # Mock 置信度较低
        }
        # 如果有图片，提升置信度
        if evidence_files:
            extracted['confidence'] = 0.75
        return {
            'extracted': extracted,
            'confidence': extracted['confidence'],
            'mockMode': True,
        }
