import { json } from '../lib/response.js';
import { authenticate, hasReportedWordsAccess } from '../lib/auth.js';
import { ensureReportedWordsTable } from '../lib/reportedWords.js';

export async function handleGetReportedWords(request, env) {
  const auth = await authenticate(request, env);
  if (auth.error) return auth.error;
  if (!hasReportedWordsAccess(auth.username, env)) {
    return json({ error: 'ga punya akses' }, 403);
  }

  await ensureReportedWordsTable(env);

  const blockedRows = await env.DB.prepare(
    'SELECT word FROM reported_words WHERE type = ?'
  ).bind('blocked').all();
  const customRows = await env.DB.prepare(
    'SELECT word FROM reported_words WHERE type = ?'
  ).bind('custom').all();

  const blocked = blockedRows.results.map(r => r.word);
  const custom = customRows.results.map(r => r.word);

  return json({
    blocked,
    custom,
    _debug: {
      blockedCount: blocked.length,
      customCount: custom.length,
    },
  });
}