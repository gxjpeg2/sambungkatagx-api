// Digeneralisir dari versi awal (yang hardcode 5x/15menit khusus username login)
// biar bisa dipake ulang buat kasus lain: rate limit per-IP di /register, dan
// rate limit per-IP di /login (tambahan, di luar yang per-username yang udah ada).
// key bebas string apa aja, asal unik per "identitas" yang mau dibatasin
// (contoh: `login:${username}`, `login-ip:${ip}`, `register:${ip}`).

const DEFAULT_MAX_COUNT = 5;
const DEFAULT_WINDOW_SECONDS = 900; // 15 menit

export async function isRateLimited(env, key, opts = {}) {
  const maxCount = opts.maxCount ?? DEFAULT_MAX_COUNT;
  const raw = await env.RATE_LIMIT.get(`rl:${key}`);
  if (!raw) return { limited: false };
  try {
    const data = JSON.parse(raw);
    const now = Math.floor(Date.now() / 1000);
    if (data.count >= maxCount && data.resetAt > now) {
      return { limited: true, retryAfter: data.resetAt - now };
    }
    return { limited: false };
  } catch (e) {
    return { limited: false };
  }
}

export async function bumpRateLimit(env, key, opts = {}) {
  const windowSeconds = opts.windowSeconds ?? DEFAULT_WINDOW_SECONDS;
  const raw = await env.RATE_LIMIT.get(`rl:${key}`);
  let data;
  try { data = raw ? JSON.parse(raw) : null; } catch (e) { data = null; }
  const count = data ? data.count + 1 : 1;
  const resetAt = Math.floor(Date.now() / 1000) + windowSeconds;
  await env.RATE_LIMIT.put(`rl:${key}`, JSON.stringify({ count, resetAt }), { expirationTtl: windowSeconds });
}

export async function clearRateLimit(env, key) {
  await env.RATE_LIMIT.delete(`rl:${key}`);
}

// CF-Connecting-IP itu header yang Cloudflare selalu nempelin sendiri di tiap
// request yang lewat jaringannya (gak bisa dipalsuin dari luar, beda kayak
// X-Forwarded-For yang gampang di-spoof kalau gak ditangani hati-hati).
export function getClientIp(request) {
  return request.headers.get('CF-Connecting-IP') || 'unknown';
}
