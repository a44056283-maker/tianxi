#!/usr/bin/env python3
from pathlib import Path
import sys


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(root / "apps" / "api-server"))

    from app import local_sync, product_library, retail_core  # noqa: E402

    data_dir = root / "apps" / "web-cockpit" / "public" / "data"
    retail_core.seed_reference_data(data_dir)
    product_library.seed_from_snapshots(data_dir)
    written = product_library.write_product_library_static_snapshots(data_dir)
    core_written = local_sync.write_static_snapshots(data_dir)
    print(f"Product library frontend snapshots refreshed: {len(written)} files")
    print(f"Retail core frontend snapshots refreshed: {len(core_written)} files")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

