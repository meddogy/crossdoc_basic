import { methodGuard, readJson, sendJson, supabaseRequest, serializeError } from '../lib/_supabase.js';

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['POST'])) return;
  try {
    const body = await readJson(req);
    const accessToken = String(body.access_token || '').trim();
    if (!accessToken) return sendJson(res, 401, { error: '로그인 토큰이 없습니다.' });
    const user = await supabaseRequest('/auth/v1/user', { token: accessToken });
    return sendJson(res, 200, { user });
  } catch (error) {
    const info = serializeError(error);
    console.error('[auth-user] failed', JSON.stringify(info, null, 2));
    return sendJson(res, error.status || 500, {
      error: '로그인 사용자 확인에 실패했습니다.',
      detail: info.message,
      status: error.status || 500,
      cause: info.cause,
      diagnostics: info.diagnostics,
    });
  }
}
