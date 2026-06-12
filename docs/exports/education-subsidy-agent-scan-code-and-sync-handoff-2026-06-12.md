# 教育补代扫代码与新采集同步逻辑交接包

更新时间：2026-06-12  
项目根目录：`/Users/luxiangnan/Desktop/联想智慧零售项目/lenovo-smart-retail-cockpit`

## 1. 目的

这份交接包用于把“教育补代扫”当前已经存在的代码、运行逻辑、CLI 主链、今日水印相机同步链、SQL/API/前端收口链，完整交给更高阶模型继续完善规则、参数和实现。

本包不是“业务已最终收口”的声明，而是当前真实工程状态的代码地图和运行入口汇总。

## 2. 当前链路总览

当前教育补代扫已经不是单一微信群采集链，而是并存三条输入链：

1. `education_scan_record_v2` 本地录入 / API 录入链
2. 今日水印相机 VIP incoming 目录同步链
3. 今日相机网页分类文件夹 CLI 主链

它们最终都要汇入：

1. SQLite：`apps/api-server/data/retail-core.sqlite3`
2. 静态汇总快照：`apps/web-cockpit/public/data/latest-education-subsidy-agent-scan-summary.json`
3. 工作台 API：`/api/education-collection/workbench`
4. 前端页面：
   - `apps/web-cockpit/public/education-subsidy-2026/index.html`
   - `apps/web-cockpit/public/education-subsidy-2026/admin.html`
   - `apps/web-cockpit/src/App.tsx` 中的教育补代扫区块

## 3. 关键代码文件

### 3.1 API / SQLite / 静态快照层

1. `apps/api-server/app/edu_scan_v2_api.py`
   - `POST /api/education-scan/v2/records`
   - `GET /api/education-scan/v2/records`
   - `POST /api/education-scan/v2/sync-to-projection`
   - 作用：
     - 把手机端/脚本端教育补记录写入 `education_scan_record_v2`
     - 写证据表、校准日志、绩效归属
     - 触发投影同步

2. `apps/api-server/app/local_sync.py`
   - 当前教育补汇总收口核心
   - 作用：
     - 合并 `education_scan_record_v2` 与历史基线 summary
     - 过滤 test/debug/synthetic 记录
     - 识别显式群名
     - 重建 `latest-education-subsidy-agent-scan-summary.json`
     - 向 `apps/web-cockpit/public/data/` 写静态文件

3. `apps/api-server/app/education_collection_workbench_api.py`
   - `GET /api/education-collection/workbench`
   - 作用：
     - 给教育补采集工作台提供总览、最近记录、缺口信息、group summary
     - 从静态 summary 与 SQL 组合出工作台视图

4. `apps/api-server/app/main.py`
   - 主 FastAPI 入口
   - 作用：
     - 对外暴露教育补相关 API
     - 把教育补静态快照纳入通用数据输出链

### 3.2 CLI / 自动化 / 同步链

1. `apps/inventory-sync/src/cli.ts`
   - CLI 总入口
   - 教育补相关命令：
     - `sync-education-subsidy-cli`
     - `sync-education-subsidy-watermark-incoming`

2. `apps/inventory-sync/src/automation/scheduledTasks.ts`
   - 定时任务编排入口
   - 当前会调用教育补采集审计函数：
     - `inspectEducationSubsidyAgentScanAcquisition`

3. `apps/inventory-sync/src/storage/educationSubsidyAgentScanStore.ts`
   - 前端教育补快照结构定义
   - 定义：
     - `EducationSubsidyAgentScanRow`
     - `EducationSubsidyAgentScanSnapshot`
     - 多件套审计结构
   - 它是前端、审计、汇总口径的类型中心

### 3.3 今日相机 / 今日水印相机脚本层

1. `scripts/run_education_subsidy_cli_sync.py`
   - CLI 主编排脚本
   - 真实链路：
     - 跑 `watermark_camera_sync.py`
     - 扫描 `/private/tmp/xhey_web_folder_cli`
     - 逐目录调用 `xhey_web_folder_cli.py`
     - 跑 `repair_education_service_filtered_records.py`
     - 调 `/api/education-scan/v2/sync-to-projection`
     - 拉 `/api/education-collection/workbench`
     - 输出汇总报告

2. `scripts/watermark_camera_sync.py`
   - 今日水印相机 VIP incoming 同步脚本
   - 真实链路：
     - 扫描 WebDAV 挂载目录 incoming
     - 复制到 OCR staging
     - 本地 OCR
     - 尝试按 SN / 订单号 / 手机号匹配销售单
     - 构造记录 POST 到 `/api/education-scan/v2/records`
     - 成功转 processed，失败转 failed

