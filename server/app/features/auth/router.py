from fastapi import APIRouter, Depends, status

from app.core.deps import CurrentUserDep, DBSessionDep
from app.features.auth.service import AuthService
from app.models import (
    ChangePasswordRequest,
    RegisterFirstUserRequest,
    RegisterFirstUserResponse,
    RotateApiKeyResponse,
    UserProfileResource,
)

router = APIRouter(prefix="/api/v2/auth", tags=["auth"])


async def get_service(db: DBSessionDep) -> AuthService:
    return AuthService(db)


@router.post(
    "/register-first-user",
    response_model=RegisterFirstUserResponse,
    status_code=status.HTTP_201_CREATED,
)
async def register_first_user(
    payload: RegisterFirstUserRequest,
    service: AuthService = Depends(get_service),
):
    return await service.register_first_user(payload)


@router.get("/me", response_model=UserProfileResource)
async def get_me(
    current_user: CurrentUserDep,
    service: AuthService = Depends(get_service),
):
    return service.to_user_profile(current_user)


@router.post("/me/api-key/roll", response_model=RotateApiKeyResponse)
async def roll_api_key(
    current_user: CurrentUserDep,
    service: AuthService = Depends(get_service),
):
    return await service.rotate_api_key(current_user)


@router.post("/me/password", status_code=status.HTTP_204_NO_CONTENT)
async def change_password(
    payload: ChangePasswordRequest,
    current_user: CurrentUserDep,
    service: AuthService = Depends(get_service),
):
    await service.change_password(
        user=current_user,
        current_password=payload.current_password,
        new_password=payload.new_password,
    )
