from __future__ import annotations

import json
import subprocess
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "docs" / "ai-context" / "snapshots"
LATEST_SNAPSHOT = ROOT / "docs" / "ai-context" / "latest-snapshot.md"
HANDOFF = ROOT / "docs" / "ai-context" / "09_CODEX_HANDOFF.md"
NEXT_ACTIONS = ROOT / "docs" / "ai-context" / "04_NEXT_ACTIONS.md"
TEST_LOG = ROOT / "docs" / "ai-context" / "10_TEST_LOG.md"


def run(cmd: list[str]) -> str:
    completed = subprocess.run(
        cmd,
        cwd=ROOT,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        check=False,
    )
    return completed.stdout.strip()


def read_text(path: Path, fallback: str = "") -> str:
    if not path.exists():
        return fallback
    return path.read_text(encoding="utf-8").strip()


def get_api_list() -> list[str]:
    text = run(["python3", "-c", "\n".join([
        "from pathlib import Path",
        "import re",
        "text = Path('apps/api-server/app/main.py').read_text(encoding='utf-8')",
        "routes = re.findall(r'@app\\.(get|post|put|delete)\\(\"([^\"]+)\"\\)', text)",
        "print('\\n'.join(f'{m.upper()} {p}' for m, p in routes))",
    ])])
    return [line for line in text.splitlines() if line.strip()]


def get_cli_list() -> list[str]:
    scripts: list[str] = []
    for rel in ["apps/inventory-sync/package.json", "apps/web-cockpit/package.json"]:
        path = ROOT / rel
        if not path.exists():
            continue
        payload = json.loads(path.read_text(encoding="utf-8"))
        for name, command in payload.get("scripts", {}).items():
            scripts.append(f"{rel}: {name} -> {command}")
    return scripts


def count_snapshots() -> dict[str, int]:
    web_latest = len(list((ROOT / "apps/web-cockpit/public/data").glob("latest-*.json")))
    artifacts_latest = len(list((ROOT / "apps/inventory-sync/artifacts").glob("latest-*")))
    docs_ai = len(list((ROOT / "docs/ai-context").glob("*.md")))
    return {
        "web_latest_json": web_latest,
        "artifact_latest_files": artifacts_latest,
        "ai_context_docs": docs_ai,
    }


def head_lines(text: str, limit: int = 12) -> str:
    lines = [line.rstrip() for line in text.splitlines() if line.strip()]
    return "\n".join(lines[:limit]) if lines else "无"


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M")
    out_path = OUT_DIR / f"snapshot-{stamp}.md"

    branch = run(["git", "branch", "--show-current"]) or "unknown"
    latest_commit = run(["git", "log", "-1", "--oneline"]) or "unknown"
    status = run(["git", "status", "--short"]) or "clean"
    api_list = get_api_list()
    cli_list = get_cli_list()
    counts = count_snapshots()

    current_task = head_lines(read_text(NEXT_ACTIONS, "无"))
    recent_test = head_lines(read_text(TEST_LOG, "无"))
    next_suggestion = head_lines(read_text(HANDOFF, "无"))

    content = f"""# Smart Retail Snapshot

生成时间：{datetime.now().strftime("%Y-%m-%d %H:%M:%S")}

## 1. 当前 Git 分支和最新提交

- 分支：`{branch}`
- 最新提交：`{latest_commit}`

## 2. git status

```text
{status}
```

## 3. 当前任务状态

```text
{current_task}
```

## 4. 当前数据快照数量

- `apps/web-cockpit/public/data/latest-*.json`：{counts["web_latest_json"]}
- `apps/inventory-sync/artifacts/latest-*`：{counts["artifact_latest_files"]}
- `docs/ai-context/*.md`：{counts["ai_context_docs"]}

## 5. 当前 API 列表

```text
{chr(10).join(api_list) if api_list else "无"}
```

## 6. 当前 CLI 命令列表

```text
{chr(10).join(cli_list) if cli_list else "无"}
```

## 7. 最近一次测试结果

```text
{recent_test}
```

## 8. 下一步建议

```text
{next_suggestion}
```
"""
    out_path.write_text(content, encoding="utf-8")
    LATEST_SNAPSHOT.write_text(content, encoding="utf-8")
    print(str(out_path))


if __name__ == "__main__":
    main()
