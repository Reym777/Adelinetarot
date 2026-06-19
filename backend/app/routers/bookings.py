"""Public booking endpoints: create a consultation, confirm the PayPal payment
and poll the resulting status / video link.

Pricing is authoritative (recomputed server-side from the chosen plan), the
honeypot traps bots, every write is rate-limited and the natal chart + report
are generated only after payment is confirmed.
"""
from __future__ import annotations

import json
import secrets
from datetime import datetime, timezone
from typing import Dict

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from ..astrology import compute_chart
from ..config import settings
from ..database import get_db
from ..models import Booking
from ..report import build_report
from ..schemas import (
    BookingCreate,
    BookingCreateResponse,
    BookingStatus,
    PaymentConfirm,
)
from ..security import client_ip, write_rate_limit
from ..security import read_rate_limit

router = APIRouter(prefix="/api/bookings", tags=["bookings"])


def _plan_pricing(plan: str) -> Dict[str, object]:
    """Authoritative amounts. PayPal cannot settle PEN, so the sol plan is
    charged as its configured USD equivalent."""
    if plan == "mxn":
        return {
            "currency": "MXN", "amount": float(settings.price_mxn),
            "charge_currency": "MXN", "charge_amount": float(settings.price_mxn),
        }
    return {
        "currency": "PEN", "amount": float(settings.price_pen),
        "charge_currency": "USD", "charge_amount": float(settings.price_pen_as_usd),
    }


def _paypal_me_url(charge_currency: str, charge_amount: float) -> str:
    amount = f"{charge_amount:.2f}".rstrip("0").rstrip(".")
    return f"https://paypal.me/{settings.paypal_me_handle}/{amount}{charge_currency}"


def _make_reference() -> str:
    stamp = datetime.now(timezone.utc).strftime("%y%m%d")
    return f"ADT-{stamp}-{secrets.token_hex(3).upper()}"


@router.post("", response_model=BookingCreateResponse, status_code=201)
def create_booking(
    payload: BookingCreate,
    request: Request,
    _: None = Depends(write_rate_limit),
    db: Session = Depends(get_db),
) -> BookingCreateResponse:
    # Honeypot: a filled "website" means a bot — fake success, store nothing.
    if payload.website:
        return BookingCreateResponse(
            reference="ADT-IGNORED", public_token="", status="pending",
            plan=payload.plan, currency="MXN", amount=0.0,
            charge_currency="MXN", charge_amount=0.0,
            paypal_client_id="", paypal_me_url="", message="Recibido.",
        )

    pricing = _plan_pricing(payload.plan)
    booking = Booking(
        reference=_make_reference(),
        public_token=secrets.token_urlsafe(24),
        full_name=payload.full_name,
        email=str(payload.email),
        birth_date=payload.birth_date,
        birth_time=payload.birth_time,
        birth_place=payload.birth_place,
        status="pending",
        plan=payload.plan,
        currency=str(pricing["currency"]),
        amount=float(pricing["amount"]),
        charge_currency=str(pricing["charge_currency"]),
        charge_amount=float(pricing["charge_amount"]),
        client_ip=client_ip(request),
    )
    db.add(booking)
    db.commit()

    return BookingCreateResponse(
        reference=booking.reference,
        public_token=booking.public_token,
        status=booking.status,
        plan=booking.plan,
        currency=booking.currency,
        amount=booking.amount,
        charge_currency=booking.charge_currency,
        charge_amount=booking.charge_amount,
        paypal_client_id=settings.paypal_client_id,
        paypal_me_url=_paypal_me_url(booking.charge_currency, booking.charge_amount),
        message="Datos recibidos. Completa el pago para generar tu enlace de videollamada.",
    )


def _status_message(booking: Booking) -> str:
    if booking.status == "paid":
        return "Pago confirmado. Tu enlace de videollamada está listo."
    return "Pendiente de pago."


@router.post("/{public_token}/pay", response_model=BookingStatus)
def confirm_payment(
    public_token: str,
    payload: PaymentConfirm,
    request: Request,
    _: None = Depends(write_rate_limit),
    db: Session = Depends(get_db),
) -> BookingStatus:
    if payload.website:  # honeypot
        raise HTTPException(status_code=404, detail="No encontrado")

    booking = (
        db.query(Booking).filter(Booking.public_token == public_token).first()
    )
    if not booking:
        raise HTTPException(status_code=404, detail="No encontrado")

    # Idempotent: if already paid, just return the existing deliverable.
    if booking.status == "paid":
        return BookingStatus(
            reference=booking.reference, full_name=booking.full_name,
            status=booking.status, plan=booking.plan, currency=booking.currency,
            amount=booking.amount, video_url=booking.video_url,
            message=_status_message(booking),
        )

    # Generate the unique video room shared by the consultant and AdelineTarot.
    room = f"{settings.video_room_prefix}-{secrets.token_urlsafe(9)}"
    chart = compute_chart(
        booking.full_name, booking.birth_date, booking.birth_time,
        booking.birth_place,
    )
    report = build_report(booking.full_name, booking.birth_date, chart)

    booking.status = "paid"
    booking.payment_method = payload.method
    booking.paypal_order_id = payload.paypal_order_id
    booking.paid_at = datetime.now(timezone.utc)
    booking.video_room = room
    booking.video_url = f"{settings.video_base_url}/{room}"
    booking.chart_json = json.dumps(chart, ensure_ascii=False, default=str)
    booking.report_text = report
    db.commit()

    return BookingStatus(
        reference=booking.reference, full_name=booking.full_name,
        status=booking.status, plan=booking.plan, currency=booking.currency,
        amount=booking.amount, video_url=booking.video_url,
        message=_status_message(booking),
    )


@router.get("/{public_token}", response_model=BookingStatus)
def get_status(
    public_token: str,
    _: None = Depends(read_rate_limit),
    db: Session = Depends(get_db),
) -> BookingStatus:
    booking = (
        db.query(Booking).filter(Booking.public_token == public_token).first()
    )
    if not booking:
        raise HTTPException(status_code=404, detail="No encontrado")
    return BookingStatus(
        reference=booking.reference, full_name=booking.full_name,
        status=booking.status, plan=booking.plan, currency=booking.currency,
        amount=booking.amount,
        video_url=booking.video_url if booking.status == "paid" else None,
        message=_status_message(booking),
    )
