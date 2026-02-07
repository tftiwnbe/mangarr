from collections.abc import Iterable, Sequence
from typing import Generic, TypeVar

from sqlmodel import SQLModel
from sqlmodel.ext.asyncio.session import AsyncSession

Model = TypeVar("Model", bound=SQLModel)


class Storage(Generic[Model]):
    def __init__(self, session: AsyncSession):
        self.session = session

    async def add(self, instance: Model) -> Model:
        self.session.add(instance)
        await self._commit([instance])
        return instance

    async def add_many(self, instances: Iterable[Model]) -> Sequence[Model]:
        instances = list(instances)
        self.session.add_all(instances)
        await self._commit(instances)
        return instances

    async def commit(self, *refresh_targets: Model) -> None:
        await self._commit(refresh_targets)

    async def delete(self, instance: Model) -> None:
        await self.session.delete(instance)
        await self._commit([])

    async def _commit(self, refresh_targets: Iterable[Model]) -> None:
        try:
            await self.session.commit()
        except Exception:
            await self.session.rollback()
            raise
        for target in refresh_targets:
            await self.session.refresh(target)
