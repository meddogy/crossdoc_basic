import { methodGuard, readJson, sendJson, supabaseRequest, serializeError, diagnostics } from '../lib/_supabase.js';

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['POST'])) return;
  try {
    const body = await readJson(req);
    const refreshToken = String(body.refresh_token || '').trim();
    if (!refreshToken) return sendJson(res, 400, { error: '갱신 토큰이 없습니다. 다시 로그인해 주세요.' });

    const session = await supabaseRequest('/auth/v1/token', {
      method: 'POST',
      query: { grant_type: 'refresh_token' },
      body: { refresh_token: refreshToken },
    });

    return sendJson(res, 200, { ok: true, session, diagnostics: diagnostics({ action: 'refresh-session' }) });
  } catch (error) {
    const info = serializeError(error, { action: 'refresh-session' });
    console.error('[refresh-session] failed', JSON.stringify(info, null, 2));
    return sendJson(res, error.status || 500, {
      error: '로그인 세션 갱신에 실패했습니다.',
      detail: info.message,
      status: error.status || 500,
      cause: info.cause,
      supabaseStatus: error.status || 500,
      supabaseMessage: info.payload?.message || info.payload?.msg || info.payload?.error_description || info.payload?.error || '',
      diagnostics: info.diagnostics,
    });
  }
}
