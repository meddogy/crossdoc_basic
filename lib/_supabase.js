import crypto from 'node:crypto';

function cleanUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function safePrefix(value, n = 12) {
  const s = String(value || '').trim();
  if (!s) return '(empty)';
  return `${s.slice(0, n)}…${s.slice(-6)}`;
}

function safeCause(cause) {
  if (!cause) return '';
  if (typeof cause === 'string') return cause;
  const out = {};
  for (const key of ['name', 'message', 'code', 'errno', 'syscall', 'hostname', 'host', 'port']) {
    if (cause[key] !== undefined) out[key] = cause[key];
  }
  return Object.keys(out).length ? out : String(cause);
}


function b64url(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input));
  return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function fromB64url(value) {
  const s = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : '';
  return Buffer.from(s + pad, 'base64');
}

export function getAppSessionSecret() {
  const secret = String(process.env.APP_SESSION_SECRET || process.env.ADMIN_PASSCODE || '').trim();
  if (!secret || secret.length < 8) {
    const error = new Error('APP_SESSION_SECRET 또는 ADMIN_PASSCODE 환경변수가 필요합니다. Vercel 환경변수에 관리자만 아는 긴 값을 등록해 주세요.');
    error.status = 500;
    throw error;
  }
  return secret;
}

export function getBetaAccessCode() {
  const code = String(process.env.BETA_ACCESS_CODE || process.env.APP_ACCESS_CODE || '').trim();
  if (!code) {
    const error = new Error('BETA_ACCESS_CODE 환경변수가 비어 있습니다. 모바일/PC 공통 접속코드로 사용할 값을 Vercel 환경변수에 추가해 주세요.');
    error.status = 500;
    throw error;
  }
  return code;
}

function signPayload(payload) {
  const secret = getAppSessionSecret();
  return b64url(crypto.createHmac('sha256', secret).update(payload).digest());
}

export function createAppSessionToken({ email, plan = 'basic', memo = '' }, ttlSeconds = 60 * 60 * 24 * 30) {
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(JSON.stringify({
    typ: 'church-docs-kit-session',
    email: String(email || '').trim().toLowerCase(),
    plan,
    memo: String(memo || '').slice(0, 200),
    iat: now,
    exp: now + ttlSeconds,
  }));
  const sig = signPayload(payload);
  return `${payload}.${sig}`;
}

export function verifyAppSessionToken(token) {
  const raw = String(token || '').trim();
  const [payloadPart, sigPart] = raw.split('.');
  if (!payloadPart || !sigPart) {
    const error = new Error('앱 세션 토큰 형식이 올바르지 않습니다.');
    error.status = 401;
    throw error;
  }
  const expected = signPayload(payloadPart);
  const a = Buffer.from(sigPart);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    const error = new Error('앱 세션 서명이 올바르지 않습니다.');
    error.status = 401;
    throw error;
  }
  let payload;
  try { payload = JSON.parse(fromB64url(payloadPart).toString('utf8')); }
  catch { const error = new Error('앱 세션 내용을 읽을 수 없습니다.'); error.status = 401; throw error; }
  if (payload?.typ !== 'church-docs-kit-session') {
    const error = new Error('앱 세션 종류가 올바르지 않습니다.');
    error.status = 401;
    throw error;
  }
  if (!payload.email) {
    const error = new Error('앱 세션 이메일이 없습니다.');
    error.status = 401;
    throw error;
  }
  if (Number(payload.exp || 0) < Math.floor(Date.now() / 1000)) {
    const error = new Error('앱 세션이 만료되었습니다. 다시 접속해 주세요.');
    error.status = 401;
    throw error;
  }
  return payload;
}

export function getSupabaseConfig() {
  const url = cleanUrl(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL);
  const anonKey = String(process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '').trim();
  if (!url || !/^https:\/\/.+\.supabase\.co$/.test(url)) {
    const error = new Error(`Supabase URL 환경변수가 올바르지 않습니다. 현재 값: ${url || '(비어 있음)'}`);
    error.status = 500;
    throw error;
  }
  if (!anonKey) {
    const error = new Error('Supabase anon key 환경변수가 비어 있습니다. VITE_SUPABASE_ANON_KEY를 확인해 주세요.');
    error.status = 500;
    throw error;
  }
  return { url, anonKey };
}


export function getServiceRoleKey() {
  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '').trim();
  if (!serviceRoleKey) {
    const error = new Error('SUPABASE_SERVICE_ROLE_KEY 환경변수가 비어 있습니다. Vercel 서버 환경변수에 service_role key를 등록해 주세요.');
    error.status = 500;
    throw error;
  }
  return serviceRoleKey;
}

export function checkAdminPasscode(passcode) {
  const expected = String(process.env.ADMIN_PASSCODE || '').trim();
  if (!expected) {
    const error = new Error('ADMIN_PASSCODE 환경변수가 비어 있습니다. Vercel 서버 환경변수에 관리자 비밀번호를 등록해 주세요.');
    error.status = 500;
    throw error;
  }
  if (String(passcode || '').trim() !== expected) {
    const error = new Error('관리자 비밀번호가 맞지 않습니다.');
    error.status = 401;
    throw error;
  }
  return true;
}

