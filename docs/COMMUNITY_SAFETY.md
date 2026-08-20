# OpenStation community safety and privacy operations

This document defines the minimum privacy, moderation, and incident-response
practices required before OpenStation Neighborhoods is called a release
candidate. It describes operational requirements, not features that the current
web client already provides.

| Field | Value |
| --- | --- |
| Status | Release-candidate requirement |
| Owner | OpenStation safety lead |
| Review cadence | Quarterly, and after every material incident or room-policy change |
| Scope | The OpenStation Space and all seven child rooms |

## Required public disclosure

The following facts must be presented before a person joins the OpenStation
community, in the privacy notice, and from the reporting interface:

> OpenStation community rooms are public Matrix rooms hosted by Beeper. They
> are not end-to-end encrypted. Anyone with a compatible Matrix account and the
> room address or ID can join. After joining, a member can read the shared room
> history from before they joined. Matrix is federated, so participating
> homeservers may receive and retain copies of room events and media. A
> redaction requests that clients and servers remove content, but OpenStation
> cannot guarantee deletion from every federated server or from copies someone
> has already made. Do not post secrets or sensitive personal information.

The disclosure must not describe these rooms as private merely because guests
cannot join or unauthenticated visitors cannot read their history. The rooms
are public-join rooms, and the web app automatically joins them after the user
consents. The action must say that it will connect Beeper and join seven public
rooms; a generic connection approval is not sufficiently specific.

A member's Matrix ID, display name, avatar, room membership, messages, media,
reactions, and event timestamps can be visible to other participants and copied
into notifications, exports, screenshots, caches, backups, and participating
homeservers.

Neighborhoods connects directly from the member's browser to Beeper Desktop on
that same computer. The OpenStation static host does not receive the Beeper
bearer token or Matrix encryption keys. The bearer token can still read and
write the member's chats, so it must remain in session storage, must never be
logged, and must be discarded when it is inactive or rejected.

## Community rules

The code of conduct shown before joining must prohibit:

- harassment, threats, stalking, hate speech, and targeted intimidation;
- spam, scams, impersonation, malware, and coordinated disruption;
- publishing another person's private information without permission;
- sexual exploitation, child sexual abuse material, and other illegal content;
- evading a moderation action through another account or homeserver; and
- content that violates Beeper's terms or the rules of a participating
  homeserver.

It must also explain the available actions, the appeal path, and that serious
or illegal conduct may be escalated to Beeper, another homeserver operator, or
the appropriate authority.

## Roles and authority

Matrix permissions are room-local. A role is not complete until it has been
verified in the Space and every child room.

| Role | Normal power level | Responsibilities |
| --- | ---: | --- |
| Member | 0 | Participate, report problems, and redact their own messages where supported. |
| Moderator | 50 | Review reports; redact, kick, ban, and unban; keep an incident log. |
| Administrator | 100 | Manage moderators, power levels, join/history rules, aliases, Space links, and room upgrades. |
| Creator | Room-version dependent | Retains special room control; must be a long-lived, approved identity. |

Before a public release there must be at least two active human moderators and
two independent administrators in the Space and every child room. An account
must never be shared between people. Any organization-managed or automated
Beeper account requires Beeper's approval.

## Reporting design

The OpenStation report action must send reports to an OpenStation-controlled,
private moderation queue. A standard Matrix report can also be submitted when
supported, but it is not a substitute: delivery of a Matrix report is controlled
by the reporter's homeserver and is not guaranteed to reach OpenStation.

A report record should contain only what is required to investigate:

- report ID, creation time, status, and assigned moderator;
- reporting account ID and a safe way to respond;
- room ID, event ID, reported Matrix user ID, and event timestamp;
- category, the reporter's explanation, and whether immediate danger is alleged;
- actions taken, reasons, moderator identity, and appeal outcome; and
- whether the matter was escalated to Beeper or another homeserver.

Do not copy an entire room history into the report system. Restrict the queue
and audit log to moderators, encrypt them at rest, define a retention period,
and remove records when that period expires unless a documented legal or safety
need requires longer retention. Never place an administrator or bot access token
in the hosted web client.

Recommended response targets:

| Severity | Example | Acknowledge | First action |
| --- | --- | ---: | ---: |
| Emergency | Credible imminent harm, child safety, illegal material | As soon as staffed | Immediately |
| High | Threats, doxxing, active raid, malware | 1 hour | 1 hour |
| Normal | Harassment, spam, impersonation | 1 business day | 2 business days |
| Appeal | Review of a completed action | 2 business days | 5 business days |

Publish the actual staffed hours. Do not promise a response time that the team
cannot meet.

## Enforcement model

- **Hide or ignore** is a member-side visibility choice. It does not remove the
  sender from a room and must not be described as a community ban.
- **Redact** removes the targeted event from ordinary Matrix presentation. It
  cannot guarantee destruction of federated or previously downloaded copies.
