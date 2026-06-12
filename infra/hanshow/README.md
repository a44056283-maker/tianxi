# 汉朔电子价签 Docker 联调骨架

更新时间：2026-05-25

## 目的

这套目录不是破解汉朔，也不是伪造“已完成安装”。

它的作用只有三个：

1. 在当前这台 Mac + Docker Desktop 上先搭起可用的联调运行环境
2. 给 `Shopweb / ESL-Working` 留出明确落包位置
3. 让后续厂商包一到位就可以直接验证启动

## 当前真实状态

已完成：

1. MySQL 8.0 容器
2. Tomcat 8.5 + JDK8 容器
3. ESL-Working 运行目录骨架
4. 日志目录
5. 数据目录

未完成：

1. `Shopweb` 正式 `war` 包未到位
2. `ESL-Working` 正式安装包未到位
3. 因此当前不能宣称“汉朔后台软件已完整安装成功”

## 目录说明

```text
infra/hanshow/
  docker-compose.yml
  README.md
  init/
  data/mysql/
  logs/tomcat/
  logs/eslworking/
  deploy/shopweb/
  deploy/eslworking/
```

## 端口规划

- Shopweb / Tomcat:
  - `http://127.0.0.1:18080`
- MySQL:
  - `127.0.0.1:13306`
- ESL-Working:
  - `http://127.0.0.1:19000`
  - 二代基站端口映射：`11234 -> 1234`
  - 一代基站 FTP 端口映射：`10021 -> 21`

说明：

- 因为当前主机已有大量本地服务，测试端口已统一做了外部偏移。
- 这不影响后续联调，只是本机避免冲突。

## 厂商包落地要求

### Shopweb

把厂商提供的 `shopweb*.war` 放到：

```text
infra/hanshow/deploy/shopweb/
```

建议最终命名为：

```text
shopweb.war
```

### ESL-Working

把厂商提供的 `ESL-Working-*.zip` 解压后目录内容放到：

```text
infra/hanshow/deploy/eslworking/
```

要求至少存在：

```text
bin/eslworking.sh
config/config.properties
lib/
```

## 启动

```bash
cd /Users/luxiangnan/Desktop/联想智慧零售项目/lenovo-smart-retail-cockpit/infra/hanshow
docker compose up -d
```

## 查看状态

```bash
cd /Users/luxiangnan/Desktop/联想智慧零售项目/lenovo-smart-retail-cockpit/infra/hanshow
docker compose ps
docker compose logs -f hanshow-mysql
docker compose logs -f hanshow-tomcat
docker compose logs -f hanshow-eslworking
```

## 当前判断

这台电脑可以作为：

1. 汉朔后台测试机
2. 接口联调机
3. 电子价签网关验证机

当前不应直接定义为：

1. 正式生产门店服务器
2. 厂商官方支持环境

因为 PDF 的官方口径仍是：

- Windows Server
- CentOS

而不是 macOS。
