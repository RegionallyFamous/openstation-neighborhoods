# Changelog

All notable changes to OpenStation Neighborhoods are recorded here. The project follows [Semantic Versioning](https://semver.org/) and uses prerelease identifiers such as `-rc.1` for release candidates.

## [Unreleased]

### Added

- Release verification, preview, promotion, and rollback foundations.
- Complete selected-room participant loading and authenticated Beeper asset streaming for account, member, message-author, and attachment media.
- Cursor-based older-message loading, deterministic pending-send resolution, and send-status feedback.
- OAuth token introspection at connection time and grant revocation on explicit disconnect.
- Explicit public-room consent, current-version checks, and a gesture-first local-network connection flow.
- Accessible small-screen room navigation and keyboard-scrollable conversation regions.

### Changed

- Saved-tab restoration now reports real progress, opens recovery details after ten seconds, and no longer waits for avatar media before entering the neighborhood.
- HTML responses opt out of edge rewriting so analytics beacons cannot be injected into the token-bearing app shell.
- Forward synchronization now drains Beeper's newest cursors and reconciles remote deletion tombstones.
- Beeper API and OAuth traffic is pinned to `http://127.0.0.1:23373`.
- Attachments load only after a user asks to download them.
- Onboarding artwork is 98% smaller, and social cards use a standard 1200×630 image.

### Removed

- The install manifest for a mobile/PWA experience that the same-computer Beeper integration cannot support.
- Reactions and their unused client, state, test, and interface code.
- Title/alias room discovery now that every production room has an immutable canonical ID.

## 0.1.0 (alpha) - 2026-08-19

### Added

- Initial alpha of the OpenStation Neighborhoods hosted Beeper community client.
