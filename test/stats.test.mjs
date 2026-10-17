import assert from 'node:assert/strict';
import { test } from 'node:test';
import { recordCards, summarizeStats } from '../extension/stats.js';

test('daily counts follow local calendar days, fill missing days, and keep all-time totals', () => {
  const evening = new Date(2026, 9, 17, 23, 59);
  const morning = new Date(2026, 9, 18, 0, 1);
  const state = recordCards(recordCards(null, 8, evening), 3, morning);
  const summary = summarizeStats(state, morning);
  assert.equal(summary.today, 3);
  assert.equal(summary.total, 11);
  assert.equal(summary.week.length, 7);
  assert.deepEqual(summary.week.map(day => day.count), [0, 0, 0, 0, 0, 8, 3]);
  assert.equal(summary.week[6].date, '2026-10-18');
});

test('retention bounds daily data while preserving the lifetime total', () => {
  let state;
  for (let day = 1; day <= 40; day++) state = recordCards(state, 2, new Date(2026, 9, day, 12));
  assert.equal(Object.keys(state.days).length, 7);
  assert.equal(summarizeStats(state, new Date(2026, 10, 9)).total, 80);
});

test('invalid stored values and increments cannot poison the counters', () => {
  const now = new Date(2026, 9, 17);
  assert.equal(summarizeStats({ total: -1, days: { '2026-10-17': 'bad' } }, now).today, 0);
  assert.equal(summarizeStats(null, now).total, 0);
  for (const count of [-1, 0.5, NaN, Infinity, '2']) assert.throws(() => recordCards(null, count, now));
});
