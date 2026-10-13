"""Smoke test: runs every analysis on a 60,000-row sheet, Excel import and the PDF builder.
Run from backend/:  python -m tests.test_api
"""
import io, math, random
import numpy as np
from fastapi.testclient import TestClient
from openpyxl import Workbook
from app.main import app
from app.auth import current_user
from app import reports

app.dependency_overrides[current_user] = lambda: {"id": "u1", "email": "a@b.c"}
c = TestClient(app)
rng = np.random.default_rng(1)

def col(name, vals): return {"name": name, "vals": [str(v) for v in vals]}
N = 60000  # big-data sized
cols = {
  "0": col("Thickness", np.round(rng.normal(2.5, .02, N), 4)),
  "1": col("Temp", np.round(rng.normal(180, 2.5, N), 2)),
  "2": col("Pressure", np.round(rng.normal(6.9, .15, N), 3)),
  "3": col("Shift", [random.choice("ABC") for _ in range(N)]),
  "4": col("Line", [random.choice(["L1", "L2"]) for _ in range(N)]),
  "5": col("Life", np.round(rng.weibull(2.2, 300) * 1000, 1)),
}
cases = {
 "desc": {"vars": [0, 1]}, "t1": {"x": 0}, "t2": {"x": 0, "y": 2}, "tp": {"x": 1, "y": 2}, "norm": {"x": 0},
 "corr": {"vars": [0, 1, 2]}, "fit": {"y": 0, "x": 1}, "mreg": {"y": 0, "xs": [1, 2]}, "anova": {"vars": [0, 2]},
 "var2": {"x": 0, "y": 2}, "imr": {"x": 0}, "cap": {"x": 0}, "hist": {"x": 1}, "scatter": {"x": 1, "y": 0}, "box": {"vars": [0, 2]},
 "mw": {"x": 0, "y": 2}, "kw": {"vars": [0, 1, 2]}, "chi": {"a": 3, "b": 4}, "anova2": {"y": 0, "a": 3, "b": 4},
 "tukey": {"vars": [0, 1, 2]}, "boxcox": {"x": 5}, "weibull": {"x": 5},
}
opts = {"t1": {"mu": "2.5", "conf": "95"}, "t2": {"conf": "95"}, "tp": {"conf": "95"}, "cap": {"lsl": "2.44", "usl": "2.56"}}
import time
for aid, sel in cases.items():
    t = time.time()
    r = c.post("/analyze", json={"id": aid, "cols": cols, "sel": sel, "opt": opts.get(aid, {})})
    assert r.status_code == 200, (aid, r.text)
    j = r.json()
    assert j["tables"] or j["charts"], aid
    for ch in j["charts"]:
        for k in ("x", "y"): assert all(math.isfinite(v) for v in ch[k]), (aid, k)
        assert len(ch.get("dots", [])) <= 3000
    print(f"{aid:8s} ok {time.time()-t:5.2f}s {len(r.content)//1024:5d}KB  {j.get('verdict','')[:70]}")
# errors come back as 422 with a message
r = c.post("/analyze", json={"id": "cap", "cols": cols, "sel": {"x": 0}, "opt": {}}); assert r.status_code == 422, r.text; print("422:", r.json()["detail"])
# excel
wb = Workbook(); ws = wb.active; ws.title = "Run 1"; ws.append(["Temp", "Yield"]); [ws.append([170 + i, 50.5 + i * .5]) for i in range(10)]
ws2 = wb.create_sheet("Notes"); ws2.append([1, 2]); ws2.append([3, 4]); b = io.BytesIO(); wb.save(b)
r = c.post("/import/excel", files={"file": ("x.xlsx", b.getvalue())}); assert r.status_code == 200, r.text
print("excel", [(s["name"], s["rows"], [x["name"] for x in s["cols"]]) for s in r.json()["sheets"]])
# pdf
pins = [{"title": "Process Capability", "cat": "qual", "project_name": "Panel QC", "verdict": "Cpk = 1.48 → capable (≥ 1.33)", "vcls": "good",
         "tables": [{"head": ["Index", "Cp", "Cpk"], "rows": [["Within", "1.62", "1.48"]]}], "notes": ["σ within = M̄R / 1.128"]}]
pdf = reports.build_pdf(pins, "a@b.c"); print("pdf bytes", len(pdf))
print(c.get("/health").json())
