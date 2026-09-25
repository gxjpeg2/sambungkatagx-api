import { sha256Hex } from './crypto.js';

// Exclude 0/O dan 1/I -- kode ini bakal dibaca & diketik ulang manual sama
// user dari chat Discord, jadi karakter yang gampang ketuker mata dibuang
// dari awal. 32 karakter tersisa, 4 grup x 4 karakter = 32^16 kemungkinan,
// entropi jauh lebih dari cukup buat kode sekali-pakai yang cuma hidup 30 menit.
const CODE_CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_GROUP_COUNT = 4;
const CODE_GROUP_LEN = 4;

export const PIN_RESET_CODE_TTL_SECONDS = 30 * 60; // 30 menit

export function generateResetCode() {
  const randomBytes = crypto.getRandomValues(new Uint8Array(CODE_GROUP_COUNT * CODE_GROUP_LEN));
  const chars = [...randomBytes].map(b => CODE_CHARSET[b % CODE_CHARSET.length]);
  const groups = [];
  for (let i = 0; i < CODE_GROUP_COUNT; i++) {
    groups.push(chars.slice(i * CODE_GROUP_LEN, (i + 1) * CODE_GROUP_LEN).join(''));
  }
  return groups.join('-');
}

export async function hashResetCode(code) {
  // Dinormalisasi dulu (upper + strip spasi) -- biar user yang salin-tempel
  // dari Discord dengan spasi nyempil atau lowercase gak ke-reject gara-gara
  // beda kapitalisasi doang.
  return sha256Hex(normalizeResetCode(code));
}

export function normalizeResetCode(code) {
  return String(code || '').toUpperCase().replace(/\s+/g, '');
}

// username jadi PRIMARY KEY -- generate kode baru buat username yang sama
// otomatis nge-replace (INSERT OR REPLACE), jadi kode lama otomatis mati
// tanpa perlu query DELETE terpisah.
export async function ensurePinResetTable(env) {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS pin_reset_codes (
      username TEXT PRIMARY KEY,
      code_hash TEXT NOT NULL,
      generated_by TEXT NOT NULL,
      generated_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      used_at INTEGER
    )`
  ).run();
}