export function diagnostics(extra = {}) {
  try {
    const { url, anonKey } = getSupabaseConfig();
    return {
      supabaseUrl: url,
      keyPrefix: safePrefix(anonKey),
      keyKind: anonKey.startsWith('eyJ') ? 'legacy anon JWT' : anonKey.startsWith('sb_publishable_') ? 'publishable key' : 'unknown',
      ...extra,
    };
  } catch (e) {
    return { configError: e.message, ...extra };
  }
}

export async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body || '{}'); } catch { return {}; }
  }
  return {};
}

export function sendJson(res, status, data) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.status(status).send(JSON.stringify(data));
}

export function methodGuard(req, res, allowed = ['POST']) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', `${allowed.join(', ')}, OPTIONS`);
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.status(204).end();
    return false;
  }
  if (!allowed.includes(req.method)) {
    sendJson(res, 405, { error: `${allowed.join('/')} 요청만 사용할 수 있습니다.` });
    return false;
  }
  return true;
}

function buildEndpoint(path, query) {
  const { url } = getSupabaseConfig();
  const endpoint = new URL(`${url}${path}`);
  if (query) {
    Object.entries(query).forEach(([k, v]) => {
      if (v !== undefined && v !== null && String(v) !== '') endpoint.searchParams.set(k, v);
    });
  }
  return endpoint;
}

export async function supabaseRequest(path, { method = 'GET', token, body, query, timeoutMs = 15000 } = {}) {
  const { anonKey } = getSupabaseConfig();
  const endpoint = buildEndpoint(path, query);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`Supabase 요청 시간 초과: ${timeoutMs}ms`)), timeoutMs);
  let response;
  let text = '';
  let payload = null;
  try {
    response = await fetch(endpoint.toString(), {
      method,
      signal: controller.signal,
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${token || anonKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-Client-Info': 'church-docs-kit-basic/1.22',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    text = await response.text();
  } catch (e) {
    const error = new Error(e.message || 'fetch failed');
    error.status = 500;
    error.endpoint = endpoint.toString();
    error.causeDetail = safeCause(e.cause || e);
    throw error;
  } finally {
    clearTimeout(timer);
  }

  if (text) {
    try { payload = JSON.parse(text); } catch { payload = { message: text }; }
  }

  if (!response.ok) {
    const detail = payload?.error_description || payload?.msg || payload?.message || payload?.error || JSON.stringify(payload || {});
    const error = new Error(detail || `Supabase 요청 실패: ${response.status}`);
    error.status = response.status;
    error.payload = payload;
    error.endpoint = endpoint.toString();
    error.responseText = text;
    throw error;
  }
  return payload;
}


export async function serviceRoleRequest(path, { method = 'GET', body, query, timeoutMs = 15000, headers = {} } = {}) {
  const { url } = getSupabaseConfig();
  const serviceRoleKey = getServiceRoleKey();
  const endpoint = new URL(`${url}${path}`);
  if (query) {
    Object.entries(query).forEach(([k, v]) => {
      if (v !== undefined && v !== null && String(v) !== '') endpoint.searchParams.set(k, v);
    });
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`Supabase 관리자 요청 시간 초과: ${timeoutMs}ms`)), timeoutMs);
  let response;
  let text = '';
  let payload = null;
  try {
    response = await fetch(endpoint.toString(), {
      method,
      signal: controller.signal,
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-Client-Info': 'church-docs-kit-basic/1.22-admin',
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    text = await response.text();
  } catch (e) {
    const error = new Error(e.message || 'fetch failed');
    error.status = 500;
    error.endpoint = endpoint.toString();
    error.causeDetail = safeCause(e.cause || e);
    throw error;
  } finally {
    clearTimeout(timer);
  }

  if (text) {
    try { payload = JSON.parse(text); } catch { payload = { message: text }; }
  }

  if (!response.ok) {
    const detail = payload?.error_description || payload?.msg || payload?.message || payload?.error || JSON.stringify(payload || {});
    const error = new Error(detail || `Supabase 관리자 요청 실패: ${response.status}`);
    error.status = response.status;
    error.payload = payload;
    error.endpoint = endpoint.toString();
    error.responseText = text;
    throw error;
  }
  return payload;
}

export function serializeError(error, extra = {}) {
  return {
    name: error?.name || 'Error',
    message: error?.message || String(error),
    status: error?.status || 500,
    endpoint: error?.endpoint || '',
    cause: error?.causeDetail || safeCause(error?.cause),
    payload: error?.payload || null,
    responseText: error?.responseText || '',
    diagnostics: diagnostics(extra),
    stack: String(error?.stack || '').split('\n').slice(0, 4).join('\n'),
  };
}
