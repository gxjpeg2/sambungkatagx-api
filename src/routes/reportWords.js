import { json } from '../lib/response.js';
import { authenticate } from '../lib/auth.js';
import { getDictionarySet } from '../lib/dictionary.js';
import { ensureReportedWordsTable, buildReportedWordsStmts } from '../lib/reportedWords.js';

export async function handleReportWords(request, env) {
  const auth = await authenticate(request, env);
  if (auth.error) return auth.error;

  const body = await request.json().catch(() => null);
  if (!body) return json({ error: 'body invalid' }, 400);

  const blockedWords = Array.isArray(body.blocked) ? body.blocked : [];
  const customWordsList = Array.isArray(body.customWords) ? body.customWords : [];

  await ensureReportedWordsTable(env);

  const now = Math.floor(Date.now() / 1000);
  const dictSet = await getDictionarySet(env);
  const stmts = buildReportedWordsStmts(env, dictSet, blockedWords, customWordsList, now);
  // Catatan: endpoint ini sengaja tetep satu batch tanpa dipecah chunk,
  // sama persis kayak versi asli. Beda dengan backfill yang dipecah per 100,
  // karena volume kata yang dilaporin per submit jauh lebih kecil.
  if (stmts.length) await env.DB.batch(stmts);

  return json({ ok: true, dictFetchOk: !!dictSet });
}
