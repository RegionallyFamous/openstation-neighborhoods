# OpenStation Neighborhoods repository instructions

- Preserve the local-only security boundary: the default Beeper endpoint must remain on loopback and documentation must never suggest exposing the Desktop API to the public internet.
- Treat `src/community.ts` as the canonical community manifest. Never present fictional messages, members, unread counts, or identity as live data.
- Never commit Beeper access tokens, OAuth authorization codes, Matrix session keys, or real chat exports.
- Do not perform a live OAuth grant, send a live message, join a room, or react from the user's account without confirmation at the moment of that action.
- Keep the disconnected hosted app useful as a room map and Beeper onboarding surface when Beeper is absent.
- Ship Neighborhoods as the hosted web app at `openstation.chat`; do not reintroduce a native wrapper without an explicit product decision.
- Beeper API responses may evolve. Normalize external data at the adapter boundary and cover changed shapes with tests.
- Run `npm run check` after implementation changes.
