from datetime import datetime, timezone
from typing import Any, ClassVar

from sqlmodel import Field, SQLModel


class User(SQLModel, table=True):
    __tablename__: ClassVar[Any] = "users"

    id: int | None = Field(default=None, primary_key=True)
    username: str = Field(index=True, unique=True)
    password_hash: str
    is_admin: bool = False
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    last_login_at: datetime | None = None


class AuthSession(SQLModel, table=True):
    __tablename__: ClassVar[Any] = "auth_sessions"

    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="users.id", index=True)
    token_hash: str = Field(index=True, unique=True)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    last_used_at: datetime | None = None
    revoked_at: datetime | None = None
    expires_at: datetime | None = None


class IntegrationApiKey(SQLModel, table=True):
    __tablename__: ClassVar[Any] = "integration_api_keys"

    id: int | None = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="users.id", index=True)
    name: str
    key_hash: str = Field(index=True, unique=True)
    key_prefix: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    last_used_at: datetime | None = None
    revoked_at: datetime | None = None


class RegisterFirstUserRequest(SQLModel):
    username: str
    password: str


class LoginRequest(SQLModel):
    username: str
    password: str
    remember_me: bool = False


class UserProfileResource(SQLModel):
    id: int
    username: str
    is_admin: bool
    created_at: datetime


class RegisterFirstUserResponse(SQLModel):
    user: UserProfileResource
    api_key: str


class LoginResponse(SQLModel):
    user: UserProfileResource
    api_key: str
    issued_at: datetime


class ChangePasswordRequest(SQLModel):
    current_password: str
    new_password: str


class ChangePasswordResponse(SQLModel):
    api_key: str


class IntegrationApiKeyResource(SQLModel):
    id: int
    name: str
    key_prefix: str
    created_at: datetime
    last_used_at: datetime | None = None
    revoked_at: datetime | None = None


class CreateIntegrationApiKeyRequest(SQLModel):
    name: str


class CreateIntegrationApiKeyResponse(SQLModel):
    key: IntegrationApiKeyResource
    api_key: str


class SetupStatusResponse(SQLModel):
    needs_setup: bool
