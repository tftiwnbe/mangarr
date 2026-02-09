from typing import Annotated

from fastapi import Depends, Header, HTTPException, status
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.core.database import get_database_session
from app.core.security import hash_api_key
from app.models import User

DBSessionDep = Annotated[AsyncSession, Depends(get_database_session)]
ApiKeyHeaderDep = Annotated[str | None, Header(alias="X-API-Key")]
AuthorizationHeaderDep = Annotated[str | None, Header(alias="Authorization")]


def _extract_api_key(
    x_api_key: str | None,
    authorization: str | None,
) -> str | None:
    if x_api_key:
        return x_api_key.strip()
    if not authorization:
        return None
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        return None
    return token.strip()


async def get_current_user(
    db: DBSessionDep,
    x_api_key: ApiKeyHeaderDep = None,
    authorization: AuthorizationHeaderDep = None,
) -> User:
    api_key = _extract_api_key(x_api_key=x_api_key, authorization=authorization)
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing API key",
        )

    user = (
        await db.exec(select(User).where(User.api_key_hash == hash_api_key(api_key)))
    ).first()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid API key",
        )
    return user


async def require_authenticated_user(_: Annotated[User, Depends(get_current_user)]) -> None:
    return None


CurrentUserDep = Annotated[User, Depends(get_current_user)]

__all__ = ["CurrentUserDep", "DBSessionDep", "get_current_user", "require_authenticated_user"]
