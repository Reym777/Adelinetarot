"""Admin endpoints (AdelineTarot).

Every route is guarded by a constant-time admin-token check (sent in the
``X-Admin-Token`` header). The admin sees the full natal chart, the generated
report and the shared video link for each paid consultation.
"""
from __future__ import annotations

import json
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Booking
from ..schemas import AdminBookingDetail, AdminBookingSummary
from ..security import read_rate_limit, require_admin

router = APIRouter(
    prefix="/api/admin",
    tags=["admin"],
    dependencies=[Depends(require_admin)],
)


@router.get("/me")
def verify_token() -> dict:
    """Lightweight endpoint the dashboard calls to validate the token."""
    return {"ok": True}


@router.get("/bookings", response_model=List[AdminBookingSummary])
def list_bookings(
    _: None = Depends(read_rate_limit),
    db: Session = Depends(get_db),
) -> List[AdminBookingSummary]:
    rows = db.query(Booking).order_by(Booking.created_at.desc()).limit(500).all()
    return [
        AdminBookingSummary(
            id=b.id, reference=b.reference, full_name=b.full_name, email=b.email,
            birth_date=b.birth_date, birth_place=b.birth_place, status=b.status,
            plan=b.plan, currency=b.currency, amount=b.amount,
            created_at=b.created_at, paid_at=b.paid_at,
        )
        for b in rows
    ]


@router.get("/bookings/{booking_id}", response_model=AdminBookingDetail)
def booking_detail(
    booking_id: int,
    _: None = Depends(read_rate_limit),
    db: Session = Depends(get_db),
) -> AdminBookingDetail:
    b: Optional[Booking] = db.get(Booking, booking_id)
    if not b:
        raise HTTPException(status_code=404, detail="No encontrado")

    chart = json.loads(b.chart_json) if b.chart_json else None
    return AdminBookingDetail(
        id=b.id, reference=b.reference, full_name=b.full_name, email=b.email,
        birth_date=b.birth_date, birth_time=b.birth_time, birth_place=b.birth_place,
        status=b.status, plan=b.plan, currency=b.currency, amount=b.amount,
        charge_currency=b.charge_currency, charge_amount=b.charge_amount,
        payment_method=b.payment_method, paypal_order_id=b.paypal_order_id,
        created_at=b.created_at, paid_at=b.paid_at,
        video_url=b.video_url, video_room=b.video_room,
        chart=chart, report_text=b.report_text,
    )
