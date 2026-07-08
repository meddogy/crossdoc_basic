import { methodGuard, readJson, sendJson, supabaseRequest, serializeError, diagnostics } from './_supabase.js';

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function requestOrigin(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  return req.headers.origin || `${proto}://${req.headers.host}`;
}

function safeRedirect(req, redirectTo) {
  const origin = requestOrigin(req);
  try {
    const candidate = new URL(redirectTo || origin);
    const base = new URL(origin);
    if (candidate.origin === base.origin) return candidate.toString();
  } catch {}
  return origin;
}

async function sendOtp(email, redirectTo) {
  return supabaseRequest('/auth/v1/otp', {
    method: 'POST',
    query: { redirect_to: redirectTo },
    body: {
      email,
      create_user: true,
      data: { source: 'church-docs-kit-basic', version: '1.1' },
    },
  });
}

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['POST'])) return;
  const startedAt = Date.now();
  let email = '';
  let redirectTo = '';
  try {
    const body = await readJson(req);
    email = normalizeEmail(body.email);
    if (!email) return sendJson(res, 400, { error: '이메일을 입력해 주세요.' });
    redirectTo = safeRedirect(req, body.redirectTo);

    console.log('[send-login-link] start', { email, redirectTo, diag: diagnostics({ origin: requestOrigin(req) }) });
    const result = await sendOtp(email, redirectTo);
    console.log('[send-login-link] success', { email, redirectTo, elapsedMs: Date.now() - startedAt });

    return sendJson(res, 200, { ok: true, email, redirectTo, result: result || null, diagnostics: diagnostics({ redirectTo }) });
  } catch (error) {
    const info = serializeError(error, { email, redirectTo, origin: requestOrigin(req) });
    console.error('[send-login-link] failed', JSON.stringify(info, null, 2));
    return sendJson(res, error.status || 500, {
      error: '로그인 링크 발송에 실패했습니다.',
      detail: info.message,
      status: error.status || 500,
      cause: info.cause,
      supabaseStatus: error.status || 500,
      supabaseMessage: info.payload?.message || info.payload?.msg || info.payload?.error_description || info.payload?.error || '',
      diagnostics: info.diagnostics,
      troubleshooting: 'Vercel Logs에서 [send-login-link] failed 로그를 열어 message, cause, payload를 확인해 주세요.',
    });
  }
}
