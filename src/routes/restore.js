import { json } from '../lib/response.js';
import { authenticate } from '../lib/auth.js';
import { getBackupById, snapshotNow } from '../lib/backups.js';

export async function handleRestore(request, env) {
  const auth = await authenticate(request, env);
  if (auth.error) return auth.error;

  const body = await request.json().catch(() => null);
  const backupId = body && Number.isInteger(body.backupId) ? body.backupId : null;
  if (!backupId) return json({ error: 'backupId invalid' }, 400);

  const backup = await getBackupById(env, auth.username, backupId);
  if (!backup) return json({ error: 'backup ga ketemu' }, 404);

  const now = Math.floor(Date.now() / 1000);

  // Snapshot state sekarang dulu (dipaksa, gak di-throttle) sebelum ditimpa,
  // biar restore ini sendiri gak destructive -- selalu bisa dibalikin lagi.
  await snapshotNow(env, auth.username, auth.row.data || '{}', now);

  await env.DB.prepare('UPDATE users SET data = ?, updated_at = ? WHERE username = ?')
    .bind(JSON.stringify(backup.data), now, auth.username).run();

  return json({ ok: true, restored_from: backup.created_at, updated_at: now, data: backup.data });
}