- **Kick** removes a member now. A kicked member can rejoin a public room.
- **Ban** prevents that Matrix ID from rejoining that particular room.
- **Cross-room ban** applies a reasoned ban in all OpenStation rooms. Joining or
  banning in the Space alone does not automatically change child-room membership.
- **Homeserver escalation** asks the relevant provider to act on an account,
  room, media, or server. Only the provider can perform provider-level actions.

Every enforcement action must have a reason and moderator identity in the
private audit log. High-impact actions require confirmation in the moderator
tool. Appeals should be reviewed by someone other than the original moderator
when staffing permits.

## Incident runbooks

### Reported message or member

1. Verify the room ID, event ID, sender ID, and reporter's description.
2. Assess immediate safety without forwarding unnecessary content.
3. Preserve the minimum identifiers and decision context in the private log.
4. Redact offending events when justified.
5. Warn, kick, or ban the member according to severity and prior behavior.
6. For a ban, enforce it in all affected OpenStation rooms.
7. Tell the reporter that the report was reviewed without disclosing private
   moderator discussion or another person's personal information.
8. Record the appeal route and close or schedule follow-up.

### Spam or raid

1. Put the affected rooms into a temporary moderator-only posting mode if the
   volume cannot be safely handled.
2. Ban participating accounts across all rooms and redact the spam batch.
3. Preserve identifiers and a small representative sample; do not retain an
   unnecessary complete copy.
4. Escalate malicious media, compromised accounts, or server-wide abuse to
   Beeper and the originating homeserver.
5. Restore normal posting only after verifying power levels, join rules, the
   moderation bot, and the report queue.
6. Publish a short incident note if members were materially affected.

### Credible threat or imminent harm

1. Do not promise confidentiality that OpenStation cannot provide.
2. Preserve the minimum exact identifiers, timestamps, and original report.
3. Escalate immediately to the designated safety lead and follow the team's
   jurisdiction-specific emergency policy.
4. Contact Beeper or the relevant homeserver through the documented escalation
   route when provider action is needed.
5. Limit details to the people handling the incident and record every disclosure.

### Child sexual abuse material or other illegal media

1. Do not download, duplicate, or circulate the material for investigation.
2. Preserve only the room ID, event ID, sender ID, timestamp, and existing URL or
   media identifier needed for a provider report.
3. Remove access through the room moderation tools and immediately contact the
   designated safety lead.
4. Follow the applicable mandatory-reporting procedure and Beeper escalation
   path. Do not improvise a legal process in the public room.

### Compromised moderator, administrator, or bot

1. Use an unaffected administrator to remove the compromised identity's power
   in the Space and every room, and ban it when appropriate.
2. Revoke its Beeper Desktop integration and other credentials.
3. Compare current room state with the last approved governance snapshot.
4. Restore aliases, Space links, join/history rules, and power levels.
5. Review actions and messages created during the suspected window.
6. Notify Beeper if the account or homeserver session may be compromised.
7. Document impact, remediation, and the decision to reopen normal posting.

### Beeper or moderation-service outage

1. Keep the disconnected web experience read-only and honest about the outage.
2. Do not expose or tunnel a user's local Beeper Desktop API as a workaround.
3. Use an independent administrator or federated moderation account when it can
   safely reach the rooms.
4. If moderation coverage is lost, stop promotion of the public community and
   use moderator-only posting until coverage returns.
5. Reconcile missed reports and room state after recovery.

## Release-candidate safety gate

- [ ] The public disclosure and code of conduct are visible before auto-join.
- [ ] The join action clearly says it will join all seven public rooms.
- [ ] A report reaches the private OpenStation queue and gets an audit ID.
- [ ] Matrix report delivery is treated as supplemental, not authoritative.
- [ ] Two moderators can redact, kick, ban, unban, and enforce a cross-room ban.
- [ ] A kicked account can rejoin, while a banned account cannot.
- [ ] A second Beeper account and an account on another homeserver are tested.
- [ ] Spam, threat, illegal-media, compromised-admin, and outage drills pass.
- [ ] Beeper supplies a documented abuse and account-recovery escalation route.
- [ ] Moderator access, report retention, and appeal handling are reviewed.

## References

- [Matrix reporting](https://spec.matrix.org/latest/client-server-api/#reporting-content)
- [Matrix power levels](https://spec.matrix.org/latest/client-server-api/#mroompower_levels)
- [Matrix community moderation](https://matrix.org/docs/communities/moderation/)
- [Matrix room history visibility](https://spec.matrix.org/latest/client-server-api/#room-history-visibility)
- [Beeper Desktop API authentication](https://developers.beeper.com/desktop-api/auth/)
- [Beeper Matrix chats](https://help.beeper.com/using-matrix-chats-in-beeper)
- [Beeper privacy policy](https://www.beeper.com/privacy)
- [Beeper terms](https://www.beeper.com/terms)
