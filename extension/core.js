// Shared, dependency-free logic. Used by the extension AND the Telegram bot.
// Everything here is pure so it can be tested offline.

export const SITES = {
  bms: { name: 'BookMyShow' },
  district: { name: 'District' },
};

export function detectSite(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  const h = u.hostname.replace(/^www\./, '');
  if (h === 'bookmyshow.com' || h.endsWith('.bookmyshow.com')) return 'bms';
  if (h === 'district.in' || h.endsWith('.district.in')) return 'district';
  return null;
}

// ---------- page text helpers ----------

export function visibleText(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

const TIME_RE = /\b(0?[1-9]|1[0-2]):[0-5]\d\s?(?:AM|PM)\b/gi;
const NOT_YET_RE = /coming soon|notify me|get notified|bookings? (?:will )?open|not (?:yet )?(?:open|available) for booking|yet to (?:open|release)/i;
const SOLD_OUT_RE = /sold ?out|house ?full/i;

export function extractShowtimes(html) {
  const text = visibleText(html);
  const set = new Set();
  for (const m of text.matchAll(TIME_RE)) {
    set.add(m[0].toUpperCase().replace(/(\d)(AM|PM)/, '$1 $2').replace(/\s+/g, ' '));
  }
  return [...set];
}

// Three honest states: open / not_yet / unknown. "unknown" is never reported as "no".
export function classifyBooking(html) {
  const showtimes = extractShowtimes(html);
  const text = visibleText(html);
  if (showtimes.length >= 2) return { state: 'open', showtimes };
  if (NOT_YET_RE.test(text)) return { state: 'not_yet', showtimes };
  return { state: 'unknown', showtimes };
}

export function looksSoldOut(html) {
  return SOLD_OUT_RE.test(visibleText(html));
}

// Does the page mention at least one of the wanted words (languages / formats)?
export function matchesWords(html, words) {
  if (!words || !words.length) return true;
  const text = visibleText(html).toLowerCase();
  return words.some((w) => w && text.includes(String(w).toLowerCase()));
}

export function parseList(s) {
  return String(s || '').split(/[,;]/).map((x) => x.trim()).filter(Boolean);
}

// ---------- seats ----------

// rows: [{ label, seats: [{ label, free, aisleBefore, price }] }] ordered left to right.
// An aisle always breaks a run.
export function findBlocks(rows, minSize = 2) {
  const out = [];
  for (const row of rows) {
    let run = [];
    const flush = () => {
      if (run.length >= minSize) {
        out.push({
          row: row.label,
          from: run[0].label,
          to: run[run.length - 1].label,
          size: run.length,
          price: run[0].price ?? null,
        });
      }
      run = [];
    };
    for (const s of row.seats) {
      if (s.aisleBefore) flush();
      if (s.free) run.push(s); else flush();
    }
    flush();
  }
  return out;
}

// "F-K, M" -> ['F','G','H','J','K','M'] following the hall's own row order.
export function expandRows(spec, orderedLabels) {
  const wanted = new Set();
  for (const part of parseList(spec)) {
    const m = part.match(/^([A-Za-z0-9]+)\s*-\s*([A-Za-z0-9]+)$/);
    if (m) {
      const a = orderedLabels.indexOf(m[1].toUpperCase());
      const b = orderedLabels.indexOf(m[2].toUpperCase());
      if (a >= 0 && b >= 0) {
        for (let i = Math.min(a, b); i <= Math.max(a, b); i++) wanted.add(orderedLabels[i]);
      }
    } else {
      wanted.add(part.toUpperCase());
    }
  }
  return wanted;
}

export function filterBlocks(blocks, { rows, orderedRows, maxPrice } = {}) {
  let allowed = null;
  if (rows) allowed = expandRows(rows, orderedRows || []);
  return blocks.filter((b) => {
    if (allowed && allowed.size && !allowed.has(String(b.row).toUpperCase())) return false;
    if (maxPrice && b.price != null && b.price > maxPrice) return false;
    return true;
  });
}

export const blockKey = (b) => `${b.row}:${b.from}-${b.to}`;

// Only blocks not announced before.
export function newBlocks(prevKeys, blocks) {
  const seen = new Set(prevKeys || []);
  return blocks.filter((b) => !seen.has(blockKey(b)));
}

// ---------- scheduling ----------

const MIN = 60_000;
const HOUR = 60 * MIN;

// Tightens as showtime approaches. Never faster than once a minute.
export function seatInterval(msUntilShow, override) {
  if (override) return Math.max(MIN, override);
  if (msUntilShow > 24 * HOUR) return 30 * MIN;
  if (msUntilShow > 6 * HOUR) return 15 * MIN;
  if (msUntilShow > 3 * HOUR) return 5 * MIN;
  return Math.max(MIN, 90_000);
}

// Booking-opens watch sleeps until `wakeDays` before release.
export function bookingAwake(releaseISO, now, wakeDays = 7) {
  if (!releaseISO) return true; // unknown date: start early, not late
  const rel = Date.parse(releaseISO);
  if (Number.isNaN(rel)) return true;
  return now >= rel - wakeDays * 24 * HOUR;
}

export function bookingExpired(releaseISO, now) {
  if (!releaseISO) return false;
  const rel = Date.parse(releaseISO);
  return !Number.isNaN(rel) && now > rel + 24 * HOUR;
}

export function seatExpired(showStartISO, now) {
  if (!showStartISO) return false;
  const t = Date.parse(showStartISO);
  return !Number.isNaN(t) && now > t + 15 * MIN;
}

// ---------- messages ----------

export function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function describeBlock(b) {
  const span = b.from === b.to ? b.from : `${b.from}–${b.to}`;
  return `${b.row} ${span} · ${b.size} together${b.price != null ? ` · ₹${b.price}` : ''}`;
}

export function fmtDuration(ms) {
  const m = Math.round(ms / MIN);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}
