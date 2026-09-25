// untuk update kamus
// npx wrangler kv key put "dictionary" --path="C:\Users\asus\Downloads\samkat\data\assets.txt" --binding=DICTIONARY_KV --remote

const ASSET_SHIFT = 37;
const ASSET_RANGE_START = 32;
const ASSET_RANGE_SIZE = 95;
const DICT_CACHE_TTL_MS = 5 * 60 * 1000;

// State cache di-scope ke modul ini aja, gak nyebar ke file lain.
let _dictSetCache = null;
let _dictSetCacheAt = 0;

export function decodeAssetText(str) {
  let out = '';
  for (let i = 0; i < str.length; i++) {
    let code = str.charCodeAt(i);
    if (code >= ASSET_RANGE_START && code < ASSET_RANGE_START + ASSET_RANGE_SIZE) {
      code = ((code - ASSET_RANGE_START - ASSET_SHIFT) % ASSET_RANGE_SIZE + ASSET_RANGE_SIZE) % ASSET_RANGE_SIZE + ASSET_RANGE_START;
    }
    out += String.fromCharCode(code);
  }
  return out;
}

export async function getDictionarySet(env, forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && _dictSetCache && (now - _dictSetCacheAt) < DICT_CACHE_TTL_MS) {
    return _dictSetCache;
  }
  try {
    const encodedText = await env.DICTIONARY_KV.get('dictionary');
    if (!encodedText) {
      console.error(`[getDictionarySet] key "dictionary" kosong/gak ketemu di KV DICTIONARY_KV`);
      return _dictSetCache;
    }
    console.log(`[getDictionarySet] baca dari KV OK, panjang teks encoded: ${encodedText.length}`);
    let words;
    try {
      words = JSON.parse(decodeAssetText(encodedText));
    } catch (parseErr) {
      console.error(`[getDictionarySet] gagal parse hasil decode: ${parseErr.message}. Awal teks: ${encodedText.slice(0, 80)}`);
      return _dictSetCache;
    }
    if (!Array.isArray(words)) {
      console.error(`[getDictionarySet] hasil decode bukan array. typeof: ${typeof words}`);
      return _dictSetCache;
    }
    _dictSetCache = new Set(words);
    _dictSetCacheAt = now;
    console.log(`[getDictionarySet] sukses, ${words.length} kata di-cache`);
    return _dictSetCache;
  } catch (e) {
    console.error(`[getDictionarySet] exception: ${e && e.message ? e.message : String(e)}`);
    return _dictSetCache;
  }
}
