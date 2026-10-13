"""All settings come from environment variables (set them in Render)."""
import os


class Settings:
    supabase_url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    supabase_anon_key = os.environ.get("SUPABASE_ANON_KEY", "")
    supabase_service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    # Comma-separated list of sites allowed to call this API, e.g. https://analysis-studio.vercel.app
    allowed_origins = [o.strip().rstrip("/") for o in os.environ.get("ALLOWED_ORIGINS", "*").split(",") if o.strip()]
    resend_api_key = os.environ.get("RESEND_API_KEY", "")
    report_from = os.environ.get("REPORT_FROM", "Analysis Studio <onboarding@resend.dev>")
    cron_secret = os.environ.get("CRON_SECRET", "")
    app_url = os.environ.get("APP_URL", "")
    max_upload_mb = int(os.environ.get("MAX_UPLOAD_MB", "25"))


settings = Settings()
