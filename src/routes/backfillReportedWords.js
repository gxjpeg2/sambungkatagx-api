import { json } from '../lib/response.js';
import { authenticate, hasReportedWordsAccess } from '../lib/auth.js';
import { getDictionarySet } from '../lib/dictionary.js';
import { ensureReportedWordsTable, buildReportedWordsStmts, batchInChunks } from '../lib/reportedWords.js';

export async function handleBackfillReportedWords(request, env) {
  const auth = await authenticate(request, env);
  if (auth.error) return auth.error;
  if (!hasReportedWordsAccess(auth.username, env)) {
    return json({ error: 'ga punya akses' }, 403);
  }

  await ensureReportedWordsTable(env);

  const allUsers = await env.DB.prepare('SELECT data FROM users').all();
  const now = Math.floor(Date.now() / 1000);
  const dictSet = await getDictionarySet(env, true);

  if (!dictSet) {
    return json({ error: 'gagal fetch kamus master, backfill dibatalin biar data lama gak ke-wipe', code: 'DICT_FETCH_FAILED' }, 503);
  }

  await env.DB.prepare('DELETE FROM reported_words').run();

  let stmts = [];

  for (const row of allUsers.results) {
    let data;
    try { data = JSON.parse(row.data || '{}'); } catch (e) { continue; }
    const blockedWords = Array.isArray(data.blocked) ? data.blocked : [];
    const customWordsList = Array.isArray(data.customWords) ? data.customWords : [];
    stmts = stmts.concat(buildReportedWordsStmts(env, dictSet, blockedWords, customWordsList, now));
  }

  await batchInChunks(env, stmts);

  return json({ ok: true, usersScanned: allUsers.results.length, wordsProcessed: stmts.length });
}
