/** Offset (ms) between UTC and the given IANA zone at instant `date`. */
function zoneOffset(date, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(date).map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Wall-clock time in `timeZone` -> UTC Date. */
export function zonedToUtc(y, m, d, hh, mm, timeZone) {
  const guess = new Date(Date.UTC(y, m, d, hh, mm));
  const first = new Date(guess.getTime() - zoneOffset(guess, timeZone));
  // Re-check once so DST transitions land on the right side.
  return new Date(guess.getTime() - zoneOffset(first, timeZone));
}

/** Calendar date parts of `date` as seen in `timeZone`. */
export function zonedParts(date, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
    }).formatToParts(date).map((p) => [p.type, p.value]),
  );
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  return { y: +parts.year, m: +parts.month - 1, d: +parts.day, weekday };
}

export function isValidTimeZone(tz) {
  if (typeof tz !== 'string' || !tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Upcoming slot instants (UTC) for weekly slots in `timeZone`, starting after `from`,
 * looking ahead `days` days, in chronological order.
 */
export function upcomingSlots(slots, timeZone, from = new Date(), days = 28) {
  const out = [];
  const start = zonedParts(from, timeZone);
  for (let i = 0; i < days; i++) {
    // Noon UTC on the local date avoids landing on the wrong day near midnight.
    const day = new Date(Date.UTC(start.y, start.m, start.d + i, 12));
    const weekday = day.getUTCDay();
    for (const s of slots) {
      if (s.weekday !== weekday) continue;
      const [hh, mm] = s.time.split(':').map(Number);
      const at = zonedToUtc(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hh, mm, timeZone);
      if (at > from) out.push(at);
    }
  }
  return out.sort((a, b) => a - b);
}