3. `scripts/xhey_integration/xhey_web_folder_cli.py`
   - 今日相机网页分类文件夹 CLI 主链
   - 真实链路：
     - 输入 ZIP / 本地目录 / 下载 URL
     - 解压与图片遍历
     - OCR 提取
     - 教育补规则分类
     - 调用 Bridge API
     - 写 SQL / 投影

4. `scripts/repair_education_service_filtered_records.py`
   - 教育补修复脚本
   - 作用：
     - 修服务类误过滤记录
     - 修 serial OCR 记录
     - 再次触发 projection sync 与静态快照重写

### 3.4 配置与前端层

1. `config/watermark_camera_path_mapping.json`
   - 今日水印相机挂载路径
   - staff name → staff id 映射
   - OCR 服务地址
   - 教育补 API 地址

2. `apps/web-cockpit/public/education-subsidy-2026/index.html`
   - 教育补采集工作台
   - 通过工作台 API 展示总览、时间线、规则说明

3. `apps/web-cockpit/public/education-subsidy-2026/admin.html`
   - 教育补管理端
   - 当前加入了：
     - 占位记录过滤
     - 展示层去重
     - 管理端本地修订与同步

4. `apps/web-cockpit/src/App.tsx`
   - 总驾驶舱中的教育补贴群代扫、智店通入库群代扫、异常/核销、多件套视图
   - 当前也包含：
     - 前端展示门禁
     - 分组视图
     - 多件套聚合
     - 同手机号/同订单候选逻辑的一部分

## 4. 当前运行逻辑

### 4.1 v2 记录写入链

入口：

- `/api/education-scan/v2/records`

写入动作：

1. 校验员工
2. 生成 `record_id`
3. 计算：
   - `total_education_discount_amount`
   - `total_service_fee`
   - `total_zhixiangjin`
4. 写入表：
   - `education_scan_record_v2`
   - `education_scan_evidence`
   - `education_scan_calibration_log`
5. 计算绩效归属

### 4.2 今日水印相机 incoming 同步链

入口：

- `python3 scripts/watermark_camera_sync.py --once`
- 或 `node --import tsx/esm src/cli.ts sync-education-subsidy-watermark-incoming`

逻辑：

1. 扫描 `incomingDir`
2. 文件名 / EXIF / OCR 提取员工、时间、订单号、单扫/多件套
3. 调本地 OCR 服务 `http://127.0.0.1:8765`
4. 调教育补 API 进行：
   - `match-serial`
   - `match-order`
   - `match-phone`
5. 生成 v2 记录并写库
6. 归档图片
7. 输出 report

### 4.3 今日相机网页分类文件夹 CLI 主链

入口：

- `python3 scripts/run_education_subsidy_cli_sync.py`
- 或 `node --import tsx/esm src/cli.ts sync-education-subsidy-cli`

逻辑：

1. 扫描网页分类文件夹导出结果
2. 目录级调用 `xhey_web_folder_cli.py`
3. OCR 提取 + 分类规则判断
4. 按梁伟 / 郭晨臣 / 李建定等目标员工筛选
5. 调 bridge / API 入库
6. 修复被误过滤记录
7. 触发：
   - `/api/education-scan/v2/sync-to-projection`
   - `/api/education-collection/workbench`
8. 输出批次报告

### 4.4 投影 / 静态快照 / 前端同步链

当前真实同步顺序：

1. `education_scan_record_v2`
2. `local_sync.write_static_snapshots(...)`
3. 重写：
   - `apps/web-cockpit/public/data/latest-education-subsidy-agent-scan-summary.json`
   - `apps/web-cockpit/public/data/latest-education-agent-scan-sync-gap.json`
4. 工作台 API / 前端页面读取这些静态文件

## 5. 当前业务规则口径

### 5.1 群组口径

1. `教育补贴群`
   - 目标规则：普通教育补单扫
   - 目标服务费口径：`30 元 / 台`

2. `智店通入库群`
   - 目标规则：普通教育补 / 二件套 / 三件套 / 双屏两件套
   - 当前业务要求：
     - 同手机号不同商品可以组成多件套
     - 即使不是同一出库单，也可能升级为多件套

### 5.2 当前前端显示层新增门禁

当前 `App.tsx` 与 `admin.html` 都额外做了前端门禁：

1. 过滤 `latest-education-agent-scan-sync-gap.json`
2. 过滤 `待补采`
3. 过滤服务类商品：
   - 延保
   - 服务
   - 会员
   - 智惠
   - 保险
4. 过滤：
   - 无有效商品
   - 且无订单号
   - 且无 SN

