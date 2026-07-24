import { methodGuard, readJson, sendJson, checkAdminPasscode, serviceRoleRequest, serializeError } from '../lib/_supabase.js';

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

async function getApplication(id) {
  const rows = await serviceRoleRequest('/rest/v1/beta_applications', {
    query: {
      select: 'id,name,church,role,phone,email,status',
      id: `eq.${id}`,
      limit: '1',
    },
  });
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['POST'])) return;
  try {
    const body = await readJson(req);
    checkAdminPasscode(body.passcode);
    const id = String(body.id || '').trim();
    const action = String(body.action || 'approve').trim();
    if (!id) return sendJson(res, 400, { error: '신청자 ID가 없습니다.' });
    const app = await getApplication(id);
    if (!app) return sendJson(res, 404, { error: '신청자를 찾지 못했습니다.' });

    const email = normalizeEmail(app.email);
    if (!email) return sendJson(res, 400, { error: '신청자 이메일이 비어 있습니다.' });

    let status = 'pending';
    if (action === 'approve') status = 'approved';
    if (action === 'reject') status = 'rejected';
    if (action === 'pending') status = 'pending';

    if (action === 'approve') {
      await serviceRoleRequest('/rest/v1/allowed_users', {
        method: 'POST',
        query: { on_conflict: 'email' },
        headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
        body: {
          email,
          plan: 'beta',
          active: true,
          memo: `BASIC 1.18 베타테스터${app.church ? ` · ${app.church}` : ''}`,
        },
      });
    }

    const updated = await serviceRoleRequest('/rest/v1/beta_applications', {
      method: 'PATCH',
      query: { id: `eq.${id}`, select: 'id,name,church,role,phone,email,documents,device,message,status,memo,created_at,approved_at' },
      headers: { Prefer: 'return=representation' },
      body: {
        status,
        approved_at: status === 'approved' ? new Date().toISOString() : null,
        memo: status === 'approved' ? '승인 완료 · allowed_users 자동 등록' : status === 'rejected' ? '거절 처리' : '대기 상태로 변경',
      },
    });

    return sendJson(res, 200, { ok: true, application: Array.isArray(updated) ? updated[0] : updated });
  } catch (error) {
    const info = serializeError(error);
    console.error('[approve-beta] failed', JSON.stringify(info, null, 2));
    return sendJson(res, error.status || 500, {
      error: '베타 신청 처리에 실패했습니다.',
      detail: info.message,
      status: error.status || 500,
      cause: info.cause,
      diagnostics: info.diagnostics,
    });
  }
}
