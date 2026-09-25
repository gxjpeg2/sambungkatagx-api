import { json } from '../lib/response.js';
import { authenticate, hasReportedWordsAccess } from '../lib/auth.js';
import { isValidReportType, stripWordsFromAllUsers, isSafeReportedWord } from '../lib/reportedWords.js';

export async function handleUnblockAllWords(request, env) {
  const auth = await authenticate(request, env);
  if (auth.error) return auth.error;
  if (!hasReportedWordsAccess(auth.username, env)) {
    return json({ error: 'ga punya akses' }, 403);
  }

  // type dikirim lewat query string (?type=custom) karena request ini gak selalu
  // bawa body JSON (frontend lama manggil POST tanpa body). Default 'blocked'
  // biar tombol "Batal Block Semua" yang lama tetep jalan apa adanya.
  const url = new URL(request.url);
  const type = url.searchParams.get('type') || 'blocked';
  if (!isValidReportType(type)) return json({ error: 'type invalid' }, 400);

  const rows = await env.DB.prepare(
    'SELECT word FROM reported_words WHERE type = ?'
  ).bind(type).all();
  // Sejak buildReportedWordsStmts udah nyaring pake isSafeReportedWord pas
  // insert, baris di tabel ini harusnya emang selalu aman. Tapi kalau ada
  // baris lama (dari sebelum validasi ini dipasang) yang somehow lolos,
  // disaring ulang di sini juga -- jaga-jaga, biar gak ada kata liar yang
  // sampe ikut dipake bangun pola SQL LIKE di stripWordsFromAllUsers.
  const words = rows.results.map(r => r.word).filter(isSafeReportedWord);

  if (words.length === 0) {
    return json({ ok: true, type, wordsCleared: 0, usersAffected: 0 });
  }
  const wordSet = new Set(words);

  await env.DB.prepare('DELETE FROM reported_words WHERE type = ?').bind(type).run();

  const now = Math.floor(Date.now() / 1000);
  const usersAffected = await stripWordsFromAllUsers(env, type, wordSet, now);

  return json({ ok: true, type, wordsCleared: words.length, usersAffected });
}
