# Last Chats Dashboard

A SillyTavern extension that turns the app's landing state into a dashboard of your most recently used chats. Each card shows the character's portrait, the chat and character name, a relative "last used" time, a preview of the last message and the message count — clicking a card opens that chat directly, group chats included.

## What it does

- Full-screen dashboard shown on startup when no chat is open. It can **replace SillyTavern's built-in welcome page** (on by default).
- A **grid icon in the top bar** (rightmost) opens the dashboard any time; it's also in the **wand menu → "Last Chats Dashboard"**.
- Portraits are loaded at full resolution from the character files, not ST's small thumbnails. Group cards show the group avatar or a collage of member portraits.
- **Pin chats** to keep them in a dedicated **Pinned** section below Latest, even after newer chats push them out of the recent list. Pin from a card (hover → pin icon) or from ☰ → **Manage chat files**. Pins use the same storage as ST's own welcome page, so pin state stays consistent everywhere.
- **Delete chats** straight from the dashboard (hover a card → trash icon, with a confirmation). The currently open chat is marked and can't be deleted from here.
- Settings under **Extensions → Last Chats Dashboard**: how many chats to show (1–100), show on startup, replace welcome page, and an "open now" button.
- Closes via Esc, the ✕ button, or clicking the backdrop.

## Install

In SillyTavern, go to **Extensions → Install extension**, paste

```
https://github.com/Flythos/Last-Chats-Dashboard
```

and confirm. Then restart SillyTavern and hard-refresh the browser tab (Ctrl+F5).

Requires SillyTavern ≥ 1.13.x.

## Uninstall

Delete the extension folder from `data/<your-user-handle>/extensions/` and refresh. Settings under `extension_settings.lastChatsDashboard` are harmless leftovers.

## How it works

- Recent chats come from SillyTavern's own `POST /api/chats/recent` endpoint — the same one the built-in welcome page uses — so there is no separate recency tracking.
- Opening a chat reuses ST's normal open flow for characters and groups; deleting uses ST's delete helpers behind a confirmation popup.
- "Replace welcome page" works by watching `#chat` and removing the welcome panel ST injects whenever it appears.

## Development

No build step; plain ES modules + jQuery, loaded by SillyTavern as-is. `npm test` runs a pin-flow harness against a simulated recent-chats endpoint, `npm run audit` checks every SillyTavern import used by the code against the ST sources.
