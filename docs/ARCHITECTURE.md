# Architecture

Neighborhoods owns the presentation and information architecture of an OpenStation community. Beeper owns identity, encryption, account sessions, and Matrix transport.

## Runtime flow

1. The application probes `GET /v1/info` on Beeper Desktop's loopback API.
2. The user creates a read/write access token in Beeper under **Settings → Integrations → Approved connections** and pastes it into the connection panel.
3. The token is stored for the browser session only unless the user explicitly selects **Remember me on this computer**.
4. Neighborhoods reads Beeper accounts and confirms that a Matrix account is available.
5. Beeper chats are matched to channels in `src/community.ts`. Exact room IDs win when configured; human-readable titles are the proof-of-concept fallback.
6. The selected room's messages are normalized into the product's internal message model.
7. Sends and read receipts are forwarded to the local Beeper API.

## Trust boundary

```text
┌──────────────────────────────────────────────┐
│ User's computer                              │
│                                              │
│  Neighborhoods ── bearer token ──► Beeper   │
│       UI          localhost only     Desktop │
│                                      │       │
└──────────────────────────────────────│───────┘
                                       ▼
                             Beeper/Matrix network
```

Neighborhoods never receives a Beeper password or Matrix encryption key. Its bearer token can still read and write chats, so it is kept in browser storage only and must never be logged or exported. Users can choose a short expiry and revoke the connection from Beeper's Approved connections list.

## Production direction

Neighborhoods is a hosted web product at `openstation.chat`. SpaceFast serves the static app and Cloudflare provides authoritative DNS, while every authenticated Beeper request travels directly from the visitor's browser to Beeper Desktop on that same computer. Neither SpaceFast nor OpenStation receives the Beeper bearer token or proxies the local API.

The disconnected interface contains only the canonical room structure and connection guidance. Messages, members, unread counts, identity, sends, and read receipts appear only after Beeper returns live data.

Beeper Desktop 4.3.57 applies a same-origin requirement to OAuth registration, token exchange, introspection, and revocation. Because Neighborhoods is hosted, it uses Beeper's documented manual-token fallback and validates the credential with the first authenticated API request instead of calling the restricted OAuth endpoints.

The Matrix community remains portable. If OpenStation later operates its own Matrix client or homeserver, the manifest and room identities can survive while the transport adapter changes.
