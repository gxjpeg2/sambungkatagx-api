import { corsHeaders, json } from './lib/response.js';
import { handleRegister } from './routes/register.js';
import { handleLogin } from './routes/login.js';
import { handleSyncGet, handleSyncPost } from './routes/sync.js';
import { handleReportWords } from './routes/reportWords.js';
import { handleGetReportedWords } from './routes/reportedWords.js';
import { handleUnblockWord } from './routes/unblockWord.js';
import { handleUnblockAllWords } from './routes/unblockAllWords.js';
import { handleBackfillReportedWords } from './routes/backfillReportedWords.js';
import { handleGetBackups } from './routes/backups.js';
import { handleRestore } from './routes/restore.js';
import { handleGetDictionary } from './routes/dictionary.js';
import { handleListPinResetUsers, handleGeneratePinResetCode, handleForgotPin } from './routes/pinReset.js';

const routes = [
  { method: 'POST', path: '/register', handler: handleRegister },
  { method: 'POST', path: '/login', handler: handleLogin },
  { method: 'GET', path: '/sync', handler: handleSyncGet },
  { method: 'POST', path: '/sync', handler: handleSyncPost },
  { method: 'POST', path: '/report-words', handler: handleReportWords },
  { method: 'GET', path: '/reported-words', handler: handleGetReportedWords },
  { method: 'POST', path: '/unblock-word', handler: handleUnblockWord },
  { method: 'POST', path: '/unblock-all-words', handler: handleUnblockAllWords },
  { method: 'POST', path: '/backfill-reported-words', handler: handleBackfillReportedWords },
  { method: 'GET', path: '/backups', handler: handleGetBackups },
  { method: 'POST', path: '/restore', handler: handleRestore },
  { method: 'GET', path: '/dictionary', handler: handleGetDictionary },
  { method: 'GET', path: '/admin/pin-reset/users', handler: handleListPinResetUsers },
  { method: 'POST', path: '/admin/pin-reset/generate', handler: handleGeneratePinResetCode },
  { method: 'POST', path: '/forgot-pin', handler: handleForgotPin },
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (request.method === 'OPTIONS') {
        return new Response(null, { headers: corsHeaders() });
      }

      const route = routes.find(r => r.method === request.method && r.path === url.pathname);
      if (!route) return json({ error: 'not found' }, 404);

      return await route.handler(request, env);
    } catch (err) {
      return json({ error: 'server error: ' + (err && err.message ? err.message : String(err)), code: 'INTERNAL_ERROR' }, 500);
    }
  },
};
