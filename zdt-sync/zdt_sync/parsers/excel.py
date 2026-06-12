from __future__ import annotations

from pathlib import Path
from typing import Any

import pandas as pd

from zdt_sync.utils import normalize_text


def parse_excel_records(path: str | Path, columns: list[str] | None = None) -> list[dict[str, Any]]:
    """Parse an Excel/CSV file downloaded from the back office.

    If columns are provided, the parser maps the first N columns to those field names.
    Otherwise it uses the spreadsheet headers.
    """
    path = Path(path)
    if path.suffix.lower() in {".csv", ".txt"}:
        df = pd.read_csv(path)
    else:
        df = pd.read_excel(path)
    df = df.dropna(how="all")
    if columns:
        usable = min(len(columns), len(df.columns))
        df = df.iloc[:, :usable]
        df.columns = columns[:usable]
    records: list[dict[str, Any]] = []
    for row in df.to_dict(orient="records"):
        cleaned = {str(k): normalize_text(v) for k, v in row.items() if normalize_text(v) != ""}
        if cleaned:
            records.append(cleaned)
    return records
