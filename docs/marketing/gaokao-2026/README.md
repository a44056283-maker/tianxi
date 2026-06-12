# 2026 高考营销活动素材

更新时间：2026-06-05

## 本地目录

- `raw/preview-only/`：已下载的百度网盘 JPG 预览图，仅用于活动方案和版式预览，不是印刷源文件。
- `download-attempts/`：百度网盘分享页、提取码校验结果、文件清单和下载尝试记录。

## 已识别的原始文件

### 高考拍照框

- `高考拍照框0524.jpg`，原始大小约 15.4 MB
- `高考拍照框0524.eps`，原始大小约 34.6 MB
- `高考拍照框0524.ai`，原始大小约 17.1 MB

### AI 海报 + 条幅

- 桌卡 5 张：拯救者三件套、三件套三重礼、YOGA 三件套、AI 学习装备、AI 帮填志愿
- 条幅 6 张：3.5x0.4m、4x0.5m、4.5x0.5m、5x0.5m、6x0.6m、7x0.6m
- 海报 5 张：拯救者三件套、三件套三重礼、YOGA 三件套、AI 学习装备、AI 帮填志愿

## 当前下载状态

- 提取码校验：已通过。
- 文件清单：已完整解析。
- JPG 预览图：已下载到 `raw/preview-only/`。
- 原始印刷文件：未下载成功。百度网盘下载接口返回 `errno=113`，提示验证码签名错误；当前命令行缺少页面运行时下载签名，BaiduPCS-Go 未登录临时环境也未能转存下载。

## 已生成前端入口

- `apps/web-cockpit/public/gaokao-2026/index.html`：高考活动入口页。
- `apps/web-cockpit/public/gaokao-2026/coupon.html`：B5 宽度优惠券双面五联打印版，单张 `176mm x 52mm`，A4 正面 5 张、背面 5 张；背面包含厂家人物素材、活动说明、扫码登记二维码和“门店盖章有效”区域。
- `apps/web-cockpit/public/gaokao-2026/mobile.html`：手机活动详情页，包含优惠权益、专业选机、电脑知识、抖音作品展示、AI 照片许愿、客户留资和脱敏展示。

## 门店门头素材

- 原始可见图片：`apps/web-cockpit/public/gaokao-2026/source/storefront-wechat-original.png`
- IMAGE2 优化图：`apps/web-cockpit/public/gaokao-2026/assets/storefront-hero-official.png`

- 原始合影：`apps/web-cockpit/public/gaokao-2026/source/wechat-group-photo-original.png`
- 高考拍照框合影：`apps/web-cockpit/public/gaokao-2026/assets/photo-frame-with-group.jpg`
- IMAGE2 融合版拍照框合影：`apps/web-cockpit/public/gaokao-2026/assets/photo-frame-with-group-image2.png`

当前手机页首页顶部使用 IMAGE2 融合版“高考必胜”拍照框合影作为主视觉，保留门店门头的小高度占位；门头图高度已加高，以露出“百脑汇商贸有限公司”等门店识别信息。

为改善手机端加载速度，首页首屏不直接加载原始 PNG 大图，而使用压缩后的 WebP：

- `apps/web-cockpit/public/gaokao-2026/assets/storefront-hero-mobile.webp`
- `apps/web-cockpit/public/gaokao-2026/assets/photo-frame-with-group-image2-mobile.webp`

原始 PNG 仍保留用于后续设计调整；手机页首屏图片使用预加载和淡入式加载，页面下方素材图使用懒加载。

厂家活动素材已改为“缩略图 + 点开查看”：

- 列表只加载 `*-thumb.webp`，缩略图约 3K-29K。
- 点击素材卡后才加载 `*-view.webp`，查看图约 15K-44K。
- 已覆盖 AI 学习装备、AI 帮填志愿、三件套三重礼、YOGA 三件套、拯救者三件套的海报/桌卡，以及 5m/7m 条幅。
- 查看层关闭时会清空大图地址，避免手机端持续占用图片资源。

当前优惠券有两个二维码：

```text
活动详情：
https://gaokao2026.tianlu2026.org/gaokao-2026/mobile.html

扫码登记：
https://gaokao2026.tianlu2026.org/gaokao-2026/mobile.html?campaign=gaokao2026&source=coupon_qr&action=e_coupon_claim#lead
```

正式独立网址确定后，需要重新生成：

- `apps/web-cockpit/public/gaokao-2026/assets/activity-qr.png`
- `apps/web-cockpit/public/gaokao-2026/assets/activity-lead-qr.png`

其中 `activity-lead-qr.png` 必须保留 `campaign/source/action` 参数，方便后续后台统计电子券扫码来源、客户留资和员工回访。

## 电子版优惠券

手机页已增加电子版优惠券领取模块：

- 活动日期：即日起至 `2026-06-21`。
- 发放机制：客户登记姓名、手机号、专业方向、预算、购机时间后，由后端发放电子券。
- 起止号规则：从 `LNV-GK-088` 开始，总数量 `999` 张，末号为 `LNV-GK-1086`。
- 去重规则：同一手机号重复登记，不重复占用券号，返回原电子券。
- 核销方式：到店出示电子券，广告机或广告机管理端调用核销接口。
- 广告机核销页：`apps/web-cockpit/public/ad-machine/gaokao-coupon-redeem.html`

后端接口：

```text
POST /api/marketing/gaokao-2026/e-coupons/claim
GET  /api/marketing/gaokao-2026/e-coupons/{code}
POST /api/marketing/gaokao-2026/e-coupons/redeem
```

核销请求示例：

```json
{
  "code": "LNV-GK-088",
  "operator": "ad-machine",
  "deviceId": "ad-machine-01",
  "note": "到店核销"
}
```

## 已建立后端接口

手机页留资已接入现有 FastAPI 后端，数据写入 `apps/api-server/data/retail-core.sqlite3` 的 `gaokao_2026_lead` 表；手机号按原文保存用于门店回访，同时生成 `phone_hash` 去重，手机页公开列表只返回脱敏姓名和脱敏手机号。

本地启动：

```bash
cd apps/api-server
uv run fastapi dev app/main.py --host 127.0.0.1 --port 8000
```

接口：

```text
POST /api/marketing/gaokao-2026/leads
GET  /api/marketing/gaokao-2026/leads?limit=8
GET  /api/marketing/gaokao-2026/summary
```

手机页提交规则：

- `https://gaokao2026.tianlu2026.org/gaokao-2026/mobile.html?campaign=gaokao2026&source=coupon_qr&action=e_coupon_claim#lead` 会把 `campaign/source/action` 一起写入后端。
- 后端启动时，表单提交写入 SQLite、发放电子券并刷新后端脱敏列表。
- 后端未启动时，页面回退到浏览器 `localStorage`，不影响现场演示；这类本机记录不等于后台已收集。

## 后续建议

用当前 Chrome 或百度网盘客户端手动下载原始文件后，放入：

```text
docs/marketing/gaokao-2026/raw/original/
```

原始文件到位后，再基于 `raw/original/` 做印刷输出、门店物料裁切和活动文案适配。
