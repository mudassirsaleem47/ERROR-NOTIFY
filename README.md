# Error Notify & Copy

A Chrome extension that catches console errors on any website, shows them as macOS-style notifications, and lets you copy a full error report with one click.

## Features

**Error capture**
- `console.error` (with printf-style `%s` / `%d` / `%o` formatting, so React messages read correctly)
- Uncaught runtime errors
- Unhandled promise rejections
- Failed resources (`<img>`, `<script>`, `<link>`)
- `console.warn` (optional)
- Source file, line and column, plus the full stack trace

**Notifications**
- macOS-style frosted glass toasts, with automatic light/dark theme
- Stacked like a deck: newest in front, older ones peek behind; hover to expand the list
- Repeated errors are grouped with a count badge instead of spamming new toasts
- Swipe right or up to dismiss, or use the ✕ button on hover
- One-click **Copy** of a formatted report (message, source, page URL, stack)
- Optional auto-hide (paused while hovering), compact mode and alert sound
- Rendered in a Shadow DOM, so page CSS can't break them and they stay above page content

**Popup**
- Error list for the current tab or all tabs, with search
- Per-error Copy, stack trace view and delete; Copy all / Clear
- Error count badge on the extension icon for the current page
- Settings: Notifications, Auto hide, Compact toasts, Sound, Capture warnings

## Installation

1. Clone or download this repository.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and select the project folder.
4. Requires Chrome 116 or newer.

## Testing

`test.html` has buttons for every error type plus stress and safety tests (duplicates, flooding, XSS, hostile page CSS, high z-index modal, React hydration messages).

1. In `chrome://extensions`, open the extension's **Details** and enable **Allow access to file URLs**.
2. Open `test.html` in Chrome and click the buttons.

## Project structure

| File | Purpose |
| --- | --- |
| `manifest.json` | Extension manifest (MV3) |
| `hook.js` | Runs in the page's JS context; hooks `console` and error events |
| `content.js` | Receives captured errors, batches them to storage, renders toasts |
| `background.js` | Service worker; stores errors, updates the icon badge, plays sounds |
| `offscreen.html`, `offscreen.js` | Offscreen document used for alert sound playback |
| `sound.js` | Alert sound synthesis (Web Audio), shared by popup and offscreen page |
| `popup.html`, `popup.css`, `popup.js` | Extension popup: error list and settings |
| `test.html` | Manual test page |

## Privacy

Errors are stored only in your browser (`chrome.storage.local`, last 100 entries). Nothing is sent anywhere.
