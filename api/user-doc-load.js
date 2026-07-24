import { methodGuard, readJson, sendJson, supabaseRequest, serviceRoleRequest, serializeError } from './_supabase.js';

function normalizeEmail(email) { return String(email || '').trim().toLowerCase(); }
async function getAllowedEmail(accessToken) {
  if (!accessToken) { const e = new Error('로그인 토큰이 없습니다.'); e.status = 401; throw e; }
  const user = await supabaseRequest('/auth/v1/user', { token: accessToken });
  const email = normalizeEmail(user?.email);
  if (!email) { const e = new Error('로그인 이메일을 확인하지 못했습니다.'); e.status = 401; throw e; }
  const rows = await supabaseRequest('/rest/v1/allowed_users', {
    token: accessToken,
    query: { select: 'email,active,plan', email: `eq.${email}`, active: 'eq.true', limit: '1' },
  });
  if (!Array.isArray(rows) || !rows.length) { const e = new Error('등록된 사용자 이메일이 아닙니다.'); e.status = 403; throw e; }
  return email;
}

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['POST'])) return;
  try {
    const body = await readJson(req);
    const accessToken = String(body.access_token || '').trim();
    const id = String(body.id || '').trim();
    if (!id) return sendJson(res, 400, { error: '불러올 문서 ID가 없습니다.' });
    const email = await getAllowedEmail(accessToken);
    const rows = await serviceRoleRequest('/rest/v1/user_documents', {
      query: { select: 'id,title,doc_type,bundle_types,data,updated_at,created_at', id: `eq.${id}`, owner_email: `eq.${email}`, limit: '1' },
    });
    const doc = Array.isArray(rows) && rows.length ? rows[0] : null;
    if (!doc) return sendJson(res, 404, { error: '문서를 찾지 못했습니다.' });
    return sendJson(res, 200, { ok: true, document: doc });
  } catch (error) {
    const info = serializeError(error);
    console.error('[user-doc-load] failed', JSON.stringify(info, null, 2));
    return sendJson(res, error.status || 500, {
      error: '내 문서 불러오기에 실패했습니다.',
      detail: info.message,
      status: error.status || 500,
      cause: info.cause,
      diagnostics: info.diagnostics,
    });
  }
}
