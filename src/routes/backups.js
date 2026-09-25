import { json } from '../lib/response.js';
import { authenticate } from '../lib/auth.js';
import { listBackupsSummary } from '../lib/backups.js';

export async function handleGetBackups(request, env) {
  const auth = await authenticate(request, env);
  if (auth.error) return auth.error;

  const backups = await listBackupsSummary(env, auth.username);
  return json({ backups });
}
