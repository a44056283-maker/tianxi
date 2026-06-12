#今日水印相机 OpenAPI 对接 + 教育补凭证分类
**日期**：2026-06-10
**作者**：OpenClaw (main session, xhey-integration)
**状态**：DRAFT（等 key确认）
**优先级**：P1（与 #11 教育采集记忆收口联动）

---

##1.目标

把"今日水印相机"App拍的工作凭证通过 **OpenAPI主动拉取模式**，替代/补充当前"云盘 + OCR"链路：
- **API拉取 → 结构化水印元数据**（无需 OCR，准确度更高）
- **按水印关键词分类**：教育补 /库存流水 /销售 /采购 /其它
- **走现有 bridge API** 入 SQLite
- **现有链路兜底**：API失败时回落到云盘 OCR

##2.文档要点（来自 https://docs.xhey.top/docs/open-platform-server/）

###2.1接入模式
- **主动拉取**（推荐）：POST +签名
- **Webhook推送**：需提供公网回调 domain（暂不实施）

###2.2鉴权
- 算法：**HmacSHA256** → hex digest
- payload：序列化后的请求 body（**确认细节待 key验证通过后明确**）
-密钥：groupKey + groupSecret（按月更新）

###2.3已知 Endpoint（来自公开搜索 +文档）
|路径 | 方法 |用途 |
|------|------|------|
| `/v2/department/sublist` | POST |部门子列表 |
| `/v2/group/photo/search` | POST |拉取照片列表（按时间 +员工 + 水印关键词）|
| `/v2/group/info` | GET |团队信息 |
| `/v2/user/info` | GET |员工信息 |
| `/v2/photo/get` | GET | 单张照片详情 |

###2.4错误码
|码 |含义 |
|------|------|
|200 | success |
|2001 | 单次最多1000 条 |
|4007 | group key or secret错 |
|4010 | 单次最多180 天 |
|4011 |最多3 个 watermarkContent关键词 |
|4012 | 单关键词最长15字符 |

##3.实施步骤

### Step1：API客户端封装 `scripts/xhey_integration/xhey_client.py`
- HmacSHA256签名
- POST `/v2/group/photo/search`拉照片列表
- 支持按时间范围 +员工 + 水印关键词查询
- 环境变量读 `XHEY_GROUP_KEY` / `XHEY_GROUP_SECRET`

### Step2：水印分类器 `scripts/xhey_integration/watermark_classifier.py`
-关键词 →分类映射（教育补/库存/销售/采购/其它）
- 返回结构化字段：员工 ID、时间、SN、订单号、金额

### Step3：worker `scripts/xhey_integration/xhey_pull_worker.py`
- 每5 分钟扫描
-拉取最近5 分钟照片
- 按关键词分类
-调现有 `bridge API /api/collection/v1/submit` 入库
-移动到 `processed/{date}/{staff}/`

### Step4：集成到现有 `watermark_camera_sync.py`
-优先 API源（更快、更准）
-兜底云盘源（API失败时）
- 共用 `processed/` 输出目录

### Step5：测试 +部署
-单元测试（mock HTTP）
-端到端：真 API key +真实员工 +真实水印照片
- launchd 配置：`com.lenovo-smart-retail.xhey-pull-worker.plist`

##4. 当前阻塞

**key/secret验证未通过**：
- 用 `d92a8d58c79186749c7c48f5b7f1b999` / `b5c1390fd8340e1238b47087e58563d8`
-试了30+签名变体（hex/base64/SHA1/key+body拼接/纯 body/纯 ts...）
-全部 `{"code":401,"msg":"verify error"}`
- 不在签名算法问题 → 是 **key本身在服务端不被接受**

**可能原因**：
1. key 是**预生产 /沙箱**环境（不是正式 OpenAPI）
2. secret复制时字符错误
3. key已被禁用 / 未激活（需要到 https://developer.xhey.top 控制台激活）
4. groupKey/secret 不匹配（张冠李戴）

**建议**：直接联系 xhey客服17360234063确认 key 是否有效。

##5.验收

### 完成定义
- [] `xhey_client.py` 单测通过（mock HTTP）
- [] `xhey_pull_worker.py`端到端跑通（真 API + 真员工 + 真水印）
- [] `watermark_classifier.py`关键词 →分类准确率 ≥95%
- [] `processed/{date}/{staff}/`路径下出现分类后的照片
- [] bridge API收到分类记录并写入 SQLite
- [] launchd守护进程运行，每5 分钟扫描一次
- [] 与现有云盘源共存，API优先

### 不算完成
- key验证未通过 → 仅完成 dry-run 代码
- 只跑一次手动测试 → 必须 launchd守护运行 ≥24h

##6. 不做的事

- 不动 SQLite 主表数据
- 不替换现有云盘源（先并存）
- 不启用 webhook（等用户后续要求）
- 不跳过现有 OCR链路（云盘源仍走 OCR）

##7. 相关文件

-现有 sync：`scripts/watermark_camera_sync.py`
-现有 bridge API：`apps/api-server/app/collection_bridge_api.py`
-现有 launchd：`infra/launchagents/com.lenovo-smart-retail.watermark-camera-sync.plist`
-知识库：`~/.openclaw/workspace/MEMORY.md`（xhey集成章节）
