import {
  detectSite, classifyBooking, looksSoldOut, matchesWords, parseList,
  seatInterval, bookingAwake, bookingExpired, seatExpired,
  escapeHtml, SITES,
} from './core.js';

const TICK = 'tick';
const BOOKING_EVERY = 10 * 60_000;

async function load() {
  const { watches = [], settings = {} } = await chrome.storage.local.get(['watches', 'settings']);
  return { watches, settings };
}
const save = (watches) => chrome.storage.local.set({ watches });

chrome.runtime.onInstalled.addListener(() => chrome.alarms.create(TICK, { periodInMinutes: 1 }));
chrome.runtime.onStartup.addListener(() => chrome.alarms.create(TICK, { periodInMinutes: 1 }));

chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name !== TICK) return;
  const { watches, settings } = await load();
  if (settings.paused) return;
  const now = Date.now();
  let changed = false;
  for (const w of watches) {
    if (w.done) continue;
    if (w.kind === 'booking' ? bookingExpired(w.release, now) : seatExpired(w.showStart, now)) {
      w.done = true; changed = true; continue;
    }
    const due = (w.lastCheck || 0) + dueEvery(w, now);
    if (now < due) continue;
    if (w.kind === 'booking' && !bookingAwake(w.release, now, settings.wakeDays ?? 7)) continue;
    w.lastCheck = now; changed = true;
    try { await check(w, settings); } catch (e) { w.lastError = String(e.message || e); }
  }
  if (changed) await save(watches);
  updateBadge(watches);
});

function dueEvery(w, now) {
  if (w.kind === 'booking') return BOOKING_EVERY;
  const ms = w.showStart ? Date.parse(w.showStart) - now : 48 * 3600_000;
  return seatInterval(ms, w.intervalMs);
}

async function fetchPage(url) {
  // Plain request, nothing identifying sent.
  const r = await fetch(url, { credentials: 'omit', redirect: 'follow' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.text();
}

async function check(w, settings) {
  const html = await fetchPage(w.url);
  if (w.kind === 'booking') {
    const res = classifyBooking(html);
    w.state = res.state;
    if (res.state === 'open' &&
        matchesWords(html, w.languages) && matchesWords(html, w.formats) &&
        w.prevState !== 'open') {
      await alert(settings, w, `Booking open — ${w.title}`,
        `${SITES[w.site].name}${w.languages?.length ? ' · ' + w.languages.join('/') : ''}`);
    }
    w.prevState = res.state === 'unknown' ? w.prevState : res.state; // unknown never overwrites
    return;
  }
  // seat watch: sold-out -> available transition + any DOM block report from content script
  const soldOut = looksSoldOut(html);
  w.state = soldOut ? 'sold_out' : 'available';
  if (w.prevState === 'sold_out' && !soldOut) {
    await alert(settings, w, `Seats may be open — ${w.title}`, 'The page no longer says sold out. Check the seat map.');
  }
  w.prevState = w.state;
}

async function alert(settings, w, title, message) {
  chrome.notifications.create(`w-${w.id}-${Date.now()}`, {
    type: 'basic', iconUrl: 'icon128.png', title, message, priority: 2,
  });
  const n = (w.alerts || 0) + 1; w.alerts = n;
  if (settings.tgToken && settings.tgChat) {
    const text = `<b>${escapeHtml(title)}</b>\n${escapeHtml(message)}\n${escapeHtml(w.url)}`;
    try {
      await fetch(`https://api.telegram.org/bot${settings.tgToken}/sendMessage`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: settings.tgChat, text, parse_mode: 'HTML' }),
      });
    } catch { /* offline: desktop alert already fired */ }
  }
  if (settings.webhook) {
    try {
      await fetch(settings.webhook, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title, message, url: w.url, content: `${title}\n${message}\n${w.url}` }) });
    } catch { /* ignore */ }
  }
}

function updateBadge(watches) {
  const n = watches.filter((w) => !w.done && w.prevState === 'open').length;
  chrome.action.setBadgeText({ text: n ? String(n) : '' });
}

chrome.notifications.onClicked.addListener(async (id) => {
  const wid = id.split('-')[1];
  const { watches } = await load();
  const w = watches.find((x) => x.id === wid);
  if (w) chrome.tabs.create({ url: w.url });
});

chrome.runtime.onMessage.addListener((msg, _s, reply) => {
  (async () => {
    const { watches } = await load();
    if (msg.type === 'add') {
      const site = detectSite(msg.url);
      if (!site) return reply({ ok: false, error: 'Open a BookMyShow or District page first.' });
      watches.push({
        id: Math.random().toString(36).slice(2, 9), kind: msg.kind, site, url: msg.url,
        title: msg.title || 'Untitled', release: msg.release || null, showStart: msg.showStart || null,
        languages: parseList(msg.languages), formats: parseList(msg.formats), created: Date.now(),
      });
      await save(watches); updateBadge(watches); reply({ ok: true });
    } else if (msg.type === 'remove') {
      await save(watches.filter((w) => w.id !== msg.id)); reply({ ok: true });
    } else if (msg.type === 'checkNow') {
      const { settings } = await load();
      for (const w of watches) if (!w.done) { w.lastCheck = Date.now(); try { await check(w, settings); } catch (e) { w.lastError = String(e.message || e); } }
      await save(watches); updateBadge(watches); reply({ ok: true });
    }
  })();
  return true;
});
