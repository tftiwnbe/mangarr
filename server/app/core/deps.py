import asyncio
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import Depends, Header, HTTPException, Query, status
from sqlalchemy import or_, update
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.core.database import get_database_session, sessionmanager
from app.core.security import hash_api_key
from app.core.utils import commit_with_sqlite_retry
from app.models import AuthSession, IntegrationApiKey, User

DBSessionDep = Annotated[AsyncSession, Depends(get_database_session)]
ApiKeyHeaderDep = Annotated[str | None, Header(alias="X-API-Key")]
AuthorizationHeaderDep = Annotated[str | None, Header(alias="Authorization")]
ApiKeyQueryDep = Annotated[
    str | None,
    Query(alias="api_key", include_in_schema=False),
]
_LAST_USED_UPDATE_INTERVAL = timedelta(minutes=5)


def _extract_api_key(
    x_api_key: str | None,
    authorization: str | None,
    query_api_key: str | None,
) -> str | None:
    if x_api_key:
        return x_api_key.strip()
    if query_api_key:
        return query_api_key.strip()
    if not authorization:
        return None
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        return None
    return token.strip()


def _needs_last_used_update(
    last_used_at: datetime | None,
    now: datetime,
) -> bool:
    if last_used_at is None:
        return True
    candidate = (
        last_used_at.replace(tzinfo=timezone.utc)
        if last_used_at.tzinfo is None
        else last_used_at.astimezone(timezone.utc)
    )
    return (now - candidate) >= _LAST_USED_UPDATE_INTERVAL


async def _touch_last_used(
    model: type[AuthSession] | type[IntegrationApiKey],
    row_id: int | None,
    last_used_at: datetime | None,
    now: datetime,
) -> None:
    if row_id is None or not _needs_last_used_update(last_used_at, now):
        return

    try:
        async with sessionmanager.session() as db:
            threshold = now - _LAST_USED_UPDATE_INTERVAL
            await db.exec(
                update(model)
                .where(
                    model.id == row_id,
                    or_(model.last_used_at.is_(None), model.last_used_at < threshold),
                )
                .values(last_used_at=now)
            )
            await commit_with_sqlite_retry(db)
    except Exception:
        return


def _schedule_last_used_touch(
    model: type[AuthSession] | type[IntegrationApiKey],
    row: AuthSession | IntegrationApiKey,
    now: datetime,
) -> None:
    asyncio.create_task(_touch_last_used(model, row.id, row.last_used_at, now))


async def get_current_user(
    db: DBSessionDep,
    x_api_key: ApiKeyHeaderDep = None,
    authorization: AuthorizationHeaderDep = None,
    query_api_key: ApiKeyQueryDep = None,
) -> User:
    api_key = _extract_api_key(
        x_api_key=x_api_key,
        authorization=authorization,
        query_api_key=query_api_key,
    )
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing API key or session token",
        )

    hashed_credential = hash_api_key(api_key)
    now = datetime.now(timezone.utc)

    auth_session = (
        await db.exec(
            select(AuthSession, User)
            .join(User, AuthSession.user_id == User.id)
            .where(
                AuthSession.token_hash == hashed_credential,
                AuthSession.revoked_at.is_(None),
                or_(AuthSession.expires_at.is_(None), AuthSession.expires_at > now),
            )
        )
    ).first()
    if auth_session is not None:
        session_row, user = auth_session
        _schedule_last_used_touch(AuthSession, session_row, now)
        return user

    integration_key = (
        await db.exec(
            select(IntegrationApiKey, User)
            .join(User, IntegrationApiKey.user_id == User.id)
            .where(
                IntegrationApiKey.key_hash == hashed_credential,
                IntegrationApiKey.revoked_at.is_(None),
            )
        )
    ).first()
    if integration_key is not None:
        key_row, user = integration_key
        _schedule_last_used_touch(IntegrationApiKey, key_row, now)
        return user

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid API key or session token",
    )


async def require_authenticated_user(_: Annotated[User, Depends(get_current_user)]) -> None:
    return None


CurrentUserDep = Annotated[User, Depends(get_current_user)]


async def require_admin_user(
    current_user: CurrentUserDep,
) -> User:
    if not current_user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin privileges required",
        )
    return current_user


CurrentAdminDep = Annotated[User, Depends(require_admin_user)]

__all__ = [
    "CurrentAdminDep",
    "CurrentUserDep",
    "DBSessionDep",
    "get_current_user",
    "require_admin_user",
    "require_authenticated_user",
]
