from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class SetRepoUrlRequest(_message.Message):
    __slots__ = ("url",)
    URL_FIELD_NUMBER: _ClassVar[int]
    url: str
    def __init__(self, url: _Optional[str] = ...) -> None: ...

class SetRepoUrlResponse(_message.Message):
    __slots__ = ("success", "error")
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    ERROR_FIELD_NUMBER: _ClassVar[int]
    success: bool
    error: str
    def __init__(self, success: bool = ..., error: _Optional[str] = ...) -> None: ...

class FlareSolverrConfig(_message.Message):
    __slots__ = ("enabled", "url", "timeout_seconds", "response_fallback", "session_name", "session_ttl_minutes")
    ENABLED_FIELD_NUMBER: _ClassVar[int]
    URL_FIELD_NUMBER: _ClassVar[int]
    TIMEOUT_SECONDS_FIELD_NUMBER: _ClassVar[int]
    RESPONSE_FALLBACK_FIELD_NUMBER: _ClassVar[int]
    SESSION_NAME_FIELD_NUMBER: _ClassVar[int]
    SESSION_TTL_MINUTES_FIELD_NUMBER: _ClassVar[int]
    enabled: bool
    url: str
    timeout_seconds: int
    response_fallback: bool
    session_name: str
    session_ttl_minutes: int
    def __init__(self, enabled: bool = ..., url: _Optional[str] = ..., timeout_seconds: _Optional[int] = ..., response_fallback: bool = ..., session_name: _Optional[str] = ..., session_ttl_minutes: _Optional[int] = ...) -> None: ...

class GetFlareSolverrConfigRequest(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class GetFlareSolverrConfigResponse(_message.Message):
    __slots__ = ("config",)
    CONFIG_FIELD_NUMBER: _ClassVar[int]
    config: FlareSolverrConfig
    def __init__(self, config: _Optional[_Union[FlareSolverrConfig, _Mapping]] = ...) -> None: ...

class SetFlareSolverrConfigRequest(_message.Message):
    __slots__ = ("config",)
    CONFIG_FIELD_NUMBER: _ClassVar[int]
    config: FlareSolverrConfig
    def __init__(self, config: _Optional[_Union[FlareSolverrConfig, _Mapping]] = ...) -> None: ...

class SetFlareSolverrConfigResponse(_message.Message):
    __slots__ = ("success", "error")
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    ERROR_FIELD_NUMBER: _ClassVar[int]
    success: bool
    error: str
    def __init__(self, success: bool = ..., error: _Optional[str] = ...) -> None: ...

class ProxyConfig(_message.Message):
    __slots__ = ("hostname", "port", "username", "password", "ignored_addresses", "bypass_local_addresses")
    HOSTNAME_FIELD_NUMBER: _ClassVar[int]
    PORT_FIELD_NUMBER: _ClassVar[int]
    USERNAME_FIELD_NUMBER: _ClassVar[int]
    PASSWORD_FIELD_NUMBER: _ClassVar[int]
    IGNORED_ADDRESSES_FIELD_NUMBER: _ClassVar[int]
    BYPASS_LOCAL_ADDRESSES_FIELD_NUMBER: _ClassVar[int]
    hostname: str
    port: int
    username: str
    password: str
    ignored_addresses: str
    bypass_local_addresses: bool
    def __init__(self, hostname: _Optional[str] = ..., port: _Optional[int] = ..., username: _Optional[str] = ..., password: _Optional[str] = ..., ignored_addresses: _Optional[str] = ..., bypass_local_addresses: bool = ...) -> None: ...

class GetProxyConfigRequest(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class GetProxyConfigResponse(_message.Message):
    __slots__ = ("config",)
    CONFIG_FIELD_NUMBER: _ClassVar[int]
    config: ProxyConfig
    def __init__(self, config: _Optional[_Union[ProxyConfig, _Mapping]] = ...) -> None: ...

class SetProxyConfigRequest(_message.Message):
    __slots__ = ("config",)
    CONFIG_FIELD_NUMBER: _ClassVar[int]
    config: ProxyConfig
    def __init__(self, config: _Optional[_Union[ProxyConfig, _Mapping]] = ...) -> None: ...

class SetProxyConfigResponse(_message.Message):
    __slots__ = ("success", "error")
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    ERROR_FIELD_NUMBER: _ClassVar[int]
    success: bool
    error: str
    def __init__(self, success: bool = ..., error: _Optional[str] = ...) -> None: ...

class SetExtensionProxyRequest(_message.Message):
    __slots__ = ("package_name", "use_proxy")
    PACKAGE_NAME_FIELD_NUMBER: _ClassVar[int]
    USE_PROXY_FIELD_NUMBER: _ClassVar[int]
    package_name: str
    use_proxy: bool
    def __init__(self, package_name: _Optional[str] = ..., use_proxy: bool = ...) -> None: ...

class SetExtensionProxyResponse(_message.Message):
    __slots__ = ("success", "error")
    SUCCESS_FIELD_NUMBER: _ClassVar[int]
    ERROR_FIELD_NUMBER: _ClassVar[int]
    success: bool
    error: str
    def __init__(self, success: bool = ..., error: _Optional[str] = ...) -> None: ...
