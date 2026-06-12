FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml README.md /app/
COPY zdt_sync /app/zdt_sync

RUN pip install --no-cache-dir -U pip \
    && pip install --no-cache-dir -e '.[dev]' \
    && playwright install --with-deps chromium

COPY config /app/config
COPY scripts /app/scripts

ENTRYPOINT ["zdt-sync"]
