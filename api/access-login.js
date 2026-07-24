import {
  methodGuard,
  readJson,
  sendJson,
  serviceRoleRequest,
  serializeError,
  getBetaAccessCode,
  createAppSessionToken,
  verifyAppSessionToken,
} from '../lib/_supabase.js';

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

async function getAllowedUser(email) {
  const rows = await serviceRoleRequest('/rest/v1/allowed_users', {
    query: {
      select: 'email,plan,active,memo,created_at',
      email: `eq.${email}`,
      active: 'eq.true',
      limit: '1',
    },
  });
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

function sessionPayload(user) {
  const token = createAppSessionToken({ email: user.email, plan: user.plan || 'basic', memo: user.memo || '' });
  return {
    access_token: token,
    token_type: 'app',
    expires_at: Date.now() + 1000 * 60 * 60 * 24 * 30,
    user: { email: user.email },
  };
}

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['POST'])) return;
  try {
    const body = await readJson(req);
    const mode = String(body.mode || 'login').trim();

    if (mode === 'verify') {
      const token = String(body.access_token || '').trim();
      const payload = verifyAppSessionToken(token);
      const allowed = await getAllowedUser(payload.email);
      if (!allowed) return sendJson(res, 403, { error: '등록된 사용자 이메일이 아니거나 사용 권한이 비활성화되었습니다.' });
      return sendJson(res, 200, { ok: true, email: allowed.email, buyer: allowed, session: sessionPayload(allowed) });
    }

    const email = normalizeEmail(body.email);
    const code = String(body.access_code || body.code || '').trim();
    if (!email) return sendJson(res, 400, { error: '이메일을 입력해 주세요.' });
    if (!code) return sendJson(res, 400, { error: '접속코드를 입력해 주세요.' });
    if (code !== getBetaAccessCode()) return sendJson(res, 401, { error: '접속코드가 맞지 않습니다.' });

    const allowed = await getAllowedUser(email);
    if (!allowed) return sendJson(res, 403, { error: '아직 승인되지 않은 이메일입니다. 관리자 승인 후 사용할 수 있습니다.' });

    return sendJson(res, 200, { ok: true, email: allowed.email, buyer: allowed, session: sessionPayload(allowed) });
  } catch (error) {
    const info = serializeError(error);
    console.error('[access-login] failed', JSON.stringify(info, null, 2));
    return sendJson(res, error.status || 500, {
      error: '접속 확인에 실패했습니다.',
      detail: info.message,
      status: error.status || 500,
      cause: info.cause,
      diagnostics: info.diagnostics,
      troubleshooting: 'Vercel 환경변수 BETA_ACCESS_CODE, ADMIN_PASSCODE, Supabase URL/KEY 값을 확인해 주세요.',
    });
  }
}
