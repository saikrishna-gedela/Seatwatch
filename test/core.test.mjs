import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectSite, classifyBooking, findBlocks, expandRows, filterBlocks, newBlocks, blockKey,
  seatInterval, bookingAwake, bookingExpired, seatExpired, matchesWords, describeBlock,
} from '../extension/core.js';

const H = 3600_000;

test('detectSite', () => {
  assert.equal(detectSite('https://in.bookmyshow.com/movies/x'), 'bms');
  assert.equal(detectSite('https://www.district.in/movies/y'), 'district');
  assert.equal(detectSite('https://evil.com/bookmyshow.com'), null);
  assert.equal(detectSite('nope'), null);
});

test('classifyBooking has three honest states', () => {
  assert.equal(classifyBooking('<p>Coming soon</p>').state, 'not_yet');
  assert.equal(classifyBooking('<div>06:30 PM</div><div>09:45 PM</div>').state, 'open');
  assert.equal(classifyBooking('<p>hello</p>').state, 'unknown');
});

test('aisle breaks a run', () => {
  const seats = [1, 2, 3, 4].map((n) => ({ label: String(n), free: true, aisleBefore: n === 3 }));
  const b = findBlocks([{ label: 'F', seats }], 2);
  assert.equal(b.length, 2);
  assert.equal(b[0].size, 2);
});

test('taken seat splits a block', () => {
  const seats = [
    { label: '1', free: true }, { label: '2', free: false }, { label: '3', free: true }, { label: '4', free: true },
  ];
  const b = findBlocks([{ label: 'A', seats }], 2);
  assert.deepEqual(b.map((x) => x.size), [2]);
});

test('row ranges follow the hall order (skipped I)', () => {
  const order = ['F', 'G', 'H', 'J', 'K'];
  assert.deepEqual([...expandRows('F-K', order)], order);
});

test('filterBlocks by rows and price', () => {
  const blocks = [
    { row: 'A', from: '1', to: '4', size: 4, price: 100 },
    { row: 'F', from: '1', to: '4', size: 4, price: 300 },
  ];
  assert.equal(filterBlocks(blocks, { rows: 'F-K', orderedRows: ['A', 'F', 'G', 'K'] }).length, 1);
  assert.equal(filterBlocks(blocks, { maxPrice: 200 }).length, 1);
});

test('newBlocks announces each block once', () => {
  const b = [{ row: 'F', from: '1', to: '4', size: 4 }];
  assert.equal(newBlocks([], b).length, 1);
  assert.equal(newBlocks([blockKey(b[0])], b).length, 0);
});

test('seat interval ladder, never under a minute', () => {
  assert.equal(seatInterval(30 * H), 30 * 60_000);
  assert.equal(seatInterval(10 * H), 15 * 60_000);
  assert.equal(seatInterval(4 * H), 5 * 60_000);
  assert.equal(seatInterval(1 * H), 90_000);
  assert.equal(seatInterval(1 * H, 1000), 60_000);
});

test('booking watch sleeps then wakes; unknown date never sleeps', () => {
  const now = Date.parse('2026-10-16T00:00:00Z');
  assert.equal(bookingAwake('2026-12-01', now), false);
  assert.equal(bookingAwake('2026-10-20', now), true);
  assert.equal(bookingAwake(null, now), true);
  assert.equal(bookingExpired('2026-10-10', now), true);
});

test('seat watch retires 15 min after start', () => {
  const start = '2026-10-16T12:00:00Z';
  assert.equal(seatExpired(start, Date.parse(start) + 10 * 60_000), false);
  assert.equal(seatExpired(start, Date.parse(start) + 16 * 60_000), true);
});

test('matchesWords and describeBlock', () => {
  assert.equal(matchesWords('<p>Telugu IMAX</p>', ['telugu']), true);
  assert.equal(matchesWords('<p>Hindi</p>', ['telugu']), false);
  assert.equal(describeBlock({ row: 'F', from: '8', to: '13', size: 6, price: 240 }), 'F 8–13 · 6 together · ₹240');
});
