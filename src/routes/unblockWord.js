import { json } from '../lib/response.js';
import { authenticate, hasReportedWordsAccess } from '../lib/auth.js';
import { isValidReportType, stripWordsFromAllUsers, isSafeReportedWord } from '../lib/reportedWords.js';

export async function handleUnblockWord(request, env) {
  const auth = await authenticate(request, env);
  if (auth.error) return auth.error;
  if (!hasReportedWordsAccess(auth.username, env)) {
    return json({ error: 'ga punya akses' }, 403);
  }

  const body = await request.json().catch(() => null);
  const word = body && typeof body.word === 'string' ? body.word.trim() : '';
  if (!word) return json({ error: 'word invalid' }, 400);

  // Dipastikan formatnya kata Indonesia beneran (huruf kecil doang) sebelum
  // dipake bangun pola SQL LIKE di stripWordsFromAllUsers -- kalau lolos
  // begitu aja, karakter kayak % atau _ di dalemnya bisa kepake browser
  // sebagai wildcard SQL dan bikin pencocokan meleset (match lebih luas dari
  // yang dimaksud). Bukan soal SQL injection (tetep parameterized), murni
  // soal presisi pencarian.
  if (!isSafeReportedWord(word)) return json({ error: 'word invalid' }, 400);

  // type default 'blocked' biar frontend lama (yang belum ngirim type) tetep jalan normal.
  const type = body && typeof body.type === 'string' ? body.type : 'blocked';
  if (!isValidReportType(type)) return json({ error: 'type invalid' }, 400);

  await env.DB.prepare(
    'DELETE FROM reported_words WHERE word = ? AND type = ?'
  ).bind(word, type).run();

  const now = Math.floor(Date.now() / 1000);
  const usersAffected = await stripWordsFromAllUsers(env, type, new Set([word]), now);

  return json({ ok: true, word, type, usersAffected });
}
