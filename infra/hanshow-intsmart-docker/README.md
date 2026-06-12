# Hanshow Intsmart 本机 Docker 部署

用途：在当前 Mac 上用 Docker 启动汉朔 Intsmart 测试服务。

启动：

```bash
cd infra/hanshow-intsmart-docker
docker compose up -d --build
```

访问：

```text
https://127.0.0.1:8445
https://192.168.13.104:8445
```

边界：

- 不导入客户证书。
- 不连接真实价签平台。
- 不代表价签已下发。
- 当前使用 `linux/amd64` 兼容厂家 x86_64 `jsvc`，在 Apple Silicon 上会有转译开销。

## 当前实测状态

- `2026-05-25` 已在当前 Mac Docker Desktop 上启动成功。
- `hanshow-intsmart-mysql`：MySQL 5.7，端口 `3308`。
- `hanshow-intsmart`：Intsmart 3.0-beta10，端口 `8445` / `48446`。
- 局域网访问：`https://192.168.13.104:8445`。

常用命令：

```bash
./start.sh
./status.sh
./stop.sh
```

已做的适配：

- 使用 `linux/amd64` 运行厂家 x86_64 `jsvc`。
- 将 datasource 从 `127.0.0.1:3308` 改到 Docker 内部 `intsmart-mysql:3306`。
- 关闭 tray 图标。
- 清理残留 `integration-daemon.pid` 后启动。
- 给 MySQL 增加 Docker 内网访问授权。


## Chrome 证书提示处理

厂商包内 HTTPS 证书为自签证书，当前证书 `CN=hanshow`，没有可用于 `192.168.13.104` 的 SAN。后续采集、同步、配置必须优先沿用用户已经登录的浏览器窗口，不再新开隔离浏览器配置，以免丢失登录态。

如只是本机访问价签后台，优先使用 HTTP 入口避免证书提示：

```bash
./open-intsmart-http.sh
```

如必须使用 HTTPS，请在当前已登录浏览器窗口中手动信任或继续访问，不使用新的 Chrome Profile。
