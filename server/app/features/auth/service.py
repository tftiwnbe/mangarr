from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlmodel import func, select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.core.security import (
    generate_api_key,
    hash_api_key,
    hash_password,
    validate_password_strength,
    validate_username,
    verify_password,
)
from app.models import (
    RegisterFirstUserRequest,
    RegisterFirstUserResponse,
    RotateApiKeyResponse,
    User,
    UserProfileResource,
)


class AuthService:
    def __init__(self, session: AsyncSession):
        self.session = session

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
        api_key = generate_api_key()

        user = User(
            username=username,
            password_hash=hash_password(request.password),
            api_key_hash=hash_api_key(api_key),
            is_admin=True,
            created_at=now,
            updated_at=now,
            last_api_key_rotated_at=now,
        )
        self.session.add(user)
        await self.session.commit()
        await self.session.refresh(user)

        return RegisterFirstUserResponse(
            user=self.to_user_profile(user),
            api_key=api_key,
        )

    async def rotate_api_key(self, user: User) -> RotateApiKeyResponse:
        api_key = generate_api_key()
        now = datetime.now(timezone.utc)
        user.api_key_hash = hash_api_key(api_key)
        user.updated_at = now
        user.last_api_key_rotated_at = now
        self.session.add(user)
        await self.session.commit()

        return RotateApiKeyResponse(api_key=api_key, rotated_at=now)

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

        user.password_hash = hash_password(new_password)
        user.updated_at = datetime.now(timezone.utc)
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
