# Production rollback

Rollback moves the SpaceFast live channel to an existing ready frontend version. It does not rebuild, delete the failed version, change DNS, or reverse any Matrix action already completed through Beeper.

## When to roll back

Roll back when production introduces a launch-blocking regression such as:

- OAuth cannot complete or valid users are reported as invalid-token
- The application loses its loopback-only API boundary
- Users cannot load the community after connecting
- A release exposes fictional data as live activity
- A browser-breaking JavaScript error affects the supported launch matrix
- Required security headers disappear

## Procedure

1. Stop further promotions and record the failing SpaceFast version.
2. List retained versions:

   ```bash
   npm run release:versions
   ```

3. Confirm the version marked as last-known-good in the previous release receipt is still `ready`.
4. Run the **Promote release to production** workflow with that version. For an authorized emergency operator, the equivalent CLI command is:

   ```bash
   npm exec -- sf rollback v12 --team openstation --space openstation-chat --channel live --wait
   ```

5. Verify `https://openstation.chat/`, the `www` redirect, security headers, and disconnected mode.
6. With explicit approval, verify OAuth and a read-only room load using a designated test account.
7. Record the rollback timestamp, operator, failed version, restored version, user impact, and follow-up issue.

## After rollback

- Keep the failed immutable version and its release receipt until the incident review is complete.
- Reproduce the fault from the failed preview URL rather than from production.
- Fix forward through the normal preview qualification process.
- Do not reuse a revoked credential or copy a browser token into issue notes, logs, or screenshots.

