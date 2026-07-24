import { methodGuard, readJson, sendJson, supabaseRequest, serviceRoleRequest, serializeError } from './_supabase.js';

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

async function getAllowedEmail(accessToken) {
  if (!accessToken) {
    const error = new Error('로그인 토큰이 없습니다.');
    error.status = 401;
    throw error;
  }
  const user = await supabaseRequest('/auth/v1/user', { token: accessToken });
  const email = normalizeEmail(user?.email);
  if (!email) {
    const error = new Error('로그인 이메일을 확인하지 못했습니다.');
    error.status = 401;
    throw error;
  }
  const rows = await supabaseRequest('/rest/v1/allowed_users', {
    token: accessToken,
    query: { select: 'email,active,plan', email: `eq.${email}`, active: 'eq.true', limit: '1' },
  });
  if (!Array.isArray(rows) || !rows.length) {
    const error = new Error('등록된 사용자 이메일이 아닙니다.');
    error.status = 403;
    throw error;
  }
  return email;
}

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['POST'])) return;
  try {
    const body = await readJson(req);
    const accessToken = String(body.access_token || '').trim();
    const email = await getAllowedEmail(accessToken);
    const rows = await serviceRoleRequest('/rest/v1/user_documents', {
      query: {
        select: 'id,title,doc_type,bundle_types,updated_at,created_at',
        owner_email: `eq.${email}`,
        order: 'updated_at.desc',
        limit: '30',
      },
    });
    return sendJson(res, 200, { ok: true, documents: rows || [] });
  } catch (error) {
    const info = serializeError(error);
    console.error('[user-doc-list] failed', JSON.stringify(info, null, 2));
    return sendJson(res, error.status || 500, {
      error: '내 문서 목록을 불러오지 못했습니다.',
      detail: info.message,
      status: error.status || 500,
      cause: info.cause,
      diagnostics: info.diagnostics,
    });
  }
}
