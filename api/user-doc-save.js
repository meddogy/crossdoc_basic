import { methodGuard, readJson, sendJson, supabaseRequest, serviceRoleRequest, serializeError } from './_supabase.js';

function normalizeEmail(email) { return String(email || '').trim().toLowerCase(); }
function cleanText(value, max = 120) { return String(value || '').trim().slice(0, max); }
function toArray(value) {
  if (Array.isArray(value)) return value.map(v => cleanText(v, 80)).filter(Boolean).slice(0, 10);
  return [];
}
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
    const email = await getAllowedEmail(accessToken);
    const id = cleanText(body.id, 80);
    const title = cleanText(body.title, 120) || '새 문서';
    const docType = cleanText(body.doc_type || body.type, 80) || '기본 공지 안내문';
    const bundleTypes = toArray(body.bundle_types || body.bundleTypes);
    const data = body.data && typeof body.data === 'object' ? body.data : null;
    if (!data) return sendJson(res, 400, { error: '저장할 문서 데이터가 없습니다.' });
    const payload = {
      owner_email: email,
      title,
      doc_type: docType,
      bundle_types: bundleTypes,
      data,
      updated_at: new Date().toISOString(),
    };
    let saved;
    if (id) {
      saved = await serviceRoleRequest('/rest/v1/user_documents', {
        method: 'PATCH',
        query: { id: `eq.${id}`, owner_email: `eq.${email}`, select: 'id,title,doc_type,bundle_types,updated_at,created_at' },
        headers: { Prefer: 'return=representation' },
        body: payload,
      });
      if (!Array.isArray(saved) || !saved.length) {
        const e = new Error('저장할 문서를 찾지 못했습니다. 새 문서로 다시 저장해 주세요.'); e.status = 404; throw e;
      }
    } else {
      saved = await serviceRoleRequest('/rest/v1/user_documents', {
        method: 'POST',
        query: { select: 'id,title,doc_type,bundle_types,updated_at,created_at' },
        headers: { Prefer: 'return=representation' },
        body: payload,
      });
    }
    return sendJson(res, 200, { ok: true, document: Array.isArray(saved) ? saved[0] : saved });
  } catch (error) {
    const info = serializeError(error);
    console.error('[user-doc-save] failed', JSON.stringify(info, null, 2));
    return sendJson(res, error.status || 500, {
      error: '내 문서 저장에 실패했습니다.',
      detail: info.message,
      status: error.status || 500,
      cause: info.cause,
      diagnostics: info.diagnostics,
    });
  }
}
