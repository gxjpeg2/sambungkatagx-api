// Kata yang dilaporin (blocked/custom) ujung-ujungnya ke-render mentah-mentah
// di panel admin (frontend). Endpoint ini kudu jadi gerbang yang gak bisa
// di-skip -- validasi di frontend gampang dilewatin (tinggal panggil API-nya
// langsung), jadi pemeriksaan karakter/panjang HARUS ada di sini juga.
// Kata Indonesia asli cuma terdiri dari huruf kecil, jadi apapun di luar itu
// (<, >, ", spasi, angka, dll) ditolak duluan sebelum sempet nyantol di DB.
const REPORTED_WORD_PATTERN = /^[a-z]{2,86}$/;

export function isSafeReportedWord(word) {
  return typeof word === 'string' && REPORTED_WORD_PATTERN.test(word);
}

export async function ensureReportedWordsTable(env) {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS reported_words (
      word TEXT NOT NULL,
      type TEXT NOT NULL,
      reported_at INTEGER,
      PRIMARY KEY (word, type)
    )`
  ).run();
}

export async function batchInChunks(env, stmts, chunkSize = 100) {
  for (let i = 0; i < stmts.length; i += chunkSize) {
    await env.DB.batch(stmts.slice(i, i + chunkSize));
  }
}

export async function cleanupReportedWords(env, dictSet) {
  if (!dictSet) return;

  const blockedRows = await env.DB.prepare(
    'SELECT word FROM reported_words WHERE type = ?'
  ).bind('blocked').all();
  const customRows = await env.DB.prepare(
    'SELECT word FROM reported_words WHERE type = ?'
  ).bind('custom').all();

  const staleBlocked = blockedRows.results.map(r => r.word).filter(w => !dictSet.has(w));
  const staleCustom = customRows.results.map(r => r.word).filter(w => dictSet.has(w));

  const stmts = [];
  for (const w of staleBlocked) {
    stmts.push(env.DB.prepare('DELETE FROM reported_words WHERE word = ? AND type = ?').bind(w, 'blocked'));
  }
  for (const w of staleCustom) {
    stmts.push(env.DB.prepare('DELETE FROM reported_words WHERE word = ? AND type = ?').bind(w, 'custom'));
  }
  await batchInChunks(env, stmts);
  return { staleBlockedRemoved: staleBlocked.length, staleCustomRemoved: staleCustom.length };
}

// Sebelumnya logic ini di-copy dua kali (di endpoint report-words dan
// backfill-reported-words), sekarang satu sumber dipakai keduanya.
// Kata blocked cuma diproses kalau memang ada di kamus, kata custom cuma
// diproses kalau belum ada di kamus.
export function buildReportedWordsStmts(env, dictSet, blockedWords, customWordsList, now) {
  const stmts = [];
  if (!dictSet) return stmts;
  for (const w of blockedWords) {
    if (!isSafeReportedWord(w)) continue;
    if (!dictSet.has(w)) continue;
    stmts.push(env.DB.prepare(
      'INSERT OR IGNORE INTO reported_words (word, type, reported_at) VALUES (?, ?, ?)'
    ).bind(w, 'blocked', now));
  }
  for (const w of customWordsList) {
    if (!isSafeReportedWord(w)) continue;
    if (dictSet.has(w)) continue;
    stmts.push(env.DB.prepare(
      'INSERT OR IGNORE INTO reported_words (word, type, reported_at) VALUES (?, ?, ?)'
    ).bind(w, 'custom', now));
  }
  return stmts;
}

// --- Generalisasi unblock: dipakai bareng oleh /unblock-word & /unblock-all-words
// buat dua jenis laporan, 'blocked' (kata yang diblok) dan 'custom' (kata custom
// yang ditambahin user). Bedanya cuma di field mana yang kena strip di data user.
const REPORT_TYPES = {
  blocked: { dataField: 'blocked' },
  custom: { dataField: 'customWords' },
};

export function isValidReportType(type) {
  return Object.prototype.hasOwnProperty.call(REPORT_TYPES, type);
}

export function dataFieldForType(type) {
  return REPORT_TYPES[type].dataField;
}

// Strip satu atau beberapa kata dari field data user yang sesuai tipe laporan
// (data.blocked atau data.customWords), lalu bikin statement UPDATE buat user
// yang emang kena. wordSet: Set<string> kata yang mau di-strip.
//
// CATATAN: sebelumnya di sini ada pra-filter SQL (`data LIKE ?` digabung pake
// OR, di-chunk 40 kondisi per query) buat ngirit JSON.parse tiap baris user.
// Itu DIBUANG karena D1 (SQLite) nolak query yang gabungin terlalu banyak
// kondisi LIKE pake OR sekaligus -- errornya "D1_ERROR: LIKE or GLOB pattern
// too complex: SQLITE_ERROR", kejadian pas "Batal Block Semua" dipanggil buat
// jumlah kata yang banyak. Karena skala user masih kecil (puluhan), full scan
// + filter di JS jauh lebih aman (gak ada batas kompleksitas sama sekali) dan
// bedanya ke performa masih gak berasa. Kalau nanti user udah ratusan/ribuan
// dan ini mulai berat, ganti pendekatannya ke tabel index terpisah
// (word -> username) daripada nyoba optimasi LIKE lagi.
export async function stripWordsFromAllUsers(env, type, wordSet, now) {
  const field = dataFieldForType(type);
  if (wordSet.size === 0) return 0;

  const allUsers = await env.DB.prepare('SELECT username, data FROM users').all();
  const stmts = [];
  let usersAffected = 0;

  for (const row of allUsers.results) {
    let data;
    try { data = JSON.parse(row.data || '{}'); } catch (e) { continue; }
    if (!Array.isArray(data[field]) || !data[field].some(w => wordSet.has(w))) continue;

    data[field] = data[field].filter(w => !wordSet.has(w));
    usersAffected++;
    stmts.push(env.DB.prepare(
      'UPDATE users SET data = ?, updated_at = ? WHERE username = ?'
    ).bind(JSON.stringify(data), now, row.username));
  }

  await batchInChunks(env, stmts);
  return usersAffected;
}
