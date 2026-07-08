import { methodGuard, sendJson, diagnostics, supabaseRequest, serializeError } from './_supabase.js';

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['GET', 'POST'])) return;
  try {
    // Supabase Auth settings endpoint is public with anon key and is useful for connectivity diagnostics.
    let authSettings = null;
    try {
      authSettings = await supabaseRequest('/auth/v1/settings', { method: 'GET', timeoutMs: 10000 });
    } catch (e) {
      const info = serializeError(e);
      return sendJson(res, e.status || 500, {
        ok: false,
        error: 'Supabase 연결 진단 실패',
        detail: info.message,
        cause: info.cause,
        diagnostics: info.diagnostics,
      });
    }
    return sendJson(res, 200, { ok: true, diagnostics: diagnostics(), authSettings });
  } catch (error) {
    const info = serializeError(error);
    return sendJson(res, error.status || 500, { ok: false, error: info.message, diagnostics: info.diagnostics });
  }
}
