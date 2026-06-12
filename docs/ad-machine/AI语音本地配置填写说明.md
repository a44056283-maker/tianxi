# 广告机 AI 语音本地配置填写说明

更新时间：2026-05-26
适用页面：`/ad-machine/full-service.html`

## 目标
不把 API Key 写入仓库代码，由本机单独配置后自动生效。

## 步骤 1：创建本地配置脚本
在这个路径新建文件：

`apps/web-cockpit/public/ad-machine/config.local.js`

写入以下内容（把示例 key 改成你自己的）：

```js
window.__AD_MACHINE_LOCAL_CONFIG__ = {
  minimaxApiKey: '在这里填你的MiniMaxKey',
  voiceProvider: 'minimax'
}
```

## 步骤 2：页面自动读取
`full-service.html` 已支持自动读取 `config.local.js`。

读取优先级：
1. `config.local.js`
2. 本机 `localStorage`
3. 页面手动输入

## 步骤 3：验证
打开：

- `https://ad.tianlu2026.org/ad-machine/full-service.html`
- 或 `http://192.168.13.104:5174/ad-machine/full-service.html`

检查：
1. 语音模式自动切换到 `MiniMax TTS`
2. 点击“整页AI讲解”或模块内“本模块讲解”能正常播报

## 安全说明
- `config.local.js` 建议仅在本机/内网使用，不要提交到 Git。
- 如需轮换 key，只改 `config.local.js` 即可。
