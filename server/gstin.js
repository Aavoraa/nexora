// GSTIN (India's GST registration number): 15 characters, ending in a check character.
// 2-digit state code, 10-character PAN, entity number, "Z", check character.

const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** The check character for the first 14 characters (the published GSTN mod-36 scheme). */
export function gstinCheckChar(first14) {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const p = CHARS.indexOf(first14[i]) * (i % 2 ? 2 : 1);
    sum += Math.floor(p / 36) + (p % 36);
  }
  return CHARS[(36 - (sum % 36)) % 36];
}

/** Uppercased, space-free GSTIN if it is well formed and its check character matches, else null. */
export function normalizeGstin(v) {
  const g = typeof v === 'string' ? v.replace(/\s+/g, '').toUpperCase() : '';
  const state = Number(g.slice(0, 2));
  if (!GSTIN_RE.test(g) || state < 1 || (state > 38 && state !== 97 && state !== 99)) return null;
  return gstinCheckChar(g.slice(0, 14)) === g[14] ? g : null;
}
