import { methodGuard, readJson, sendJson, checkAdminPasscode, serviceRoleRequest, serializeError } from './_supabase.js';

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['POST'])) return;
  try {
    const body = await readJson(req);
    checkAdminPasscode(body.passcode);
    const rows = await serviceRoleRequest('/rest/v1/beta_applications', {
      query: {
        select: 'id,name,church,role,email,documents,device,message,status,memo,created_at,approved_at',
        order: 'created_at.desc',
        limit: '200',
      },
    });
    return sendJson(res, 200, { applications: Array.isArray(rows) ? rows : [] });
  } catch (error) {
    const info = serializeError(error);
    console.error('[beta-list] failed', JSON.stringify(info, null, 2));
    return sendJson(res, error.status || 500, {
      error: '베타 신청 목록을 불러오지 못했습니다.',
      detail: info.message,
      status: error.status || 500,
      cause: info.cause,
      diagnostics: info.diagnostics,
    });
  }
}
