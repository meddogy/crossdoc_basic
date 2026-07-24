import { methodGuard, readJson, sendJson, supabaseRequest, serviceRoleRequest, serializeError } from '../lib/_supabase.js';

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

function isMissingUserDocumentsTable(info) {
  const text = `${info?.message || ''} ${info?.cause || ''} ${JSON.stringify(info?.diagnostics || {})}`;
  return text.includes('user_documents') && (text.includes('Could not find the table') || text.includes('schema cache') || text.includes('does not exist'));
}
function missingUserDocumentsPayload(defaultError, info) {
  const missing = isMissingUserDocumentsTable(info);
  if (!missing) return null;
  return {
    error: '내 문서 저장 테이블이 아직 만들어지지 않았습니다.',
    detail: 'Supabase SQL Editor에서 supabase_cloud_documents.sql 파일 내용을 한 번 실행해 주세요. 실행 후 1~2분 뒤 다시 저장하면 됩니다.',
    status: 404,
    action: 'supabase_cloud_documents.sql 실행 필요',
    cause: info?.message || defaultError,
    diagnostics: info?.diagnostics,
  };
}

async function listDocuments(email) {
  const rows = await serviceRoleRequest('/rest/v1/user_documents', {
    query: {
      select: 'id,title,doc_type,bundle_types,updated_at,created_at',
      owner_email: `eq.${email}`,
      order: 'updated_at.desc',
      limit: '30',
    },
  });
  return { ok: true, documents: rows || [] };
}

async function loadDocument(email, body) {
  const id = String(body.id || '').trim();
  if (!id) { const e = new Error('불러올 문서 ID가 없습니다.'); e.status = 400; throw e; }
  const rows = await serviceRoleRequest('/rest/v1/user_documents', {
    query: { select: 'id,title,doc_type,bundle_types,data,updated_at,created_at', id: `eq.${id}`, owner_email: `eq.${email}`, limit: '1' },
  });
  const doc = Array.isArray(rows) && rows.length ? rows[0] : null;
  if (!doc) { const e = new Error('문서를 찾지 못했습니다.'); e.status = 404; throw e; }
  return { ok: true, document: doc };
}

async function saveDocument(email, body) {
  const id = cleanText(body.id, 80);
  const title = cleanText(body.title, 120) || '새 문서';
  const docType = cleanText(body.doc_type || body.type, 80) || '기본 공지 안내문';
  const bundleTypes = toArray(body.bundle_types || body.bundleTypes);
  const data = body.data && typeof body.data === 'object' ? body.data : null;
  if (!data) { const e = new Error('저장할 문서 데이터가 없습니다.'); e.status = 400; throw e; }
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
    if (!Array.isArray(saved) || !saved.length) { const e = new Error('저장할 문서를 찾지 못했습니다. 새 문서로 다시 저장해 주세요.'); e.status = 404; throw e; }
  } else {
    saved = await serviceRoleRequest('/rest/v1/user_documents', {
      method: 'POST',
      query: { select: 'id,title,doc_type,bundle_types,updated_at,created_at' },
      headers: { Prefer: 'return=representation' },
      body: payload,
    });
  }
  return { ok: true, document: Array.isArray(saved) ? saved[0] : saved };
}

async function deleteDocument(email, body) {
  const id = String(body.id || '').trim();
  if (!id) { const e = new Error('삭제할 문서 ID가 없습니다.'); e.status = 400; throw e; }
  await serviceRoleRequest('/rest/v1/user_documents', {
    method: 'DELETE',
    query: { id: `eq.${id}`, owner_email: `eq.${email}` },
  });
  return { ok: true };
}

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['POST'])) return;
  let action = 'list';
  try {
    const body = await readJson(req);
    action = String(body.action || 'list').trim();
    const accessToken = String(body.access_token || '').trim();
    const email = await getAllowedEmail(accessToken);

    let result;
    if (action === 'list') result = await listDocuments(email);
    else if (action === 'load') result = await loadDocument(email, body);
    else if (action === 'save') result = await saveDocument(email, body);
    else if (action === 'delete') result = await deleteDocument(email, body);
    else return sendJson(res, 400, { error: '알 수 없는 내 문서 요청입니다.' });

    return sendJson(res, 200, result);
  } catch (error) {
    const info = serializeError(error, { action });
    console.error(`[user-docs:${action}] failed`, JSON.stringify(info, null, 2));
    const tableMissing = missingUserDocumentsPayload('내 문서 처리에 실패했습니다.', info);
    if (tableMissing) return sendJson(res, 404, tableMissing);
    return sendJson(res, error.status || 500, {
      error: '내 문서 처리에 실패했습니다.',
      detail: info.message,
      status: error.status || 500,
      cause: info.cause,
      diagnostics: info.diagnostics,
    });
  }
}
