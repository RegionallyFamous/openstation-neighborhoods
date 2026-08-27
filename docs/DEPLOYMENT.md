# Web deployment

OpenStation Neighborhoods is a static Vite application hosted on SpaceFast. SpaceFast serves the frontend but does not proxy Beeper traffic or receive Beeper access tokens. Each authenticated request travels from the visitor's browser to Beeper Desktop on that same computer.

## Release lanes

Production must be promoted from an already-tested immutable preview. Do not rebuild between preview testing and production promotion.

### Preview

The compatible local command publishes a preview and waits for it to become ready:

```bash
npm run deploy:spacefast
```

`deploy:spacefast` intentionally aliases `deploy:preview`; it does not change live traffic. The preferred release path is the **Publish release preview** GitHub Actions workflow. Run the workflow from `main` and provide an annotated tag or full commit SHA in its `revision` input; it checks out that revision and records the Git repository, commit, selected ref, SpaceFast version, and deployment receipt.

The preview workflow requires a `SPACEFAST_TOKEN` secret in a GitHub environment named `preview`. Give the token only the access required to publish to the OpenStation team's `openstation-chat` space.

### Production

After the immutable preview passes the release checklist, run the **Promote release to production** workflow and provide its SpaceFast version reference, such as `v12`. The workflow points the live channel at that exact version without rebuilding it.

Configure the GitHub environment named `production` with:

- At least one required reviewer
- A scoped `SPACEFAST_TOKEN` secret
- Deployment access limited to protected tags or the protected `main` branch

The workflow smoke-tests the canonical domain, security headers, and `www` redirect after promotion and saves the SpaceFast response as a one-year release receipt.

## Build environment

CI builds with a fixed production configuration:

```text
VITE_BEEPER_API_BASE=http://127.0.0.1:23373
VITE_BEEPER_OAUTH_SCOPE=
```

A non-loopback Beeper API base is prohibited. Never place an access token, OAuth authorization code, Matrix key, or chat data in a Vite environment variable; Vite variables are compiled into public JavaScript.

The dependency lockfile, declared npm release, Node compatibility range, and exact SpaceFast CLI dependency are part of the release input. CI validates the supported minimum Node release and the current Node LTS line.

## SpaceFast configuration

The production SpaceFast space is `openstation-chat` in the `openstation` team. The build publishes `dist/` in snapshot mode with the SPA fallback enabled.

The files copied from `public/` provide:

- `_redirects` for the client-side application fallback
- `_headers` for CSP, browser security policy, and caching
- Local fonts, brand assets, the web manifest, and application icons

SpaceFast deployment history is not a substitute for Git history. Every release receipt must link the SpaceFast version to a Git commit and tag.

## Domains

`openstation.chat` is the canonical domain. `www.openstation.chat` permanently redirects to it. Cloudflare remains authoritative for DNS, while SpaceFast terminates HTTPS and serves the site.

After every production promotion, verify:

```bash
curl --fail --head https://openstation.chat/
curl --fail --head https://www.openstation.chat/
```

The apex response must include the CSP, Referrer-Policy, Permissions-Policy, and X-Content-Type-Options declared in `public/_headers`. The `www` response must redirect to `https://openstation.chat/`.

Do not create a public proxy to port 23373. The Beeper Desktop API remains bound to the visitor's own computer.

## Rollback

SpaceFast keeps immutable ready versions. Use the process in [`ROLLBACK.md`](ROLLBACK.md) to point the live channel at the recorded last-known-good version. A rollback changes only the hosted frontend; it does not reverse messages, room joins, or Matrix administration already performed through Beeper.
