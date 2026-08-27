# Changelog

All notable changes to OpenStation Neighborhoods are recorded here. The project follows [Semantic Versioning](https://semver.org/) and uses prerelease identifiers such as `-rc.1` for release candidates.

## [Unreleased]

## 0.2.0-rc.1 - 2026-08-26

### Added

- A Beeper-supported manual access-token connection path for hosted browsers after Beeper 4.3.57 made its OAuth endpoints same-origin only.
- Actionable recovery states for Beeper availability, browser access, version, authorization, account health, room joins, rate limits, and live synchronization.
- Per-room retry controls and visible loading, retrying, stale, and recovered synchronization feedback.
- Release verification, preview, promotion, and rollback foundations.
- Complete selected-room participant loading and authenticated Beeper asset streaming for account, member, message-author, and attachment media.
- Cursor-based older-message loading, deterministic pending-send resolution, and send-status feedback.
- Explicit public-room consent, current-version checks, and a gesture-first local-network connection flow.
- Accessible small-screen room navigation and keyboard-scrollable conversation regions.
- An optional “Remember me on this computer” approval that survives tab closure while session-only storage remains the default.

### Changed

- Connection validation now uses the first authenticated Desktop API request; disconnect clears the browser copy while Beeper-side token revocation remains in Settings → Integrations.
- Saved-session recovery now reuses a valid token, failed rooms retry independently, and transient sync errors can no longer masquerade as a healthy live connection.
- Saved sessions no longer wait on a redundant Matrix profile lookup, and slow read receipts no longer block message hydration.
- Saved-tab restoration now reports real progress, opens recovery details after ten seconds, and no longer waits for avatar media before entering the neighborhood.
- HTML responses opt out of edge rewriting so analytics beacons cannot be injected into the token-bearing app shell.
- Forward synchronization now drains Beeper's newest cursors and reconciles remote deletion tombstones.
- Beeper API traffic is pinned to `http://127.0.0.1:23373`.
- Attachments load only after a user asks to download them.
- Onboarding artwork is 98% smaller, and social cards use a standard 1200×630 image.

### Removed

- The install manifest for a mobile/PWA experience that the same-computer Beeper integration cannot support.
- Reactions and their unused client, state, test, and interface code.
- Title/alias room discovery now that every production room has an immutable canonical ID.

## 0.1.0 (alpha) - 2026-08-19

### Added

- Initial alpha of the OpenStation Neighborhoods hosted Beeper community client.
