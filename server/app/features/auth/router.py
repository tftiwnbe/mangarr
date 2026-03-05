import time
from collections import defaultdict
from threading import Lock

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.core.deps import CurrentUserDep, DBSessionDep
from app.features.auth.service import AuthService
from app.models import (
    ChangePasswordRequest,
    CreateIntegrationApiKeyRequest,
    CreateIntegrationApiKeyResponse,
    IntegrationApiKeyResource,
    LoginRequest,
    LoginResponse,
    RegisterFirstUserRequest,
    RegisterFirstUserResponse,
    RotateApiKeyResponse,
    SetupStatusResponse,
    UserProfileResource,
)

router = APIRouter(prefix="/api/v2/auth", tags=["auth"])

# ---------------------------------------------------------------------------
# Simple in-memory login rate limiter (per client IP)
# ---------------------------------------------------------------------------
_RATE_WINDOW = 15 * 60   # 15-minute sliding window
_RATE_MAX_FAILS = 10     # max failed attempts before lockout

_rate_lock = Lock()
_rate_failures: dict[str, list[float]] = defaultdict(list)


def _get_client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _check_rate_limit(ip: str) -> None:
    now = time.monotonic()
    with _rate_lock:
        window = _rate_failures[ip]
        window[:] = [t for t in window if now - t < _RATE_WINDOW]
        if len(window) >= _RATE_MAX_FAILS:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many failed login attempts — try again later",
            )


def _record_failure(ip: str) -> None:
    with _rate_lock:
        _rate_failures[ip].append(time.monotonic())


def _clear_failures(ip: str) -> None:
    with _rate_lock:
        _rate_failures.pop(ip, None)


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


@router.get("/setup-status", response_model=SetupStatusResponse)
async def setup_status(
    service: AuthService = Depends(get_service),
):
    return await service.get_setup_status()


@router.post("/login", response_model=LoginResponse)
async def login(
    payload: LoginRequest,
    request: Request,
    service: AuthService = Depends(get_service),
):
    ip = _get_client_ip(request)
    _check_rate_limit(ip)
    try:
        result = await service.login(payload)
    except HTTPException:
        _record_failure(ip)
        raise
    _clear_failures(ip)
    return result


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


@router.get("/me/api-keys", response_model=list[IntegrationApiKeyResource])
async def list_api_keys(
    current_user: CurrentUserDep,
    service: AuthService = Depends(get_service),
):
    return await service.list_integration_api_keys(current_user)


@router.post(
    "/me/api-keys",
    response_model=CreateIntegrationApiKeyResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_api_key(
    payload: CreateIntegrationApiKeyRequest,
    current_user: CurrentUserDep,
    service: AuthService = Depends(get_service),
):
    return await service.create_integration_api_key(current_user, payload.name)


@router.delete("/me/api-keys/{key_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_api_key(
    key_id: int,
    current_user: CurrentUserDep,
    service: AuthService = Depends(get_service),
):
    await service.revoke_integration_api_key(current_user, key_id)


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
