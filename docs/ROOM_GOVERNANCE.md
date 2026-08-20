# OpenStation Matrix room governance and recovery

This is the durable operations record for the OpenStation Matrix Space and its
rooms. The canonical product configuration remains `src/community.ts`; this
document explains how to audit, recover, replace, and preserve that configuration.
Room IDs are public identifiers, not secrets. Tokens, recovery codes, private
moderation-room IDs, and account session keys must never be added here.
Live Matrix state is authoritative for membership, permissions, room versions,
aliases, encryption, and moderation actions; this document records the intended
state and the recovery procedure.

## Current production manifest

Baseline observed on 2026-08-19: the Space and six supported rooms exist on
`beeper.com`, report Matrix room version 11, allow public joins, forbid guest
joins, are not world-readable, and have no advertised canonical alias. The
provisioner set shared history and did not enable end-to-end encryption.

| Logical ID | Type | Current Matrix room ID | Expected member posting |
| --- | --- | --- | --- |
| `openstation` | Space | `!jYEavbUBVrpqbFoOOc:beeper.com` | Moderator only |
| `welcome` | Announcement | `!UuSyQQEmGsqUSLAaAZ:beeper.com` | Moderator only; member reactions allowed |
| `announcements` | Announcement | `!GsViuCUYarKZrSbEPw:beeper.com` | Moderator only; member reactions allowed |
| `general` | Discussion | `!pNVJVFkiQDmaHxpeeA:beeper.com` | Allowed |
| `showcase` | Discussion | `!iXXipjdOmtOlNOBjFV:beeper.com` | Allowed |
| `builders` | Discussion | `!VjKgltGsprslucAaLp:beeper.com` | Allowed |
| `help-desk` | Discussion | `!xyMzRCglbiZDoNyjUH:beeper.com` | Allowed |

This table is a recovery aid, not a reason to skip live state validation. A
Matrix room upgrade produces a replacement room with a new room ID, so every
manifest change must update this table and `src/community.ts` together in a
reviewed release.

## Required state profile

Apply and verify this profile separately in the Space and all six supported rooms:

| Setting | Space | Announcements | Discussions |
| --- | --- | --- | --- |
| Join rule | `public` | `public` | `public` |
| Directory listing | Deliberate decision | Deliberate decision | Deliberate decision |
| Guest access | `forbidden` | `forbidden` | `forbidden` |
| History visibility | `shared` | `shared` | `shared` |
| `m.room.encryption` | Absent | Absent | Absent |
| `users_default` | 0 | 0 | 0 |
| `events_default` | 50 or higher | 50 | 0 |
| `state_default` | 50, with sensitive state at 100 | 50, with sensitive state at 100 | 50, with sensitive state at 100 |
| Kick / ban / redact | 50 | 50 | 50 |
| `@room` notification | 50 | 50 | 50 |

Explicitly protect these state events at administrator level: power levels,
join rules, history visibility, encryption, server ACLs, aliases, tombstones,
and Space child/parent relationships. Verify that member reactions remain
allowed in announcement rooms. Do not add `m.room.encryption`: the public-room
decision is intentionally unencrypted, and Matrix encryption cannot later be
disabled without replacing the room.

The Space must contain ordered `m.space.child` links for every room. Each child
should contain an `m.space.parent` link back to the Space with `canonical: true`.
Every link needs valid `via` servers. Once an independent homeserver account is
joined, include more than the Beeper server where supported.

## Administration model

Release-candidate minimum:

- one Beeper organization identity approved by Beeper for long-lived community
  ownership, or a documented alternative agreed with Beeper;
- two independent administrator accounts with the necessary authority in the
  Space and every room;
- at least one administrator on another homeserver for provider-outage and
  federation recovery testing;
- two active human moderators at power level 50 in every public room; and
- one cross-room moderation service with a private control room and auditable
  credentials.

Beeper's terms describe account access as personal. Do not share a Beeper login
or recovery code among team members. Record named custodians, use separate
accounts, and obtain written Beeper approval before treating an account as a
shared organization or bot identity.

For every administrator, record in a private credential system:

- Matrix user ID and homeserver;
- human owner and backup contact;
- rooms in which the account has administrator authority;
- Beeper recovery email and recovery-code custody, when applicable;
- verified devices and last successful recovery test; and
- date of the next access review.

## Initial hardening checklist

- [ ] Confirm the creator and `m.room.create` event in all eight rooms.
- [ ] Confirm the exact room version; current production rooms report version 11.
- [ ] Decide with Beeper whether to upgrade to room version 12 before accepting content.
- [ ] Verify two independent administrators in the Space and every room.
- [ ] Verify two moderators and the moderation service in every public room.
- [ ] Apply and export the approved power-level state for all eight rooms.
- [ ] Verify public join, shared history, forbidden guests, and absent encryption.
- [ ] Make the Space timeline moderator-only.
- [ ] Add canonical parent events in all child rooms.
- [ ] Reserve canonical `:beeper.com` aliases if Beeper permits them.
- [ ] Do not claim `:openstation.chat` aliases without Matrix hosting or delegation for that domain.
- [ ] Test joining by immutable room ID from a fresh Beeper account.
- [ ] Test joining and moderation from an independent homeserver.
- [ ] Remove or owner-gate the production provisioning surface.

## Routine audit

Run monthly and after every moderation incident, room upgrade, administrator
change, or Beeper platform update.

1. Fetch the live create, power-level, join-rule, history, guest-access,
   encryption, canonical-alias, tombstone, and Space relationship state.
