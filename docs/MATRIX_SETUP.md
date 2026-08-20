# Provision the OpenStation community through Beeper

Neighborhoods uses the Matrix account already inside Beeper. `openstation.chat` is the public web product; Beeper supplies the account, Matrix homeserver, and local Desktop API. OpenStation does not operate another homeserver and members do not create another account.

## One-time administrator provisioning

1. Sign into the Beeper account that will own the OpenStation community.
2. Keep Beeper Desktop open and enable **Settings → Integrations → Desktop API**.
3. Open `https://openstation.chat/?provision=1`.
4. Connect and approve OpenStation's local read/write access.
5. Press **Create OpenStation Community** once.

The operator workflow creates six supported public rooms first, followed by a public Matrix Space whose initial `m.space.child` state links every room. Welcome and Announcements restrict ordinary `m.room.message` events while still allowing reactions. The remaining rooms use normal public-chat permissions.

Progress is saved in browser local storage after every successful room creation, so an interrupted run resumes rather than recreating completed rooms. The Beeper access token remains in session storage and never enters SpaceFast or OpenStation infrastructure.

## Commit stable room IDs

The successful provisioner displays a non-secret manifest containing the Space room ID and a room ID for each channel. Copy those immutable identifiers into `src/community.ts`:

```ts
spaceRoomId: '!space-id:beeper.com',

// On each channel:
roomId: '!channel-id:beeper.com',
```

The source manifest becomes the durable directory for every member. Friendly titles can change later without breaking discovery or joining.

## Member onboarding

Members open `openstation.chat`, connect Beeper, and approve the local integration. Neighborhoods calls Beeper Desktop's Matrix join endpoint for each stable room ID and opens the first available channel. Members never copy a Matrix alias or use Beeper's manual join dialog.

## Launch checks

- Space and six supported rooms created from the intended administrator account
- Stable Space and room IDs committed to `src/community.ts`
- Welcome and Announcements tested as read-only for an ordinary member
- Fresh Beeper account joins all rooms automatically
- Messages, unread state, members, and reactions contain only live Beeper data
- At least one additional moderator added before the public launch
