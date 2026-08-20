# Security policy

## Reporting a vulnerability

Please report suspected vulnerabilities privately through this repository's GitHub Security Advisory form. Do not open a public issue containing a Beeper access token, OAuth authorization code, Matrix session key, room export, or another person's messages.

Include the affected OpenStation version or Git commit, browser and Beeper Desktop versions, reproduction steps, and impact. Replace tokens and private identifiers with clearly marked placeholders.

## Supported versions

Until the first stable release, only the latest published release candidate receives security fixes. Alpha versions and old preview deployments are unsupported.

## Security boundary

Neighborhoods talks directly from the visitor's browser to Beeper Desktop on loopback. OpenStation must never proxy or expose the Desktop API on the public internet. A production build that contains a non-loopback Desktop API endpoint is a release blocker.

## Tracked development-tool advisory

SpaceFast CLI 0.0.24 currently pulls transitive `esbuild` and `js-yaml` advisories that npm reports in the development toolchain. Neighborhoods uses SpaceFast only as a local/CI publishing CLI; it is not bundled into the frontend and production dependencies report zero vulnerabilities with `npm audit --omit=dev`. Review these dev-tool exceptions before every release candidate and remove them when SpaceFast publishes a fixed dependency graph.
