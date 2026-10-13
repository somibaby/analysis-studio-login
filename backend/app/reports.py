"""Scheduled PDF reports of each user's pinned results, sent by email (Resend)."""
import base64
import io
import time
from datetime import datetime, timezone

import httpx
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from .config import settings

DAY = 86400
PERIOD = {"weekly": 6.5 * DAY, "monthly": 27.5 * DAY}
INK, VIOLET, LINE = colors.HexColor("#17132E"), colors.HexColor("#6D4AFF"), colors.HexColor("#E3DFF2")
CAT = {"basic": "Basic Stats", "reg": "Regression", "anova": "ANOVA", "qual": "Quality", "graph": "Graphs", "adv": "Advanced"}

# The built-in PDF fonts only cover Western characters, so swap symbols for plain text.
_ASCII = {"μ": "mu", "σ": "sigma", "α": "alpha", "β": "beta", "η": "eta", "λ": "lambda", "ρ": "rho", "≥": ">=", "≤": "<=",
          "→": "->", "−": "-", "–": "-", "—": "-", "…": "...", "₀": "0", "₁": "1", "₂": "2", "²": "^2", "√": "sqrt",
          "×": "x", "●": "*", "“": '"', "”": '"', "’": "'", "X̄": "Xbar", "X̿": "Xbarbar", "R̄": "Rbar", "M̄R": "MRbar", "̄": ""}


def plain(s) -> str:
    s = str(s)
    for k, v in _ASCII.items():
        s = s.replace(k, v)
    return s.encode("latin-1", "replace").decode("latin-1")


def _esc(s):
    return plain(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def build_pdf(pins: list[dict], who: str) -> bytes:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=16 * mm, rightMargin=16 * mm, topMargin=16 * mm, bottomMargin=16 * mm,
                            title="Analysis Studio report", author="Analysis Studio")
    ss = getSampleStyleSheet()
    h1 = ParagraphStyle("h1", parent=ss["Title"], alignment=0, textColor=INK, fontSize=22, spaceAfter=4)
    h2 = ParagraphStyle("h2", parent=ss["Heading2"], textColor=INK, fontSize=13, spaceBefore=10, spaceAfter=2)
    small = ParagraphStyle("small", parent=ss["Normal"], fontSize=8.5, textColor=colors.HexColor("#5B5675"))
    body = ParagraphStyle("body", parent=ss["Normal"], fontSize=9, leading=12)
    cell = ParagraphStyle("cell", parent=body, fontSize=7.5, leading=9)
    story = [Paragraph("Analysis Studio report", h1),
             Paragraph(_esc(f"{who} - {datetime.now(timezone.utc).strftime('%d %b %Y')} - {len(pins)} pinned result(s)"), small), Spacer(1, 8)]
    if not pins:
        story.append(Paragraph("You have no pinned results yet. Pin a result in the workspace and it will appear in your next report.", body))
    for p in pins:
        block = [Paragraph(_esc(f"{p.get('title', '')}  ({CAT.get(p.get('cat'), p.get('cat', ''))})"), h2),
                 Paragraph(_esc(f"Project: {p.get('project_name', '')}"), small)]
        if p.get("verdict"):
            bg = {"good": "#DDF7EF", "bad": "#FFE3E1"}.get(p.get("vcls"), "#ECE7FF")
            t = Table([[Paragraph("<b>" + _esc(p["verdict"]) + "</b>", body)]], colWidths=[doc.width])
            t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), colors.HexColor(bg)), ("BOX", (0, 0), (-1, -1), 0, colors.white),
                                   ("LEFTPADDING", (0, 0), (-1, -1), 6), ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4)]))
            block += [Spacer(1, 4), t]
        for tb in (p.get("tables") or [])[:4]:
            head = tb.get("head") or []
            rows = (tb.get("rows") or [])[:40]
            if not head:
                continue
            data = [[Paragraph("<b>" + _esc(h) + "</b>", cell) for h in head]] + [[Paragraph(_esc(v), cell) for v in r] for r in rows]
            t = Table(data, repeatRows=1, colWidths=[doc.width / len(head)] * len(head))
            t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#FAF9FF")), ("LINEBELOW", (0, 0), (-1, -1), 0.4, LINE),
                                   ("BOX", (0, 0), (-1, -1), 0.6, LINE), ("VALIGN", (0, 0), (-1, -1), "MIDDLE")]))
            block += [Spacer(1, 5), t]
        for n in (p.get("notes") or [])[:3]:
            block += [Spacer(1, 3), Paragraph(_esc(n), small)]
        story.append(KeepTogether(block[:4]))
        story += block[4:]
    if settings.app_url:
        story += [Spacer(1, 14), Paragraph(_esc(f"Open the charts in the app: {settings.app_url}"), small)]
    doc.build(story)
    return buf.getvalue()


async def send_email(to: str, pdf: bytes, count: int) -> None:
    if not settings.resend_api_key:
        raise RuntimeError("Email is not configured on the server (RESEND_API_KEY).")
    html = (f"<p>Hi,</p><p>Your Analysis Studio report is attached with <b>{count}</b> pinned result(s).</p>"
            + (f'<p><a href="{settings.app_url}">Open Analysis Studio</a></p>' if settings.app_url else "")
            + "<p style='color:#5B5675;font-size:12px'>Change or stop these emails in Settings → Scheduled reports.</p>")
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post("https://api.resend.com/emails", headers={"Authorization": f"Bearer {settings.resend_api_key}"},
                              json={"from": settings.report_from, "to": [to], "subject": f"Analysis Studio report - {datetime.now(timezone.utc):%d %b %Y}",
                                    "html": html, "attachments": [{"filename": "analysis-studio-report.pdf", "content": base64.b64encode(pdf).decode()}]})
    if r.status_code >= 300:
        raise RuntimeError(f"Email service refused the message: {r.text[:200]}")


def _admin_headers():
    k = settings.supabase_service_key
    return {"apikey": k, "Authorization": f"Bearer {k}", "Content-Type": "application/json"}


async def _rest(client, method, path, **kw):
    r = await client.request(method, f"{settings.supabase_url}/rest/v1/{path}", headers=_admin_headers(), **kw)
    r.raise_for_status()
    return r.json() if r.content else None


async def send_for_user(user_id: str, fallback_email: str = "") -> dict:
    async with httpx.AsyncClient(timeout=30) as client:
        rs = await _rest(client, "GET", f"report_settings?user_id=eq.{user_id}&select=*")
        pins = await _rest(client, "GET", f"pins?user_id=eq.{user_id}&select=*&order=created.desc&limit=50")
        to = (rs[0].get("email") if rs else "") or fallback_email
        if not to:
            raise RuntimeError("Add an email address in Settings → Scheduled reports first.")
        await send_email(to, build_pdf(pins, to), len(pins))
        if rs:
            await _rest(client, "PATCH", f"report_settings?user_id=eq.{user_id}", json={"last_sent": int(time.time() * 1000)})
    return {"sent_to": to, "pins": len(pins)}


async def run_due() -> dict:
    """Called once a day by the GitHub Actions schedule."""
    now = time.time() * 1000
    sent, failed = 0, 0
    async with httpx.AsyncClient(timeout=30) as client:
        rows = await _rest(client, "GET", "report_settings?frequency=in.(weekly,monthly)&select=*")
    for r in rows or []:
        if now - (r.get("last_sent") or 0) < PERIOD[r["frequency"]] * 1000:
            continue
        try:
            await send_for_user(r["user_id"])
            sent += 1
        except Exception:  # keep going for other users
            failed += 1
    return {"checked": len(rows or []), "sent": sent, "failed": failed}
