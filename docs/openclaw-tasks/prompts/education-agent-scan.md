你执行的是“智店通入库群教育补代扫箱码补扫”，不是普通微信浏览。

硬性浏览器规则：
1. 只能使用用户当前已经登录的默认 Chrome `user` 会话。
2. 只能复用 `127.0.0.1:9222` 上已经登录过的 Chrome 标签页。
3. 禁止打开新的浏览器、禁止打开空白浏览器、禁止新建 Chrome Profile、禁止清理登录缓存、禁止退出账号后重登。
4. 禁止使用 Browser/in-app browser/browser-use/Playwright/Puppeteer/Chromium launch 打开采集页面。
5. 如果当前 Chrome 会话未登录、出现二维码、验证码、白屏、安全验证、空白页或无法进入网页微信，立即写 `blocked_page_risk` 回执，不要另开浏览器。

先读取：
1. `/Users/luxiangnan/.openclaw/workspace/OPENCLAW_LENOVO_RETAIL_RULES.md`
2. `/Users/luxiangnan/Desktop/联想智慧零售项目/lenovo-smart-retail-cockpit/docs/openclaw-tasks/education-agent-scan.md`
3. `/Users/luxiangnan/Desktop/联想智慧零售项目/lenovo-smart-retail-cockpit/docs/ai-context/16_SCHEDULED_COLLECTION_RULE_PROMPT.md`

执行任务：
1. 复用现有 Chrome 已登录标签页打开或切到 `https://localhost:3001/`。
2. 从当前会话列表或右侧信息栏入口进入 `智店通入库群`，禁止用搜索栏搜索群名。
3. 从上次成功/阻塞/未扫描时间点开始补扫今天的教育补代扫。
4. 历史方向必须一直向上翻到上一次已确认的最后一张代扫教育补箱码图片，或明确找到上次已确认扫描边界。
5. 未到达这个箱码边界前，不允许判断无新增或已扫完。
6. 查看群图片优先进入群后打开看到的第一张相关照片，然后用图片查看器左箭头或键盘左键逐张向历史图片方向过图，不靠反复大滚动猜图，不随意左右来回试。
7. 每张图片、缩略图、上传状态卡、箱码截图都必须逐张打开或放大确认。
8. 必须一直向左核对到目标图片、对应箱码图、上传完成卡、核销成功卡和最后一次已经采集过的代扫教育补照片边界。
9. 记录每张图的时间、发送人、图片序号、是否箱码、是否教育补代扫、SKU/PN/SN/型号。
10. 箱码图、外箱标签图、上传完成卡、核销成功卡必须串成同一条记录。
11. 只看到核销成功卡、上传完成卡或代扫文字但未继续用图片左右键找到对应箱码，只能写 `executed_not_closed`。
12. 完成历史方向扫描后，再回到最新消息方向复扫一次，可疑区域二次回扫一次。

输出要求：
- 有新增代扫：写入 `apps/inventory-sync/artifacts/manual/education-agent-scan/education-agent-scan-YYYY-MM-DD-HHmm.json`。
- 阻塞或未收口：写入 `apps/inventory-sync/artifacts/manual/openclaw/receipts/education-agent-scan-YYYY-MM-DD-HHmm.json`。
- 采集后必须同步写入 SQL 主链，刷新前端，并检查前端教育补/出入库流水同步可见；未完成 SQL 与前端复核，不能写 `real_completed`。
- 汇报必须包含：是否复用现有 Chrome、是否进入智店通入库群、是否按左键方向到达上次已采集代扫照片边界、扫描时间范围、打开图片数量、箱码记录数量、SQL 写入结果、前端复核结果、阻塞原因、输出路径。
