# Last Chats Dashboard

A SillyTavern UI extension that turns the app's landing state into a **dashboard of your most recently used chats**. Each chat is shown as a card with the character's portrait (groups get their own avatar or a collage of member portraits), the chat name, character/group name, a relative "last used" time, a preview of the last message and the message count. **Clicking a card opens that chat directly** — one-on-one and group chats alike.

## Features

- Full-screen dashboard shown on startup when no chat is open
- **Grid icon in the top bar** (rightmost icon) opens it in one click
- Also reopenable from the **wand menu → "Last Chats Dashboard"**
- Portraits are loaded at **full resolution** from the character files (not ST's 96×144 thumbnails)
- Can **replace SillyTavern's built-in welcome page** (default on)
- Delete chats directly from the dashboard (hover a card → trash icon; the currently open chat can't be deleted from here)
- Settings: number of chats to show (1–100), show-on-startup toggle, replace-welcome-page toggle, "open now" button — found under **Extensions → Last Chats Dashboard**
- Closes via Esc, the ✕ button, or clicking the backdrop

## Requirements

- SillyTavern ≥ **1.13.x** (needs the `POST /api/chats/recent` endpoint, `deleteCharacterChatByName` / `deleteGroupChatByName`, and the welcome-page DOM used for replacement)

## Installation

1. Copy this whole folder into your SillyTavern installation:

   ```
   <SillyTavern>/public/scripts/extensions/third-party/LastChatsDashboard
   ```

2. (Re)start SillyTavern and hard-refresh the browser tab (**Ctrl+F5**).
3. The extension should appear as **Last Chats Dashboard** in the Extensions panel and be enabled.

### Uninstall

Delete the folder from `public/scripts/extensions/third-party/` and refresh the page. Settings under `extension_settings.lastChatsDashboard` are harmless leftovers, or clear them from your server settings file if you want a fully clean slate.

## Manual test checklist

1. **Startup** — with no chat open, reload the page: the dashboard should appear, and ST's built-in welcome page should *not*.
2. **Open chat** — click any card: that chat opens and the dashboard closes.
3. **Top-bar icon** — the grid icon at the right end of the top icon row opens the dashboard in one click (including while a chat is open); hover makes it bright like the other icons.
4. **Recency** — chat for a bit, close/select another chat, reopen the dashboard: that chat is now first with a fresh preview and time.
5. **Portrait quality** — character portraits are crisp (full-size originals), not blurry thumbnails; group cards show the group avatar or a member collage.
6. **Groups** — a group chat card shows the group avatar or member collage; clicking it opens the group chat.
7. **Delete** — hover a non-active card → trash icon → confirm → the card disappears from the list.
8. **Active chat guard** — the currently open chat shows an "Open" badge and no delete button.
9. **Close paths** — Esc, ✕ and backdrop click all close the dashboard; the top-bar icon and wand-menu button reopen it.
10. **Settings** — toggling "Show on startup" off and reloading lands you in the plain UI; "Replace the built-in welcome page" off makes ST's welcome page appear again; the number input changes how many cards are listed.
11. **Edge cases** — if a chat's character/group was deleted, the card is skipped; if there are no chats at all, an empty-state message shows.

If anything misbehaves, open the browser console (F12) and check for `[lastChatsDashboard]` messages.

## How it works (technical notes)

- Data comes from SillyTavern's own `POST /api/chats/recent` endpoint (same one the built-in welcome page uses) — no separate tracking of chat recency is needed.
- Opening a chat reuses ST's own flow: `selectCharacterById` → `setActiveCharacter` → `openCharacterChat` (or the group equivalents).
- Deleting uses ST's `deleteCharacterChatByName` / `deleteGroupChatByName` helpers behind a confirmation popup.
- "Replace welcome page" works via a `MutationObserver` on `#chat` that removes the injected `.welcomePanel` plus the assistant/welcome messages whenever ST adds them.
