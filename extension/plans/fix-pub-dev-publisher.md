# 67 — Fix pub.dev Publisher Identity

## Status

**Blocked** — waiting on pub.dev support or OIDC API workaround.

## Problem

The `saropa_drift_viewer` package on pub.dev shows **"unverified uploader"**
instead of the verified publisher **saropa.com**.

- Package URL: https://pub.dev/packages/saropa_drift_viewer
- Published versions: 0.2.1, 0.2.2
- Expected publisher: saropa.com (verified, owns `saropa_lints` and
  `saropa_dart_utils`)

## Root Cause

The first version was published via GitHub Actions using OIDC authentication
(`dart pub publish --force` in `.github/workflows/publish.yml`). The OIDC
service identity — not the human Google account
`craig.hathaway@saropa.com` — became the sole owner on pub.dev.

Because the owner is a CI service identity:

1. No human account can see the **Admin tab** on the package page
2. `dart pub uploader add` is **deprecated** — returns "manage uploaders from
   the admin page"
3. The package cannot be transferred to the `saropa.com` verified publisher
4. The package cannot be discontinued, unlisted, or retracted
5. No new uploaders can be invited

The human account (`craig.hathaway@saropa.com`) is fully authenticated via
`dart pub login` and is the admin of the `saropa.com` verified publisher, but
pub.dev does not recognize it as an uploader for this package.

## What Was Tried

| Action | Result |
|--------|--------|
| `dart pub login` as `craig.hathaway@saropa.com` | Authenticated, but no Admin tab visible |
| `dart pub uploader add` via GitHub Actions workflow (`add-uploader.yml`) | Command deprecated, exit code 1 |
| `dart pub uploader list` | Command deprecated |
| Filed GitHub issue [dart-lang/pub-dev#9261](https://github.com/dart-lang/pub-dev/issues/9261) | Closed immediately, told to email `support@pub.dev` |
| Emailed `support@pub.dev` | Pending reply (pub.dev collaborator confirmed it will be answered) |

## Workaround Attempt: OIDC API Calls

A workflow `.github/workflows/fix-publisher.yml` was created to exploit the
fact that the OIDC identity has publish access. It attempts to call the
pub.dev API directly using the GitHub OIDC token:

### API Endpoints (from pub-dev source code)

| Operation | Method | Endpoint | Body |
|-----------|--------|----------|------|
| Invite uploader | `POST` | `/api/packages/<pkg>/invite-uploader` | `{"email": "..."}` |
| Transfer to publisher | `PUT` | `/api/packages/<pkg>/publisher` | `{"publisherId": "..."}` |
| Discontinue | `PUT` | `/api/packages/<pkg>/options` | `{"isDiscontinued": true}` |
| Retract version | `PUT` | `/api/packages/<pkg>/versions/<ver>/options` | `{"isRetracted": true}` |

### Risk

The admin endpoints use `requireAuthenticatedWebUser()` in the pub-dev
server code, which may only accept Google OAuth tokens — not GitHub OIDC
tokens. If so, all attempts will fail with 401/403.

### Workflow Location

`.github/workflows/fix-publisher.yml` — triggered manually from the Actions
tab.

## Resolution Paths

### Path 1: pub.dev Support (most likely)

Wait for `support@pub.dev` to respond. They can server-side:

- Add `craig.hathaway@saropa.com` as an uploader
- Transfer the package to `saropa.com`
- Or both

### Path 2: OIDC API Workaround (uncertain)

Run `fix-publisher.yml` and check if any of the API calls succeed. If the
OIDC token is accepted for admin operations, the package can be transferred
or discontinued directly.

### Path 3: Republish Under New Name (nuclear option)

1. Rename the package in `pubspec.yaml` (e.g. `saropa_drift_viewer2`)
2. `dart pub login` as `craig.hathaway@saropa.com`
3. `dart pub publish` locally
4. Transfer to `saropa.com` via the Admin tab
5. Old package remains on pub.dev permanently (cannot be deleted)

## Prevention

For all future packages:

1. **Publish the first version locally** with `dart pub publish` while logged
   in as `craig.hathaway@saropa.com`
2. **Transfer to `saropa.com`** via the Admin tab on pub.dev
3. **Then** enable the GitHub Actions OIDC workflow for subsequent versions

The automated publishing workflow should only be used after the package
already exists under the verified publisher. Publishing the first version
via CI creates an ownerless package that no human can administer.

## Affected Packages

- `saropa_drift_viewer` — confirmed affected
- Any other package first-published via GitHub Actions OIDC may have the
  same issue

## References

- [dart-lang/pub-dev#9261](https://github.com/dart-lang/pub-dev/issues/9261)
- [pub-dev source: pubapi.dart](https://github.com/dart-lang/pub-dev/blob/master/app/lib/frontend/handlers/pubapi.dart)
- [Automated publishing docs](https://dart.dev/tools/pub/automated-publishing)
- [Verified publishers docs](https://dart.dev/tools/pub/verified-publishers)
