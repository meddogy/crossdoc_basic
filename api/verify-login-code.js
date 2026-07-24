import { methodGuard, readJson, sendJson, supabaseRequest, serializeError, diagnostics } from './_supabase.js';

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function normalizeToken(token) {
  return String(token || '').trim().replace(/\s+/g, '');
}

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['POST'])) return;
  let email = '';
  let token = '';
  try {
    const body = await readJson(req);
    email = normalizeEmail(body.email);
    token = normalizeToken(body.token);
    if (!email) return sendJson(res, 400, { error: '이메일을 입력해 주세요.' });
    if (!/^\d{6}$/.test(token)) return sendJson(res, 400, { error: '메일에 도착한 6자리 숫자 코드를 입력해 주세요.' });

    const session = await supabaseRequest('/auth/v1/verify', {
      method: 'POST',
      body: {
        email,
        token,
        type: 'email',
      },
    });

    return sendJson(res, 200, { ok: true, session, diagnostics: diagnostics({ action: 'verify-login-code' }) });
  } catch (error) {
    const info = serializeError(error, { email, action: 'verify-login-code' });
    console.error('[verify-login-code] failed', JSON.stringify(info, null, 2));
    return sendJson(res, error.status || 500, {
      error: '인증 코드 확인에 실패했습니다.',
      detail: info.message,
      status: error.status || 500,
      cause: info.cause,
      supabaseStatus: error.status || 500,
      supabaseMessage: info.payload?.message || info.payload?.msg || info.payload?.error_description || info.payload?.error || '',
      diagnostics: info.diagnostics,
      troubleshooting: '메일에 도착한 최신 6자리 코드를 입력했는지 확인해 주세요. Supabase 이메일 템플릿이 {{ .Token }} 코드 방식으로 되어 있어야 합니다.',
    });
  }
}
