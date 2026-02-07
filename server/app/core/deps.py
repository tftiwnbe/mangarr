from typing import Annotated

from fastapi import Depends
from sqlmodel.ext.asyncio.session import AsyncSession

from app.core.database import get_database_session

DBSessionDep = Annotated[AsyncSession, Depends(get_database_session)]

__all__ = ["DBSessionDep"]
