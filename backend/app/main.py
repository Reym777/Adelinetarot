"""FastAPI application entry point for AdelineTarot.

Wires configuration, database, security middleware and routers, and (in
development) hosts the static frontend (``index.html`` + ``admin.html``).

Run locally:
    uvicorn app.main:app --reload --port 8000
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.trustedhost import TrustedHostMiddleware

from . import __version__
from .config import settings
from .database import init_db
from .routers import admin as admin_router
from .routers import bookings as bookings_router
from .security import BodySizeLimitMiddleware, SecurityHeadersMiddleware

logger = logging.getLogger("adelinetarot")
logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    # Surface the admin token once so AdelineTarot can sign in (generated if
    # ADELINE_ADMIN_TOKEN was not provided).
    logger.info("AdelineTarot API %s started (debug=%s)", __version__, settings.debug)
    logger.info("Admin token: %s", settings.resolved_admin_token)
    yield


app = FastAPI(
    title=settings.app_name,
    version=__version__,
    description="Backend seguro del sitio AdelineTarot.",
    lifespan=lifespan,
    docs_url="/api/docs",
    redoc_url=None,
    openapi_url="/api/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Accept", "X-Admin-Token"],
    max_age=600,
)
app.add_middleware(BodySizeLimitMiddleware)
app.add_middleware(
    TrustedHostMiddleware,
    allowed_hosts=settings.allowed_hosts,
)
app.add_middleware(SecurityHeadersMiddleware)


@app.exception_handler(RequestValidationError)
async def validation_handler(request: Request, exc: RequestValidationError):
    errors = [
        {"loc": ".".join(str(p) for p in e.get("loc", [])), "msg": e.get("msg", "")}
        for e in exc.errors()
    ]
    return JSONResponse(status_code=422, content={"detail": "validation_error", "errors": errors})


@app.exception_handler(Exception)
async def unhandled_handler(request: Request, exc: Exception):
    logger.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content={"detail": "Error interno del servidor"})


@app.get("/api/health", tags=["meta"])
def health() -> dict:
    return {"status": "ok", "version": __version__}


@app.get("/api/config", tags=["meta"])
def public_config() -> dict:
    """Non-secret config the frontend needs to render prices and PayPal."""
    return {
        "prices": {
            "mxn": settings.price_mxn,
            "pen": settings.price_pen,
            "pen_as_usd": settings.price_pen_as_usd,
        },
        "paypal_me_handle": settings.paypal_me_handle,
        "paypal_enabled": bool(settings.paypal_client_id),
    }


app.include_router(bookings_router.router)
app.include_router(admin_router.router)


# --- Static frontend (convenience for local dev) -----------------------------
if settings.serve_frontend and (settings.frontend_path / "index.html").exists():
    frontend = settings.frontend_path

    @app.get("/", include_in_schema=False)
    def index() -> FileResponse:
        return FileResponse(frontend / "index.html")

    @app.get("/admin", include_in_schema=False)
    def admin_page() -> FileResponse:
        return FileResponse(frontend / "admin.html")

    app.mount("/", StaticFiles(directory=str(frontend), html=False), name="frontend")
else:
    @app.get("/", include_in_schema=False)
    def root_info() -> dict:
        return {"service": settings.app_name, "docs": "/api/docs"}
