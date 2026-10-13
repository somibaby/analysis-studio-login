"""Analysis Studio API (FastAPI).

Endpoints
  GET  /health                 - status + feature list (used by the app's "server" badge)
  POST /analyze                - run an analysis (big worksheets or SciPy-only tests)
  POST /import/excel           - .xlsx -> worksheets
  POST /reports/test           - email the signed-in user a report now
  POST /reports/run            - send all due scheduled reports (called by the daily schedule)
"""
import hmac

from fastapi import Depends, FastAPI, File, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from pydantic import BaseModel, Field

from . import reports
from .auth import current_user
from .config import settings
from .excel import read_workbook
from .stats import ANALYSES, AnalysisError, run

app = FastAPI(title="Analysis Studio API", version="1.0.0")
app.add_middleware(GZipMiddleware, minimum_size=2000)
app.add_middleware(CORSMiddleware, allow_origins=settings.allowed_origins, allow_methods=["GET", "POST"],
                   allow_headers=["Authorization", "Content-Type"], max_age=3600)


class AnalyzeIn(BaseModel):
    id: str
    cols: dict[str, dict] = Field(default_factory=dict)
    sel: dict = Field(default_factory=dict)
    opt: dict = Field(default_factory=dict)
    dec: int = 4
    alpha: float = 0.05


@app.get("/health")
def health():
    return {"ok": True, "analyses": sorted(ANALYSES), "excel": True, "reports": bool(settings.resend_api_key and settings.supabase_service_key)}


@app.post("/analyze")
async def analyze(body: AnalyzeIn, user: dict = Depends(current_user)):
    try:
        return run(body.id, body.cols, body.sel, body.opt, body.dec, body.alpha)
    except AnalysisError as e:
        raise HTTPException(422, str(e))


@app.post("/import/excel")
async def import_excel(file: UploadFile = File(...), user: dict = Depends(current_user)):
    data = await file.read(settings.max_upload_mb * 1024 * 1024 + 1)
    if len(data) > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(413, f"File is larger than {settings.max_upload_mb} MB.")
    try:
        sheets = read_workbook(data)
    except Exception:
        raise HTTPException(422, "That file could not be read as an Excel workbook (.xlsx).")
    if not sheets:
        raise HTTPException(422, "The workbook has no data.")
    return {"sheets": sheets}


@app.post("/reports/test")
async def report_test(user: dict = Depends(current_user)):
    try:
        return await reports.send_for_user(user["id"], user.get("email") or "")
    except RuntimeError as e:
        raise HTTPException(422, str(e))


@app.post("/reports/run")
async def report_run(x_cron_secret: str = Header(default="")):
    if not settings.cron_secret or not hmac.compare_digest(x_cron_secret, settings.cron_secret):
        raise HTTPException(403, "Forbidden")
    return await reports.run_due()
