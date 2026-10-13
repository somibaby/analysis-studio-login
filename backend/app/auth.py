"""Checks the Supabase login token the browser sends with each request.

Asking Supabase "who owns this token?" works with every Supabase key type
(legacy or new signing keys), so there is no JWT secret to configure.
Answers are cached for a minute to keep requests fast.
"""
import time

import httpx
from fastapi import Header, HTTPException

from .config import settings

_cache: dict[str, tuple[float, dict]] = {}


async def current_user(authorization: str = Header(default="")) -> dict:
    if not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Sign in to use the server features.")
    token = authorization[7:].strip()
    hit = _cache.get(token)
    if hit and hit[0] > time.time():
        return hit[1]
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(f"{settings.supabase_url}/auth/v1/user",
                                 headers={"Authorization": f"Bearer {token}", "apikey": settings.supabase_anon_key})
    except httpx.HTTPError:
        raise HTTPException(503, "Could not reach the sign-in service. Try again.")
    if r.status_code != 200:
        raise HTTPException(401, "Your session has expired — sign in again.")
    user = r.json()
    if len(_cache) > 5000:
        _cache.clear()
    _cache[token] = (time.time() + 60, user)
    return user
