# Security policy

## Reporting a vulnerability

Please report suspected vulnerabilities privately through this repository's GitHub Security Advisory form. Do not open a public issue containing a Beeper access token, OAuth authorization code, Matrix session key, room export, or another person's messages.

Include the affected OpenStation version or Git commit, browser and Beeper Desktop versions, reproduction steps, and impact. Replace tokens and private identifiers with clearly marked placeholders.

## Supported versions

Until the first stable release, only the latest published release candidate receives security fixes. Alpha versions and old preview deployments are unsupported.

## Security boundary

Neighborhoods talks directly from the visitor's browser to Beeper Desktop on loopback. OpenStation must never proxy or expose the Desktop API on the public internet. A production build that contains a non-loopback Desktop API endpoint is a release blocker.

## Tracked development-tool advisory

SpaceFast CLI 0.0.13 currently pulls esbuild 0.28.0, which npm reports under low-severity advisory [GHSA-g7r4-m6w7-qqqr](https://github.com/advisories/GHSA-g7r4-m6w7-qqqr). The affected behavior is an esbuild development server running on Windows; Neighborhoods uses this dependency only for the SpaceFast publishing CLI on macOS or Linux and does not invoke that server. Review this exception before every release candidate and remove it when SpaceFast publishes a fixed dependency graph.
