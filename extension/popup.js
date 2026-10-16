import { detectSite, SITES } from './core.js';
const $ = (id) => document.getElementById(id);
let tab = null;

async function init() {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const site = tab && detectSite(tab.url || '');
  $('page').textContent = site ? `${SITES[site].name} page detected` : 'Open a BookMyShow or District page.';
  if (site) {
    try {
      const info = await chrome.tabs.sendMessage(tab.id, { type: 'pageInfo' });
      if (info && info.title) $('title').value = info.title;
    } catch { /* content script not ready */ }
  }
  const { settings = {} } = await chrome.storage.local.get('settings');
  for (const k of ['tgToken', 'tgChat', 'webhook']) $(k).value = settings[k] || '';
  $('pause').textContent = settings.paused ? 'Resume' : 'Pause';
  render();
}

async function add(kind) {
  const res = await chrome.runtime.sendMessage({
    type: 'add', kind, url: tab.url, title: $('title').value,
    release: $('release').value || null, languages: $('langs').value, formats: $('fmts').value,
  });
  if (!res.ok) alert(res.error);
  render();
}

async function render() {
  const { watches = [] } = await chrome.storage.local.get('watches');
  $('list').innerHTML = '';
  for (const w of watches) {
    const d = document.createElement('div'); d.className = 'w';
    const state = w.done ? 'finished' : (w.state || 'waiting for first check');
    d.innerHTML = `<b></b><div class="s"></div><div class="s"></div>`;
    d.children[0].textContent = w.title;
    d.children[1].textContent = `${w.kind === 'booking' ? 'Booking-opens' : 'Seat'} · ${SITES[w.site].name} · ${state}`;
    d.children[2].textContent = w.lastError ? `Last error: ${w.lastError}` : (w.lastCheck ? `Checked ${new Date(w.lastCheck).toLocaleTimeString()}` : '');
    const b = document.createElement('button'); b.className = 'ghost'; b.textContent = 'Remove';
    b.onclick = async () => { await chrome.runtime.sendMessage({ type: 'remove', id: w.id }); render(); };
    d.appendChild(b); $('list').appendChild(d);
  }
}

$('addBooking').onclick = () => add('booking');
$('addSeat').onclick = () => add('seat');
$('now').onclick = async () => { await chrome.runtime.sendMessage({ type: 'checkNow' }); render(); };
$('pause').onclick = async () => {
  const { settings = {} } = await chrome.storage.local.get('settings');
  settings.paused = !settings.paused; await chrome.storage.local.set({ settings });
  $('pause').textContent = settings.paused ? 'Resume' : 'Pause';
};
$('saveSet').onclick = async () => {
  const { settings = {} } = await chrome.storage.local.get('settings');
  for (const k of ['tgToken', 'tgChat', 'webhook']) settings[k] = $(k).value.trim();
  await chrome.storage.local.set({ settings });
};
init();
