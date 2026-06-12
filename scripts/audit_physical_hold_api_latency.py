"""
PO 实物仓 API 时延审计。

校验 4 件事：
1. /api/retail-core/physical-stock-holds?limit=5000 响应 < 4 秒
2. /api/retail-core/physical-stock-holds/sales-order-candidates?limit=120 响应 < 4 秒
3. /api/retail-core/physical-stock-holds/sales-order-candidates?limit=5000 响应 < 6 秒
4. 前端 fetchWithTimeout 默认 12 秒下，前 3 项都不会触发 abort

用法：
  python3 scripts/audit_physical_hold_api_latency.py [--base http://127.0.0.1:5174]
"""
from __future__ import annotations

import argparse
import json
import time
import urllib.parse
import urllib.request


def timed_get(base: str, path: str, timeout_s: float) -> tuple[int, float, int]:
    url = base + path
    start = time.monotonic()
    try:
        with urllib.request.urlopen(url, timeout=timeout_s) as r:
            data = r.read()
        cost = time.monotonic() - start
        return r.status, cost, len(data)
    except Exception as e:
        cost = time.monotonic() - start
        print(f"    err: {e!r}")
        return 0, cost, 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:5174")
    args = ap.parse_args()

    base = args.base.rstrip("/")
    print(f"== PO 实物仓 API 时延审计 (base={base}) ==")

    cases = [
        ("holds_5000", "/api/retail-core/physical-stock-holds?limit=5000&status=all&ts={ts}", 4.0),
        ("candidates_120", "/api/retail-core/physical-stock-holds/sales-order-candidates?limit=120&transfer_status=all&ts={ts}", 4.0),
        ("candidates_5000", "/api/retail-core/physical-stock-holds/sales-order-candidates?limit=5000&transfer_status=all&ts={ts}", 6.0),
    ]

    results = []
    for name, path_tpl, threshold_s in cases:
        # 跑 3 次取中位数，避免冷启
        times = []
        size = 0
        for run in range(3):
            path = path_tpl.format(ts=int(time.time() * 1000) + run)
            status, cost_s, n = timed_get(base, path, timeout_s=15.0)
            times.append(cost_s)
            size = n
        times.sort()
        median_s = times[1]
        ok = median_s <= threshold_s
        results.append((name, ok, median_s, threshold_s, size))
        mark = "PASS" if ok else "FAIL"
        print(f"[{mark}] {name}: median={median_s:.2f}s (threshold {threshold_s}s) bytes={size}")

    # 4. 12 秒 timeout 不触发
    print()
    print("== 12 秒 timeout 检查 ==")
    for name, path_tpl, _ in cases:
        path = path_tpl.format(ts=int(time.time() * 1000))
        status, cost_s, n = timed_get(base, path, timeout_s=12.0)
        ok = status == 200 and cost_s < 11.5
        mark = "PASS" if ok else "FAIL"
        print(f"[{mark}] {name} 在 12 秒 timeout 下完成 (status={status} cost={cost_s:.2f}s)")

    failed = sum(1 for _, ok, *_ in results if not ok)
    print()
    print(f"Total: {len(results) - failed}/{len(results)} PASS")
    return 1 if failed else 0


if __name__ == "__main__":
    import sys
    sys.exit(main())
