from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse

from app.core.deps import DBSessionDep
from app.features.discover.service import DiscoverService

router = APIRouter(prefix="/api/v2/discover", tags=["discover"])


async def get_service(db: DBSessionDep) -> DiscoverService:
    return DiscoverService(db)


@router.get("/popular")
async def discover_popular(
    cursor: int = Query(0, description="Cursor for pagination (ID of last seen title)"),
    limit: int = Query(20, ge=1, le=100, description="Number of titles to return"),
    service: DiscoverService = Depends(get_service),
):
    """
    Stream popular titles with cursor-based pagination.

    **Flow:**
    1. Returns cached titles from database first (instant)
    2. If not enough cached, fetches from enabled sources by priority
    3. Automatically fetches one page at a time from next available source
    4. Returns cursor for next request

    **Parameters:**
    - cursor: Start from this title ID (0 = start from beginning)
    - limit: How many titles to return (1-100, default 20)

    **Response:** Server-Sent Events stream with:
    - `type: status` - Loading status messages
    - `type: title` - Individual titles with progress
    - `type: complete` - Final message with next cursor

    **Example usage:**
    ```javascript
    const eventSource = new EventSource('/api/v2/discover/popular?cursor=0&limit=20');
    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'title') {
        // Add title to UI
      } else if (data.type === 'complete') {
        // Use data.cursor for next request
        // Check data.has_more to see if there are more titles
      }
    };
    ```
    """
    return StreamingResponse(
        service.stream_popular_titles(cursor=cursor, limit=limit),
        media_type="text/event-stream",
    )


@router.get("/latest")
async def discover_latest(
    cursor: int = Query(0, description="Cursor for pagination (ID of last seen title)"),
    limit: int = Query(20, ge=1, le=100, description="Number of titles to return"),
    service: DiscoverService = Depends(get_service),
):
    """
    Stream latest titles with cursor-based pagination.
    Only includes sources that support the 'latest' feature.

    **Flow:**
    1. Returns cached titles from database first (instant)
    2. If not enough cached, fetches from enabled sources by priority
    3. Automatically fetches one page at a time from next available source
    4. Returns cursor for next request

    **Parameters:**
    - cursor: Start from this title ID (0 = start from beginning)
    - limit: How many titles to return (1-100, default 20)

    **Response:** Server-Sent Events stream with:
    - `type: status` - Loading status messages
    - `type: title` - Individual titles with progress
    - `type: complete` - Final message with next cursor
    """
    return StreamingResponse(
        service.stream_latest_titles(cursor=cursor, limit=limit),
        media_type="text/event-stream",
    )