2. Compare it with the last signed governance snapshot.
3. Confirm the approved administrators, moderators, and bot are still joined
   with the expected authority in all eight rooms.
4. Confirm there are no unexpected creators, aliases, parent/child links, ACLs,
   or privileged accounts.
5. Join with a normal account and verify posting permissions in announcements
   and discussions.
6. Test a report, redaction, kick, ban, unban, and cross-room ban.
7. Export the state snapshot and record the audit date, operator, differences,
   and remediation in private operations storage.

The hosted web client must never receive the administrator or moderation-bot
token used to perform this audit.

## Primary administrator recovery

### Lost device or inactive session

1. Stop using the affected session and revoke its Beeper integration tokens.
2. Recover the account only through a verified Beeper device or the recovery
   code held in the private credential system.
3. Inspect every room for unexpected messages, membership changes, power-level
   changes, aliases, ACLs, or Space links.
4. Reauthorize the minimum required devices and integrations.
5. Record the event and run the full routine audit.

### Lost recovery code

1. If a verified device remains, follow Beeper's supported recovery procedure;
   do not copy its session secrets into OpenStation.
2. Contact Beeper through the documented organization support route before
   resetting or deleting anything.
3. Use another administrator to preserve control of every room while the account
   is recovered.
4. A recovery-code reset can make old encrypted Beeper history inaccessible.
   The OpenStation rooms are intentionally unencrypted, but the administrator's
   other Beeper chats may be affected.
5. After recovery, verify the account, replace its recovery record, and rerun
   the governance audit.

### Compromised or unrecoverable primary administrator

1. From an unaffected administrator, demote or remove the account from the
   Space and all child rooms to the extent the room version permits. Ban it if
   continued access is unsafe.
2. Revoke the account from the moderation service and all private control rooms.
3. Notify Beeper and request homeserver-level account action when required.
4. Compare live state with the last approved snapshot and restore all differences.
5. Promote a replacement administrator without demoting the last working admin.
6. Test kick, ban, redact, state editing, Space editing, and room upgrade rights.
7. Publish an incident notice if community members or their data were affected.

Room version 12 gives creators special control that cannot be removed by an
ordinary power-level change. Choose creators and `additional_creators` before a
version-12 upgrade and document how their credentials remain available.

## Archive and provider-exit plan

At least weekly during active use, create an encrypted archive containing:

- the logical manifest and current room IDs;
- room state and power levels for all eight rooms;
- member and moderator roster needed for recovery;
- messages and attachments permitted by policy; and
- export time, counts, tool version, and verification result.

Store archives outside the Beeper account with access logging and a retention
schedule. Beeper's documented export is an archive; there is no documented
general restore operation. Test readability and attachment completeness, but do
not call an export a failover backup.

For resilience, keep an approved administrator or moderation service joined
from another homeserver. Federation gives that server a participating copy of
room state and events, but it does not guarantee a complete media archive,
alias ownership, or a turnkey migration.

## Room upgrade or replacement

Use this procedure when moving to a new Matrix room version, replacing a damaged
room, or leaving Beeper hosting:

1. Announce the maintenance window and freeze non-moderator posting if needed.
2. Export the current room state, power levels, roster, messages, attachments,
   aliases, and Space links.
3. Create or upgrade using the approved long-lived creator and additional
   creators. Confirm the new room version before proceeding.
4. Apply the required state profile; join administrators, moderators, and the
   moderation service; then test their permissions.
5. Add the new room to the Space, add its canonical parent link, and preserve
   the intended order and `via` servers.
6. Transfer aliases that the upgrading homeserver controls and verify every
   alias resolves to the new room ID.
7. Update the logical manifest, `src/community.ts`, this document, and the
   moderation configuration in one reviewed release.
8. Publish and pin the successor link in the old room. Keep the old room
   moderator-controlled while clients and members migrate.
9. Test automatic joining from a fresh Beeper account and a remote Matrix
   account before restoring normal posting.
10. Monitor failed joins and keep the prior manifest available for diagnosis.

Do not assume a hardcoded room ID survives an upgrade. Do not remove the old
room or its recovery evidence until the retention period and migration success
criteria are satisfied.

## Recovery acceptance drill

- [ ] A backup administrator recovers control without the primary account.
- [ ] A compromised moderator is removed from all eight rooms.
- [ ] A room-state snapshot identifies and repairs a deliberate test change.
- [ ] A fresh Beeper account joins the Space and all current room IDs.
- [ ] A remote Matrix account can join, read shared history, and be moderated.
- [ ] A room replacement updates aliases, Space links, moderation, and manifest.
- [ ] An encrypted export opens independently and its event/attachment counts reconcile.
- [ ] Beeper 401, 403, 404, 429, and offline states have documented operator actions.
- [ ] No access token, recovery code, session key, or private report data appears in source control.

## References

- [Matrix Spaces](https://spec.matrix.org/latest/client-server-api/#spaces)
- [Matrix room aliases](https://spec.matrix.org/latest/client-server-api/#room-aliases)
- [Matrix room versions](https://spec.matrix.org/latest/rooms/)
- [Matrix room administration and upgrades](https://matrix.org/docs/communities/administration/)
- [Matrix community provider changes](https://matrix.org/docs/communities/switching-providers/)
- [Beeper recovery and device verification](https://help.beeper.com/en_US/quick-references/how-to-verify-a-beeper-app)
- [Beeper recovery-code reset](https://help.beeper.com/en_US/troubleshooting/reset-secure-storage-recovery-code-restore)
- [Beeper Desktop API](https://developers.beeper.com/desktop-api/)
- [Beeper terms](https://www.beeper.com/terms)
