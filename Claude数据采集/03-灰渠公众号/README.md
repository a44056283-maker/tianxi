# 灰渠公众号

中文任务名：灰渠公众号  
taskName：`daily-gray-channel-check`

## 任务定位

目标：采集当天公众号原文或当天有效截图，生成灰渠报价库。

微信入口统一走网页端：

- `https://localhost:3001`

## 原始输入

当天必须至少有其一：

- 当天公众号原文文本
- 当天公众号截图

原始输入放到：

- `原始输入/`

建议文件名：

- `gray-wholesale-YYYY-MM-DD.txt`
- `gray-wholesale-YYYY-MM-DD.png`

## 固定执行顺序

1. 获取电脑操控槽位：
   - `bash scripts/computer_use_task_gate.sh acquire gray-channel-capture 80 灰渠公众号`
2. 进入目标公众号
3. 先扫当前状态，再点文章或菜单
4. 保存当天原文或截图到 `原始输入/`
5. 执行：
   - `bash scripts/run_scheduled_task.sh daily-gray-channel-check`
6. 读取报告，核查：
   - `quoteDate`
   - `isCarriedForward`
   - `executionOutcome`
7. 释放槽位

## 成功标准

- 进入正确公众号
- 识别当天原文与旧原文
- 落下当天 manual 原文文件
- 没有当天原文时，只写阻塞，不假装完成

## 回执

回执写到：

- `运行回执/YYYY-MM-DD-灰渠公众号.md`

阻塞写到：

- `阻塞记录/YYYY-MM-DD-灰渠公众号.md`

