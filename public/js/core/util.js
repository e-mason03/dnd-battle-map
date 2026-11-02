// ============================================================
// Small shared helpers (safe for both Worker and browser)
// ============================================================

export function uid(len = 10) {
  const a = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let s = '';
  for (const b of bytes) s += a[b % a.length];
  return s;
}

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export const abilityMod = score => Math.floor(((score || 10) - 10) / 2);

export const fmtMod = n => (n >= 0 ? '+' : '') + n;

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, ch => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

export const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
