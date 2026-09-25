import { json } from '../lib/response.js';
import { validUsername, validPin, hasUnlimitedKompePresets } from '../lib/auth.js';
import { hashPin, randomHex, signToken } from '../lib/crypto.js';
import { isRateLimited, bumpRateLimit, getClientIp } from '../lib/rateLimit.js';

// Sebelumnya endpoint ini gak ada rate limit sama sekali -- bisa dipake buat
// spam bikin akun (numpuk row di D1, kena kuota write harian) atau nyoba-nyoba
// enumerasi username yang udah kepake. Dibatesin per-IP, agak longgar
// (10x/jam) soalnya register itu wajarnya jarang dipanggil ulang-ulang.
const REGISTER_MAX_ATTEMPTS = 10;
const REGISTER_WINDOW_SECONDS = 3600;

export async function handleRegister(request, env) {
  const ip = getClientIp(request);
  const limitCheck = await isRateLimited(env, `register:${ip}`, { maxCount: REGISTER_MAX_ATTEMPTS });
  if (limitCheck.limited) {
    return json({
      error: `kebanyakan percobaan daftar dari jaringan ini, coba lagi dalam ${Math.ceil(limitCheck.retryAfter / 60)} menit`,
      code: 'RATE_LIMITED',
      retryAfter: limitCheck.retryAfter,
    }, 429);
  }

  const body = await request.json().catch(() => null);
  if (!body) return json({ error: 'body invalid' }, 400);
  const username = String(body.username || '').toLowerCase().trim();
  const pin = String(body.pin || '');
  if (!validUsername(username)) return json({ error: 'username 3-20 karakter, huruf kecil/angka/underscore' }, 400);
  if (!validPin(pin)) return json({ error: 'password minimal 8 karakter, harus ada huruf besar dan angka' }, 400);

  // Dihitung sebagai 1 percobaan begitu udah lolos validasi format dasar --
  // biar gak nge-limit orang yang salah ketik format doang, tapi tetep
  // ngeblok percobaan bikin akun beneran yang diulang-ulang.
  await bumpRateLimit(env, `register:${ip}`, { windowSeconds: REGISTER_WINDOW_SECONDS });

  const existing = await env.DB.prepare('SELECT username FROM users WHERE username = ?').bind(username).first();
  if (existing) return json({ error: 'username udah dipakai' }, 409);

  const { hash, salt } = await hashPin(pin);
  const sessionId = randomHex(16);
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    'INSERT INTO users (username, pin_hash, salt, data, session_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(username, hash, salt, '{}', sessionId, now, now).run();

  const token = await signToken(username, sessionId, env.TOKEN_SECRET);
  return json({ token, data: {}, unlimitedKompePresets: hasUnlimitedKompePresets(username, env) });
}
