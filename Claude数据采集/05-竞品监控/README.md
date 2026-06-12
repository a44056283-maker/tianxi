# 竞品监控

中文任务名：竞品监控  
taskName：`daily-competitor-monitor-check`

## 任务定位

来源固定为京东自营对应店铺。

品牌顺序固定：

1. Think
2. 华硕
3. 惠普
4. 华为

## 原始输入

放到：

- `原始输入/`

可包含：

- 当天页面截图
- 价格记录
- 商品链接

## 固定执行顺序

1. 打开已收藏店铺入口或已沉淀链接仓库
2. 逐条核对：
   - 配置
   - 国补前价
   - 国补后价
   - 活动
   - 教育补贴
3. 保存当天原始记录
4. 执行：
   - `bash scripts/run_scheduled_task.sh daily-competitor-monitor-check`
5. 读取任务报告

## 成功标准

- 命中正确店铺
- 确认链接落点和证据路径
- 按品牌分类整理

## 回执

回执写到：

- `运行回执/YYYY-MM-DD-竞品监控.md`

阻塞写到：

- `阻塞记录/YYYY-MM-DD-竞品监控.md`

