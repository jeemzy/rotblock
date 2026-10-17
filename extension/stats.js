const safeCount = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
const key = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

function weekDates(now) {
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(now);
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() - 6 + index);
    return key(date);
  });
}

function normalize(state, now) {
  const days = Object.fromEntries(weekDates(now).map(date => [date, safeCount(state?.days?.[date])]));
  const total = Math.max(safeCount(state?.total), Object.values(days).reduce((a, b) => a + b, 0));
  return { version: 1, total, days };
}

export function recordCards(state, count, now = new Date()) {
  if (!Number.isSafeInteger(count) || count < 0 || count > 50_000) throw new Error('Invalid card count');
  const next = normalize(state, now);
  next.total = Math.min(Number.MAX_SAFE_INTEGER, next.total + count);
  next.days[key(now)] = Math.min(Number.MAX_SAFE_INTEGER, next.days[key(now)] + count);
  return next;
}

export function summarizeStats(state, now = new Date()) {
  const value = normalize(state, now);
  return { today: value.days[key(now)], total: value.total,
    week: Object.entries(value.days).map(([date, count]) => ({ date, count })) };
}
