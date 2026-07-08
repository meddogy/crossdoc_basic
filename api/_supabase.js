function cleanUrl(value) {
  return String(value || '').trim().replace(/\/$/, '');
}

export function getSupabaseConfig() {
  const url = cleanUrl(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL);
  const anonKey = String(process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '').trim();
  if (!url || !/^https:\/\/.+\.supabase\.co$/.test(url)) {
    throw new Error(`Supabase URL 환경변수가 올바르지 않습니다. 현재 값: ${url || '(비어 있음)'}`);
  }
  if (!anonKey) {
    throw new Error('Supabase anon key 환경변수가 비어 있습니다. VITE_SUPABASE_ANON_KEY를 확인해 주세요.');
  }
  return { url, anonKey };
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

export function methodGuard(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.status(204).end();
    return false;
  }
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'POST 요청만 사용할 수 있습니다.' });
    return false;
  }
  return true;
}

export async function supabaseRequest(path, { method = 'GET', token, body, query } = {}) {
  const { url, anonKey } = getSupabaseConfig();
  const endpoint = new URL(`${url}${path}`);
  if (query) Object.entries(query).forEach(([k, v]) => endpoint.searchParams.set(k, v));
  const response = await fetch(endpoint.toString(), {
    method,
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token || anonKey}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let payload = null;
  const text = await response.text();
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = { message: text }; }
  }
  if (!response.ok) {
    const detail = payload?.error_description || payload?.msg || payload?.message || payload?.error || JSON.stringify(payload || {});
    const error = new Error(detail || `Supabase 요청 실패: ${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}
