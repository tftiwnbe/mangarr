# Integration API

Mangarr exposes a small authenticated API for external tools and migration scripts.

Create an integration key in `Settings -> Integration API Keys`, then send it with either:

- `Authorization: Bearer mgr_...`
- `X-API-Key: mgr_...`

## Search Titles

`POST /api/titles/import/search`

Request body:

```json
{
  "source_id": "2499283573021220255",
  "query": "Chainsaw Man",
  "limit": 10
}
```

Optional fields:

- `search_filters`: raw source search filters object, using the same filter payload shape the web app sends to the bridge
- `source_id`: omit or send an empty string to search across enabled sources
- `query`: may be empty when `search_filters` is provided

Response shape:

```json
{
  "query": "Chainsaw Man",
  "source_id": "2499283573021220255",
  "limit": 10,
  "items": [
    {
      "canonical_key": "2499283573021220255::/title/...",
      "source_id": "2499283573021220255",
      "source_pkg": "eu.kanade.tachiyomi.extension.en.mangadex",
      "source_lang": "en",
      "source_name": "MangaDex",
      "title_url": "/title/...",
      "title": "Chainsaw Man",
      "description": "...",
      "cover_url": "https://...",
      "genre": "Action, Horror"
    }
  ]
}
```

## Import Title

`POST /api/titles/import`

Pass one of the returned `items[]` objects back as `item`:

```json
{
  "item": {
    "canonical_key": "2499283573021220255::/title/...",
    "source_id": "2499283573021220255",
    "source_pkg": "eu.kanade.tachiyomi.extension.en.mangadex",
    "source_lang": "en",
    "title_url": "/title/...",
    "title": "Chainsaw Man"
  },
  "user_status_key": "plan_to_read",
  "collection_names": ["Imported"],
  "listed_in_library": true
}
```

Supported preference fields:

- `user_status_id`
- `user_status_key`
- `user_status_label`
- `collection_ids`
- `collection_names`
- `listed_in_library`
- `use_default_status`
- `use_default_collection`

Default behavior when preference fields are omitted:

- applies the default `Plan to Read` status if present
- applies the `Imported` collection, creating it on first use if needed
- lists the title in the visible library grid

The import endpoint reuses the normal Mangarr import flow, so it still merges duplicates, caches covers, and syncs chapters the same way the web UI does.
