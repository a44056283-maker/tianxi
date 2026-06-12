#!/usr/bin/env python3
"""
Lenovo ID Login 脚本 - 通过 CDP 连接 Chrome 并完成联想ID手机号登录
"""
import websocket, json, time, urllib.request, sys

# 凭证
PHONE = "15637798222"
PASSWORD = "Xy@06130822"

def get_cdp_ws():
    resp = urllib.request.urlopen('http://127.0.0.1:9222/json/version', timeout=5)
    data = json.loads(resp.read())
    return data['webSocketDebuggerUrl']

def send_cmd(ws, cmd_id, method, params=None):
    ws.send(json.dumps({'id': cmd_id, 'method': method, 'params': params or {}}))
    time.sleep(0.3)

def wait_for_text(ws, timeout=15):
    """等待页面加载完成"""
    start = time.time()
    while time.time() - start < timeout:
        ws.settimeout(1)
        try:
            msg = json.loads(ws.recv())
            if msg.get('method') == 'Page.loadEventFired':
                return True
        except:
            pass
    return False

def main():
    ws_url = get_cdp_ws()
    print(f'连接 Chrome CDP...')
    ws = websocket.create_connection(ws_url, timeout=10)
    print('已连接')

    # 启用域
    send_cmd(ws, 1, 'Page.enable')
    send_cmd(ws, 2, 'Runtime.enable')
    time.sleep(0.5)

    # 导航到联想ID手机登录页
    print('导航到联想ID登录页...')
    send_cmd(ws, 10, 'Page.navigate', {'url': 'https://sdcsso.lenovo.com/webauthn/preLogin?webauthn_action=uilogin&webauthn_realm=retail-family.lenovo.com&webauthn_callback=https://dqmsso.lenovo.com/v1.0/utility/lenovoid/oauth2/callback'})

    # 等待页面加载
    loaded = wait_for_text(ws, 15)
    print(f'页面加载: {loaded}')
    time.sleep(3)

    # 点击"使用手机号登录"
    print('点击"使用手机号登录"...')
    ws.send(json.dumps({'id': 20, 'method': 'Runtime.evaluate', 'params': {
        'expression': "(function(){ const links = Array.from(document.querySelectorAll('a')); for(let a of links) { if(a.innerText.includes('手机号')) { a.click(); return 'clicked'; } } return 'not found'; })()",
        'returnByValue': True
    }}))
    time.sleep(2)
    ws.settimeout(3)
    for _ in range(10):
        try:
            m = json.loads(ws.recv())
            if m.get('id') == 20:
                print('点击结果:', m.get('result', {}).get('result', {}).get('value'))
        except:
            pass

    time.sleep(2)

    # 填写手机号
    print('填写手机号...')
    ws.send(json.dumps({'id': 31, 'method': 'Runtime.evaluate', 'params': {
        'expression': "(function(){ const inputs = document.querySelectorAll('input[placeholder=\"手机号\"]'); if(inputs[0]) { inputs[0].value = '" + PHONE + "'; inputs[0].dispatchEvent(new Event('input',{bubbles:true})); return 'ok'; } return 'not found'; })()",
        'returnByValue': True
    }}))
    time.sleep(0.5)

    # 填写密码
    print('填写密码...')
    ws.send(json.dumps({'id': 32, 'method': 'Runtime.evaluate', 'params': {
        'expression': "(function(){ const inputs = document.querySelectorAll('input[placeholder=\"密码\"]'); if(inputs[0]) { inputs[0].value = '" + PASSWORD + "'; inputs[0].dispatchEvent(new Event('input',{bubbles:true})); return 'ok'; } return 'not found'; })()",
        'returnByValue': True
    }}))
    time.sleep(0.5)

    # 点击"下一步"（提交表单）
    print('点击"下一步"...')
    ws.send(json.dumps({'id': 40, 'method': 'Runtime.evaluate', 'params': {
        'expression': "(function(){ const links = Array.from(document.querySelectorAll('a')); for(let a of links) { if(a.innerText.includes('下一步') && !a.href.includes('javascript')) { a.click(); return 'clicked: ' + a.innerText; } } return 'not found'; })()",
        'returnByValue': True
    }}))
    time.sleep(0.5)
    ws.settimeout(3)
    for _ in range(10):
        try:
            m = json.loads(ws.recv())
            if m.get('id') == 40:
                print('下一步结果:', m.get('result', {}).get('result', {}).get('value'))
        except:
            pass

    # 等待登录结果
    print('等待登录跳转...')
    time.sleep(10)

    # 获取当前 URL
    ws.send(json.dumps({'id': 50, 'method': 'Runtime.evaluate', 'params': {
        'expression': 'window.location.href',
        'returnByValue': True
    }}))
    ws.settimeout(3)
    for _ in range(10):
        try:
            m = json.loads(ws.recv())
            if m.get('id') == 50:
                url = m.get('result', {}).get('result', {}).get('value', '')
                print('当前 URL:', url)
                if 'retail-pos' in url or 'retail-family' in url:
                    print('✅ 登录成功，跳转到零售后台!')
                else:
                    print('仍在联想ID页面')
        except:
            pass

    ws.close()
    print('完成')

if __name__ == '__main__':
    main()
