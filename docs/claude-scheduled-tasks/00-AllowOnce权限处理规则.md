# Claude 定时任务：Allow Once 权限处理规则

## 结论

如果任务执行过程中还需要点 `Allow Once`，这个流程就不能算真正自动化。

`Allow Once` 是权限边界，不应该用脚本、坐标点击、AppleScript 或 UI 自动化去自动点掉。正确做法是把定时任务设计成不触发 `Allow Once`。

## 自动化实现方式

### 允许自动化的部分

Claude 可以自动做：

- 读取项目内 Markdown 任务文件。
- 读取用户已经手动保存到本机的 Excel、截图、OCR 文本。
- 判断报价文件日期、来源和状态。
- 生成练习回执。
- 生成定时任务草案。
- 写入 `docs/claude-scheduled-tasks/receipts/`。

### 不允许自动化的部分

Claude 不可以自动做：

- 自动点击 `Allow Once`。
- 自动点击微信、公众号、聊天窗口。
- 自动运行脚本去操作微信。
- 自动绕过权限确认、验证码、登录确认、安全验证。
- 自动把未复核结果写进业务快照。

## 遇到 Allow Once 时的处理

如果 Claude 看到或触发 `Allow Once`：

1. 立即停止当前动作。
2. 不要点击。
3. 在回执中写：

```text
status: blocked_permission_prompt
blockingReason: 出现 Allow Once 权限确认，当前流程不能无人值守自动化
manualActionRequired: 用户需要手动授权，或改成文件桥/人工保存文件模式
```

4. 继续走文件桥方案：
   - 用户手动下载或保存报价文件。
   - Claude 只读取保存后的文件。
   - Claude 输出回执。

## 正确的定时任务形态

报价采集定时任务应分成两层：

### 1. 人工输入层

由用户手动完成：

- 打开或复用 Chrome `https://localhost:3001/` 网页微信；不打开微信桌面版。
- 点击群文件或公众号文章。
- 下载 Excel。
- 保存截图。
- 处理 `Allow Once`、登录、安全确认。

### 2. Claude 自动整理层

由 Claude 自动完成：

- 扫描固定目录是否出现当天文件。
- 检查文件日期。
- 读取任务规则。
- 判断状态。
- 生成回执。
- 提醒 Codex 是否可以进入同步。

## 推荐固定目录

后续请把人工保存的报价输入统一放到：

```text
docs/claude-scheduled-tasks/manual-inputs/
```

推荐命名：

```text
2026-05-17-分销群报价.xlsx
2026-05-17-灰渠公众号截图.png
2026-05-17-灰渠公众号OCR.txt
```

Claude 只检查这个目录和项目已有 artifacts，不主动控制微信。
