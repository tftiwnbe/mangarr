from datetime import datetime, timezone
from typing import Any, ClassVar

from sqlmodel import Field, SQLModel


class User(SQLModel, table=True):
    __tablename__: ClassVar[Any] = "users"

    id: int | None = Field(default=None, primary_key=True)
    username: str = Field(index=True, unique=True)
    password_hash: str
    api_key_hash: str = Field(index=True, unique=True)
    is_admin: bool = False
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    last_login_at: datetime | None = None
    last_api_key_rotated_at: datetime | None = None


class RegisterFirstUserRequest(SQLModel):
    username: str
    password: str


class UserProfileResource(SQLModel):
    id: int
    username: str
    is_admin: bool
    created_at: datetime
    last_api_key_rotated_at: datetime | None = None


class RegisterFirstUserResponse(SQLModel):
    user: UserProfileResource
    api_key: str


class RotateApiKeyResponse(SQLModel):
    api_key: str
    rotated_at: datetime


class ChangePasswordRequest(SQLModel):
    current_password: str
    new_password: str
