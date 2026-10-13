"""Excel (.xlsx / .xlsm) import: every sheet becomes a worksheet of columns."""
import io
import math
from datetime import date, datetime, time

from openpyxl import load_workbook

MAX_ROWS = 1_000_000
MAX_COLS = 500


def _cell(v):
    if v is None:
        return ""
    if isinstance(v, bool):
        return "1" if v else "0"
    if isinstance(v, (int,)):
        return str(v)
    if isinstance(v, float):
        if not math.isfinite(v):
            return ""
        return repr(v) if v != int(v) or abs(v) >= 1e15 else str(int(v))
    if isinstance(v, (datetime, date, time)):
        return v.isoformat()
    return str(v).strip()


def read_workbook(data: bytes):
    wb = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    sheets = []
    for ws in wb.worksheets:
        rows = []
        for r in ws.iter_rows(values_only=True):
            rows.append([_cell(v) for v in r[:MAX_COLS]])
            if len(rows) > MAX_ROWS:
                break
        while rows and not any(rows[-1]):
            rows.pop()
        if not rows:
            continue
        width = max(len(r) for r in rows)
        while width > 0 and not any(len(r) >= width and r[width - 1] for r in rows):
            width -= 1
        if width == 0:
            continue
        head = rows[0] + [""] * (width - len(rows[0]))
        has_head = any(h and not _is_num(h) for h in head[:width])
        body = rows[1:] if has_head else rows
        cols = []
        for j in range(width):
            cols.append({"name": head[j] if has_head else "", "vals": [(r[j] if j < len(r) else "") for r in body]})
        sheets.append({"name": ws.title, "rows": len(body), "cols": cols})
    wb.close()
    return sheets


def _is_num(s):
    try:
        float(str(s).replace(",", ""))
        return True
    except ValueError:
        return False
