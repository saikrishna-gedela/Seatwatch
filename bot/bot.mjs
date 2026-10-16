// Self-hosted Telegram watcher. Free, no credits, no dependencies (Node 18+).
//   BOT_TOKEN=123:abc node bot.mjs
// Create the bot yourself with @BotFather. State is kept in state.json next to this file.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  detectSite, classifyBooking, looksSoldOut, matchesWords, parseList,
  seatInterval, bookingAwake, bookingExpired, seatExpired, escapeHtml, SITES,
} from '../extension/core.js';

const TOKEN = process.env.BOT_TOKEN;
if (!TOKEN) { console.error('Set BOT_TOKEN (get one from @BotFather).'); process.exit(1); }
const API = `https://api.telegram.org/bot${TOKEN}`;
const STATE_FILE = process.env.STATE_FILE || join(dirname(fileURLToPath(import.meta.url)), 'state.json');
const ONCE = process.env.ONCE === '1'; // run one pass and exit (for GitHub Actions)
const BOOKING_EVERY = 10 * 60_000;

let state = { offset: 0, watches: [] };
try { state = JSON.parse(await readFile(STATE_FILE, 'utf8')); } catch { /* first run */ }
const persist = () => writeFile(STATE_FILE, JSON.stringify(state, null, 2));

async function tg(method, body) {
  const r = await fetch(`${API}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  return r.json();
}
const say = (chat_id, text) =>
  tg('sendMessage', { chat_id, text, parse_mode: 'HTML', disable_web_page_preview: true });

const URL_RE = /https?:\/\/[^\s]+/;

async function handle(msg) {
  const chat = msg.chat.id;
  const text = (msg.text || '').trim();
  if (text.startsWith('/start') || text.startsWith('/help')) {
    return say(chat,
      'Share or paste a BookMyShow / District film link.\n' +
      '/watching · list watches\n/stop &lt;n&gt; · remove watch n\n/pause · /resume\n\n' +
      'Add options after the link: <code>lang=Telugu fmt=IMAX release=2026-11-20 mode=seat</code>');
  }
  if (text.startsWith('/watching')) {
    const mine = state.watches.filter((w) => w.chat === chat && !w.done);
    if (!mine.length) return say(chat, 'Nothing on watch.');
    return say(chat, mine.map((w, i) =>
      `${i + 1}. ${escapeHtml(w.title)} · ${w.kind} · ${SITES[w.site].name} · ${w.state || 'pending'}`).join('\n'));
  }
  if (text.startsWith('/stop')) {
    const n = parseInt(text.split(/\s+/)[1], 10);
    const mine = state.watches.filter((w) => w.chat === chat && !w.done);
    if (!mine[n - 1]) return say(chat, 'Use /watching to see numbers.');
    mine[n - 1].done = true; await persist();
    return say(chat, 'Stopped.');
  }
  if (text.startsWith('/pause') || text.startsWith('/resume')) {
    const paused = text.startsWith('/pause');
    state.watches.filter((w) => w.chat === chat).forEach((w) => { w.paused = paused; });
    await persist();
    return say(chat, paused ? 'Paused.' : 'Resumed.');
  }
  const m = text.match(URL_RE);
  if (!m) return;
  const url = m[0];
  const site = detectSite(url);
  if (!site) return say(chat, 'I only know BookMyShow and District links.');
  const opt = (k) => (text.match(new RegExp(`${k}=(\\S+)`)) || [])[1];
  const title = (text.replace(URL_RE, '').replace(/\b\w+=\S+/g, '').trim()) || new URL(url).pathname.split('/').filter(Boolean).pop();
  state.watches.push({
    id: Math.random().toString(36).slice(2, 9), chat, site, url, title,
    kind: opt('mode') === 'seat' ? 'seat' : 'booking',
    release: opt('release') || null,
    languages: parseList(opt('lang')), formats: parseList(opt('fmt')),
  });
  await persist();
  return say(chat, `Watching <b>${escapeHtml(title)}</b> on ${SITES[site].name}. I'll message you the moment it changes.`);
}

async function poll() {
  for (;;) {
    try {
      const r = await tg('getUpdates', { offset: state.offset, timeout: 30 });
      for (const u of r.result || []) {
        state.offset = u.update_id + 1;
        if (u.message) await handle(u.message).catch((e) => console.error(e));
      }
      await persist();
    } catch (e) { console.error('poll', e.message); await new Promise((r) => setTimeout(r, 5000)); }
  }
}

async function runChecks() {
  const now = Date.now();
  for (const w of state.watches) {
    if (w.done || w.paused) continue;
    if (w.kind === 'booking' ? bookingExpired(w.release, now) : seatExpired(w.showStart, now)) { w.done = true; continue; }
    const every = w.kind === 'booking' ? BOOKING_EVERY : seatInterval(w.showStart ? Date.parse(w.showStart) - now : 48 * 3600_000, w.intervalMs);
    if (now - (w.lastCheck || 0) < every) continue;
    if (w.kind === 'booking' && !bookingAwake(w.release, now)) continue;
    w.lastCheck = now;
    try {
      const r = await fetch(w.url, { redirect: 'follow' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const html = await r.text();
      if (w.kind === 'booking') {
        const c = classifyBooking(html);
        w.state = c.state;
        if (c.state === 'open' && w.prevState !== 'open' && matchesWords(html, w.languages) && matchesWords(html, w.formats)) {
          await say(w.chat, `<b>Booking open — ${escapeHtml(w.title)}</b>\n${escapeHtml(w.url)}`);
        }
        if (c.state !== 'unknown') w.prevState = c.state;
      } else {
        const sold = looksSoldOut(html);
        w.state = sold ? 'sold_out' : 'available';
        if (w.prevState === 'sold_out' && !sold) {
          await say(w.chat, `<b>Seats may be open — ${escapeHtml(w.title)}</b>\n${escapeHtml(w.url)}`);
        }
        w.prevState = w.state;
      }
    } catch (e) { w.lastError = e.message; }
  }
  await persist();
}

async function once() {
  // Handle messages that arrived since the last run, then run due checks, then exit.
  const r = await tg('getUpdates', { offset: state.offset, timeout: 0 });
  for (const u of r.result || []) {
    state.offset = u.update_id + 1;
    if (u.message) await handle(u.message).catch((e) => console.error(e));
  }
  await runChecks();
  await persist();
}

if (ONCE) {
  try { await once(); } catch (e) { console.error('run skipped:', e.cause?.code || e.message); }
  process.exit(0);
} else {
  setInterval(() => runChecks().catch((e) => console.error(e)), 60_000);
  console.log('Bot running.');
  poll();
}
