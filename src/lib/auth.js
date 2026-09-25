import { verifyTokenSignature } from './crypto.js';
import { json } from './response.js';

// Cek apakah username punya akses ke reported-words. Bisa lebih dari 1 akun --
// REPORTED_WORDS_ACCESS di wrangler.jsonc isinya daftar username dipisah koma,
// misal: "gxjpeg2,lalalarosan". OWNER_USERNAME tetap otomatis dapet akses juga.
export function hasReportedWordsAccess(username, env) {
  if (username === env.OWNER_USERNAME) return true;
  const extra = (env.REPORTED_WORDS_ACCESS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  return extra.includes(username);
}

// Sama pola-nya kayak hasReportedWordsAccess di atas -- ini buat panel admin
// generate kode reset PIN. SENGAJA dipisah dari REPORTED_WORDS_ACCESS (bukan
// digabung), soalnya generate kode reset PIN itu jauh lebih sensitif -- gak
// mesti semua orang yang boleh liat reported-words otomatis boleh reset PIN
// orang lain.
export function hasPinResetAccess(username, env) {
  if (username === env.OWNER_USERNAME) return true;
  const extra = (env.PIN_RESET_ACCESS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  return extra.includes(username);
}

// Sama pola-nya kayak hasReportedWordsAccess di atas -- daftar username yang
// dibolehin nyimpen preset Kompe tanpa batas (bypass MAX_KOMPE_PRESETS di
// frontend). Diatur lewat UNLIMITED_KOMPE_PRESET_USERNAMES di wrangler.jsonc,
// dipisah koma. OWNER_USERNAME otomatis dapet juga.
export function hasUnlimitedKompePresets(username, env) {
  if (username === env.OWNER_USERNAME) return true;
  const extra = (env.UNLIMITED_KOMPE_PRESET_USERNAMES || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  return extra.includes(username);
}

export function validUsername(u) {
  return typeof u === 'string' && /^[a-z0-9_]{3,20}$/.test(u);
}

export function validPin(p) {
  if (typeof p !== 'string' || p.length < 8 || p.length > 64) return false;
  if (!/[A-Z]/.test(p)) return false;
  if (!/[0-9]/.test(p)) return false;
  return true;
}

export async function authenticate(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.replace('Bearer ', '');
  const payload = await verifyTokenSignature(token, env.TOKEN_SECRET);
  if (!payload) return { error: json({ error: 'sesi ga valid, login ulang', code: 'INVALID_TOKEN' }, 401) };

  const row = await env.DB.prepare('SELECT session_id, data FROM users WHERE username = ?').bind(payload.u).first();
  if (!row) return { error: json({ error: 'user ga ketemu', code: 'USER_NOT_FOUND' }, 404) };

  const isMultiDeviceExempt = env.MULTI_DEVICE_EXEMPT_USERNAME && payload.u === env.MULTI_DEVICE_EXEMPT_USERNAME;

  if (!isMultiDeviceExempt && row.session_id !== payload.sid) {
    return { error: json({ error: 'akun ini lagi login di device lain', code: 'SESSION_REPLACED' }, 401) };
  }
  return { username: payload.u, row };
}
