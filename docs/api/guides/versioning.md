## Versioning

The API is versioned in the path. `/v1` is the current version. The `info.version` of the OpenAPI document is the Standcast release (for example `0.2.0`).

- **Public beta.** While Standcast is in 0.x, `/v1` can still change in incompatible ways. Such changes are listed in the changelog before they ship, with as much notice as possible. The 90-day notice below applies from 1.0.
- New fields may be added to responses at any time. Ignore fields you do not recognize.
- New optional request parameters and new operations may be added to `/v1` without notice.
- A change that breaks existing clients ships only in `/v2`.
- Before `/v1` behavior is removed or changed incompatibly, the change is announced in the changelog at least 90 days in advance.

Every release is listed in `docs/api/CHANGELOG.md`, under the same version as the [GitHub release](https://github.com/ImFelipeOliveira/standcast/releases).
