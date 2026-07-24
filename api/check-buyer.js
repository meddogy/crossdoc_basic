import { methodGuard, readJson, sendJson, supabaseRequest, serializeError } from '../lib/_supabase.js';

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['POST'])) return;
  try {
    const body = await readJson(req);
    const accessToken = String(body.access_token || '').trim();
    if (!accessToken) return sendJson(res, 401, { error: '로그인 토큰이 없습니다.' });

    const user = await supabaseRequest('/auth/v1/user', { token: accessToken });
    const email = normalizeEmail(user?.email);
    if (!email) return sendJson(res, 401, { error: '로그인 이메일을 확인하지 못했습니다.' });

    const rows = await supabaseRequest('/rest/v1/allowed_users', {
      token: accessToken,
      query: {
        select: 'email,plan,active,memo',
        email: `eq.${email}`,
        active: 'eq.true',
        limit: '1',
      },
    });

    const buyer = Array.isArray(rows) && rows.length ? rows[0] : null;
    return sendJson(res, 200, { buyer, email });
  } catch (error) {
    const info = serializeError(error);
    console.error('[check-buyer] failed', JSON.stringify(info, null, 2));
    return sendJson(res, error.status || 500, {
      error: '구매자 권한 확인에 실패했습니다.',
      detail: info.message,
      status: error.status || 500,
      cause: info.cause,
      diagnostics: info.diagnostics,
    });
  }
}
