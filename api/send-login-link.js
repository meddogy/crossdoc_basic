import { methodGuard, readJson, sendJson, supabaseRequest } from './_supabase.js';

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function safeRedirect(req, redirectTo) {
  const origin = req.headers.origin || `https://${req.headers.host}`;
  try {
    const candidate = new URL(redirectTo || origin);
    const base = new URL(origin);
    if (candidate.origin === base.origin) return candidate.toString();
  } catch {}
  return origin;
}

export default async function handler(req, res) {
  if (!methodGuard(req, res)) return;
  try {
    const body = await readJson(req);
    const email = normalizeEmail(body.email);
    if (!email) return sendJson(res, 400, { error: '이메일을 입력해 주세요.' });
    const redirectTo = safeRedirect(req, body.redirectTo);

    await supabaseRequest('/auth/v1/otp', {
      method: 'POST',
      query: { redirect_to: redirectTo },
      body: { email, create_user: true },
    });

    return sendJson(res, 200, { ok: true, email, redirectTo });
  } catch (error) {
    return sendJson(res, error.status || 500, {
      error: '로그인 링크 발송에 실패했습니다.',
      detail: error.message || String(error),
      status: error.status || 500,
    });
  }
}
