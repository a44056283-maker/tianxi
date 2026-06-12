# 第三方依赖说明

本 starter 包没有再分发第三方开源项目源码。它通过 `pyproject.toml`、`Dockerfile`、`scripts/install_*.sh` 声明并安装依赖。

主要依赖：

```text
Playwright for Python
Typer
SQLAlchemy
PostgreSQL Docker image
Redis Docker image
PyYAML
python-dotenv
openpyxl
pandas
pytest
```

上线前请由你们公司内部按开源合规流程确认许可证、版本、供应链安全和镜像来源。
