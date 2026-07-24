import { methodGuard, readJson, sendJson, serviceRoleRequest, serializeError } from './_supabase.js';

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}
function cleanText(value, max = 500) {
  return String(value || '').trim().slice(0, max);
}
function toArray(value) {
  if (Array.isArray(value)) return value.map(v => cleanText(v, 80)).filter(Boolean);
  if (!value) return [];
  return String(value).split(',').map(v => cleanText(v, 80)).filter(Boolean);
}
function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['POST'])) return;
  try {
    const body = await readJson(req);
    const name = cleanText(body.name, 80);
    const church = cleanText(body.church, 120);
    const role = cleanText(body.role, 80);
    const phone = cleanText(body.phone, 80);
    const email = normalizeEmail(body.email);
    const documents = toArray(body.documents);
    const device = cleanText(body.device, 120);
    const message = cleanText(body.message, 1200);
    const consent = body.consent === true || body.consent === 'true' || body.consent === 'yes';

    if (!name) return sendJson(res, 400, { error: '이름을 입력해 주세요.' });
    if (!phone) return sendJson(res, 400, { error: '연락 가능한 연락처를 입력해 주세요.' });
    if (!email || !validEmail(email)) return sendJson(res, 400, { error: '정확한 이메일 주소를 입력해 주세요.' });
    if (!consent) return sendJson(res, 400, { error: '개인정보 수집 및 베타테스트 안내에 동의해 주세요.' });

    const existing = await serviceRoleRequest('/rest/v1/beta_applications', {
      query: { select: 'id,email,status', email: `eq.${email}`, limit: '1' },
    });

    const payload = {
      name,
      church,
      role,
      phone,
      email,
      documents,
      device,
      message,
      consent,
      status: existing?.[0]?.status === 'approved' ? 'approved' : 'pending',
      memo: 'BASIC 1.18 베타 신청',
    };

    let saved;
    if (Array.isArray(existing) && existing.length) {
      saved = await serviceRoleRequest('/rest/v1/beta_applications', {
        method: 'PATCH',
        query: { email: `eq.${email}`, select: 'id,email,status,name,church,created_at' },
        headers: { Prefer: 'return=representation' },
        body: payload,
      });
    } else {
      saved = await serviceRoleRequest('/rest/v1/beta_applications', {
        method: 'POST',
        query: { select: 'id,email,status,name,church,created_at' },
        headers: { Prefer: 'return=representation' },
        body: payload,
      });
    }

    return sendJson(res, 200, { ok: true, application: Array.isArray(saved) ? saved[0] : saved });
  } catch (error) {
    const info = serializeError(error);
    console.error('[beta-apply] failed', JSON.stringify(info, null, 2));
    return sendJson(res, error.status || 500, {
      error: '베타테스터 신청 저장에 실패했습니다.',
      detail: info.message,
      status: error.status || 500,
      cause: info.cause,
      diagnostics: info.diagnostics,
    });
  }
}
