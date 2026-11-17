# Controls

- Drag the chat-list divider. Focus it with Tab and use Left/Right arrows;
  Shift moves faster, Home/End select the limits, Enter or double-click resets.
- **Aa**, or `Ctrl+Alt+Space`, opens message text size and shortcut settings.
  Only message bodies change size. Header, composer, timestamps and icons stay unchanged.
- `Ctrl+Alt+Down` / `Ctrl+Alt+Up`: next / previous unread conversation, wrapping
  through the current chat list. Change these keys in settings.
- `Ctrl+Alt+1` through `9`: open that numbered unread conversation in list order.
  Disable number shortcuts in settings if they conflict with your desktop.
- Escape cancels a list scan. Mouse interaction also cancels it. Alt+K is untouched.

Opening a conversation lets WhatsApp mark it read normally. Numbering therefore
changes as you read chats. Navigation scrolls the current list to load virtualized
rows; searches and filters limit which chats it can find. It never changes drafts.
The scan stops after 250 scroll steps. Duplicate chat titles need WhatsApp to expose
distinct row indexes or IDs. Unread detection uses WhatsApp's unread markers with
English accessibility labels as a fallback; interface changes can require updates.

Width, text size and key bindings are saved in extension-local storage. Chat text,
contacts and messages are never saved or sent anywhere. The divider is hidden below
640 px so WhatsApp can use its narrow layout. Browser and desktop shortcuts may
take priority over a custom binding.

# Setup and checks

`luna configure chromium` builds and installs the extension in the Luna profile.
It closes Chromium through Luna's normal app-configuration flow. Existing disabled
extensions stay disabled. The v0.0.4 migration performs this setup during self-update.

From the repository root:

```sh
bun run --cwd packages/better-whatsapp-web build
bun run --cwd packages/better-whatsapp-web check
bun test packages/better-whatsapp-web/tests
```

The standalone build is `packages/better-whatsapp-web/dist`. For manual installation,
use **Load unpacked** in Chromium's extensions page with developer mode enabled.
It runs only on `https://web.whatsapp.com/`. External-link routing belongs to
[Luna Browser Links](../luna-browser-links/DOCS.md).
