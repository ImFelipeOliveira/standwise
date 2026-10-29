## Pagination

List operations use opaque cursors.

| Parameter | Where | Description |
| --- | --- | --- |
| `limit` | query | Page size, from 1 to 100. Defaults to 50. |
| `cursor` | query | The `next_cursor` of the previous page. Omit it to get the first page. |

A paginated response carries the items and a `next_cursor`:

```json
{ "data": [], "next_cursor": "eyJpZCI6MTIzfQ" }
```

When `next_cursor` is `null` there are no more pages. Treat the cursor as an opaque string: do not parse it, build it or store it for long. Keep the same filters while paginating.
