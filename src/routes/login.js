import { json } from '../lib/response.js';
import { hashPin, PIN_ITERATIONS_LEGACY, randomHex, signToken } from '../lib/crypto.js';
import { isRateLimited, bumpRateLimit, clearRateLimit, getClientIp } from '../lib/rateLimit.js';
import { hasUnlimitedKompePresets } from '../lib/auth.js';

// Per-username (di bawah) nyegah 1 akun spesifik di-brute-force. Ini nambahin
// lapisan per-IP: batesin percobaan LOGIN GAGAL dari 1 IP total, ke username
// manapun -- biar gak bisa disebar ("nyoba dikit-dikit tiap username") buat
// ngehindarin limit yang per-username. Threshold-nya sengaja dilonggarin
// (20x/15menit) dibanding yang per-username (5x), soalnya 1 IP bisa aja
// beneran dipake rame-rame (sekolah/kantor/wifi publik).
const LOGIN_IP_MAX_ATTEMPTS = 20;
const LOGIN_IP_WINDOW_SECONDS = 900;

export async function handleLogin(request, env) {
  const body = await request.json().catch(() => null);
  if (!body) return json({ error: 'body invalid' }, 400);
  const username = String(body.username || '').toLowerCase().trim();
  const pin = String(body.pin || '');
  const ip = getClientIp(request);

  const ipLimitCheck = await isRateLimited(env, `login-ip:${ip}`, { maxCount: LOGIN_IP_MAX_ATTEMPTS });
  if (ipLimitCheck.limited) {
    return json({
      error: `kebanyakan percobaan gagal dari jaringan ini, coba lagi dalam ${Math.ceil(ipLimitCheck.retryAfter / 60)} menit`,
      code: 'RATE_LIMITED',
      retryAfter: ipLimitCheck.retryAfter,
    }, 429);
  }

  const limitCheck = await isRateLimited(env, `login:${username}`);
  if (limitCheck.limited) {
    return json({
      error: `kebanyakan percobaan salah, coba lagi dalam ${Math.ceil(limitCheck.retryAfter / 60)} menit`,
      code: 'RATE_LIMITED',
      retryAfter: limitCheck.retryAfter,
    }, 429);
  }

  const row = await env.DB.prepare('SELECT pin_hash, salt, data FROM users WHERE username = ?').bind(username).first();
  if (!row) {
    await bumpRateLimit(env, `login:${username}`);
    await bumpRateLimit(env, `login-ip:${ip}`, { windowSeconds: LOGIN_IP_WINDOW_SECONDS });
    return json({ error: 'username atau pin salah' }, 401);
  }
  const { hash } = await hashPin(pin, row.salt);
  let matched = hash === row.pin_hash;
  let upgradedHash = null;

  if (!matched) {
    const legacy = await hashPin(pin, row.salt, PIN_ITERATIONS_LEGACY);
    if (legacy.hash === row.pin_hash) {
      matched = true;
      upgradedHash = hash;
    }
  }

  if (!matched) {
    await bumpRateLimit(env, `login:${username}`);
    await bumpRateLimit(env, `login-ip:${ip}`, { windowSeconds: LOGIN_IP_WINDOW_SECONDS });
    return json({ error: 'username atau pin salah' }, 401);
  }
  if (upgradedHash) {
    await env.DB.prepare('UPDATE users SET pin_hash = ? WHERE username = ?').bind(upgradedHash, username).run();
  }
  await clearRateLimit(env, `login:${username}`);

  const sessionId = randomHex(16);
  await env.DB.prepare('UPDATE users SET session_id = ? WHERE username = ?').bind(sessionId, username).run();

  const token = await signToken(username, sessionId, env.TOKEN_SECRET);
  return json({ token, data: JSON.parse(row.data || '{}'), unlimitedKompePresets: hasUnlimitedKompePresets(username, env) });
}
