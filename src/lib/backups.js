// Snapshot data user diambil tepat SEBELUM tiap overwrite di /sync (POST),
// bukan lewat cron terpisah -- soalnya /sync percaya 100% ke apa yang dikirim
// client tanpa validasi. Kalau suatu saat ada bug di frontend yang ngirim data
// kosong/salah, kita tetep punya titik aman persis sebelum overwrite itu terjadi.
//
// Supaya gak numpuk (sync bisa nembak tiap beberapa detik pas user aktif),
// snapshot baru cuma dibikin kalau snapshot terakhir user itu udah lebih lama
// dari BACKUP_THROTTLE_SECONDS. Retensi dibatasi BACKUP_RETENTION_COUNT
// snapshot terakhir per user, sisanya di-prune otomatis.

export const BACKUP_THROTTLE_SECONDS = 30 * 60; // 30 menit
export const BACKUP_RETENTION_COUNT = 20;

// Setelah tabel dipastikan ada sekali di isolate ini, gak perlu diulang tiap
// request -- CREATE TABLE/INDEX IF NOT EXISTS tetep query yang perlu round-
// trip ke D1, dan ini kepanggil di JALUR UTAMA tiap /sync (lewat
// maybeSnapshotBeforeWrite), jadi paling kerasa dampaknya kalau dihilangin.
// Cloudflare Workers biasa reuse isolate yang sama buat banyak request
// berurutan, jadi flag ini efektif ngilangin 2 query DDL di hampir semua
// sync setelah yang pertama. Isolate baru (cold start) bakal balik ke false
// lagi dan re-check sekali -- itu udah bener & aman.
let backupsTableEnsured = false;

export async function ensureBackupsTable(env) {
  if (backupsTableEnsured) return;
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS backups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`
  ).run();
  await env.DB.prepare(
    `CREATE INDEX IF NOT EXISTS idx_backups_username_created
     ON backups (username, created_at DESC)`
  ).run();
  backupsTableEnsured = true;
}

// Dipanggil dari handleSyncPost, SEBELUM data lama ditimpa. dataJsonString
// adalah data LAMA (yang mau diganti), bukan data baru yang baru dikirim.
// Best-effort: kalau gagal, jangan sampai bikin /sync ikutan gagal.
export async function maybeSnapshotBeforeWrite(env, username, dataJsonString, now) {
  try {
    await ensureBackupsTable(env);

    const last = await env.DB.prepare(
      'SELECT created_at FROM backups WHERE username = ? ORDER BY created_at DESC LIMIT 1'
    ).bind(username).first();

    if (last && (now - last.created_at) < BACKUP_THROTTLE_SECONDS) {
      return { snapshotted: false };
    }

    await env.DB.prepare(
      'INSERT INTO backups (username, data, created_at) VALUES (?, ?, ?)'
    ).bind(username, dataJsonString, now).run();

    await pruneOldBackups(env, username);
    return { snapshotted: true };
  } catch (e) {
    return { snapshotted: false, error: e && e.message ? e.message : String(e) };
  }
}

// Dipakai pas mau restore: paksa bikin snapshot dari state SEKARANG (sebelum
// ditimpa sama data hasil restore), TANPA throttle -- soalnya restore itu
// aksi yang jarang & krusial, jadi harus selalu dijamin reversible, gak boleh
// ke-skip gara-gara kebetulan ada snapshot rutin yang baru aja jalan.
export async function snapshotNow(env, username, dataJsonString, now) {
  try {
    await ensureBackupsTable(env);
    await env.DB.prepare(
      'INSERT INTO backups (username, data, created_at) VALUES (?, ?, ?)'
    ).bind(username, dataJsonString, now).run();
    await pruneOldBackups(env, username);
    return { snapshotted: true };
  } catch (e) {
    return { snapshotted: false, error: e && e.message ? e.message : String(e) };
  }
}

async function pruneOldBackups(env, username) {
  const rows = await env.DB.prepare(
    'SELECT id FROM backups WHERE username = ? ORDER BY created_at DESC'
  ).bind(username).all();
  const staleIds = rows.results.slice(BACKUP_RETENTION_COUNT).map(r => r.id);
  if (staleIds.length === 0) return;
  const placeholders = staleIds.map(() => '?').join(',');
  await env.DB.prepare(`DELETE FROM backups WHERE id IN (${placeholders})`).bind(...staleIds).run();
}

// Total grup trap, dukung format lama (kompeGroups flat) maupun baru
// (kompePresets, per preset per mode).
function countKompeGroups(data) {
  if (data.kompePresets && typeof data.kompePresets === 'object') {
    return ['normal', 'brutal'].reduce((total, mode) => {
      const presets = Array.isArray(data.kompePresets[mode]) ? data.kompePresets[mode] : [];
      return total + presets.reduce((sum, p) => sum + (Array.isArray(p.groups) ? p.groups.length : 0), 0);
    }, 0);
  }
  return Array.isArray(data.kompeGroups) ? data.kompeGroups.length : 0;
}

// List ringkas (tanpa isi data penuh, cuma metadata + jumlah) buat ditampilin di UI.
export async function listBackupsSummary(env, username) {
  await ensureBackupsTable(env);
  const rows = await env.DB.prepare(
    'SELECT id, data, created_at FROM backups WHERE username = ? ORDER BY created_at DESC'
  ).bind(username).all();

  return rows.results.map(row => {
    let data;
    try { data = JSON.parse(row.data || '{}'); } catch (e) { data = {}; }
    return {
      id: row.id,
      created_at: row.created_at,
      pushedWordsCount: Array.isArray(data.pushedWords) ? data.pushedWords.length : 0,
      kompeGroupsCount: countKompeGroups(data),
    };
  });
}

// Ambil isi lengkap satu backup, dipastikan milik username yang bersangkutan
// (jangan sampai user A bisa restore pake id backup milik user B).
export async function getBackupById(env, username, backupId) {
  await ensureBackupsTable(env);
  const row = await env.DB.prepare(
    'SELECT id, data, created_at FROM backups WHERE id = ? AND username = ?'
  ).bind(backupId, username).first();
  if (!row) return null;
  let data;
  try { data = JSON.parse(row.data || '{}'); } catch (e) { return null; }
  return { id: row.id, data, created_at: row.created_at };
}
