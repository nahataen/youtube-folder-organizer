# AGENTS.md

Chrome/Edge MV3 extension, no build step. Static files loaded unpacked. No npm, no bundler, no tests, no lint config.

## Structure

- `manifest.json` — MV3, `permissions: ["storage"]` only. Content scripts run on `https://www.youtube.com/*` at `document_idle`. JS loads in manifest order (classic scripts, no bundler); all share `window.YTCF` namespace.
- `content/core/` — `utils.js` (creates `YTCF` + toast/DOM/text/URL helpers), `store.js` (state `folders`/`currentChannel`, `ytFoldersV1` persistence), `channel.js` (channel detection), `shared.css` (buttons, `.ytcf-chip` gradient chip, avatar, toast, hints).
- `content/sidebar/` — `sidebar.js` (`MIS CARPETAS` render + inject + SPA observers + init), `forms.js` (create/rename), `sidebar.css`.
- `content/watch/` — `watch-button.js` (`＋ Carpeta` in watch `ytd-menu-renderer`, folder picker, add/remove membership; exposes `toggleChannelPicker(wrap)` for reuse), `watch.css` (button wrapper positioning + picker; the chip design is `.ytcf-chip` in `shared.css`).
- `content/samemenu/` — `samemenu.js` (same `＋ Carpeta` button in channel header `ytFlexibleActionsViewModelHost`; single file, reuses `.ytcf-chip` + `toggleChannelPicker`; no own CSS).
- `content/wall/` — `videos.js` (channel scraping + RSS fallback + cache), `wall.js` (video wall, exposes `window.YTCFView = { openFolder, close, getOpenId }`), `folderView.css`.
- `icons/` — 16/48/128 px.

## Data

- Single key `ytFoldersV1` in `chrome.storage.local`: `{ id, name, open, channels: [{ key, name, url, avatar }] }[]`.
- Folder names: unique case-insensitive after trim, max 40 chars. Deleting a folder never unsubscribes.
- Channel `key` is the normalized path (`/@handle`, `/channel/ID`, `/c/x`, `/user/x`); only these pass `safeChannelPath()`.

## YouTube SPA quirks

- Guide re-renders often: `content.js` re-injects via `MutationObserver` + debounced `ensureInject()` (prepends to guide). Navigation closes the wall (`YTCFView.close()`).
- Watch action bar also re-renders: the `＋ Carpeta` button (`#ytcf-watch-add`) targets only `ytd-watch-metadata #actions ytd-menu-renderer > #top-level-buttons-computed`, is prepended left of Like and re-moved there when wiped; hidden off `/watch`. Click opens a fixed-position picker listing ALL folders (`✓` = already contains channel; click toggles add/remove). Its styles (`.ytcf-watch-btn`, `.ytcf-watch-picker*`) are self-contained explicit colors (no `var(--yt-spec-*)`), theme via `html[dark]` only.
- Theme: watch `<html dark>` attribute, toggle `.ytcf-dark` (`syncTheme`/`syncWallTheme`). Never rely on `prefers-color-scheme`.
- Wall hides `#page-manager` children with `display:none` and restores them on close; guard against races with `requestToken`/`openId` in `openFolder`.

## Video fetching (`folderView.js`)

- Primary: `fetch(channel.url + "/videos")` → brace-balanced `extractInitialData()` → `crawlVideos()` (handles `lockupViewModel` and legacy `videoRenderer`). Max depth 10, 12 videos/channel.
- Fallback: official RSS only works for `/channel/UC…` keys. Other URL forms fail gracefully with per-channel error hint.
- Cache 10 min per channel (`CACHE_TTL`); refresh button busts it. Fetch in batches of 3, render progressively.

## Security conventions (keep)

- Build DOM with `createElement` + `textContent` only — no `innerHTML` with user/channel data.
- Validate channel URLs with `safeChannelPath()`; reject non-youtube origins and arbitrary paths.
- Avatars: `referrerPolicy="no-referrer"`, `onerror` → initial-letter fallback; filter `data:`/placeholder thumbs.

## Verify

No automated tests. Manual check: `edge://extensions/` (or `chrome://`) → Developer mode → Load unpacked → open `youtube.com`, toggle sidebar, create folder, add channel from a watch page, open wall, switch light/dark.
