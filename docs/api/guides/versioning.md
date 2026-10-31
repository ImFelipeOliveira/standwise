## Versioning

The API is versioned in the path. `/v1` is the current stable version.

- New fields may be added to responses at any time. Ignore fields you do not recognize.
- New optional request parameters and new operations may be added to `/v1` without notice.
- A change that breaks existing clients ships only in `/v2`.
- Before `/v1` behavior is removed or changed incompatibly, the change is announced in the changelog at least 90 days in advance.

Every release is listed in `docs/api/CHANGELOG.md`.
