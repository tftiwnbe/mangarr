from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlmodel import func, select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.config import settings
from app.core.security import (
    generate_api_key,
    hash_api_key,
    hash_password,
    validate_password_strength,
    validate_username,
    verify_password,
)
from app.models import (
    AuthSession,
    CreateIntegrationApiKeyResponse,
    IntegrationApiKey,
    IntegrationApiKeyResource,
    LoginRequest,
    LoginResponse,
    RegisterFirstUserRequest,
    RegisterFirstUserResponse,
    RotateApiKeyResponse,
    SetupStatusResponse,
    User,
    UserProfileResource,
)


class AuthService:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def get_setup_status(self) -> SetupStatusResponse:
        return SetupStatusResponse(needs_setup=not settings.public.initialized)

    async def register_first_user(
        self, request: RegisterFirstUserRequest
    ) -> RegisterFirstUserResponse:
        if await self._count_users() > 0:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="First user is already registered",
            )

        username = validate_username(request.username)
        validate_password_strength(request.password)
        now = datetime.now(timezone.utc)
        bootstrap_integration_api_key = generate_api_key()

        user = User(
            username=username,
            password_hash=hash_password(request.password),
            api_key_hash=hash_api_key(bootstrap_integration_api_key),
            is_admin=True,
            created_at=now,
            updated_at=now,
            last_api_key_rotated_at=now,
        )
        self.session.add(user)
        await self.session.flush()

        user_id = self._require_user_id(user)
        session_token = await self._create_session(user_id=user_id, issued_at=now)
        await self._store_integration_api_key(
            user_id=user_id,
            name="default",
            api_key=bootstrap_integration_api_key,
            created_at=now,
        )

        await self.session.commit()
        await self.session.refresh(user)
        self.mark_initialized()

        return RegisterFirstUserResponse(
            user=self.to_user_profile(user),
            api_key=session_token,
        )

    async def login(self, request: LoginRequest) -> LoginResponse:
        normalized_username = validate_username(request.username)
        now = datetime.now(timezone.utc)

        user = (
            await self.session.exec(
                select(User).where(User.username == normalized_username)
            )
        ).first()
        if user is None or not verify_password(request.password, user.password_hash):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid username or password",
            )

        session_token = await self._create_session_token(user)
        user.updated_at = now
        user.last_login_at = now
        self.session.add(user)
        await self.session.commit()

        return LoginResponse(
            user=self.to_user_profile(user),
            api_key=session_token,
            issued_at=now,
        )

    async def rotate_api_key(self, user: User) -> RotateApiKeyResponse:
        now = datetime.now(timezone.utc)
        user_id = self._require_user_id(user)
        await self._revoke_active_integration_api_keys(user_id=user_id, revoked_at=now)
        api_key = generate_api_key()
        await self._store_integration_api_key(
            user_id=user_id,
            name="default",
            api_key=api_key,
            created_at=now,
        )
        user.api_key_hash = hash_api_key(api_key)
        user.updated_at = now
        user.last_api_key_rotated_at = now
        self.session.add(user)
        await self.session.commit()

        return RotateApiKeyResponse(api_key=api_key, rotated_at=now)

    async def list_integration_api_keys(
        self, user: User
    ) -> list[IntegrationApiKeyResource]:
        user_id = self._require_user_id(user)
        keys = (
            await self.session.exec(
                select(IntegrationApiKey)
                .where(IntegrationApiKey.user_id == user_id)
                .order_by(IntegrationApiKey.created_at.desc())
            )
        ).all()
        return [self.to_integration_api_key_resource(item) for item in keys]

    async def create_integration_api_key(
        self, user: User, name: str
    ) -> CreateIntegrationApiKeyResponse:
        user_id = self._require_user_id(user)
        sanitized_name = self._sanitize_api_key_name(name)
        now = datetime.now(timezone.utc)
        api_key = generate_api_key()
        key = await self._store_integration_api_key(
            user_id=user_id,
            name=sanitized_name,
            api_key=api_key,
            created_at=now,
        )
        user.updated_at = now
        user.last_api_key_rotated_at = now
        self.session.add(user)
        await self.session.commit()
        await self.session.refresh(key)
        return CreateIntegrationApiKeyResponse(
            key=self.to_integration_api_key_resource(key),
            api_key=api_key,
        )

    async def revoke_integration_api_key(self, user: User, key_id: int) -> None:
        user_id = self._require_user_id(user)
        api_key = (
            await self.session.exec(
                select(IntegrationApiKey).where(
                    IntegrationApiKey.id == key_id,
                    IntegrationApiKey.user_id == user_id,
                    IntegrationApiKey.revoked_at.is_(None),
                )
            )
        ).first()
        if api_key is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="API key not found",
            )
        api_key.revoked_at = datetime.now(timezone.utc)
        self.session.add(api_key)
        await self.session.commit()

    async def change_password(
        self, user: User, current_password: str, new_password: str
    ) -> None:
        if not verify_password(current_password, user.password_hash):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Current password is incorrect",
            )

        validate_password_strength(new_password)
        if verify_password(new_password, user.password_hash):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="New password must be different",
            )

        now = datetime.now(timezone.utc)
        user.password_hash = hash_password(new_password)
        user.updated_at = now
        await self._revoke_active_sessions(
            user_id=self._require_user_id(user),
            revoked_at=now,
        )
        self.session.add(user)
        await self.session.commit()

    async def _count_users(self) -> int:
        return int(await self.session.scalar(select(func.count(User.id))) or 0)

    @staticmethod
    def to_user_profile(user: User) -> UserProfileResource:
        if user.id is None:
            raise HTTPException(status_code=500, detail="User persistence error")
        return UserProfileResource(
            id=int(user.id),
            username=user.username,
            is_admin=user.is_admin,
            created_at=user.created_at,
            last_api_key_rotated_at=user.last_api_key_rotated_at,
        )

    @staticmethod
    def to_integration_api_key_resource(
        key: IntegrationApiKey,
    ) -> IntegrationApiKeyResource:
        if key.id is None:
            raise HTTPException(status_code=500, detail="API key persistence error")
        return IntegrationApiKeyResource(
            id=int(key.id),
            name=key.name,
            key_prefix=key.key_prefix,
            created_at=key.created_at,
            last_used_at=key.last_used_at,
            revoked_at=key.revoked_at,
        )

    async def _create_session_token(self, user: User) -> str:
        user_id = self._require_user_id(user)
        return await self._create_session(
            user_id=user_id,
            issued_at=datetime.now(timezone.utc),
        )

    async def _create_session(self, user_id: int, issued_at: datetime) -> str:
        session_token = generate_api_key()
        self.session.add(
            AuthSession(
                user_id=user_id,
                token_hash=hash_api_key(session_token),
                created_at=issued_at,
                last_used_at=issued_at,
            )
        )
        return session_token

    async def _revoke_active_sessions(self, user_id: int, revoked_at: datetime) -> None:
        sessions = (
            await self.session.exec(
                select(AuthSession).where(
                    AuthSession.user_id == user_id,
                    AuthSession.revoked_at.is_(None),
                )
            )
        ).all()
        for item in sessions:
            item.revoked_at = revoked_at
            self.session.add(item)

    async def _revoke_active_integration_api_keys(
        self, user_id: int, revoked_at: datetime
    ) -> None:
        keys = (
            await self.session.exec(
                select(IntegrationApiKey).where(
                    IntegrationApiKey.user_id == user_id,
                    IntegrationApiKey.revoked_at.is_(None),
                )
            )
        ).all()
        for item in keys:
            item.revoked_at = revoked_at
            self.session.add(item)

    async def _store_integration_api_key(
        self, user_id: int, name: str, api_key: str, created_at: datetime
    ) -> IntegrationApiKey:
        item = IntegrationApiKey(
            user_id=user_id,
            name=name,
            key_hash=hash_api_key(api_key),
            key_prefix=api_key[:8],
            created_at=created_at,
        )
        self.session.add(item)
        return item

    @staticmethod
    def _sanitize_api_key_name(name: str) -> str:
        normalized = name.strip()
        if not normalized:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="API key name is required",
            )
        if len(normalized) > 80:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="API key name must be 80 characters or fewer",
            )
        return normalized

    @staticmethod
    def _require_user_id(user: User) -> int:
        if user.id is None:
            raise HTTPException(status_code=500, detail="User persistence error")
        return int(user.id)

    @staticmethod
    def mark_initialized() -> None:
        if settings.public.initialized:
            return
        settings.public.initialized = True
        settings.save_settings()