注意：这只是“显示层过滤”，不等于源数据已经完全清洗。

## 6. 当前已知问题

这部分是交给更高阶模型时必须重点看的地方。

### 6.1 去重规则可能吞真实记录

当前前端和管理端去重键都以 `orderNumber` 优先。

结果：

- 同单号但不同手机号 / 不同 SN / 不同商品的真实记录，可能被压成 1 条。

重点位置：

- `apps/web-cockpit/src/App.tsx`
- `apps/web-cockpit/public/education-subsidy-2026/admin.html`

### 6.2 教育补贴群 30 元口径未完全从源数据层收口

虽然前端展示层按 30 元说明显示，但静态 summary / workbench API 当前仍可能带有 50 元口径残留。

重点位置：

- `apps/api-server/app/local_sync.py`
- `apps/api-server/app/education_collection_workbench_api.py`
- `apps/web-cockpit/public/data/latest-education-subsidy-agent-scan-summary.json`

### 6.3 同手机号跨单多件套规则未完全落地

当前多件套聚合主逻辑仍偏向按：

- `bundleMatchedOrderNumber`
- `orderNumber`
- `bundleGroupId`

聚合。

但业务要求是：

- 同手机号，即使不是同一出库单，也可升级为多件套。

重点位置：

- `apps/web-cockpit/src/App.tsx`
- `apps/inventory-sync/src/storage/educationSubsidyAgentScanStore.ts`
- 后端 bridge / 校准逻辑

### 6.4 占位数据仍有一部分只是在前端隐藏，没有彻底从源数据修掉

例如：

- 无商品
- 无订单
- 无 SN
- 仅有 OCR 身份证文本

这些记录当前很多是“源数据存在，前端不显示”。

## 7. 建议更高阶模型优先完善的方向

建议它优先输出以下内容：

1. 教育补代扫统一主模型：
   - 单扫
   - 普通教育补
   - 二件套
   - 三件套
   - 双屏两件套
   - 候选升级态

2. 去重主键规则：
   - 不能只按 `orderNumber`
   - 需要把 `手机号 + 商品指纹 + 日期 + SN` 一起纳入

3. 多件套升级规则：
   - 同手机号同日
   - 同手机号跨单但窗口期内
   - 同手机号电脑 + 平板 + 手机

4. 群组归属决策树：
   - 显式群名
   - staff / folder 来源
   - watermark 文本
   - bridge metadata

5. 30 元 / 50 元 / 130 元 / 150 元 / 300 元统一金额决策树

6. 数据层与显示层分离：
   - 原始事实表
   - 校准层
   - 对账展示层
   - 差异审计层

## 8. 推荐本地运行命令

### API

```bash
cd /Users/luxiangnan/Desktop/联想智慧零售项目/lenovo-smart-retail-cockpit/apps/api-server
uv run fastapi dev app/main.py --host 127.0.0.1 --port 8000
```

### 前端

```bash
cd /Users/luxiangnan/Desktop/联想智慧零售项目/lenovo-smart-retail-cockpit/apps/web-cockpit
pnpm dev --host 127.0.0.1
```

### 今日水印相机 incoming 同步

```bash
cd /Users/luxiangnan/Desktop/联想智慧零售项目/lenovo-smart-retail-cockpit
python3 scripts/watermark_camera_sync.py --once
```

### 今日相机网页分类文件夹 CLI 主链

```bash
cd /Users/luxiangnan/Desktop/联想智慧零售项目/lenovo-smart-retail-cockpit
python3 scripts/run_education_subsidy_cli_sync.py --min-date 2026-06-06
```

### CLI 入口

```bash
cd /Users/luxiangnan/Desktop/联想智慧零售项目/lenovo-smart-retail-cockpit/apps/inventory-sync
node --import tsx/esm src/cli.ts sync-education-subsidy-cli --min-date 2026-06-06
node --import tsx/esm src/cli.ts sync-education-subsidy-watermark-incoming
```

## 9. 本次打包包含内容

1. 这份说明 MD
2. 后端 API / 投影 / 工作台核心源码
3. CLI / 自动化 / 今日相机脚本
4. 今日水印相机配置
5. 前端工作台 / 管理端 / 主驾驶舱相关源码
6. 当前教育补 summary / gap 快照样本

## 10. 桌面输出

本次会额外在桌面生成：

1. 一个目录：
   - `教育补代扫代码与同步逻辑_2026-06-12`
2. 一个压缩包：
   - `教育补代扫代码与同步逻辑_2026-06-12.zip`

用于直接交给更高阶模型继续完善规则和参数。
