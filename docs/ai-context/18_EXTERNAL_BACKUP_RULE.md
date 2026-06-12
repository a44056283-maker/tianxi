# 采集外置备份规则（2026-05-28）

## 目标
- 每次采集任务成功并完成 SQL/前端同步后，自动把采集文档与图片归档到外挂硬盘。
- 每周做一次完整打包，保留可回溯历史。

## 自动规则
1. 触发点：`scripts/run_scheduled_task.sh` 成功结束后。
2. 执行脚本：`scripts/offload_collection_to_external.sh`。
3. 挂载要求：`/Volumes/TianLu_Storage` 必须存在。
4. 归档位置：`/Volumes/TianLu_Storage/联想智慧零售采集备份/daily/YYYY-MM-DD/`。
5. 归档范围：`apps/inventory-sync/artifacts/manual` 下图片/文档/JSON（仅迁移当天之前文件），并同步一份 `retail-core.sqlite3`。
6. 失败策略：外置盘未挂载或异常时仅告警，不阻断主任务。

## 每周打包
- 手动执行：`bash scripts/weekly_collection_bundle_to_external.sh`
- 输出位置：`/Volumes/TianLu_Storage/联想智慧零售采集备份/weekly/collection-YYYY-WW-*.tar.gz`

## 开关
- 关闭自动外置归档：
  `LENOVO_EXTERNAL_BACKUP_ENABLE=0 bash scripts/run_scheduled_task.sh <task-name>`
