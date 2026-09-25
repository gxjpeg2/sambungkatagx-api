import { corsHeaders } from '../lib/response.js';

// Serve isi kamus (masih dalam bentuk encoded/obfuscated, sama persis kayak
// data/assets.txt yang dulu) langsung dari KV DICTIONARY_KV. Frontend yang
// urus decode + cache lokalnya sendiri (lihat decodeAssetText & loadDefaultDictionary
// di js/script.js) -- di sini cuma pass-through mentah, gak ada proses tambahan.
export async function handleGetDictionary(request, env) {
  const encodedText = await env.DICTIONARY_KV.get('dictionary');
  if (!encodedText) {
    return new Response('dictionary not found', { status: 404, headers: corsHeaders() });
  }
  return new Response(encodedText, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      // Aman di-cache lama -- frontend udah punya cache-busting sendiri lewat
      // query param ?v=DICTIONARY_VERSION, jadi isi di URL yang sama emang gak
      // pernah berubah.
      'Cache-Control': 'public, max-age=86400',
      ...corsHeaders(),
    },
  });
}
