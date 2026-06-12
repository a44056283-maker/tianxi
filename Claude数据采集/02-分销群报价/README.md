# 分销群报价

中文任务名：分销群报价  
taskName：`daily-price-channel-check`

## 任务定位

目标：采集当天分销群报价原始 Excel 或当天有效截图，并解析成分销报价库。

微信入口统一走网页端：

- `https://localhost:3001`

## 原始输入

当天必须至少有其一：

- 分销群当天报价 Excel
- 分销群当天有效截图

原始输入放到：

- `原始输入/`

建议文件名：

- `distributor-quotes-YYYY-MM-DD.xlsx`
- `distributor-quotes-YYYY-MM-DD.png`

## 固定执行顺序

1. 获取电脑操控槽位：
   - `bash scripts/computer_use_task_gate.sh acquire distributor-quote-capture 90 分销群报价`
2. 确认网页微信已登录
3. 先扫当前群名、日期、文件名
4. 只接受当天日期文件
5. 先保存原始文件或截图证据
6. 执行：
   - `bash scripts/run_scheduled_task.sh daily-price-channel-check`
7. 读取任务报告
8. 释放槽位：
   - `bash scripts/computer_use_task_gate.sh release distributor-quote-capture`

## 成功标准

- 命中正确群和正确文件
- 已确认落盘路径
- 能区分当天文件与旧文件
- 报告能读出是否真实完成

## 回执

回执写到：

- `运行回执/YYYY-MM-DD-分销群报价.md`

阻塞写到：

- `阻塞记录/YYYY-MM-DD-分销群报价.md`

