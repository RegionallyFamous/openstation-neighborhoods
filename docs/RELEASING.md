# Release process

This process turns a reviewed Git revision into a traceable OpenStation Neighborhoods release candidate. Preview and production use the same SpaceFast artifact.

## One-time repository setup

1. Create the canonical Git remote and protect `main`.
2. Require the `CI` workflow before merging.
3. Create `preview` and `production` GitHub environments.
4. Store a least-privilege SpaceFast token as `SPACEFAST_TOKEN` in each environment.
5. Require a reviewer for the production environment.
6. Enable private vulnerability reporting through GitHub Security Advisories.

## Prepare a release candidate

1. Start from a clean, current `main` branch.
2. Move completed entries from `CHANGELOG.md`'s Unreleased section into the candidate version.
3. Set the same SemVer prerelease in `package.json` and `package-lock.json`, for example `0.2.0-rc.1`.
4. Run a clean verification:

   ```bash
   npm ci --ignore-scripts
   npm run check
   npm audit --audit-level=high
   ```

5. Commit the version and changelog. Create an annotated tag such as `v0.2.0-rc.1` only after CI passes.
6. Run **Publish release preview** from that tag or commit.
7. Save the workflow artifact containing `dist/` and `spacefast-preview.json`.

## Preview qualification

Record the following against the immutable preview URL:

- Git commit, tag, SpaceFast version ID, and manifest hash
- Successful CI workflow URL
- Desktop and mobile layout checks
- Chrome, Safari, and Firefox results where supported by local-network access rules
- Beeper Desktop version used for testing
- Fresh manual-token connection and revoked/expired/invalid-token recovery
- Disconnected mode with Beeper closed
- Automatic discovery and joining with a disposable test account
- Real message load, send, unread state, and member display
- Welcome and Announcements permissions with a non-administrator account
- CSP and other response headers
- Canonical-domain and `www` redirect behavior
- A named last-known-good SpaceFast version

Any test that sends, reacts, joins rooms, or changes Matrix state must use an approved account and receive action-time confirmation.

## Promote

Run **Promote release to production**, entering the exact SpaceFast version from the approved preview receipt. The workflow uses SpaceFast's channel switch and does not rebuild.

After promotion:

1. Confirm the workflow's production smoke test passed.
2. Repeat token recovery and one read-only room-load test from `openstation.chat`.
3. Publish release notes linking the Git tag and summarizing known limitations.
4. Store the production receipt with the release record.
5. Watch the agreed launch signals during the release observation window.

If a launch-blocking regression appears, follow [`ROLLBACK.md`](ROLLBACK.md) immediately.

## Release receipt

Every candidate and production release must retain:

- SemVer version and annotated Git tag
- Full Git commit SHA
- CI workflow URL
- Node and npm versions
- `package-lock.json` hash
- Built artifact hash
- SpaceFast version ID and manifest hash
- Immutable preview URL
- Promotion timestamp and operator
- Last-known-good rollback version
- Manual qualification notes
