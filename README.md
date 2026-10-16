# Open Seat Alerts (free)

An original, free watcher for BookMyShow and District. No accounts, no credits, no paid tier. It never books anything. It only tells you when something changes.

Two watches:
- **Booking-opens watch (bell):** attach it to a film. It sleeps until a week before release (or always runs if no date is given), checks every 10 minutes, and alerts you when showtimes appear. It reports three states: open, not yet, and can't tell. "Can't tell" never counts as "no".
- **Seat watch (+):** attach it to a sold-out show page. It alerts you when the page stops saying sold out. Check interval tightens as showtime nears (30 min, 15, 5, then 90 s) and never goes below one minute.

## 1. Chrome extension (laptop must be awake)
1. Open `chrome://extensions`, turn on Developer mode.
2. Click "Load unpacked" and pick the `extension/` folder.
3. Open a film page on BookMyShow or District, click the extension icon, set optional language/format/release date, press **Bell** or **+**.
4. Optional alerts: paste a Telegram bot token and chat id, or a Discord / ntfy.sh webhook, in the popup.

Works in Chrome, Edge, Brave, Arc.

## 2. Self-hosted Telegram bot (runs while your laptop is shut)
Needs Node 18+ on any always-on machine (a spare PC, Raspberry Pi, or a free-tier VPS).

```
BOT_TOKEN=123456:ABC... node bot/bot.mjs
```
Create the token with @BotFather. Then send the bot a film link. Optional: `lang=Telugu fmt=IMAX release=2026-11-20 mode=seat`.
Commands: /watching, /stop n, /pause, /resume.

## 3. On your phone (free, laptop not needed)
Phones can't run Chrome extensions, so on mobile you use the Telegram bot from the Telegram app, hosted free on GitHub Actions:
1. In Telegram, message @BotFather, send `/newbot`, and copy the token.
2. Create a free GitHub account, make a new **public** repository, and upload the contents of this folder to it (the `.github` folder must be included).
3. In the repo go to Settings > Secrets and variables > Actions > New repository secret. Name: `BOT_TOKEN`, value: your token.
4. Open the Actions tab, enable workflows, and run **seat-watch** once with "Run workflow".
5. In Telegram, open your bot, press Start, and share or paste a BookMyShow/District film link. Use the Share button inside the BookMyShow or District app to send it to your bot.

It runs every 5 minutes (GitHub's minimum), so the bot replies within a few minutes, not instantly, and checks can run a few minutes late. State is kept in the Actions cache, not in your repo. GitHub may pause scheduled runs on a repo with no activity for 60 days; re-enable under the Actions tab if that happens. Alternatively run `node bot/bot.mjs` on any always-on machine for instant replies.

## Tests
`node --test test/core.test.mjs` (11 offline tests).

## Honest limits
- Page checks are text heuristics (showtimes present, "coming soon", "sold out"). Both sites change their pages and may render client-side, so if a check reports "can't tell" for a page you know is open, the matching rules in `extension/core.js` (`classifyBooking`, `looksSoldOut`) are the one place to adjust. This build was tested offline only, not against the live sites.
- Row/aisle block detection (`findBlocks`) is implemented and tested, but not wired to a live seat map. Reading the seat canvas needs a site-specific reader.
- Server checks can be rate-limited or blocked by the sites; keep intervals relaxed.
- Not affiliated with BookMyShow or District. Check their terms before heavy use.
