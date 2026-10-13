# Analysis Studio

A colourful, Minitab-style statistics workbench for the web: unlimited worksheet, 26 analyses, quality tools, dashboards — with accounts, live sync across devices, a Python analysis server, Excel import and scheduled PDF reports.

```
 Browser (Vercel)                 Supabase                     Render (Python)
┌───────────────────────┐  login  ┌──────────────────┐         ┌───────────────────────────┐
│ frontend/             │◀──────▶│ Auth             │         │ backend/  FastAPI + SciPy │
│ HTML · CSS · JS       │  data   │ PostgreSQL + RLS │◀───────│ • big-worksheet analyses  │
│ • worksheet + charts  │◀──────▶│ Realtime         │ reports │ • Advanced tests          │
│ • 19 analyses locally │         └──────────────────┘         │ • Excel import            │
│                       │──────── token-checked requests ────▶│ • PDF reports (Resend)    │
└───────────────────────┘                                      └───────────────────────────┘
                                         GitHub Actions ── daily ──▶ /reports/run
```

| Part | Technology | Folder |
|---|---|---|
| Frontend | HTML, CSS, JavaScript (Preact 10, no build step) | `frontend/` |
| Accounts, database, live sync | Supabase (Auth + PostgreSQL + Realtime) | `supabase/schema.sql` |
| Analysis server | Python 3.12 · FastAPI · SciPy · statsmodels · pandas · openpyxl · ReportLab | `backend/` |
| Hosting | Vercel (frontend) · Render (server) | `render.yaml` |
| Scheduled reports | GitHub Actions (daily) + Resend (email) | `.github/workflows/reports.yml` |

**What runs where**

- In the browser: the worksheet and 19 analyses (descriptive stats, t-tests, normality, correlation, regression, ANOVA, control charts, capability, Sixpack, Pareto and graphs).
- On the server:
  - Any of those analyses when the worksheet has 20,000+ rows (change `BIG_ROWS` in `frontend/config.js`).
  - The **Advanced** tab: Mann-Whitney, Kruskal-Wallis, chi-square association, two-way ANOVA, Tukey comparisons, Box-Cox and Weibull reliability.
  - Excel (`.xlsx`) import, where each sheet becomes a project.
  - Emailed PDF reports of pinned results.
- What syncs between devices: projects and worksheets (live). Pinned results are also uploaded for reports. Session results and settings stay on each device.
- Privacy: every table uses row-level security, so a signed-in user can only read and write their own rows.

---

## Setup (about 30 minutes, all free tiers)

### 1. Supabase: accounts and database
1. Create a project at [supabase.com](https://supabase.com) (pick a region near your users, e.g. Singapore).
2. **SQL Editor → New query**, paste all of `supabase/schema.sql`, and click **Run**.
3. **Authentication → URL Configuration**: set **Site URL** to your Vercel address (step 3). Add the same address under **Redirect URLs**.
4. **Project Settings → API**: copy the **Project URL**, the **anon public** key and the **service_role** key. Keep the service_role key secret: it only goes into Render.

### 2. Render: Python server
1. At [render.com](https://render.com) go to **New → Blueprint** and choose this GitHub repository. Render reads `render.yaml`.
2. Fill in the values it asks for:
   - `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`: from step 1.4.
   - `ALLOWED_ORIGINS`: your Vercel address, e.g. `https://analysis-studio.vercel.app`.
   - `APP_URL`: the same address. It's used as the link in report emails.
   - `RESEND_API_KEY`: from step 4. You can leave it empty for now and add it later.
3. Deploy, then open `https://<your-service>.onrender.com/health`. It should show `"ok": true`.
4. Free plan note: the server sleeps after 15 minutes idle. The first request after that takes about 30 s, and the app shows "Waking up…".

### 3. Vercel: the website
1. Edit `frontend/config.js` and fill in `SUPABASE_URL`, `SUPABASE_ANON_KEY` (the anon key is safe to publish) and `API_URL` (your Render address). Commit the change.
2. At [vercel.com](https://vercel.com) go to **Add New → Project**, import this repository, and set **Root Directory** to `frontend`. Framework: **Other**. No build command.
3. Deploy. Your app is live at `https://<name>.vercel.app`. Put this address back into Supabase (1.3) and Render (`ALLOWED_ORIGINS`, `APP_URL`).

### 4. Email reports (optional)
1. Create a free account at [resend.com](https://resend.com) and create an API key. Put it in Render as `RESEND_API_KEY`.
2. Until you verify your own domain in Resend, emails can only go to the address you signed up to Resend with. After verifying a domain, set `REPORT_FROM`, e.g. `Analysis Studio <reports@yourdomain.com>`.
3. In GitHub go to **Settings → Secrets and variables → Actions** and add:
   - `API_URL`: your Render address.
   - `CRON_SECRET`: copy it from Render → your service → **Environment** (Render generated it).
4. Test it: **Actions → Scheduled reports → Run workflow**. Users choose Weekly or Monthly in the app's **Settings → Scheduled reports** and can press **Send test now**.

---

## Working on it

- Run the frontend locally: `cd frontend && python3 -m http.server 8080`, then open http://localhost:8080. With empty config values the app runs in on-device mode with no sign-in.
- Run the server locally: `cd backend && pip install -r requirements.txt && uvicorn app.main:app --reload`. Set the same environment variables as on Render.
- Server smoke test: `cd backend && python -m tests.test_api`. It runs every server analysis on a 60,000-row sheet, plus Excel import and the PDF builder.
- Add a server analysis:
  1. Write a function in `backend/app/stats.py` and register it in `ANALYSES`.
  2. Add a matching entry with `server: true` to the `ANALYSES` list in `frontend/app.js`.
- Frontend structure:
  - `index.html` holds the screen template, using `{{value}}`, `<sc-if>` and `<sc-for>`.
  - `runtime.js` renders that template with Preact.
  - `app.js` holds the statistics engine, the worksheet and the sync logic.
  - `styles.css` holds the theme.

## Costs

Free tiers cover a personal or classroom-sized app:
- Supabase: 50,000 monthly active users and a 500 MB database.
- Vercel: hobby plan.
- Render: free web service (it sleeps when idle).
- Resend: 100 emails a day.
- GitHub Actions: free for this daily job.

Upgrade Render (about US$7/month) if you want the server always awake.
