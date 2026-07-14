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
        'X-Client-Info': 'church-docs-kit-basic/1.16',
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
