# Architecture

Neighborhoods owns the presentation and information architecture of an OpenStation community. Beeper owns identity, encryption, account sessions, and Matrix transport.

## Runtime flow

1. The application probes `GET /v1/info` on Beeper Desktop's loopback API.
2. The user explicitly begins OAuth. Neighborhoods discovers Beeper's local authorization metadata, dynamically registers a public client, and starts an authorization-code flow with PKCE.
3. The returned access token is stored for the browser session only.
4. Neighborhoods reads Beeper accounts and confirms that a Matrix account is available.
5. Beeper chats are matched to channels in `src/community.ts`. Exact room IDs win when configured; human-readable titles are the proof-of-concept fallback.
6. The selected room's messages are normalized into the product's internal message model.
7. Sends, reactions, and read receipts are forwarded to the local Beeper API.

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

Neighborhoods never receives a Beeper password or Matrix encryption key. Its bearer token can still read and write chats, so it is intentionally short-lived in browser storage and must never be logged or exported.

## Production direction

Neighborhoods is a hosted web product at `openstation.chat`. SpaceFast serves the static app and Cloudflare provides authoritative DNS, while every authenticated Beeper request travels directly from the visitor's browser to Beeper Desktop on that same computer. Neither SpaceFast nor OpenStation receives the Beeper bearer token or proxies the local API.

The disconnected interface contains only the canonical room structure and connection guidance. Messages, members, unread counts, identity, sends, reactions, and read receipts appear only after Beeper returns live data.

The Matrix community remains portable. If OpenStation later operates its own Matrix client or homeserver, the manifest and room identities can survive while the transport adapter changes.
