// Helper khusus buat test. Ngulang cipher yang sama kayak decodeAssetText
// di src/lib/dictionary.js, tapi arah kebalikannya, buat nyiapin data KV
// yang formatnya sama persis kayak yang di-generate command
// `wrangler kv key put "dictionary" --path=...`

const ASSET_SHIFT = 37;
const ASSET_RANGE_START = 32;
const ASSET_RANGE_SIZE = 95;

export function encodeAssetText(str) {
  let out = '';
  for (let i = 0; i < str.length; i++) {
    let code = str.charCodeAt(i);
    if (code >= ASSET_RANGE_START && code < ASSET_RANGE_START + ASSET_RANGE_SIZE) {
      code = ((code - ASSET_RANGE_START + ASSET_SHIFT) % ASSET_RANGE_SIZE) + ASSET_RANGE_START;
    }
    out += String.fromCharCode(code);
  }
  return out;
}

export async function seedDictionary(env, words) {
  await env.DICTIONARY_KV.put('dictionary', encodeAssetText(JSON.stringify(words)));
}

// DROP + CREATE tiap dipanggil, biar tiap test mulai dari kondisi bersih,
// gak peduli isolatedStorage aktif atau enggak di config vitest-pool-workers.
export async function resetDb(env) {
  await env.DB.exec('DROP TABLE IF EXISTS users');
  await env.DB.exec('DROP TABLE IF EXISTS reported_words');
  // env.DB.exec() D1 mecah statement per baris, jadi harus satu baris.
  await env.DB.exec(
    "CREATE TABLE users (username TEXT PRIMARY KEY, pin_hash TEXT NOT NULL, salt TEXT NOT NULL, data TEXT NOT NULL DEFAULT '{}', session_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)"
  );
}

export async function clearRateLimitKv(env, username) {
  await env.RATE_LIMIT.delete(`rl:${username}`);
}
