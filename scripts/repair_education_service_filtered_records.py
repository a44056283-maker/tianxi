from __future__ import annotations

import json
import os
import sys
from pathlib import Path


def main() -> int:
    project_root = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(project_root / "apps" / "api-server"))
    from app import local_sync  # noqa: WPS433
    from app.collection_bridge_api import repair_serial_ocr_records, repair_service_filtered_records, trigger_projection_sync  # noqa: WPS433

    since_date = os.environ.get("EDU_SCAN_REPAIR_SINCE_DATE", "2026-06-06")
    service_result = repair_service_filtered_records(since_date)
    serial_result = repair_serial_ocr_records(since_date)
    projection = trigger_projection_sync()
    written = local_sync.write_static_snapshots(project_root / "apps" / "web-cockpit" / "public" / "data")
    print(json.dumps({
        "serviceRepair": service_result,
        "serialRepair": serial_result,
        "projectionSync": projection,
        "writtenCount": len(written),
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
