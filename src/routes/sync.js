import { json } from '../lib/response.js';
import { authenticate, hasUnlimitedKompePresets } from '../lib/auth.js';
import { maybeSnapshotBeforeWrite } from '../lib/backups.js';

export async function handleSyncGet(request, env) {
  const auth = await authenticate(request, env);
  if (auth.error) return auth.error;
  return json({ data: JSON.parse(auth.row.data || '{}'), unlimitedKompePresets: hasUnlimitedKompePresets(auth.username, env) });
}

export async function handleSyncPost(request, env) {
  const auth = await authenticate(request, env);
  if (auth.error) return auth.error;

  const body = await request.json().catch(() => null);
  if (!body || typeof body.data !== 'object') return json({ error: 'data invalid' }, 400);

  const now = Math.floor(Date.now() / 1000);

  // Snapshot data LAMA (sebelum ditimpa) -- best-effort, di-throttle di dalam
  // maybeSnapshotBeforeWrite. Kalau baris user belum pernah punya data ('{}'),
  // gapapa tetep disnapshot, gak masalah.
  await maybeSnapshotBeforeWrite(env, auth.username, auth.row.data || '{}', now);

  await env.DB.prepare('UPDATE users SET data = ?, updated_at = ? WHERE username = ?')
    .bind(JSON.stringify(body.data), now, auth.username).run();
  return json({ ok: true, updated_at: now });
}
