import { json } from '../lib/response.js';
import { authenticate, hasPinResetAccess, validPin } from '../lib/auth.js';
import { hashPin, randomHex } from '../lib/crypto.js';
import { isRateLimited, bumpRateLimit, clearRateLimit, getClientIp } from '../lib/rateLimit.js';
import {
  ensurePinResetTable,
  generateResetCode,
  hashResetCode,
  normalizeResetCode,
  PIN_RESET_CODE_TTL_SECONDS,
} from '../lib/pinReset.js';

// Rate limit verifikasi kode lebih ketat dari login biasa (yang 5x/15menit) --
// kode reset PIN kalau ketebak orang lain, dampaknya lebih parah daripada
// nebak-nebak PIN doang (dia bisa GANTI PIN orang). Per-username jadi
// "lockout sementara" yang diminta.
const VERIFY_USERNAME_MAX_ATTEMPTS = 3;
const VERIFY_USERNAME_WINDOW_SECONDS = 900;
const VERIFY_IP_MAX_ATTEMPTS = 10;
const VERIFY_IP_WINDOW_SECONDS = 900;

export async function handleListPinResetUsers(request, env) {
  const auth = await authenticate(request, env);
  if (auth.error) return auth.error;
  if (!hasPinResetAccess(auth.username, env)) {
    return json({ error: 'ga punya akses' }, 403);
  }

  const rows = await env.DB.prepare('SELECT username FROM users ORDER BY username ASC').all();
  return json({ usernames: rows.results.map(r => r.username) });
}

export async function handleGeneratePinResetCode(request, env) {
  const auth = await authenticate(request, env);
  if (auth.error) return auth.error;
  if (!hasPinResetAccess(auth.username, env)) {
    return json({ error: 'ga punya akses' }, 403);
  }

  await ensurePinResetTable(env);

  const body = await request.json().catch(() => null);
  if (!body) return json({ error: 'body invalid' }, 400);
  const targetUsername = String(body.username || '').toLowerCase().trim();

  const targetRow = await env.DB.prepare('SELECT username FROM users WHERE username = ?').bind(targetUsername).first();
  if (!targetRow) return json({ error: 'username ga ketemu' }, 404);

  const code = generateResetCode();
  const codeHash = await hashResetCode(code);
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + PIN_RESET_CODE_TTL_SECONDS;

  // INSERT OR REPLACE: kalau sebelumnya udah ada kode aktif buat username ini,
  // otomatis ke-replace -- kode lama langsung mati (username = PRIMARY KEY).
  await env.DB.prepare(
    `INSERT OR REPLACE INTO pin_reset_codes (username, code_hash, generated_by, generated_at, expires_at, used_at)
     VALUES (?, ?, ?, ?, ?, NULL)`
  ).bind(targetUsername, codeHash, auth.username, now, expiresAt).run();

  return json({ code, username: targetUsername, expiresAt, expiresInSeconds: PIN_RESET_CODE_TTL_SECONDS });
}

export async function handleForgotPin(request, env) {
  await ensurePinResetTable(env);

  const body = await request.json().catch(() => null);
  if (!body) return json({ error: 'body invalid' }, 400);
  const username = String(body.username || '').toLowerCase().trim();
  const code = normalizeResetCode(body.code);
  const newPin = String(body.newPin || '');
  const ip = getClientIp(request);

  if (!username || !code) return json({ error: 'username & kode wajib diisi' }, 400);
  if (!validPin(newPin)) return json({ error: 'PIN baru minimal 8 karakter, harus ada huruf besar dan angka' }, 400);

  const ipLimitCheck = await isRateLimited(env, `pin-reset-verify-ip:${ip}`, { maxCount: VERIFY_IP_MAX_ATTEMPTS });
  if (ipLimitCheck.limited) {
    return json({
      error: `kebanyakan percobaan dari jaringan ini, coba lagi dalam ${Math.ceil(ipLimitCheck.retryAfter / 60)} menit`,
      code: 'RATE_LIMITED',
      retryAfter: ipLimitCheck.retryAfter,
    }, 429);
  }
  const userLimitCheck = await isRateLimited(env, `pin-reset-verify:${username}`, { maxCount: VERIFY_USERNAME_MAX_ATTEMPTS });
  if (userLimitCheck.limited) {
    return json({
      error: `kebanyakan percobaan salah, coba lagi dalam ${Math.ceil(userLimitCheck.retryAfter / 60)} menit`,
      code: 'RATE_LIMITED',
      retryAfter: userLimitCheck.retryAfter,
    }, 429);
  }

  const fail = async () => {
    await bumpRateLimit(env, `pin-reset-verify:${username}`, { windowSeconds: VERIFY_USERNAME_WINDOW_SECONDS });
    await bumpRateLimit(env, `pin-reset-verify-ip:${ip}`, { windowSeconds: VERIFY_IP_WINDOW_SECONDS });
    return json({ error: 'kode salah atau udah kadaluarsa' }, 400);
  };

  const row = await env.DB.prepare(
    'SELECT code_hash, expires_at, used_at FROM pin_reset_codes WHERE username = ?'
  ).bind(username).first();
  if (!row || row.used_at) return fail();

  const now = Math.floor(Date.now() / 1000);
  if (row.expires_at < now) return fail();

  const codeHash = await hashResetCode(code);
  if (codeHash !== row.code_hash) return fail();

  const userRow = await env.DB.prepare('SELECT username FROM users WHERE username = ?').bind(username).first();
  if (!userRow) return fail();

  const { hash, salt } = await hashPin(newPin);
  const sessionId = randomHex(16); // ganti session_id -> semua device lain kelogout otomatis

  await env.DB.prepare(
    'UPDATE users SET pin_hash = ?, salt = ?, session_id = ? WHERE username = ?'
  ).bind(hash, salt, sessionId, username).run();
  await env.DB.prepare(
    'UPDATE pin_reset_codes SET used_at = ? WHERE username = ?'
  ).bind(now, username).run();

  await clearRateLimit(env, `pin-reset-verify:${username}`);
  await clearRateLimit(env, `login:${username}`);

  return json({ success: true });
}
