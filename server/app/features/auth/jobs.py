from datetime import datetime, timezone

from sqlmodel import or_, select

from app.core.database import sessionmanager
from app.core.scheduler import scheduler
from app.models import AuthSession


@scheduler.interval(seconds=6 * 60 * 60, label="Session Cleanup")  # every 6 hours
async def session_cleanup_job() -> None:
    """Delete revoked and expired auth sessions."""
    now = datetime.now(timezone.utc)
    async with sessionmanager.session() as session:
        stale = (
            await session.exec(
                select(AuthSession).where(
                    or_(
                        AuthSession.revoked_at.is_not(None),
                        AuthSession.expires_at <= now,
                    )
                )
            )
        ).all()
        for item in stale:
            await session.delete(item)
        await session.commit()
