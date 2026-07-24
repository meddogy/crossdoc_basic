import React, { useContext, useEffect, useMemo, useRef, useState } from 'react';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

const NL='\n';
const PreviewDirectEditContext = React.createContext(false);
const STORAGE='church-docs-kit-basic-v1-data';
const LEGACY_STORAGE_KEYS=['church-docs-workshop-v46-data','church-docs-workshop-v45-data','church-docs-workshop-v44-data','church-docs-workshop-v43-data'];
const A4={w:794,h:1123};

// BASIC 1.25 모바일 안정 접속코드판: Supabase 이메일 Sign in 링크 없이 승인 이메일 + 접속코드로 로그인합니다.
// 베타 단계에서는 BETA_ACCESS_CODE 환경변수 하나로 PC와 모바일 접속을 안정화합니다.
const AUTH_STORAGE='church-docs-kit-basic-v1-auth-session';
const AUTH_DEBUG_INFO={
  mode:'Vercel API proxy + approved email + access code + persistent app session + PWA',
  note:'Supabase 이메일 발송과 Magic Link를 사용하지 않습니다. 승인된 이메일과 베타 접속코드로 PC/모바일에서 바로 접속합니다.'
};
function readableSupabaseError(error){
  const parts=[];
  const data=error?.data;
  if(data){
    if(data.detail)parts.push(`상세: ${data.detail}`);
    if(data.status)parts.push(`상태 코드: ${data.status}`);
    if(data.supabaseStatus)parts.push(`Supabase 상태: ${data.supabaseStatus}`);
    if(data.supabaseMessage)parts.push(`Supabase 메시지: ${data.supabaseMessage}`);
    if(data.cause)parts.push(`원인: ${typeof data.cause==='string'?data.cause:JSON.stringify(data.cause)}`);
    if(data.diagnostics){
      const d=data.diagnostics;
      parts.push(`진단: url=${d.supabaseUrl||'-'} / key=${d.keyPrefix||'-'} / redirect=${d.redirectTo||d.origin||'-'}`);
    }
    if(data.troubleshooting)parts.push(`확인: ${data.troubleshooting}`);
  }
  const raw=String(error?.message||error||'알 수 없는 오류');
  let parsed=null;
  try{parsed=JSON.parse(raw)}catch{}
  if(parsed){
    if(Array.isArray(parsed))parts.push(parsed.map(x=>x?.message||x?.error_description||x?.msg||JSON.stringify(x)).join(' / '));
    else parts.push(parsed.error_description||parsed.msg||parsed.message||parsed.error||JSON.stringify(parsed));
  }else if(/Load failed|Failed to fetch|fetch failed/i.test(raw)){
    parts.push('네트워크 요청이 실패했습니다. Vercel 함수 로그와 Supabase API 응답을 확인해 주세요.');
  }else if(/환경변수|SUPABASE|URL|KEY/i.test(raw)){
    parts.push(raw);
  }else if(/Invalid API key|apikey|JWT|Unauthorized/i.test(raw)){
    parts.push('Supabase 공개키가 맞지 않습니다. Vercel 환경변수의 VITE_SUPABASE_ANON_KEY를 확인해 주세요.');
  }else{
    parts.push(raw);
  }
  return [...new Set(parts.filter(Boolean))].join('\n');
}
function authRedirectUrl(){
  const {origin,pathname}=window.location;
  return `${origin}${pathname}`;
}
function normalizeEmail(email){return String(email||'').trim().toLowerCase();}
function readAuthSession(){
  try{return JSON.parse(localStorage.getItem(AUTH_STORAGE)||'null')}catch{return null}
}
function writeAuthSession(session){
  try{localStorage.setItem(AUTH_STORAGE,JSON.stringify(session||null))}catch{}
}
function clearAuthSession(){
  try{localStorage.removeItem(AUTH_STORAGE)}catch{}
}
function parseAuthHash(){
  const raw=window.location.hash||'';
  if(!raw.includes('access_token='))return null;
  const params=new URLSearchParams(raw.replace(/^#/,''));
  const access_token=params.get('access_token');
  const refresh_token=params.get('refresh_token');
  const expires_in=Number(params.get('expires_in')||3600);
  const token_type=params.get('token_type')||'bearer';
  if(!access_token)return null;
  history.replaceState(null,'',window.location.pathname+window.location.search);
  return {access_token,refresh_token,token_type,expires_at:Date.now()+expires_in*1000};
}
async function apiPost(path,payload){
  const res=await fetch(path,{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify(payload||{})
  });
  let data=null;
  try{data=await res.json()}catch{}
  if(!res.ok){
    const err=new Error(data?.detail||data?.error||`API 요청 실패: ${res.status}`);
    err.status=res.status;
    err.data=data;
    throw err;
  }
  return data;
}

async function submitBetaApplication(payload){
  return apiPost('/api/beta-apply',payload);
}
async function loadBetaApplications(passcode){
  return apiPost('/api/beta-list',{passcode});
}
async function updateBetaApplication(passcode,id,action){
  return apiPost('/api/approve-beta',{passcode,id,action});
}

async function listCloudDocuments(session){
  return apiPost('/api/user-docs',{action:'list',access_token:session?.access_token});
}
async function saveCloudDocument(session,payload){
  return apiPost('/api/user-docs',{action:'save',access_token:session?.access_token,...payload});
}
async function loadCloudDocument(session,id){
  return apiPost('/api/user-docs',{action:'load',access_token:session?.access_token,id});
}
async function deleteCloudDocument(session,id){
  return apiPost('/api/user-docs',{action:'delete',access_token:session?.access_token,id});
}

async function requestLoginEmail(email){
  const clean=normalizeEmail(email);
  if(!clean)throw new Error('이메일을 입력해 주세요.');
  return apiPost('/api/send-login-link',{email:clean,redirectTo:authRedirectUrl()});
}

async function requestAccessLogin(email, accessCode){
  const clean=normalizeEmail(email);
  if(!clean)throw new Error('이메일을 입력해 주세요.');
  if(!String(accessCode||'').trim())throw new Error('접속코드를 입력해 주세요.');
  return apiPost('/api/access-login',{mode:'login',email:clean,access_code:String(accessCode||'').trim()});
}
async function verifyAccessSession(session){
  const token=String(session?.access_token||'').trim();
  if(!token)throw new Error('저장된 접속 세션이 없습니다.');
  return apiPost('/api/access-login',{mode:'verify',access_token:token});
}

async function requestRefreshSession(session){
  const refreshToken=String(session?.refresh_token||'').trim();
  if(!refreshToken)throw new Error('저장된 갱신 토큰이 없습니다. 다시 로그인해 주세요.');
  const data=await apiPost('/api/refresh-session',{refresh_token:refreshToken});
  const next=data?.session||data;
  if(!next?.access_token)throw new Error('세션 갱신 응답이 올바르지 않습니다.');
  return {
    access_token:next.access_token,
    refresh_token:next.refresh_token||refreshToken,
    token_type:next.token_type||session?.token_type||'bearer',
    expires_at:Date.now()+Number(next.expires_in||3600)*1000,
    user:next.user||null
  };
}
function sessionNeedsRefresh(session){
  const expiresAt=Number(session?.expires_at||0);
  if(!session?.access_token)return false;
  if(!session?.refresh_token)return false;
  if(!expiresAt)return false;
  return Date.now()>expiresAt-5*60*1000;
}
async function getFreshSession(session){
  if(sessionNeedsRefresh(session)){
    const refreshed=await requestRefreshSession(session);
    writeAuthSession(refreshed);
    return refreshed;
  }
  return session;
}
async function getAuthUser(session){
  const data=await apiPost('/api/auth-user',{access_token:session?.access_token});
  return data?.user;
}
async function checkAllowedBuyer(email,session){
  const data=await apiPost('/api/check-buyer',{access_token:session?.access_token});
  return data?.buyer||null;
}

const PWA_DISMISSED_STORAGE='church-docs-kit-basic-v1-pwa-dismissed';
function shouldShowPwaHelp(){
  try{return localStorage.getItem(PWA_DISMISSED_STORAGE)!=='1'}catch{return true}
}
function dismissPwaHelp(){
  try{localStorage.setItem(PWA_DISMISSED_STORAGE,'1')}catch{}
}
function appHomeUrl(){
  const {origin,pathname}=window.location;
  return `${origin}${pathname}`;
}
async function copyTextToClipboard(text){
  if(navigator.clipboard?.writeText){
    await navigator.clipboard.writeText(text);
    return true;
  }
  const el=document.createElement('textarea');
  el.value=text;
  el.setAttribute('readonly','');
  el.style.position='fixed';
  el.style.left='-9999px';
  document.body.appendChild(el);
  el.select();
  try{return document.execCommand('copy')}finally{document.body.removeChild(el)}
}
function usePwaInstallPrompt(){
  const [promptEvent,setPromptEvent]=useState(null);
  const [installed,setInstalled]=useState(false);
  useEffect(()=>{
    const onBeforeInstall=(e)=>{e.preventDefault();setPromptEvent(e);};
    const onInstalled=()=>{setInstalled(true);setPromptEvent(null);dismissPwaHelp();};
    window.addEventListener('beforeinstallprompt',onBeforeInstall);
    window.addEventListener('appinstalled',onInstalled);
    if(window.matchMedia?.('(display-mode: standalone)')?.matches)setInstalled(true);
    return ()=>{
      window.removeEventListener('beforeinstallprompt',onBeforeInstall);
      window.removeEventListener('appinstalled',onInstalled);
    };
  },[]);
  async function install(){
    if(!promptEvent)return false;
    promptEvent.prompt();
    const choice=await promptEvent.userChoice.catch(()=>null);
    setPromptEvent(null);
    if(choice?.outcome==='accepted'){setInstalled(true);dismissPwaHelp();return true;}
    return false;
  }
  return {promptEvent,installed,install};
}
function PwaInstallBanner(){
  const [visible,setVisible]=useState(shouldShowPwaHelp());
  const [copied,setCopied]=useState(false);
  const {promptEvent,installed,install}=usePwaInstallPrompt();
  if(!visible||installed)return null;
  const homeUrl=appHomeUrl();
  const close=()=>{dismissPwaHelp();setVisible(false)};
  async function copyHomeUrl(){
    try{
      await copyTextToClipboard(homeUrl);
      setCopied(true);
      setTimeout(()=>setCopied(false),1800);
    }catch{
      alert(`아래 주소를 복사해 주세요.\n\n${homeUrl}`);
    }
  }
  return <div className="pwa-banner">
    <div>
      <b>이 기기에서 계속 사용할 주소입니다</b>
      <p>최초 로그인 후에는 세션이 자동 갱신됩니다. 개인 기기에서는 로그아웃하지 말고 이 주소를 홈 화면/즐겨찾기에 저장해 주세요.</p>
      <div className="shortcut-url"><code>{homeUrl}</code></div>
      <details>
        <summary>바로가기 만드는 방법</summary>
        <ul>
          <li>먼저 <b>작성기 주소 복사</b>를 눌러 주소를 저장해 두세요.</li>
          <li>Chrome/Edge: 주소창 오른쪽 설치 아이콘 또는 메뉴 → 앱 설치</li>
          <li>Safari Mac: 공유 버튼 → Dock에 추가 또는 책갈피 추가</li>
          <li>iPhone/iPad: 공유 버튼 → 홈 화면에 추가</li>
        </ul>
      </details>
    </div>
    <div className="pwa-actions">
      <button className="pwa-copy" onClick={copyHomeUrl}>{copied?'주소 복사됨':'작성기 주소 복사'}</button>
      {promptEvent&&<button className="pwa-install" onClick={install}>이 기기에 설치</button>}
      <button className="pwa-dismiss" onClick={close}>닫기</button>
    </div>
  </div>;
}

function AuthGate({children}){
  const [status,setStatus]=useState('checking');
  const [email,setEmail]=useState('');
  const [buyer,setBuyer]=useState(null);
  const [message,setMessage]=useState('');
  const [error,setError]=useState('');
  const [errorDetail,setErrorDetail]=useState('');
  const [session,setSession]=useState(null);
  const [formEmail,setFormEmail]=useState('');
  const [accessCode,setAccessCode]=useState('');
  const [copiedAddress,setCopiedAddress]=useState(false);

  useEffect(()=>{
    let cancelled=false;
    async function boot(){
      setStatus('checking');
      setError('');
      try{
        // 기존 Magic Link 해시가 남아 있어도 BASIC 1.25에서는 사용하지 않습니다.
        if(window.location.hash?.includes('access_token=')) history.replaceState(null,'',window.location.pathname+window.location.search);
        const saved=readAuthSession();
        if(!saved?.access_token||saved?.token_type!=='app'){setStatus('signedOut');return;}
        const data=await verifyAccessSession(saved);
        if(cancelled)return;
        const nextSession=data?.session||saved;
        writeAuthSession(nextSession);
        setSession(nextSession);
        setEmail(normalizeEmail(data?.email||data?.buyer?.email||nextSession?.user?.email));
        setBuyer(data?.buyer||null);
        setStatus('allowed');
      }catch(e){
        if(cancelled)return;
        console.warn('접속 세션 확인 실패',e);
        clearAuthSession();
        setSession(null);setEmail('');setBuyer(null);setStatus('signedOut');
      }
    }
    boot();
    return ()=>{cancelled=true};
  },[]);

  async function loginWithCode(e){
    e?.preventDefault?.();
    setError('');setErrorDetail('');setMessage('');
    const clean=normalizeEmail(formEmail);
    if(!clean){setError('승인된 이메일을 입력해 주세요.');return;}
    if(!accessCode.trim()){setError('관리자에게 받은 접속코드를 입력해 주세요.');return;}
    setStatus('sending');
    try{
      const data=await requestAccessLogin(clean,accessCode);
      const nextSession=data?.session;
      if(!nextSession?.access_token)throw new Error('접속 세션을 만들지 못했습니다.');
      writeAuthSession(nextSession);
      setSession(nextSession);
      setEmail(normalizeEmail(data?.email||clean));
      setBuyer(data?.buyer||null);
      setStatus('allowed');
      setMessage('접속되었습니다. 개인 PC와 본인 휴대폰에서는 로그아웃하지 말고 창만 닫아 주세요.');
    }catch(e){
      console.error(e);
      setStatus('signedOut');
      setError('접속에 실패했습니다. 이메일 승인 여부와 접속코드를 확인해 주세요.');
      setErrorDetail(readableSupabaseError(e));
    }
  }

  async function copyAppAddress(){
    try{
      await copyTextToClipboard(appHomeUrl());
      setCopiedAddress(true);
      setTimeout(()=>setCopiedAddress(false),1800);
    }catch{
      alert(`아래 작성기 주소를 복사해 주세요.\n\n${appHomeUrl()}`);
    }
  }

  function signOut(){
    clearAuthSession();
    setSession(null);setBuyer(null);setEmail('');setMessage('');setError('');setErrorDetail('');setStatus('signedOut');
  }

  if(status==='checking')return <div className="auth-screen"><div className="auth-card"><div className="auth-logo">✚</div><h1>교회문서키트 BASIC</h1><p>접속 권한을 확인하고 있습니다.</p></div></div>;
  if(status==='notAllowed')return <div className="auth-screen"><div className="auth-card"><div className="auth-logo">✚</div><h1>등록된 구매자 이메일이 아닙니다</h1><p><b>{email}</b></p><p>구매 또는 베타 승인된 이메일로 다시 접속해 주세요.</p><div className="auth-actions"><button onClick={signOut}>다른 이메일로 접속</button></div></div></div>;
  if(status==='signedOut'||status==='sending')return <div className="auth-screen"><form className="auth-card" onSubmit={loginWithCode}><div className="auth-logo">✚</div><h1>교회문서키트 BASIC 작성기</h1><p>모바일에서 메일 로그인 문제가 반복되어, 베타 기간에는 <b>승인 이메일 + 접속코드</b> 방식으로 들어갑니다. 메일을 열지 않아도 됩니다.</p><label className="auth-field"><span>승인된 이메일</span><input type="email" value={formEmail} onChange={e=>setFormEmail(e.target.value)} placeholder="name@example.com" autoComplete="email" disabled={status==='sending'}/></label><label className="auth-field"><span>접속코드</span><input type="password" value={accessCode} onChange={e=>setAccessCode(e.target.value)} placeholder="관리자에게 받은 접속코드" autoComplete="current-password" disabled={status==='sending'}/></label><button className="auth-primary" disabled={status==='sending'}>{status==='sending'?'확인 중…':'접속하기'}</button><div className="auth-mobile-help"><b>모바일 안내</b><ol><li>휴대폰에서도 같은 주소로 접속합니다.</li><li>승인된 이메일과 접속코드만 입력하면 됩니다.</li><li>개인 기기에서는 로그아웃하지 말고 창만 닫아 주세요.</li></ol></div>{message&&<div className="auth-message">{message}</div>}{error&&<div className="auth-error">{error}{errorDetail&&<><br/><br/><b>상세 오류</b><br/>{errorDetail}</>}</div>}<details className="auth-debug"><summary>관리자용 설정 확인</summary><p>인증 방식: <code>{AUTH_DEBUG_INFO.mode}</code></p><p>설명: <code>{AUTH_DEBUG_INFO.note}</code></p><p>필요 환경변수: <code>BETA_ACCESS_CODE</code></p></details><small>관리자는 Vercel 환경변수에 BETA_ACCESS_CODE를 추가해 주세요. 이 값이 베타테스터 공통 접속코드가 됩니다.</small></form></div>;
  const authInfo={email,buyer,session,signOut};
  return <><div className="auth-user-bar"><span><b>{buyer?.church_name||'사용자'}</b> · {email} · {buyer?.plan||'basic'}<em>이 기기 자동 접속 유지 중</em></span><button className="auth-copy" onClick={copyAppAddress}>{copiedAddress?'주소 복사됨':'작성기 주소 복사'}</button><button className="auth-logout" onClick={()=>{if(confirm('공용 PC에서 사용을 마치셨나요? 로그아웃하면 이 기기에서는 다음 접속 시 이메일과 접속코드를 다시 입력해야 합니다. 개인 기기라면 로그아웃하지 않는 것을 권장합니다.'))signOut();}}>공용 PC에서 로그아웃</button></div><PwaInstallBanner />{React.isValidElement(children)?React.cloneElement(children,{auth:authInfo}):children}</>;
}

const DEPARTMENTS=['선교부','교육부','문화부','예배부','사회봉사부','관리부','재정부','속회','소그룹','청년부','기타'];
const EDU_DEPTS=['영아부','유치부','초등부','청소년부','청년부'];
const REPORT_DEPT_OPTIONS=['영아부','유치부','초등부','청소년부','청년부','장년부','남선교회','여선교회','예배부','찬양팀','선교부','문화부','사회봉사부','관리부','재정부','속회','소그룹','기타'];
const DEFAULT_WEEKLY_UNITS=['영아부','유치부','초등부','청소년부','청년부'];
function makeId(prefix='id'){return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`}
function weeklyUnitRow(name='',attendance='',thisWeek='',nextWeek='',special='',id=''){return {id:id||makeId('unit'),name,attendance,thisWeek,nextWeek,special}}
function weeklyUnitRows(doc){
  if(Array.isArray(doc?.weeklyUnitRows)&&doc.weeklyUnitRows.length){
    return doc.weeklyUnitRows.filter(Boolean).map((r,i)=>({
      id:r.id||`unit-${i+1}`,
      name:(r.name ?? ''),
      attendance:r.attendance||'',
      thisWeek:r.thisWeek??r.this??'',
      nextWeek:r.nextWeek??r.next??'',
      special:r.special||''
    }));
  }
  const units=Array.isArray(doc?.weeklyUnits)&&doc.weeklyUnits.length?doc.weeklyUnits.filter(Boolean):DEFAULT_WEEKLY_UNITS;
  return units.map((name,i)=>weeklyUnitRow(name,doc?.[`${name}_attendance`]||'',doc?.[`${name}_this`]||'',doc?.[`${name}_next`]||'',doc?.[`${name}_special`]||'',`legacy-${i+1}`));
}
function nextWeeklyUnitName(rows){return ''}
function patchWeeklyUnitRows(doc,rows){return {...doc,weeklyUnitRows:rows,weeklyUnits:rows.map(r=>r.name??'')}}
const THEMES={
  '클래식 네이비':{primary:'#0b2d5c',accent:'#2f6fad',soft:'#eef6ff',paper:'#ffffff'},
  '부드러운 베이지':{primary:'#6b3f16',accent:'#d97706',soft:'#fff7ed',paper:'#fffaf3'},
  '파스텔 블루':{primary:'#1d4ed8',accent:'#60a5fa',soft:'#eff6ff',paper:'#ffffff'},
  '내추럴 그린':{primary:'#14532d',accent:'#2f855a',soft:'#ecfdf5',paper:'#fbfffb'},
  '모던 그레이':{primary:'#1f2937',accent:'#64748b',soft:'#f1f5f9',paper:'#ffffff'},
  '포인트 퍼플':{primary:'#4c1d95',accent:'#8b5cf6',soft:'#f5f3ff',paper:'#ffffff'}
};
const PRESET_META={
  '행정 보고형':{className:'admin',desc:'보고서·회의자료용. 흰 배경, 얇은 선, 정돈된 표 중심'},
  '카톡 공지형':{className:'kakao',desc:'카카오톡 공유용. 과한 장식은 줄이고 큰 제목·선명한 일정카드 중심'},
  '월간 일정형':{className:'monthly',desc:'월간행사 안내용. 일정 카드와 하단 안내 섹션 흐름 최적화'},
  '수련회 기획형':{className:'retreat',desc:'행사기획안용. 목적·개요·일정·예산이 구분되는 기획서형'},
  '예산 정리형':{className:'budget',desc:'예산안·정산용. 금액과 합계가 잘 보이는 표 중심'},
  '큐시트 진행형':{className:'cue',desc:'예배·행사 진행용. 시간과 담당자가 한눈에 보이는 진행표형'},
  '교육 자료형':{className:'education',desc:'세미나·교사교육용. 질문·핵심문장·나눔이 부드럽게 보이는 형식'},
  '행사 포스터형':{className:'poster',desc:'홍보·안내용. 제목과 날짜를 크게 보여주는 포스터형'}
};
const DESIGN_PRESETS=Object.fromEntries(Object.entries(PRESET_META).map(([k,v])=>[k,v.desc]));
const PRESET_STYLES={
  '행정 보고형':{theme:'모던 그레이',primary:'#1f2937',accent:'#64748b',soft:'#f8fafc',paper:'#ffffff'},
  '카톡 공지형':{theme:'클래식 네이비',primary:'#0b2d5c',accent:'#38bdf8',soft:'#f0f7ff',paper:'#ffffff'},
  '월간 일정형':{theme:'클래식 네이비',primary:'#0b2d5c',accent:'#2f6fad',soft:'#eef6ff',paper:'#ffffff'},
  '수련회 기획형':{theme:'내추럴 그린',primary:'#14532d',accent:'#2f855a',soft:'#ecfdf5',paper:'#fbfffb'},
  '예산 정리형':{theme:'모던 그레이',primary:'#111827',accent:'#475569',soft:'#f1f5f9',paper:'#ffffff'},
  '큐시트 진행형':{theme:'클래식 네이비',primary:'#0f172a',accent:'#334155',soft:'#f8fafc',paper:'#ffffff'},
  '교육 자료형':{theme:'부드러운 베이지',primary:'#6b3f16',accent:'#d97706',soft:'#fff7ed',paper:'#fffaf3'},
  '행사 포스터형':{theme:'포인트 퍼플',primary:'#4c1d95',accent:'#8b5cf6',soft:'#f5f3ff',paper:'#ffffff'}
};
function basicUnifiedStyle(fontScale=100){return {theme:'클래식 네이비',preset:'행정 보고형',...THEMES['클래식 네이비'],fontScale}}
function presetStylePatch(p){const name=normalizePreset(p);return {preset:name,...(PRESET_STYLES[name]||{})}}

const LEGACY_PRESETS={
  card:'행정 보고형',minimal:'행정 보고형',soft:'교육 자료형',formal:'행정 보고형',modern:'행사 포스터형',notice:'카톡 공지형',warm:'교육 자료형',
  '단정 카드형':'행정 보고형','깔끔 보고서형':'행정 보고형','부드러운 안내형':'교육 자료형','격식 회의록형':'행정 보고형','모던 포인트형':'행사 포스터형','공지 배너형':'카톡 공지형','따뜻한 카드형':'교육 자료형'
};
function normalizePreset(p){return PRESET_META[p]?p:(LEGACY_PRESETS[p]||'행정 보고형')}
function presetClass(p){return PRESET_META[normalizePreset(p)]?.className||'card'}
const ICON_OPTIONS=['📌','🙏','🎤','🎵','☕','🍱','🎲','📖','🚌','🛏️','✅','✨','👥','🕊️','⛪','🏃','💬','📋','🧭','🌿','🔥'];
const PREP_CATEGORIES=['물품','세팅','인력','홍보','행정','식사','안전','기타'];
const CUE_DOC='예배 및 행사 큐시트';
const LEGACY_CUE_TYPES=['특별예배 큐시트','특별행사 진행 큐시트'];
function isCueType(type){return type===CUE_DOC||LEGACY_CUE_TYPES.includes(type)}
const BASIC_DOC_TYPES=['기본 공지 안내문','각부 월간행사 안내','부서별 주간보고서','부서 통합 주간보고서','행사 및 수련회 기획안'];
const CATEGORIES=[
  {name:'교회문서키트 BASIC', types:BASIC_DOC_TYPES}
];
const DOC_TYPES=CATEGORIES.flatMap(c=>c.types);
const BUNDLE_DOC_TYPES=BASIC_DOC_TYPES;
function defaultBundleFor(type){
  return BASIC_DOC_TYPES.includes(type)?[type]:['기본 공지 안내문'];
}
const DEFAULT_LABELS={
  '기본 공지 안내문':['공지 개요','안내 내용','확인 및 협조','문의'],
  '회의자료':['회의 개요','지난 결정사항 점검','부서별 보고','주요 안건','일정 확인','예산/지원 요청','결정사항 및 역할분담','기도제목'],
  '연말/연차 부서 보고서':['부서 개요','한 해 주요 사역','출석/참여 현황','예산 집행 요약','평가','다음 해 계획'],
  '지출결의서':['기본 정보','지출 내역','증빙 및 지급','결재'],
  '차량/장소 사용 신청서':['신청 정보','사용 정보','확인 사항','승인'],
  '각부 월간행사 안내':['월간 핵심 일정','부서/모임별 참고 일정','확인 및 협조 요청','기도 제목'],
  '주간 공지':['이번 주 주요 공지','확인사항','기도제목'],
  '부서 통합 주간보고서':['전체 주간 활동 요약','부서별 주간 현황','공동 기도제목','공유/지원 요청'],
  '부서별 주간보고서':['예배/모임 현황','이번 주 활동','다음 주 계획','특이사항 및 지원 요청','기도제목'],
  '7개부서 보고서':['이번 주 주요 활동','특이사항 및 요청사항','다음 주 활동 계획','기도제목'],
  '기획위원회 보고서':['보고 요약','주요 안건','결의 및 진행사항','요청사항','기도제목'],
  '행사 및 수련회 기획안':['행사 목적','행사 개요','담당 및 역할','준비사항','일정표','수입·지출 예산안'],
  '세부 프로그램 문서':['프로그램 개요','목적/기대효과','진행 방법','준비물 및 세팅','진행 순서','유의사항'],
  '행사 결과 보고서':['행사 개요','진행 결과','참석 및 재정 보고','잘된 점과 보완점','후속 조치 및 요청'],
  '공문/협조 요청서':['문서 개요','요청 배경','협조 요청 내용','진행 일정','회신 및 문의'],
  '심방 보고서':['심방 개요','심방 내용','기도제목','후속 돌봄 계획','비고'],
  '예산안':['산출 근거','수입 계획','지출 계획','비고 및 확인사항'],
  '회의록':['회의 정보','안건','논의 내용','결의 사항','확인 및 서명'],
  '일정표':['일정 기본 정보','시간표','안내사항'],
    '세미나/교육자료':['자료 소개','교육 목표','진행 흐름','핵심 문장','나눔 질문','메모/안내'],
  [CUE_DOC]:['예배/행사 개요','진행 큐시트','진행/방송 체크','진행 유의사항'],
  '부서행사 진행표(캘린더형)':['월간 달력','안내사항'],
  '준비목록':['준비 개요','준비물 체크리스트','담당자별 확인','비고'],
  '만족도 조사':['조사 목적','객관식 문항','주관식 문항','안내'],
  '신청서 양식':['신청 안내','신청자 정보','신청 내용','안내사항','개인정보 동의 및 서명'],
  '기본 설정':['기본 정보','기본 문구','디자인 기본값']
};

function blank(v){return String(v??'').trim()||'-'}
function lines(v){const a=String(v??'').split(NL).map(s=>s.trim()).filter(Boolean);return a.length?a:['-']}
function num(v){const n=Number(String(v??'').replace(/[^0-9.-]/g,''));return Number.isFinite(n)?n:0}
function won(v){return `${Number(v||0).toLocaleString('ko-KR')}원`}
function sanitize(name){return String(name||'교회문서').replace(/[\\/:*?"<>|]/g,'-').slice(0,60)}
function budgetRow(){return {item:'',detail:'',amount:'',qty:'',price:'',note:''}}
function budgetAmount(r){const amountText=String(r?.amount??'').trim();if(amountText!=='')return num(amountText);const price=num(r?.price);const qtyText=String(r?.qty??'').trim();const qty=qtyText?num(qtyText):1;return price*qty}
function budgetTotal(rows){return (rows||[]).reduce((s,r)=>s+budgetAmount(r),0)}
function eventRow(){return {date:'',time:'',title:'',place:'',target:'',content:''}}
function deptRow(){return {name:'',note:''}}
function schedRow(day='1일차'){return {day,start:'09:00',end:'10:00',icon:'',title:'',place:'',memo:''}}
function programRow(n=1){return {name:n===1?'센터학습':'새 프로그램',time:'40분',target:'참가자 전체',leader:'담당자',place:'',goal:'프로그램의 목적과 기대 효과를 입력하세요.',method:'1. 도입 설명\n2. 활동 진행\n3. 조별 나눔\n4. 마무리 정리',materials:'활동지, 필기도구, 타이머, 스티커',setup:'책상 배치, 조별 자리, 안내 화면 준비',order:'5분 - 활동 안내\n25분 - 활동 진행\n10분 - 나눔 및 정리',note:'안전과 참여 분위기를 확인하며 진행합니다.'}}
function qRow(){return {question:'',options:'매우 만족\n만족\n보통\n아쉬움'}}
function cueRow(time='',part='',content='',person='',tech='',ready='',note=''){return {time,part,content,person,tech,ready,note}}
function prepRow(item='',owner='',due='',status='준비중',note='',category='물품'){return {category,item,owner,due,status,note}}
function meetingDecisionRow(){return {decision:'',owner:'',status:'',memo:''}}
function meetingDeptReportRow(dept=''){return {dept,report:'',request:'',prayer:''}}
function meetingAgendaRow(){return {agenda:'',detail:'',decisionNeeded:'',memo:''}}
function meetingScheduleRow(){return {date:'',event:'',dept:'',prep:''}}
function meetingSupportRow(){return {dept:'',content:'',amount:'',decision:''}}
function meetingActionRow(){return {action:'',owner:'',due:'',checked:''}}
function annualMinistryRow(){return {month:'',ministry:'',participants:'',note:''}}
function annualBudgetRow(){return {category:'',budget:'',spent:'',balance:'',note:''}}
function expenditureRow(){return {item:'',detail:'',qty:'',price:'',note:''}}
function useCheckRow(){return {item:'',checked:'',memo:''}}
function calendarRow(date='2026-06-07',icon='',title='',memo=''){const d=String(date||'');const day=d.includes('-')?String(Number(d.split('-')[2]||1)):'';return {date,day,icon,title,memo}}
function calendarDay(item){const direct=Number(item?.day);if(Number.isFinite(direct)&&direct>0)return direct;const d=String(item?.date||'');if(/^\d{4}-\d{2}-\d{2}$/.test(d))return Number(d.slice(-2));return 1}
function daysInMonth(ym){const [y,m]=parseMonth(ym).split('-').map(Number);return new Date(y,m,0).getDate()}
function dateFromMonthDay(month,day){const ym=/^\d{4}-\d{2}$/.test(String(month||''))?String(month):'2026-06';const max=daysInMonth(ym);const n=Math.max(1,Math.min(max,Number(day)||1));return `${ym}-${String(n).padStart(2,'0')}`}
function parseMonth(v){const s=String(v||'').trim();let m=s.match(/(\d{4})\s*[-년./]\s*(\d{1,2})/);if(m){const yy=Number(m[1]);const mm=Math.max(1,Math.min(12,Number(m[2])));return `${yy}-${String(mm).padStart(2,'0')}`;} if(/^\d{4}-\d{2}$/.test(s))return s; return '2026-06'}
function normalizeCalRows(rows,month){return (rows||[]).map(r=>{const day=calendarDay(r);return {...r,day:String(day),date:dateFromMonthDay(month||String(r?.date||'').slice(0,7),day)}})}
function labelsFor(type){return DEFAULT_LABELS[type]||['내용']}
function defaultStyleFor(type){
  return basicUnifiedStyle(100);
}
function baseExtras(type){return {labels:Object.fromEntries(labelsFor(type).map((v,i)=>[i,v])), breaks:{}, hiddenSections:{}, style:defaultStyleFor(type)}}
function normalizeLabels(type,labels){
  const out={...(labels||{})};
  if(type==='행사 및 수련회 기획안'){
    ['행사 목적','행사 개요','담당 및 역할','준비사항','일정표','수입·지출 예산안'].forEach((label,i)=>{out[i]=label});
  }
  if(type==='세부 프로그램 문서'){
    ['프로그램 개요','목적/기대효과','진행 방법','준비물 및 세팅','진행 순서','유의사항'].forEach((label,i)=>{out[i]=label});
  }
  if(isCueType(type)){
    ['예배/행사 개요','진행 큐시트','진행/방송 체크','진행 유의사항'].forEach((label,i)=>{out[i]=label});
  }
  return out;
}
function withBase(type,d){
  const b=baseExtras(type);
  const style={...b.style,...(d?.style||{})};
  style.preset=normalizePreset(style.preset);
  // BASIC 1.0.7: 세 문서의 기본 디자인 결을 하나로 맞춥니다.
  // 이전 버전에서 월간행사 안내만 '월간 일정형'으로 저장된 경우에도 기본 네이비 행정형으로 복구합니다.
  if(type==='각부 월간행사 안내' && normalizePreset(d?.style?.preset)==='월간 일정형'){
    Object.assign(style,basicUnifiedStyle(style.fontScale||100));
  }
  const labels=normalizeLabels(type,{...b.labels,...(d?.labels||{})});
  return {...b,...d,labels,breaks:{...b.breaks,...(d?.breaks||{})},hiddenSections:{...b.hiddenSections,...(d?.hiddenSections||{})},customSections:Array.isArray(d?.customSections)?d.customSections:b.customSections,style}
}

function initialData(type){
  if(type==='기본 설정') return {church:'우리교회',defaultGroup:'교육부',manager:'김선규 목사',contact:'문의: 담당 교역자 김선규 목사',footer:'',style:{theme:'클래식 네이비',preset:'행정 보고형',...THEMES['클래식 네이비'],fontScale:100}};
  if(type==='기본 공지 안내문') return {title:'교회학교 부장단 회의 안내',target:'교회학교 부장단 및 부서장',date:'2026년 7월 12일(주일) 오후 1시 30분',place:'교육관 회의실',content:'7월 교회학교 사역 일정과 여름행사 준비 상황을 함께 확인합니다. 각 부서는 참석 인원, 준비사항, 지원 요청 내용을 간단히 정리해 참석해 주세요.',requests:`각 부서별 보고 내용을 3줄 이내로 준비해 주세요.
여름행사 관련 예산·차량·공간 요청사항을 미리 정리해 주세요.
회의 시작 5분 전까지 착석을 부탁드립니다.`,contact:'문의: 담당자',footer:'다음세대 사역을 위해 함께 기도하며 준비하겠습니다.'};
  if(type==='회의자료') return {title:'교회학교 부장단 회의자료',meetingType:'교회학교 부장단',date:'2026년 7월 12일(주일) 오후 1시 30분',place:'교육관 회의실',attendees:'담당 교역자, 교육부장, 각 부서 부장 및 총무',writer:'교육부 서기',purpose:'7월 교회학교 사역 현황을 공유하고 여름사역 준비와 지원사항을 함께 점검합니다.',decisions:[{decision:'여름행사 부서별 일정은 7월 첫째 주까지 최종 공유',owner:'각 부서 부장',status:'진행중',memo:'공유 양식 통일 필요'},{decision:'전체 기도회는 둘째 주 금요일 저녁 진행',owner:'교육부',status:'확정',memo:'장소 본당'}],deptReports:[meetingDeptReportRow('영아부'),meetingDeptReportRow('유치부'),meetingDeptReportRow('초등부'),meetingDeptReportRow('청소년부'),meetingDeptReportRow('청년부')].map((r,i)=>({...r,report:['부모 동반 예배와 놀이 활동 진행','여름성경학교 찬양 연습 시작','말씀암송 활동과 조별 모임 진행','수련회 신청 독려 및 리더 모임','청년부 수련회 역할분담 논의'][i]||'',request:['보조교사 지원','활동 재료비 확인','간식 준비 협조','차량 배차 확인','숙소 최종 확인'][i]||'',prayer:['새가정 정착','교사들의 지혜','아이들의 말씀 성장','청소년들의 안전','청년 공동체 회복'][i]||''})),agendaItems:[{agenda:'여름사역 준비 점검',detail:'부서별 일정, 장소, 담당자, 예산 사용 계획을 확인합니다.',decisionNeeded:'부서별 최종 제출 기한 확정',memo:''},{agenda:'전체 기도회',detail:'참석 독려, 순서 담당, 기도제목 취합 방식을 논의합니다.',decisionNeeded:'순서 담당 확정',memo:''}],meetingSchedules:[{date:'7/12',event:'부장단 회의',dept:'교육부',prep:'회의자료 확인'},{date:'7/19',event:'전체 기도회',dept:'전체 부서',prep:'기도제목 취합'},{date:'7/26',event:'여름행사 최종 점검',dept:'각 부서',prep:'준비목록 제출'}],supportRequests:[{dept:'초등부',content:'활동 재료 추가 구입',amount:'150,000원',decision:'검토'},{dept:'청소년부',content:'수련회 차량 1대 추가',amount:'',decision:'확인 필요'}],actionItems:[{action:'부서별 예산안 최종 제출',owner:'각 부서 부장',due:'7/14',checked:'미완료'},{action:'기도회 순서 담당 확정',owner:'교육부장',due:'7/16',checked:'진행중'}],prayer:`다음세대가 예배와 말씀 안에서 자라가도록
교사와 부장단이 한마음으로 섬기도록
여름사역이 안전하고 은혜롭게 준비되도록`};
  if(type==='연말/연차 부서 보고서') return {title:'교육부 연말 부서 보고서',department:'교육부',year:'2026년',pastor:'담당 교역자',leader:'교육부장',writer:'교육부 서기',summary:'올해 부서는 교회학교 예배와 교육, 교사 훈련, 여름사역을 중심으로 다음세대 신앙 성장을 돕는 사역을 진행했습니다.',ministries:[{month:'1월',ministry:'신년 교사기도회',participants:'교사 32명',note:'부서별 기도제목 공유'},{month:'5월',ministry:'가정주일 연합예배',participants:'교회학교 전체',note:'부모 참여'},{month:'7월',ministry:'여름성경학교 및 수련회',participants:'각 부서별',note:'안전하게 진행'},{month:'11월',ministry:'교사 격려 모임',participants:'교사 28명',note:'감사 나눔'}],avgAttendance:'평균 출석 128명',maxAttendance:'최대 출석 156명',newFriends:'새친구 14명',attendanceNote:'청소년부와 청년부는 수련회 이후 출석 회복이 있었으며, 영유아부는 부모 동반 예배 참여가 꾸준히 이어졌습니다.',budgetRows:[{category:'교육자료',budget:'1,200,000',spent:'1,050,000',balance:'150,000',note:'공과 및 활동자료'},{category:'여름사역',budget:'4,000,000',spent:'3,850,000',balance:'150,000',note:'부서별 행사'},{category:'교사훈련',budget:'800,000',spent:'760,000',balance:'40,000',note:'세미나 및 식사'}],thanks:'섬기는 이들이 기쁨으로 섬기며 부서 간 협력이 잘 이루어졌습니다. 여름사역 가운데 안전사고 없이 은혜롭게 마무리된 것이 감사 제목입니다.',strengths:`부서별 담당과 역할이 비교적 명확했습니다.
교사 기도회와 준비모임이 사역 집중도를 높였습니다.`,difficulties:`일부 부서의 교사 충원이 필요합니다.
행사 준비 일정이 늦어지는 경우가 있어 사전 공유 체계가 필요합니다.`,improvements:'연초에 연간 일정과 예산 요청을 더 구체적으로 정리하고, 부서별 보고 양식을 통일하면 좋겠습니다.',nextPlan:'다음 해에는 교사훈련 정례화, 부모 소통 강화, 부서별 신앙성장 로드맵 정리를 중점으로 진행합니다.',support:'교사 충원, 공간 사용 조율, 여름사역 예산 증액 검토가 필요합니다.',prayer:`다음세대가 말씀 안에서 자라가도록
섬기는 이들이 지치지 않고 기쁨으로 섬기도록
부모와 교회가 함께 다음세대를 세우도록`};
  if(type==='지출결의서') return {title:'지출결의서',department:'교육부',applicant:'김선규 목사',writeDate:'2026년 7월 10일',useDate:'2026년 7월 12일',purpose:'교회학교 부장단 회의 및 여름사역 준비 물품 구입',paymentMethod:'계좌이체 / 카드 / 현금',receipt:'영수증 첨부 예정',items:[{item:'회의 간식',detail:'부장단 회의 다과',qty:'1',price:'45000',note:'영수증 첨부'},{item:'인쇄물',detail:'회의자료 및 준비목록 출력',qty:'30',price:'300',note:''}],memo:'실제 지출 후 영수증을 첨부하여 재정부에 제출합니다.',approval:'신청자 / 부장 / 담당 교역자 / 재정 담당'};
  if(type==='차량/장소 사용 신청서') return {title:'차량/장소 사용 신청서',requestType:'차량 사용',department:'청년부',applicant:'청년부 회장단',contact:'010-0000-0000',purpose:'청년부 수련회 이동 및 물품 운반',date:'2026년 8월 14일(금) 13:00 ~ 8월 16일(주일) 15:00',placeOrVehicle:'교회 승합차 1대 / 달빛관 세미나실',people:'탑승 9명',driver:'홍길동 집사',route:'교회 → 파주 숙소 → 교회',checks:[{item:'운전자 자격 및 보험 확인',checked:'확인 필요',memo:''},{item:'사용 후 청소 및 반납 확인',checked:'예정',memo:''},{item:'공간 사용 후 정리정돈',checked:'예정',memo:''}],note:'차량 키 수령과 반납 시간을 행정 담당자와 확인합니다. 장소 사용 후 냉난방, 조명, 문단속을 확인합니다.',approval:'신청자 / 부장 / 담당 교역자 / 관리 담당'};
  if(type==='각부 월간행사 안내') return {style:defaultStyleFor('각부 월간행사 안내'),group:'교육부',title:'교육부 7월 월간행사 안내',month:'2026년 7월',events:[{date:'7/6(주일)',time:'오후 1:30',title:'전체 기도회',place:'본당',target:'전체 부서 교사',content:'6월 사역과 다음세대를 위한 기도'},{date:'7/13(주일)',time:'오후 1:30',title:'부서별 여름사역 준비모임',place:'교육관 회의실',target:'담당 교역자, 부장, 부서장',content:'부서별 사역 점검 및 여름행사 준비 논의'},{date:'7/20(주일)',time:'오후 2:00',title:'교사 세미나',place:'소예배실',target:'교육부 교사 전체',content:'교회학교 교사의 역할과 다음세대 이해'},{date:'7/27(주일)',time:'오후 1:30',title:'7월 사역 나눔',place:'청소년부실',target:'부서별 담당 교사',content:'여름성경학교 및 수련회 준비사항 최종 점검'},{date:'7/18(토)-19(주일)',time:'오후 3:00',title:'부서 여름행사',place:'수양관',target:'해당 부서 학생 및 교사',content:'기간형 일정도 날짜와 시간을 따로 입력합니다'}],deptRows:[{name:'영아부',note:'부모 소통 강화'},{name:'유치부',note:'여름성경학교 교사 준비모임'},{name:'초등부',note:'말씀암송 활동 진행'},{name:'청소년부',note:'수련회 준비모임'},{name:'청년부',note:'월말 기도회'}],requests:'부서별 행사 일정과 예산안을 점검해 주세요.\n참석 독려와 준비물 확인을 부탁드립니다.\n역할분담을 미리 정리해 주세요.',prayers:'모든 부서가 한마음으로 사역을 준비하도록\n섬기는 이들이 기쁨으로 감당하도록\n모든 일정이 안전하고 은혜롭게 진행되도록',footer:'',contact:'문의: 담당자',requestsBullet:false,prayersBullet:false};
  if(type==='주간 공지') return {title:'이번 주 교회 사역 공지',period:'2026년 6월 3주',target:'전체 성도',items:[{date:'6/18(수)',title:'수요예배',place:'본당',target:'전교인',content:'저녁 7시 30분에 드립니다.'},{date:'6/21(주일)',title:'부서별 예배 및 모임',place:'각 부서실',target:'각 부서',content:'부서별 담당자는 출석과 특이사항을 확인해 주세요.'}],requests:'주차 안내에 협조해 주세요.\n여름사역 준비를 위해 함께 기도해 주세요.',prayer:'예배와 공동체가 은혜 안에 세워지도록'};
  if(type==='부서 통합 주간보고서'){
    return {
      reportTitle:'교회학교 주간보고서',
      period:'2026년 6월 3주',
      writer:'담당자',
      summary:'이번 주 각 부서는 예배와 모임을 정상적으로 진행했습니다. 여름사역 준비를 위해 부서별 일정, 담당자 배치, 예산 사용 계획을 1차 점검했으며, 다음 주에는 전체 기도회와 부서별 준비모임을 통해 세부 역할을 확정할 예정입니다.',
      weeklyUnitRows:[
        weeklyUnitRow('영아부','12','부모 동반 예배 및 말씀놀이 진행','부모 안내문 발송, 여름성경학교 물품 확인','새가정 1가정 방문, 적응 지원 필요','unit-1'),
        weeklyUnitRow('유치부','24','공과 활동 및 찬양 율동 연습','여름성경학교 찬양곡 선정, 반별 담당 확인','보조교사 1명 추가 지원 요청','unit-2'),
        weeklyUnitRow('초등부','38','말씀암송 활동과 조별 나눔 진행','여름성경학교 조 편성, 준비물 목록 정리','활동 재료 구입 전 예산 확인 필요','unit-3'),
        weeklyUnitRow('청소년부','31','소그룹 나눔 및 수련회 주제 안내','수련회 신청 독려, 찬양팀 연습 시작','신입생 출석 관리와 연락 필요','unit-4'),
        weeklyUnitRow('청년부','28','청년부 예배 후 소그룹 모임 진행','수련회 역할분담표 작성, 기도회 준비','새가족 2명 정착을 위한 식사교제 예정','unit-5')
      ],
      weeklyUnits:[...DEFAULT_WEEKLY_UNITS],
      commonPrayer:'다음세대가 예배와 말씀 안에서 하나님을 인격적으로 만나도록\n섬기는 이들이 지치지 않고 기쁨과 사랑으로 아이들을 섬기도록\n여름성경학교와 수련회 준비 과정에 안전과 지혜를 더하시도록',
      support:'부서별 여름행사 일정과 예산안을 이번 주 안에 최종 확인해 주세요.\n전체 기도회 참석을 각 부서에서 한 번 더 확인해 주세요.\n미정인 봉사자와 차량 지원 여부를 담당자에게 공유해 주세요.'
    };
  }
    if(type==='부서별 주간보고서') return {reportTitle:'부서별 주간보고서',period:'2026년 7월 1주',subDepartment:'청소년부',writer:'담당 교역자',attendance:'24',worship:'주일예배 및 분반공부 진행',thisWeek:`주일예배와 분반공부를 진행했습니다.
여름수련회 참석 신청을 안내했습니다.
새친구 1명이 함께 예배에 참석했습니다.`,nextWeek:`수련회 조편성과 교사 역할을 확정합니다.
학부모 안내문을 발송합니다.
예배 후 교사 준비모임을 진행합니다.`,special:`수련회 참석 인원 확인이 필요합니다.
차량 배차와 식사 준비를 점검해야 합니다.`,prayer:`청소년들이 말씀 안에서 마음을 열도록
섬기는 이들이 기쁨으로 사역을 감당하도록
여름수련회 준비가 안전하고 은혜롭게 진행되도록`};
  if(type==='7개부서 보고서') return {reportTitle:'선교부 보고',period:'2026년 6월 3주',department:'선교부',writer:'부서 담당자',thisWeek:'주일 부서 모임 진행\n하반기 선교사역 논의',special:'지원 요청사항 없음',nextWeek:'선교주일 준비사항 점검',prayer:'맡겨진 사역을 기쁨으로 감당하도록'};
  if(type==='기획위원회 보고서') return {title:'6월 기획위원회 보고서',period:'2026년 6월',writer:'담당 교역자',summary:'6월 주요 사역과 여름사역 준비 현황을 보고드립니다.',agenda:'여름사역 준비 현황\n부서별 예산 집행 계획\n공간 사용 협조 요청',decisions:'부서별 세부 일정은 다음 회의 전까지 제출하기로 함\n예산안은 재정부와 최종 조율하기로 함',requests:'각 부서 일정 공유\n교사 및 봉사자 참석 독려',prayer:'교회 모든 사역이 한마음으로 준비되도록'};
  if(type==='행사 및 수련회 기획안'||type==='행사 기획안'||type==='수련회 계획안') return {title:'청년부 여름수련회 계획안',theme:'어울림 — 함께 어울리고, 하나님께 어울리는 사람',purpose:'청년들이 함께 먹고 웃고 예배하며 서로를 더 깊이 알아가고, 말씀과 기도 안에서 하나님의 자녀와 제자로 부름받은 정체성을 회복하도록 돕는다.',period:'2026년 8월 14일(금)~16일(주일) / 2박 3일',date:'2026년 8월 14일(금)~16일(주일)',place:'파주 살림채 펜션 및 달빛관 세미나실',target:'청년부 20~25명, 담당 교역자 및 리더',program:'오프닝: 키워드 방 선택 프로그램과 팀 빌딩\n말씀과 예배: 저녁집회, 아침묵상, 기도회\n공동체 프로그램: 팀 미션, 방별 체험, 바비큐 교제\n나눔과 적용: 소그룹 나눔, 말씀카드 정리, 결단기도',roles:'총괄: 담당 교역자 — 전체 일정, 말씀, 안전관리\n운영: 회장단 — 접수, 방 배정, 공지\n회계: 총무 — 참가비, 지출, 영수증 정리\n찬양/예배: 찬양팀 — 콘티, 악보, 장비\n프로그램: 리더팀 — 게임 진행, 준비물, 시상',notes:'숙소 예약 및 입퇴실 시간 확인\n참가자 명단, 방 배정, 차량 배차표 작성\n예배 장비와 프로그램 준비물 점검\n식사/간식 계획 및 알레르기 여부 확인\n비상약, 보험, 비상연락망, 안전수칙 안내',preparation:'숙소 예약 및 입퇴실 시간 확인\n참가자 명단, 방 배정, 차량 배차표 작성\n예배 장비와 프로그램 준비물 점검\n식사/간식 계획 및 알레르기 여부 확인\n비상약, 보험, 비상연락망, 안전수칙 안내',scheduleItems:[{day:'1일차',start:'15:00',end:'16:00',icon:'',title:'교회 집결 및 출발',place:'',memo:''},{day:'1일차',start:'16:00',end:'17:00',icon:'',title:'숙소 도착 및 방 배정',place:'',memo:''},{day:'1일차',start:'19:30',end:'21:00',icon:'',title:'저녁예배 1',place:'',memo:''},{day:'2일차',start:'10:00',end:'11:30',icon:'',title:'말씀과 나눔',place:'',memo:''},{day:'2일차',start:'14:00',end:'16:00',icon:'',title:'어울림 공동체 미션',place:'',memo:''},{day:'2일차',start:'19:30',end:'21:30',icon:'',title:'저녁예배 2 및 기도회',place:'',memo:''},{day:'3일차',start:'10:00',end:'11:00',icon:'',title:'감사 나눔 및 정리',place:'',memo:''}],days:['1일차','2일차','3일차'],startHour:'8',endHour:'23',slotMinutes:'60',scheduleFontScale:'105',incomeItems:[{item:'참가비',detail:'청년부 참가비',qty:'25',price:'30000',note:'예상 인원 기준'},{item:'교회지원',detail:'부서 지원',qty:'1',price:'700000',note:'예산안 확인'}],expenseItems:[{item:'숙박',detail:'펜션 및 세미나실 대여',qty:'1',price:'1200000',note:'2박 3일 예상'},{item:'식비',detail:'식사 및 바비큐 준비',qty:'25',price:'35000',note:'1인 기준'},{item:'프로그램',detail:'미션 준비물 및 상품',qty:'1',price:'250000',note:''},{item:'예배/장비',detail:'소모품, 인쇄물, 멀티탭 등',qty:'1',price:'120000',note:''}]};
  if(type==='세부 프로그램 문서') return {title:'수련회 세부 프로그램 문서',period:'2026년 6월 26일(금)~28일(주일)',eventName:'청년부 수련회',manager:'프로그램팀 / 담당 교역자',programs:[{...programRow(1),name:'센터학습',time:'60분',target:'조별 참가자',leader:'센터별 담당 리더',place:'세미나실 및 야외 공간',goal:'참가자들이 말씀과 공동체 주제를 활동으로 경험하고, 조별 대화를 통해 자신의 생각을 정리하도록 돕습니다.',method:'1. 담당자가 센터별 활동 목적을 짧게 설명합니다.\n2. 참가자는 조별로 이동하며 각 센터의 미션을 수행합니다.\n3. 미션 후 활동지에 느낀 점과 적용점을 기록합니다.\n4. 마지막 센터에서 조별 나눔과 기도제목을 정리합니다.',materials:'센터 안내판, 활동지, 필기도구, 스티커, 타이머, 미션 카드, 간단한 상품',setup:'센터별 테이블과 의자를 배치하고, 이동 동선을 미리 표시합니다. 각 센터에는 담당 리더 1명과 진행 물품을 준비합니다.',order:'5분 - 전체 설명 및 이동 안내\n35분 - 센터별 미션 진행\n10분 - 활동지 작성\n10분 - 조별 나눔 및 마무리',note:'동선이 겹치지 않도록 조별 시작 센터를 다르게 배정합니다. 우천 시 실내 센터형으로 전환합니다.'},{...programRow(2),name:'공동체 미션',time:'50분',target:'전체 참가자',leader:'레크리에이션 담당',place:'마당 또는 강당',goal:'서로의 이름과 성향을 자연스럽게 알아가며 공동체 안에서 협력하는 경험을 갖도록 돕습니다.',method:'팀별 미션을 단계적으로 수행하고, 완료 후 진행자에게 확인을 받습니다. 점수보다 참여와 협력을 강조합니다.',materials:'미션지, 팀별 색상 스티커, 필기도구, 점수판, 상품',setup:'팀별 대기 위치와 미션 수행 공간을 구분하고, 진행자용 체크리스트를 준비합니다.',order:'10분 - 팀 구성 및 설명\n30분 - 미션 진행\n10분 - 결과 공유 및 시상',note:'경쟁이 과열되지 않도록 안전 수칙을 먼저 안내합니다.'}]};
  if(type==='행사 결과 보고서') return {title:'청년부 수련회 결과 보고서',eventName:'청년부 여름수련회',period:'2026년 7월 11일(금)~13일(주일)',place:'파주 살림채',writer:'담당 교역자',target:'청년부 및 리더',participants:'참석 24명 / 스태프 5명',summary:'청년부 여름수련회는 “어울림”이라는 주제로 진행되었으며, 예배와 말씀, 공동체 활동을 통해 청년들이 서로를 더 깊이 알아가고 신앙 공동체로 세워지는 시간이 되었습니다.',result:'전체 일정은 큰 사고 없이 진행되었습니다. 개회예배, 말씀집회, 공동체 프로그램, 조별 나눔, 폐회예배가 계획대로 진행되었고, 참여도와 만족도가 전반적으로 높았습니다.',finance:'예산 범위 안에서 집행되었으며, 숙박비와 식비는 계획대로 사용되었습니다. 프로그램 물품비는 일부 절감되었고, 남은 금액은 교육부 회계 기준에 따라 정리 예정입니다.',strengths:'청년들의 참여도가 높았음\n조별 나눔에서 신앙과 삶에 대한 진솔한 대화가 이루어짐\n리더들의 사전 준비와 현장 대응이 안정적이었음',improvements:'이동 시간 안내와 역할분담표 공유가 더 일찍 이루어질 필요가 있음\n프로그램별 준비물 확인표를 사전에 더 구체화할 필요가 있음',followup:'새가족 및 처음 참석한 청년들을 중심으로 후속 식사교제를 진행합니다. 조별 리더는 수련회 이후 2주간 안부 연락과 기도제목 확인을 진행합니다.',requests:'다음 수련회 준비를 위해 예산 편성 시 숙박비 상승분 반영이 필요합니다. 리더 훈련과 사전 기도회 일정을 조금 더 앞당겨 진행할 수 있도록 협조를 요청드립니다.'};
  if(type==='공문/협조 요청서') return {title:'교육부 여름사역 협조 요청서',docNo:'교육부-2026-06',date:'2026년 6월 20일',sender:'담당자',receiver:'각 부서장 및 행정 담당자',subject:'2026년 교육부 여름사역 준비 협조 요청',background:'2026년 교육부 여름사역을 안전하고 은혜롭게 준비하기 위해 부서별 일정, 공간 사용, 차량, 예산 집행 관련 사항을 사전에 조율하고자 합니다.',request:'부서별 여름행사 일정과 장소 사용 계획을 공유해 주시기 바랍니다.\n차량 운행, 방송 장비, 식사 준비 등 협조가 필요한 항목을 미리 알려주시기 바랍니다.\n예산 집행 예정 항목은 재정부 확인 후 진행해 주시기 바랍니다.',schedule:'제출 기한: 2026년 6월 28일(주일)\n확인 회의: 2026년 6월 30일(화) 오후 7시 30분\n최종 공유: 2026년 7월 5일(주일)',reply:'회신 방법: 담당자에게 카카오톡 또는 이메일로 전달\n문의: 담당자',closing:'교회학교와 다음세대 사역을 위해 함께 협력해 주셔서 감사합니다.'};
  if(type==='심방 보고서') return {title:'심방 보고서',date:'2026년 6월 19일(금)',visitor:'담당 교역자',person:'김OO 성도 가정',place:'가정/병원/교회 상담실',typeOfVisit:'정기 심방',summary:'가정의 최근 상황과 신앙생활을 함께 나누고, 예배 회복과 자녀를 위한 기도제목을 확인했습니다. 심방 중 특별한 위기 상황은 없었으며, 지속적인 관심과 격려가 필요합니다.',prayer:'가정의 평안과 건강을 위해\n예배와 말씀 안에서 믿음이 회복되도록\n자녀의 진로와 신앙 성장을 위해',followup:'다음 달 중 안부 연락을 드리고, 필요 시 속회/소그룹 리더와 함께 돌봄을 이어갑니다. 기도제목은 담당 교역자 개인 기록으로 관리합니다.',note:'개인정보와 민감한 내용은 외부 공유를 금하고, 목회 돌봄 목적 안에서만 사용합니다.'};
  if(type==='예산안') return {title:'여름사역 예산안',project:'교육부 여름사역',period:'2026년 7월',target:'교회학교 및 청년부',basis:'참가 예상 인원과 부서별 활동 계획을 기준으로 산출함.',notes:'세부 금액은 실제 견적에 따라 조정 가능',incomeItems:[{item:'교회지원',detail:'교육부 예산 지원',qty:'1',price:'1000000',note:''}],expenseItems:[{item:'간식',detail:'부서별 간식',qty:'100',price:'3000',note:''},{item:'프로그램',detail:'활동 재료비',qty:'1',price:'300000',note:''}]};
  if(type==='회의록') return {meetingName:'교육부 월례회의',dateTime:'2026년 6월 8일(월) 오후 7시 30분',place:'교육관 회의실',attendees:'담당 교역자, 부장, 부서장',presider:'교육부장',recorder:'교육부 서기',purpose:'6월 사역 점검 및 여름행사 준비사항을 논의',agenda:'1. 부서별 사역 보고\n2. 여름행사 준비\n3. 예산안 확인',discussion:'각 부서별 준비 현황을 공유하고 필요한 협조사항을 논의함.',resolution:'부서별 일정과 예산안을 다음 주까지 정리하기',approval:'필요'};
  if(type==='일정표') return {title:'청년부 수련회 일정표',period:'2026년 6월 26일(금)~28일(주일)',place:'파주 살림채',manager:'김선규 목사',scheduleFontScale:'100',startHour:'8',endHour:'23',slotMinutes:'60',days:['1일차','2일차','3일차'],scheduleItems:[{day:'1일차',start:'13:00',end:'14:00',icon:'',title:'출발',place:'',memo:''},{day:'1일차',start:'14:00',end:'15:00',icon:'',title:'예배 및 장소세팅',place:'',memo:''},{day:'1일차',start:'15:00',end:'16:30',icon:'',title:'아이스브레이킹',place:'',memo:''},{day:'1일차',start:'18:00',end:'19:00',icon:'',title:'저녁식사',place:'',memo:''},{day:'1일차',start:'20:00',end:'21:00',icon:'',title:'저녁집회',place:'',memo:''},{day:'2일차',start:'8:00',end:'9:00',icon:'',title:'기상 및 정비',place:'',memo:''},{day:'2일차',start:'9:00',end:'10:00',icon:'',title:'셀프 조식',place:'',memo:''},{day:'2일차',start:'10:00',end:'11:00',icon:'',title:'아침묵상',place:'',memo:''},{day:'2일차',start:'11:00',end:'13:00',icon:'',title:'조별 미션 및 백일장',place:'',memo:''},{day:'2일차',start:'13:00',end:'14:00',icon:'',title:'점심식사',place:'',memo:''},{day:'2일차',start:'14:00',end:'16:00',icon:'',title:'센터학습',place:'',memo:''},{day:'2일차',start:'17:00',end:'18:00',icon:'',title:'나만의 시간(휴식)',place:'',memo:''},{day:'2일차',start:'18:00',end:'19:00',icon:'',title:'바베큐',place:'',memo:''},{day:'2일차',start:'20:00',end:'21:30',icon:'',title:'저녁집회',place:'',memo:''},{day:'3일차',start:'8:00',end:'10:00',icon:'',title:'셀프조식 및 정리',place:'',memo:''},{day:'3일차',start:'10:00',end:'11:00',icon:'',title:'클로징예배',place:'',memo:''},{day:'3일차',start:'11:00',end:'12:00',icon:'',title:'정리 및 퇴실',place:'',memo:''}],notice:'시간과 일정은 현장 상황에 따라 조정될 수 있습니다.'};
  if(false && type==='수련회 계획안') return {title:'청년부 여름수련회 계획안',theme:'어울림 — 함께 어울리고, 하나님께 어울리는 사람',purpose:'청년들이 함께 먹고 웃고 예배하며 서로를 더 깊이 알아가고, 말씀과 기도 안에서 하나님의 자녀와 제자로 부름받은 정체성을 회복하도록 돕는다. 단순한 친교 행사가 아니라 공동체성과 신앙의 방향을 함께 세우는 시간을 목표로 한다.',period:'2026년 8월 14일(금)~16일(주일) / 2박 3일',place:'파주 살림채 펜션 및 달빛관 세미나실',target:'청년부 20~25명, 담당 교역자 및 리더',program:'오프닝: 키워드 방 선택 프로그램과 팀 빌딩\n말씀과 예배: 저녁집회, 아침묵상, 기도회\n공동체 프로그램: 유재석 캠프형 팀 미션, 방별 체험, 바비큐 교제\n나눔과 적용: 소그룹 나눔, 말씀카드 정리, 결단기도\n마무리: 감사 나눔, 사진 기록, 다음 모임 안내',roles:'총괄: 담당 교역자 — 전체 일정, 말씀, 안전관리\n운영: 회장단 — 접수, 방 배정, 공지\n회계: 총무 — 참가비, 지출, 영수증 정리\n찬양/예배: 찬양팀 — 콘티, 악보, 장비\n프로그램: 리더팀 — 게임 진행, 준비물, 시상\n식사/간식: 섬김팀 — 장보기, 배식, 정리',preparation:'숙소 예약 및 입퇴실 시간 확인\n참가자 명단, 방 배정, 차량 배차표 작성\n예배 장비: 마이크, 스피커, 노트북, HDMI, 멀티탭 점검\n프로그램 준비물: 키워드 카드, 팀명 스티커, 미션지, 상품\n식사/간식 계획 및 알레르기 여부 확인\n비상약, 보험, 비상연락망, 안전수칙 안내',scheduleItems:[{day:'1일차',start:'15:00',end:'16:00',icon:'🚌',title:'교회 집결 및 출발',place:'교회',memo:'인원 확인, 차량 배정'},{day:'1일차',start:'16:00',end:'17:00',icon:'🛏️',title:'숙소 도착 및 방 배정',place:'파주 살림채',memo:'짐 정리, 안전 안내'},{day:'1일차',start:'19:30',end:'21:00',icon:'🙏',title:'저녁예배 1',place:'달빛관',memo:'주제 선포와 기도'},{day:'2일차',start:'10:00',end:'11:30',icon:'📖',title:'말씀과 나눔',place:'세미나실',memo:'소그룹 나눔 포함'},{day:'2일차',start:'14:00',end:'16:00',icon:'🎲',title:'어울림 공동체 미션',place:'펜션 전체',memo:'팀별 활동'},{day:'2일차',start:'19:30',end:'21:30',icon:'🔥',title:'저녁예배 2 및 기도회',place:'달빛관',memo:'결단기도'},{day:'3일차',start:'10:00',end:'11:00',icon:'✅',title:'감사 나눔 및 정리',place:'세미나실',memo:'사진 촬영, 귀가 안내'}],incomeItems:[{item:'참가비',detail:'청년부 참가비',qty:'25',price:'30000',note:'예상 인원 기준'},{item:'교회지원',detail:'부서 지원',qty:'1',price:'700000',note:'예산안 확인'}],expenseItems:[{item:'숙박',detail:'펜션 및 세미나실 대여',qty:'1',price:'1200000',note:'2박 3일 예상'},{item:'식비',detail:'식사 및 바비큐 준비',qty:'25',price:'35000',note:'1인 기준'},{item:'간식',detail:'음료, 과자, 야식',qty:'25',price:'8000',note:''},{item:'프로그램',detail:'미션 준비물 및 상품',qty:'1',price:'250000',note:''},{item:'예배/장비',detail:'소모품, 인쇄물, 멀티탭 등',qty:'1',price:'120000',note:''},{item:'예비비',detail:'비상약, 추가 교통 등',qty:'1',price:'150000',note:''}]};
  if(type==='세미나/교육자료') return {title:'세미나/교육자료',subtitle:'다음세대를 세우는 배움의 시간',speaker:'강사/인도자',date:'2026년 6월 14일(주일)',place:'소예배실',target:'부서원 및 교사',topic:'교육 주제 또는 본문',goals:'교육의 목적을 확인한다.\n현장에서 적용할 수 있는 실제 방향을 정리한다.',outline:'1. 들어가는 말\n2. 핵심 강의\n3. 사례 나눔\n4. 적용과 기도',keyText:'배움은 사역을 더 분명하게 하고, 공동체를 더 건강하게 세우는 통로입니다.',questions:'오늘 가장 마음에 남은 내용은 무엇인가요?\n우리 부서에 적용할 수 있는 한 가지는 무엇인가요?',memo:'필요 시 메모 공간을 추가해 사용합니다.'};
  if(isCueType(type)) return {title:'예배 및 행사 큐시트',date:'2026년 7월 7일(주일) 오후 2시',place:'본당/교육관',target:'참석자 전체',director:'진행팀 / 방송팀',theme:'은혜와 감사로 함께하는 시간',rows:[cueRow('13:20','현장 준비','접수대, 좌석, 조명, 안내음악, 첫 화면 세팅','준비팀','BGM / 로고 화면','명찰, 안내지, 노트북','시작 40분 전 완료'),cueRow('13:40','리허설','사회자, 찬양팀, 대표기도자, 강사/진행자 동선 확인','진행팀','마이크 채널 확인','큐시트, 마이크, 보면대','순서 변경 확인'),cueRow('13:55','시작 전 안내','휴대폰 무음, 일정 안내, 기도 준비 안내','사회자','안내 자막 / 배경음악','안내 멘트','정시 시작 안내'),cueRow('14:00','오프닝','인사 및 행사/예배 시작 선언','사회자','오프닝 자막','무선마이크','분위기 환기'),cueRow('14:10','찬양/도입','찬양 또는 아이스브레이크 진행','찬양팀/진행자','가사 자막 / 음향','악보, 게임 준비물','현장 상황에 맞게 선택'),cueRow('14:30','말씀/강의','말씀 선포 또는 특강 진행','강사/설교자','PPT / 본문 자막','강의안, 성경본문','PPT 넘김 담당 확인'),cueRow('15:10','나눔/활동','소그룹 나눔 또는 공동체 활동','리더팀','타이머 / 안내 화면','나눔 질문, 활동지','팀별 진행 상황 확인'),cueRow('15:40','광고/정리','주요 광고, 다음 일정, 마무리 안내','사회자','광고 자막','공지사항','날짜와 장소 재확인'),cueRow('15:50','기도/폐회','마무리 기도와 폐회','담당 교역자','마이크 유지 / 종료 자막','폐회 안내','사진 촬영 여부 확인')],checks:`마이크 배터리와 채널을 시작 40분 전 확인
PPT, 자막, 광고, 안내 화면 오탈자 확인
사회자, 진행자, 방송팀이 같은 큐시트를 공유
접수/안내/동선/좌석 배치를 사전에 확인
순서 변경 시 진행팀과 방송팀에 동시에 공유`,notice:'큐시트는 예배와 행사를 모두 진행할 수 있는 가로형 A4 양식입니다. 현장 상황에 따라 찬양, 강의, 게임, 나눔 순서를 자유롭게 수정해 사용하세요.'};
  if(type==='부서행사 진행표(캘린더형)') return {title:'부서행사 월간 진행표',month:'2026-06',department:'교육부',manager:'부서 담당자',calendarFontScale:'110',calendarItems:[calendarRow('2026-06-07','🙏','부서 기도회','오후 모임'),calendarRow('2026-06-14','📖','교사 교육','소예배실'),calendarRow('2026-06-21','🎲','공동체 활동','부서별 진행'),calendarRow('2026-06-28','✅','월말 점검','다음 달 일정 확인')],notice:'월간 일정은 부서 상황에 맞게 조정해 주세요.'};
  if(type==='준비목록') return {title:'행사 준비목록',eventName:'청년부 수련회',period:'2026년 8월 14일(금)~16일(주일)',manager:'운영팀 / 담당 교역자',items:[prepRow('장소 예약 및 입퇴실 시간 확인','담당 교역자','D-45','완료','계약서, 잔금일, 사용 공간 확인','행정'),prepRow('참가 신청서와 참가비 안내','회장단','D-30','진행중','신청 마감일과 환불 기준 공지','행정'),prepRow('홍보 이미지 및 카톡 공지','홍보팀','D-28','진행중','주제, 일정, 장소, 준비물 포함','홍보'),prepRow('방 배정표 및 차량 배차표','운영팀','D-14','준비중','성별/리더/운전자 기준 확인','행정'),prepRow('예배 장비 세팅','방송팀','D-7','준비중','스피커, 마이크, 노트북, HDMI, 멀티탭','세팅'),prepRow('프로그램 준비물','프로그램팀','D-5','준비중','키워드 카드, 미션지, 스티커, 상품','물품'),prepRow('식사 및 간식 장보기','식사팀','D-3','준비중','알레르기 여부, 조리도구, 분리수거 봉투','식사'),prepRow('비상약 및 안전 안내','안전담당','D-2','확인필요','상비약, 보험, 비상연락망, 응급 동선','안전'),prepRow('현장 세팅 체크','전체 스태프','당일','준비중','접수대, 이름표, 안내문, 예배자리','세팅'),prepRow('정산 및 사진 정리','회계/홍보','D+3','예정','영수증 취합, 사진 공유, 감사 메시지','행정')],notes:'준비목록은 행사 전 회의에서 담당자별로 확인하고, 완료 여부를 행사 당일 오전까지 최종 점검합니다.'};
  if(type==='만족도 조사') return {title:'행사 만족도 조사',target:'참가자 전체',purpose:'행사 운영과 다음 사역 개선을 위한 의견을 수집합니다.',surveyQuestions:[qRow(),{question:'가장 은혜롭거나 도움이 되었던 시간은 무엇인가요?',options:'예배\n강의\n나눔\n공동체 프로그램'}],openQuestions:'좋았던 점을 자유롭게 적어주세요.\n개선되었으면 하는 점을 적어주세요.',guide:'응답은 다음 사역 준비에 소중히 활용됩니다.'};
  if(type==='신청서 양식') return {title:'행사 신청서',eventName:'행사명',target:'신청 대상',period:'신청 기간',eventDate:'행사 일시',place:'장소',contact:'문의: 담당자 / 담당 교역자',applicantFields:'성명\n연락처\n소속/부서\n생년월일\n비상 연락처',applicationFields:'참석 일정\n식사 여부\n교통편\n특이사항 및 요청사항',fields:'성명\n연락처\n소속/부서\n생년월일\n비상 연락처\n참석 일정\n식사 여부\n교통편\n특이사항 및 요청사항',notes:'아래 내용을 정확히 작성하여 제출해 주세요. 미성년자의 경우 보호자 연락처를 반드시 기재해 주세요. 제출 후 변경사항이 있을 경우 담당자에게 알려주세요.',privacy:'수집 항목: 성명, 연락처, 소속, 비상연락처 등 신청 확인에 필요한 정보\n이용 목적: 행사 신청 확인, 참가자 안내, 안전 관리 및 비상 연락\n보유 기간: 행사 종료 후 정산 및 확인 기간까지 보관 후 폐기',signatureDate:'2026년     월     일',signatureLabel:'신청자',approval:'담당자 확인'};
  return {title:type,content:'내용을 입력하세요.'};
}
function makeAll(){const o={};DOC_TYPES.forEach(t=>o[t]=withBase(t,initialData(t)));return o}
function merge(saved){const b=makeAll();if(!saved||typeof saved!=='object')return b;const legacy={...saved};if(legacy['교육부서 주간보고서']&&!legacy['부서별 주간보고서']) legacy['부서별 주간보고서']=legacy['교육부서 주간보고서'];
if(legacy['교육부 주간보고서']&&!legacy['부서 통합 주간보고서']) legacy['부서 통합 주간보고서']=legacy['교육부 주간보고서'];
if(legacy['7개부서 주간보고서']&&!legacy['7개부서 보고서']) legacy['7개부서 보고서']=legacy['7개부서 주간보고서'];
if((legacy['특별예배 큐시트']||legacy['특별행사 진행 큐시트'])&&!legacy[CUE_DOC]) legacy[CUE_DOC]=legacy['특별예배 큐시트']||legacy['특별행사 진행 큐시트'];
if(legacy['신청서 양식(수련회·세미나 등)']&&!legacy['신청서 양식']) legacy['신청서 양식']=legacy['신청서 양식(수련회·세미나 등)'];DOC_TYPES.forEach(t=>{if(legacy[t])b[t]=withBase(t,{...b[t],...legacy[t]})});return b}
function titleOf(type,d){
  if(type==='7개부서 보고서') return d.reportTitle||`${d.department||'7개부서'} 보고`;
  if(type==='각부 월간행사 안내') return Object.prototype.hasOwnProperty.call(d,'title') ? (d.title||'') : `${d.group||'각부'} 월간행사 안내`;
  if(type==='행사 및 수련회 기획안') return Object.prototype.hasOwnProperty.call(d,'title') ? (d.title||'') : '';
  if(type==='회의록') return Object.prototype.hasOwnProperty.call(d,'meetingName') ? (d.meetingName||'') : '';
  if(Object.prototype.hasOwnProperty.call(d,'reportTitle')) return d.reportTitle||'';
  if(Object.prototype.hasOwnProperty.call(d,'title')) return d.title||'';
  return type;
}
function titlePathOf(type){
  if(type==='행사 및 수련회 기획안') return 'title';
  if(type==='회의록') return 'meetingName';
  if(['부서 통합 주간보고서','부서별 주간보고서','7개부서 보고서'].includes(type)) return 'reportTitle';
  if(['각부 월간행사 안내','주간 공지','기획위원회 보고서','예산안','일정표','행사 및 수련회 기획안','세부 프로그램 문서','행사 결과 보고서','공문/협조 요청서','심방 보고서','세미나/교육자료',CUE_DOC,'부서행사 진행표(캘린더형)','준비목록','만족도 조사','신청서 양식' ].includes(type)) return 'title';
  return null;
}
function metaPathOf(type){
  if(type==='각부 월간행사 안내') return 'month';
  if(['주간 공지','부서 통합 주간보고서','부서별 주간보고서','7개부서 보고서','기획위원회 보고서','예산안','일정표','세부 프로그램 문서','행사 결과 보고서'].includes(type)) return 'period';
  if(['공문/협조 요청서','심방 보고서'].includes(type)) return 'date';
  if(type==='회의록') return 'dateTime';
  if(['세미나/교육자료',CUE_DOC].includes(type)) return 'date';
  if(type==='부서행사 진행표(캘린더형)') return 'month';
  if(['일정표','준비목록','신청서 양식'].includes(type)) return 'period';
  return null;
}
function ev(path,value){return {__editable:true,path,value}}
function isEv(v){return v&&typeof v==='object'&&v.__editable}
function Edit({path,value,as='span',className=''}){const directEdit=useContext(PreviewDirectEditContext);const Tag=as;const txt=value==null?'':String(value);const key=path?`path:${path}`:'';return path?<Tag className={'editable-text '+className} data-edit-path={path} data-edit-kind="text" data-preview-direct-edit="on" {...fontTargetAttrs(key,prettyFontLabel(key))} contentEditable={!!path} suppressContentEditableWarning spellCheck={false}>{txt}</Tag>:<Tag className={className}>{txt}</Tag>}
function showValue(v){return React.isValidElement(v)?v:(isEv(v)?<Edit path={v.path} value={v.value}/>:blank(v))}
function childAttendanceValue(v){const text=String(v??'').trim();const nums=text.match(/\d+/g);return nums?.[0]||''}
function AttendanceNumber({path,value}){const n=childAttendanceValue(value);return <div className="attendance-number-cell" {...fontTargetAttrs(`attendance:${path}`,'출석/참여 숫자')}><Edit path={path} value={n} className="attendance-number-edit"/><span className="attendance-unit">명</span></div>}
function pathTokens(path){return String(path||'').split('.').filter(Boolean).map(x=>/^\d+$/.test(x)?Number(x):x)}
function setByPath(obj,path,value){
  const parts=pathTokens(path); if(!parts.length)return obj;
  const root=Array.isArray(obj)?[...obj]:{...obj}; let cur=root;
  for(let i=0;i<parts.length-1;i++){const k=parts[i],n=parts[i+1];const existing=cur[k];cur[k]=Array.isArray(existing)?[...existing]:(existing&&typeof existing==='object'?{...existing}:(typeof n==='number'?[]:{}));cur=cur[k];}
  cur[parts[parts.length-1]]=value; return root;
}
function normalizeEditableText(value){return String(value||'').replace(/[\u200B\uFEFF]/g,'').replace(/\u00a0/g,' ').replace(/\r/g,'').split('\n').map(x=>x.replace(/[ \t]+/g,' ').trim()).join('\n').replace(/\n{3,}/g,'\n\n').trim()}
function dedupeEditableLines(value){
  const seen=new Set(); const out=[];
  normalizeEditableText(value).split('\n').forEach(line=>{
    const t=line.trim(); if(!t)return;
    const key=t.replace(/\s+/g,' ');
    if(seen.has(key))return;
    seen.add(key); out.push(t);
  });
  return out.join('\n');
}
function editableValue(el){
  const kind=el.getAttribute('data-edit-kind');
  if(kind==='list'){
    const items=Array.from(el.children||[]).filter(x=>String(x.tagName||'').toLowerCase()==='li').map(x=>x.innerText||x.textContent||'');
    return dedupeEditableLines(items.length?items.join('\n'):(el.innerText||el.textContent||''));
  }
  if(kind==='paragraphs'){
    const ps=Array.from(el.children||[]).filter(x=>String(x.tagName||'').toLowerCase()==='p').map(x=>x.innerText||x.textContent||'');
    return normalizeEditableText(ps.length?ps.join('\n'):(el.innerText||el.textContent||''));
  }
  return normalizeEditableText(el.innerText||el.textContent||'');
}

function editableCommitValue(el){
  return editableValue(el);
}
function placeEditableCaret(node,offset=0){
  const sel=window.getSelection?.();
  if(!sel)return;
  const range=document.createRange();
  range.setStart(node,offset);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}
function insertEditableLineBreak(el){
  el?.focus?.();
  const sel=window.getSelection?.();
  if(!sel||!sel.rangeCount)return false;
  const range=sel.getRangeAt(0);
  if(!el.contains(range.commonAncestorContainer))return false;
  const kind=el.getAttribute('data-edit-kind');
  const anchor=range.startContainer?.nodeType===1?range.startContainer:range.startContainer?.parentElement;

  // 목록은 Enter 한 번에 다음 항목으로 바로 넘어가도록 새 li를 만듭니다.
  if(kind==='list'){
    const li=anchor?.closest?.('li');
    if(li&&el.contains(li)){
      range.deleteContents();
      const newLi=document.createElement('li');
      newLi.textContent='\u200B';
      li.parentNode.insertBefore(newLi,li.nextSibling);
      placeEditableCaret(newLi.firstChild,0);
      return true;
    }
  }

  // 본문 블록은 Enter 한 번에 다음 문단으로 넘어가도록 새 p를 만듭니다.
  if(kind==='paragraphs'){
    const p=anchor?.closest?.('p');
    if(p&&el.contains(p)){
      range.deleteContents();
      const newP=document.createElement('p');
      newP.textContent='\u200B';
      p.parentNode.insertBefore(newP,p.nextSibling);
      placeEditableCaret(newP.firstChild,0);
      return true;
    }
  }

  // span/표 셀 등 단일 텍스트 영역은 <br> 대신 실제 개행 문자로 처리합니다.
  // zero-width marker를 함께 넣어 첫 Enter 직후에도 커서가 다음 줄에 보이게 합니다.
  range.deleteContents();
  const textNode=document.createTextNode('\n\u200B');
  range.insertNode(textNode);
  placeEditableCaret(textNode,1);
  return true;
}
function loadSavedData(){
  const keys=[STORAGE,...LEGACY_STORAGE_KEYS];
  for(const key of keys){
    try{const raw=localStorage.getItem(key); if(raw) return merge(JSON.parse(raw));}catch{}
  }
  return merge(null);
}
function saveToStorage(data){
  try{localStorage.setItem(STORAGE,JSON.stringify(data));return true}catch(e){console.error('자동 저장에 실패했습니다.',e);return false}
}
function useAutosave(){const [data,setData]=useState(()=>loadSavedData());useEffect(()=>{saveToStorage(data)},[data]);return [data,setData]}

function Field({label,value,onChange,type='text',small=false}){return <label className={'field '+(small?'small':'')}><span>{label}</span><input type={type} value={value||''} onChange={e=>onChange(e.target.value)} /></label>}
function Area({label,value,onChange}){return <label className="field full"><span>{label}</span><textarea value={value||''} onChange={e=>onChange(e.target.value)} /></label>}
function Select({label,value,onChange,options}){return <label className="field"><span>{label}</span><select value={value||options[0]} onChange={e=>onChange(e.target.value)}>{options.map(o=><option key={o}>{o}</option>)}</select></label>}
function Box({title,children,className=''}){return <details className={'editor-box collapsible-box '+className} data-editor-title={String(title||'')}><summary><span>{title}</span><em>열기/접기</em></summary><div className="box-body">{children}</div></details>}
function StaticBox({title,children,className=''}){return <section className={'editor-box static-editor-box '+className} data-editor-title={String(title||'')}><h3>{title}</h3><div className="box-body">{children}</div></section>}
function updateArray(arr,i,key,val){return arr.map((r,idx)=>idx===i?{...r,[key]:val}:r)}
function addCustomPage(doc,setDoc){
  const safe=Array.isArray(doc.customSections)?doc.customSections:[];
  const nextNo=safe.length+1;
  setDoc({...doc,customSections:[...safe,{title:`추가 페이지 ${nextNo}`,body:'새 페이지 내용을 입력하세요.',size:'보통',newPage:true}]});
}
function addCustomSection(doc,setDoc){
  const safe=Array.isArray(doc.customSections)?doc.customSections:[];
  setDoc({...doc,customSections:[...safe,{title:'추가 섹션',body:'내용을 입력하세요.',size:'보통',newPage:false}]});
}
function hasCustomPage(doc){
  return Array.isArray(doc.customSections)&&doc.customSections.some(s=>!!s.newPage);
}
function deleteLastCustomPage(doc,setDoc){
  const safe=Array.isArray(doc.customSections)?doc.customSections:[];
  let idx=-1;
  for(let i=safe.length-1;i>=0;i--){if(safe[i]?.newPage){idx=i;break}}
  if(idx<0){alert('삭제할 추가 페이지가 없습니다.');return}
  const pageTitle=safe[idx]?.title||`추가 페이지 ${idx+1}`;
  if(!confirm(`${pageTitle} 페이지를 삭제할까요?\n해당 페이지 아래에 이어 추가한 섹션도 함께 삭제됩니다.`))return;
  setDoc({...doc,customSections:safe.slice(0,idx)});
}
function PageAddButton({doc,setDoc,label='＋ 페이지 추가',className=''}){
  return <button type="button" className={'btn page-add-btn '+className} onClick={()=>addCustomPage(doc,setDoc)}>{label}</button>
}
function PageDeleteButton({doc,setDoc,label='− 페이지 삭제',className=''}){
  return <button type="button" className={'btn page-delete-btn '+className} disabled={!hasCustomPage(doc)} onClick={()=>deleteLastCustomPage(doc,setDoc)}>{label}</button>
}
function CustomSectionsEditor({doc,setDoc}){
  const safe=Array.isArray(doc.customSections)?doc.customSections:[];
  const sizeOptions=['작게','보통','크게','강조형'];
  function setSections(next){setDoc({...doc,customSections:next})}
  function patch(i,next){setSections(safe.map((x,idx)=>idx===i?{...x,...next}:x))}
  return <div className="custom-section-editor">
    <h4>추가 섹션</h4>
    <p className="hint">각 문서에 필요한 항목을 더 넣을 수 있습니다. 제목과 내용만 입력하면 되며, 다음 페이지로 넘길 때만 아래 체크를 사용하세요.</p>
    {safe.map((s,i)=><div className="custom-section-row" key={i}>
      <div className="row-head"><b>추가 섹션 {i+1}</b><button onClick={()=>setSections(safe.filter((_,idx)=>idx!==i))}>삭제</button></div>
      <div className="grid2">
        <Field label="섹션 제목" value={s.title||''} onChange={v=>patch(i,{title:v})}/>
        <Select label="섹션 크기" value={s.size||'보통'} options={sizeOptions} onChange={v=>patch(i,{size:v})}/>
      </div>
      <Area label="섹션 내용" value={s.body||''} onChange={v=>patch(i,{body:v})}/>
      <label className="check"><input type="checkbox" checked={!!s.newPage} onChange={e=>patch(i,{newPage:e.target.checked})}/> 이 추가 내용을 다음 페이지에서 시작하기</label>
    </div>)}
    <div className="custom-add-actions"><button className="btn secondary" onClick={()=>addCustomSection(doc,setDoc)}>+ 섹션 추가</button><PageAddButton doc={doc} setDoc={setDoc} label="+ 페이지 추가"/><PageDeleteButton doc={doc} setDoc={setDoc} label="- 페이지 삭제"/></div>
  </div>
}


const FONT_PRESETS=[
  {label:'작게',value:92,desc:'내용이 많을 때'},
  {label:'기본',value:100,desc:'기본 문서 크기'},
  {label:'크게',value:112,desc:'안내문·모바일 가독성'},
  {label:'아주 크게',value:124,desc:'카카오톡 공유용'}
];
function clampFont(v,min=75,max=145){return Math.max(min,Math.min(max,Number(v)||100))}

function cssAttr(value){return String(value||'').replace(/\\/g,'\\\\').replace(/"/g,'\\"').replace(/\n/g,' ')}
function prettyFontLabel(key,label){
  if(label)return label;
  const raw=String(key||'').replace(/^path:/,'').replace(/^block:/,'');
  const map={title:'문서 제목',reportTitle:'문서 제목',month:'기간/월',period:'기간',date:'날짜',place:'장소',manager:'담당자',writer:'작성자',requests:'확인 및 협조 요청',prayers:'기도 제목',prayer:'기도 제목',summary:'요약 본문',basis:'산출 근거',notes:'비고'};
  if(map[raw])return map[raw];
  if(/^labels\.\d+/.test(raw))return '섹션 제목';
  if(/^events\.\d+\.title/.test(raw))return '월간 핵심일정 제목';
  if(/^events\.\d+\./.test(raw))return '월간 핵심일정 내용';
  if(/^deptRows\./.test(raw))return '부서/모임별 참고 일정';
  if(/^info/.test(raw))return label||'정보칸 글씨';
  if(/^table:/.test(raw))return '표 글씨';
  if(/^schedule:/.test(raw))return '일정표 글씨';
  return raw?`선택 영역: ${raw}`:'선택한 글씨';
}
function fontTargetAttrs(key,label){return key?{'data-font-key':key,'data-font-label':prettyFontLabel(key,label),'data-font-selectable':'true'}:{}}
function readableFontLabelFromEl(el){
  const raw=(el?.textContent||'').replace(/\s+/g,' ').trim();
  const short=raw.length>22?raw.slice(0,22)+'…':raw;
  if(el?.matches?.('.doc-header h1'))return '문서 제목';
  if(el?.matches?.('.doc-header p'))return '상단 기간/정보';
  if(el?.matches?.('.doc-section h2, .doc-section h2 *'))return '섹션 제목';
  if(el?.matches?.('.doc-table th, .simple-timetable th'))return '표 제목';
  if(el?.matches?.('.doc-table td, .simple-timetable td'))return '표 내용';
  if(el?.matches?.('.info b'))return '정보 제목';
  if(el?.matches?.('.info span'))return '정보 내용';
  if(el?.matches?.('.total'))return '합계 글씨';
  if(el?.matches?.('.monthly-bottom *'))return '하단 안내';
  if(el?.matches?.('.page-badge'))return '페이지 번호';
  return short?`글씨: ${short}`:'선택한 글씨';
}
function fontAutoKeyFor(el,index){
  const wrap=el?.closest?.('.selected-doc-preview');
  const docType=(wrap?.getAttribute('data-doc-type')||'doc').replace(/[^ㄱ-ㅎ가-힣a-zA-Z0-9_-]/g,'_');
  const pages=wrap?Array.from(wrap.querySelectorAll('.page')):[];
  const page=el.closest?.('.page');
  const pageIdx=Math.max(0,pages.indexOf(page));
  const sections=page?Array.from(page.querySelectorAll('.doc-section')):[];
  const section=el.closest?.('.doc-section');
  const sectionIdx=Math.max(-1,sections.indexOf(section));
  const tag=(el.tagName||'el').toLowerCase();
  const cls=Array.from(el.classList||[]).slice(0,2).join('_')||'text';
  return `auto:${docType}:p${pageIdx}:s${sectionIdx}:${tag}:${cls}:${index}`;
}
function enhancePreviewFontTargets(root){
  if(!root)return;
  const selector=[
    '.doc-header h1','.doc-header p','.logo-mark','.page-badge',
    '.doc-section h2','.doc-section h2 .section-num','.doc-section h2 .section-title-text',
    '.doc-section h3','.doc-section h4',
    '.doc-section p','.doc-section li',
    '.text-box','.text-box p','.plain-list','.plain-list li',
    '.info-grid','.info','.info b','.info span',
    '.doc-table','.doc-table th','.doc-table td','.doc-table caption',
    '.simple-timetable','.simple-timetable th','.simple-timetable td','.simple-timetable b',
    '.month-event','.month-event .num span','.month-event .date','.month-event .evt','.month-event .evt b','.month-event .evt p',
    '.monthly-bottom b','.monthly-bottom small','.total','.signbox',
    '.notice-card','.notice-card b','.notice-card p',
    '.cal-date','.cal-item','.cal-item b','.cal-item small',
    '.prep-group h3','.prep-check-table th','.prep-check-table td',
    '.cue-sheet-table th','.cue-sheet-table td','.cue-content-cell'
  ].join(',');
  const candidates=Array.from(root.querySelectorAll(selector));
  candidates.forEach((el,i)=>{
    if(!(el.textContent||'').trim())return;
    if(el.hasAttribute('data-edit-path'))return;
    if(el.hasAttribute('data-font-key'))return;
    const key=fontAutoKeyFor(el,i);
    el.setAttribute('data-font-key',key);
    el.setAttribute('data-font-label',readableFontLabelFromEl(el));
    el.setAttribute('data-font-selectable','true');
    el.setAttribute('data-font-auto','true');
  });
}
function activeFontKeys(st){
  const arr=Array.isArray(st?.activeFontTargets)?st.activeFontTargets.filter(Boolean):[];
  const keys=arr.length?arr:(st?.activeFontTarget?[st.activeFontTarget]:[]);
  return Array.from(new Set(keys));
}
function percentToHwpSize(value){
  const n=clampFont(value,70,180)/10;
  return Math.round(n*10)/10;
}
function formatHwpSize(value){
  const n=Number(value);
  if(!Number.isFinite(n))return '';
  return Number.isInteger(n)?String(n):n.toFixed(1).replace(/\.0$/,'');
}
function hwpSizeToPercent(size){return clampFont((Number(size)||10)*10,70,180)}
function selectedFontSizes(st){
  const targets=st?.fontTargets||{};
  return activeFontKeys(st).map(k=>percentToHwpSize(targets[k]||100));
}
function mixedFontSizeLabel(st){
  const sizes=selectedFontSizes(st);
  if(!sizes.length)return '';
  const first=sizes[0];
  const mixed=sizes.some(x=>Math.abs(x-first)>0.01);
  return mixed?'혼합':formatHwpSize(first);
}
function activeFontSummary(st){
  const keys=activeFontKeys(st);
  if(keys.length>1)return `${keys.length}개 글씨 영역 선택`;
  if(keys.length===1)return `선택: ${prettyFontLabel(keys[0],st.activeFontLabel)}`;
  return '전체 글자 크기는 문서 기본도구에서 조절합니다.';
}
function fontTargetCSS(st){
  const targets=st?.fontTargets||{};
  const activeKeys=activeFontKeys(st);
  let css='';
  const strongSel=(key)=>{
    const attr=`[data-font-key="${cssAttr(key)}"]`;
    // 월간행사 카드, 일정표, 표 셀에는 !important 고정 글자 크기가 많아서
    // 선택 글자 크기 조절 CSS가 확실히 이기도록 선택자 우선순위를 높입니다.
    return `.page ${attr}${attr}${attr}${attr}${attr}`;
  };
  Object.entries(targets).forEach(([key,val])=>{
    const scale=clampFont(val,70,180);
    const sel=strongSel(key);
    css+=`${sel}{font-size:${scale}%!important;}\n${sel} *,${sel} li,${sel} p,${sel} b,${sel} span,${sel} th,${sel} td,${sel} small,${sel} strong,${sel} .editable-text{font-size:inherit!important;}\n`;
  });
  if(activeKeys.length){
    activeKeys.forEach((key)=>{
      const sel=strongSel(key);
      css+=`${sel}{outline:1.5px solid #2563eb!important;outline-offset:2px!important;background:rgba(37,99,235,.035)!important;border-radius:4px;}\n`;
    });
  }
  return css;
}
function clearFontSelectionInStyle(st){
  if(!st)return st;
  if(!st.activeFontTarget&&!st.activeFontTargets?.length&&!st.activeFontLabel)return st;
  return {...st,activeFontTarget:'',activeFontTargets:[],activeFontLabel:''};
}
function selectFontTargetInDoc(doc,setDoc,key,label){
  if(!key)return;
  const st={...baseExtras('').style,...(doc?.style||{})};
  updateDocStyle(doc,setDoc,{...st,activeFontTarget:key,activeFontTargets:[key],activeFontLabel:prettyFontLabel(key,label)});
}
function nudgeSelectedFont(doc,setDoc,deltaSize){
  const st={...baseExtras('').style,...(doc?.style||{})};
  const keys=activeFontKeys(st);
  if(!keys.length)return;
  const targets={...(st.fontTargets||{})};
  keys.forEach(key=>{
    const current=percentToHwpSize(targets[key]||100);
    targets[key]=hwpSizeToPercent(Math.max(7,Math.min(18,current+deltaSize)));
  });
  updateDocStyle(doc,setDoc,{...st,fontTargets:targets});
}
function setSelectedFontSize(doc,setDoc,size){
  const st={...baseExtras('').style,...(doc?.style||{})};
  const keys=activeFontKeys(st);
  if(!keys.length)return;
  const targets={...(st.fontTargets||{})};
  keys.forEach(key=>{targets[key]=hwpSizeToPercent(size)});
  updateDocStyle(doc,setDoc,{...st,fontTargets:targets});
}
function resetSelectedFont(doc,setDoc){
  const st={...baseExtras('').style,...(doc?.style||{})};
  const keys=activeFontKeys(st);
  if(!keys.length)return;
  const targets={...(st.fontTargets||{})};
  keys.forEach(key=>delete targets[key]);
  updateDocStyle(doc,setDoc,{...st,fontTargets:targets,activeFontTarget:'',activeFontTargets:[],activeFontLabel:''});
}
function updateDocStyle(doc,setDoc,patch){
  const current={...baseExtras('').style,...(doc?.style||{})};
  const next=typeof patch==='function'?patch(current):{...current,...patch};
  if(next.preset)next.preset=normalizePreset(next.preset);
  setDoc({...doc,style:next});
}
function fontButtonActive(value,target){return Math.abs((Number(value)||100)-target)<2}
function FontQuickControls({doc,setDoc,compact=false}){
  const st={...baseExtras('').style,...(doc?.style||{})};
  const fs=clampFont(st.fontScale);
  const auto=!!st.autoFit;
  const activeKeys=activeFontKeys(st);
  const canAdjustSelected=activeKeys.length>0;
  const selectedSize=mixedFontSizeLabel(st);
  const setScale=(value)=>updateDocStyle(doc,setDoc,{...st,fontScale:value,autoFit:false});
  return <div className={compact?'font-quick-controls compact':'font-quick-controls'}>
    <div className="font-preset-row" role="group" aria-label="글자 크기 빠른 선택">
      {FONT_PRESETS.map(p=><button type="button" key={p.label} className={fontButtonActive(fs,p.value)&&!auto?'active':''} onClick={()=>setScale(p.value)}><b>{p.label}</b><small>{p.desc}</small></button>)}
      <button type="button" className={auto?'active auto':''} onClick={()=>updateDocStyle(doc,setDoc,cur=>({...cur,autoFit:!cur.autoFit,fontScale:cur.autoFit?(cur.fontScale||100):Math.min(Number(cur.fontScale)||100,100)}))}><b>자동 맞춤</b><small>A4에 맞게 간격 축소</small></button>
    </div>
    <div className="font-detail-row selected-font-row simple-font-select-row" aria-label="미리보기 선택 글씨 조정">
      <span className="selected-font-summary auto-select-summary">{canAdjustSelected?activeFontSummary(st):'전체 글자 크기는 왼쪽 빠른 선택으로 조절합니다.'}</span>
      <label className="font-size-number"><span>크기</span><input type="number" min="7" max="18" step="0.5" disabled={!canAdjustSelected} value={selectedSize==='혼합'?'':selectedSize} placeholder={selectedSize==='혼합'?'혼합':'10'} onChange={e=>setSelectedFontSize(doc,setDoc,e.target.value)}/><em>한글 10 기준</em></label>
      <button type="button" disabled={!canAdjustSelected} onClick={()=>nudgeSelectedFont(doc,setDoc,-0.5)}>-0.5</button>
      <button type="button" disabled={!canAdjustSelected} onClick={()=>nudgeSelectedFont(doc,setDoc,0.5)}>+0.5</button>
      <button type="button" disabled={!canAdjustSelected} onClick={()=>nudgeSelectedFont(doc,setDoc,-1)}>작게</button>
      <button type="button" disabled={!canAdjustSelected} onClick={()=>nudgeSelectedFont(doc,setDoc,1)}>크게</button>
      <button type="button" disabled={!canAdjustSelected} onClick={()=>resetSelectedFont(doc,setDoc)}>선택 해제</button>
      <button type="button" onClick={()=>updateDocStyle(doc,setDoc,cur=>({...cur,fontScale:100,titleScale:100,bodyScale:100,tableScale:100,listScale:100,fontTargets:{},activeFontTarget:'',activeFontTargets:[],activeFontLabel:'',autoFit:false}))}>전체 초기화</button>
    </div>
  </div>
}

function TemplatePanel({type,doc,setDoc}){
  const labels=labelsFor(type);
  const st={...baseExtras(type).style,...(doc.style||{})};
  st.preset=normalizePreset(st.preset);
  function setStyle(k,v){
    const next={...st,[k]:v};
    if(k==='theme')Object.assign(next,THEMES[v]);
    if(k==='preset')Object.assign(next,presetStylePatch(v));
    setDoc({...doc,style:next});
  }
  return <details className="editor-box template-panel" data-editor-title="디자인 · 문구 · 페이지 조정">
    <summary className="template-summary"><span className="summary-title">⚙️ 디자인 · 문구 · 페이지 조정</span><span className="summary-pill"></span></summary>
    <p className="template-summary-note">상단 빠른 메뉴에서 자주 쓰는 디자인을 바로 고르고, 여기서는 필요할 때만 섹션 제목과 페이지 나눔을 조정합니다.</p>
    <h4>문서 목적별 디자인</h4>
    <div className="preset-grid">
      {Object.keys(DESIGN_PRESETS).map(p=><button type="button" key={p} className={'preset-card '+(st.preset===p?'selected':'')} onClick={()=>setStyle('preset',p)}>
        <span className={'preset-sample sample-'+presetClass(p)}><i></i><i></i><i></i></span>
        <b>{p}</b>
        <small>{DESIGN_PRESETS[p]}</small>
      </button>)}
    </div>
    <p className="hint strong-hint">글자 크기는 상단 빠른 메뉴의 <b>글자</b> 탭에서 바로 조절할 수 있습니다.</p>
    <div className="grid3 style-grid">
      <Select label="색상 테마" value={st.theme} options={Object.keys(THEMES)} onChange={v=>setStyle('theme',v)} />
      <Field label="대표 색상" value={st.primary} type="color" onChange={v=>setStyle('primary',v)} />
      <Field label="포인트 색상" value={st.accent} type="color" onChange={v=>setStyle('accent',v)} />
      <Field label="종이 배경" value={st.paper} type="color" onChange={v=>setStyle('paper',v)} />
    </div>
    <p className="hint strong-hint">현재 템플릿: <b>{st.preset}</b> · 선택 즉시 오른쪽 미리보기의 상단/박스/테두리 모양이 바뀝니다.</p>
    <h4>페이지 나눔 조정</h4>
    <p className="hint">보통은 그대로 두셔도 됩니다. PDF 저장 시 내용이 잘리거나 특정 내용을 다음 페이지에서 시작하고 싶을 때만 사용하세요.</p>
    {labels.map((l,i)=><div className="label-row" key={i}>
      <Field label={`섹션 ${i+1} 제목`} value={doc.labels?.[i]||l} onChange={v=>setDoc({...doc,labels:{...(doc.labels||{}),[i]:v}})} />
      <div className="section-controls page-placement-controls">
        <label className="check"><input type="checkbox" checked={!!doc.breaks?.[i]} onChange={e=>setDoc({...doc,breaks:{...(doc.breaks||{}),[i]:e.target.checked}})} /> 이 부분을 다음 페이지에서 시작하기</label>
        <div className="placement-buttons">
          <button type="button" onClick={()=>setDoc({...doc,breaks:{...(doc.breaks||{}),[i]:false}})}>현재 페이지에 두기</button>
          <button type="button" onClick={()=>setDoc({...doc,breaks:{...(doc.breaks||{}),[i]:true}})}>다음 페이지로 넘기기</button>
        </div>
        <label className="check danger-check"><input type="checkbox" checked={!!doc.hiddenSections?.[i]} onChange={e=>setDoc({...doc,hiddenSections:{...(doc.hiddenSections||{}),[i]:e.target.checked}})} /> 이 항목 사용 안 함</label>
      </div>
    </div>)}
    <CustomSectionsEditor doc={doc} setDoc={setDoc}/>
  </details>
}


function EditorFlowControls({scopeRef,type}){
  function detailNodes(){return Array.from(scopeRef.current?.querySelectorAll('details.editor-box')||[])}
  function setAll(open){detailNodes().forEach(d=>{d.open=open})}
  function showCore(){const nodes=detailNodes();nodes.forEach((d,i)=>{const t=d.dataset.editorTitle||d.querySelector('summary')?.innerText||'';d.open=i<2||/기본|개요/.test(t)});nodes.find(d=>d.open)?.scrollIntoView({behavior:'smooth',block:'start'})}
  function jump(keyword){const nodes=detailNodes();const target=nodes.find(d=>(d.dataset.editorTitle||d.querySelector('summary')?.innerText||'').includes(keyword));if(target){target.open=true;target.scrollIntoView({behavior:'smooth',block:'start'})}}
  const quick=['기본','일정','예산','준비','디자인'].filter(k=>k!=='예산'||/예산|기획안|수련회|결과/.test(type));
  return <div className="editor-flow-controls"><div><b>입력창 보기</b><span>여러 열기/접기를 반복하지 않도록 한 번에 펼치거나 필요한 곳으로 이동합니다.</span></div><div className="flow-control-buttons"><button type="button" onClick={()=>setAll(true)}>전체 열기</button><button type="button" onClick={()=>setAll(false)}>전체 접기</button><button type="button" onClick={showCore}>핵심만 보기</button>{quick.map(k=><button type="button" key={k} onClick={()=>jump(k)}>{k}으로 이동</button>)}</div></div>
}


function splitNonEmpty(text){return String(text||'').split(/\n+/).map(s=>s.trim()).filter(Boolean)}
function cleanLine(line){return String(line||'').replace(/^[-*•\d.\s]+/,'').trim()}
function lineValue(line){return String(line||'').replace(/^[^:：-]{1,16}\s*[:：-]\s*/,'').trim()}
function dateish(line){return /(\d{1,2}\s*[\/월.-]\s*\d{0,2}|\d{1,2}\s*일|주일|월요일|화요일|수요일|목요일|금요일|토요일|오전|오후|\d{1,2}:\d{2})/.test(String(line||''))}
function moneyish(line){return /(원|만원|천원|₩|\d{2,3}(?:,\d{3})+)/.test(String(line||''))}
function extractAmount(line){const m=String(line||'').match(/(\d[\d,]*)\s*(만원|천원|원)?/);if(!m)return '';let n=Number(String(m[1]).replace(/,/g,''))||0;if(m[2]==='만원')n*=10000;if(m[2]==='천원')n*=1000;return n?String(n):''}
function sectionLines(lines,patterns){const out=[];lines.forEach(l=>{if(patterns.some(p=>p.test(l)))out.push(lineValue(l))});return out.filter(Boolean)}
function firstLine(lines,patterns,fallback=''){const found=lines.find(l=>patterns.some(p=>p.test(l)));return found?lineValue(found):fallback}
function detectTitle(lines,type){
  const title=lines.find(l=>/(안내|공지|보고|기획안|계획안|수련회|세미나|행사|예배|큐시트|준비목록|프로그램|예산안)/.test(l)&&!dateish(l)&&!moneyish(l));
  return title||lines.find(l=>!dateish(l)&&!moneyish(l))||'';
}
function parseSimpleEvent(line){
  const raw=cleanLine(line);
  let date=''; let time=''; let rest=raw;
  const parts=raw.split(/\s*[|/]\s*/).map(x=>x.trim()).filter(Boolean);
  if(parts.length>=3 && dateish(parts[0])){
    date=parts[0];
    time=/^(오전|오후|AM|PM|am|pm)?\s*\d{1,2}(:\d{2})?/.test(parts[1])?parts[1]:'';
    rest=parts.slice(time?2:1).join(' ');
  }else{
    const dateMatch=raw.match(/((?:\d{1,2}\s*[\/월.-]\s*\d{1,2}(?:\s*\([^)]*\))?(?:\s*[-~–—]\s*\d{1,2}\s*[\/월.-]?\s*\d{0,2}(?:\s*\([^)]*\))?)?|\d{1,2}\s*월\s*\d{1,2}\s*일|\d{1,2}\s*일|주일|월요일|화요일|수요일|목요일|금요일|토요일)(?:\s*(?:오전|오후)?\s*\d{1,2}(?::\d{2})?\s*시?)?)/);
    if(dateMatch){
      const split=splitMonthlyDateTime(dateMatch[1]);
      date=split.date;
      time=split.time;
      rest=raw.replace(dateMatch[0],'').trim();
    }
  }
  const timeMatch=!time?rest.match(/((?:오전|오후|AM|PM|am|pm)\s*\d{1,2}(?::\d{2})?\s*(?:시|분)?|\d{1,2}:\d{2})/):null;
  if(timeMatch){time=timeMatch[1].trim();rest=rest.replace(timeMatch[0],'').trim();}
  const placeMatch=rest.match(/(?:장소\s*[:：-]?\s*)?([가-힣A-Za-z0-9 ]{1,18}(?:홀|실|관|교회|교육관|본당|소예배실|세미나실|펜션|센터|카페|방|강당|마당|로비|수양관))/);
  const place=placeMatch?placeMatch[1].trim():'';
  let title=rest.replace(/장소\s*[:：-]?\s*/,'').replace(place,'').trim();
  title=title.replace(/^(일정|행사|프로그램)\s*[:：-]\s*/,'').trim();
  return {date,time,title:title||rest||raw,place,target:'',content:''};
}
function parseScheduleRow(line,day='1일차'){
  const raw=cleanLine(line);
  const tm=raw.match(/(\d{1,2}:\d{2}|(?:오전|오후)\s*\d{1,2}(?::\d{2})?|\d{1,2}\s*시(?:\s*\d{1,2}\s*분)?)/g);
  const start=tm?.[0]?normalizeTimeText(tm[0]):'09:00';
  const end=tm?.[1]?normalizeTimeText(tm[1]):'';
  const title=raw.replace(/^(일정|순서|진행)\s*[:：-]\s*/,'').replace(tm?.[0]||'','').replace(tm?.[1]||'','').replace(/[~-]/,' ').trim()||raw;
  return {day,start,end:end||addMinutes(start,60),icon:'',title};
}
function normalizeTimeText(text){
  const raw=String(text||'').trim();
  if(!raw)return '';
  const compact=raw.replace(/\s+/g,' ').replace(/[.]/g,':');
  const ap=/오후|PM/i.test(compact)?'pm':/오전|AM/i.test(compact)?'am':'';
  let m=compact.match(/(\d{1,2})\s*시\s*(\d{1,2})?\s*분?/);
  if(!m)m=compact.match(/(\d{1,2})\s*[:：]\s*(\d{1,2})/);
  if(!m)m=compact.match(/^(?:오전|오후|AM|PM)?\s*(\d{1,2})\s*$/i);
  if(!m)return raw;
  let h=Number(m[1]);
  let min=Number(m[2]||0);
  if(!Number.isFinite(h)||!Number.isFinite(min)||h>24||min>59)return raw;
  if(ap==='pm'&&h<12)h+=12;
  if(ap==='am'&&h===12)h=0;
  if(h===24)h=0;
  return `${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}`;
}
function scheduleSortKey(value,blankFirst=false){
  if(!String(value||'').trim())return blankFirst?-1:99999;
  const normalized=normalizeTimeText(value);
  const m=String(normalized||'').match(/^(\d{1,2}):(\d{2})$/);
  if(!m)return blankFirst?99998:99999;
  return Math.max(0,Math.min(23,Number(m[1])||0))*60+Math.max(0,Math.min(59,Number(m[2])||0));
}
function sortScheduleRows(rows=[],days=[],blankFirst=false){
  const order=Object.fromEntries((days||[]).map((d,i)=>[d,i]));
  return [...(rows||[])].map((r,i)=>({...r,__sortIndex:i})).sort((a,b)=>{
    const da=order[a.day]??999; const db=order[b.day]??999;
    if(da!==db)return da-db;
    const sa=scheduleSortKey(a.start,blankFirst); const sb=scheduleSortKey(b.start,blankFirst);
    if(sa!==sb)return sa-sb;
    const ea=scheduleSortKey(a.end,false); const eb=scheduleSortKey(b.end,false);
    if(ea!==eb)return ea-eb;
    return a.__sortIndex-b.__sortIndex;
  }).map(({__sortIndex,...r})=>r);
}
function addMinutes(t,mins){const [h,m]=String(t||'09:00').split(':').map(Number);const d=new Date(2000,0,1,h||9,m||0);d.setMinutes(d.getMinutes()+mins);return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`}
function timeToMin(t){const normalized=normalizeTimeText(t);const m=String(normalized||'').match(/^(\d{1,2}):(\d{2})$/);if(!m)return 0;const h=Math.max(0,Math.min(23,Number(m[1])||0));const min=Math.max(0,Math.min(59,Number(m[2])||0));return h*60+min}
function parseBudgetRow(line){
  const raw=cleanLine(line);
  const parts=raw.split(/[\t,]/).map(x=>x.trim()).filter(Boolean);
  if(parts.length>=3)return {item:parts[0],detail:parts[1]||'',qty:parts[2]||'1',price:extractAmount(parts.slice(3).join(' '))||extractAmount(raw),note:parts[4]||''};
  return {item:raw.replace(/[:：].*/,'').trim()||raw,detail:raw,qty:'1',price:extractAmount(raw),note:''};
}
function parsePrepRow(line){const raw=cleanLine(line);return {category:/세팅|마이크|의자|책상|현수막/.test(raw)?'세팅':/식사|간식|물|도시락/.test(raw)?'식사':'물품',item:raw,owner:'',done:false,note:''}}

function normalizeFieldValue(value){return String(value||'').replace(/^[\s:=:：\-–—]+/,'').trim()}
function matchFieldLine(line,aliases){
  const raw=cleanLine(line);
  for(const alias of aliases){
    const pattern=typeof alias==='string'?alias:alias.source;
    const re=new RegExp(`^\\s*(?:${pattern})\\s*(?:[:：=\\-–—]\\s*|\\s+)?(.*)$`,'i');
    const m=raw.match(re);
    if(m){return normalizeFieldValue(m[1]||'')}
  }
  return null;
}
function lineStartsField(line,schema){return schema.some(f=>matchFieldLine(line,f.aliases)!==null)}
function parseKeyedFields(lines,schema){
  const fields={}; const used=new Set();
  for(let i=0;i<lines.length;i++){
    for(const f of schema){
      const v=matchFieldLine(lines[i],f.aliases);
      if(v===null)continue;
      used.add(i);
      let value=v;
      if(!value&&f.multiline){
        const collected=[];
        for(let j=i+1;j<lines.length;j++){
          if(lineStartsField(lines[j],schema))break;
          collected.push(cleanLine(lines[j])); used.add(j);
        }
        value=collected.join('\n');
      }
      if(value||f.keepEmpty){
        fields[f.field]=f.multiline&&fields[f.field]?[fields[f.field],value].filter(Boolean).join('\n'):value;
      }
      break;
    }
  }
  return {fields,used};
}
const EDUCATION_DEPT_WEEKLY_SCHEMA=[
  {field:'reportTitle',label:'제목',aliases:[/제목|문서\s*제목|보고서\s*제목|보고서명/],multiline:false},
  {field:'subDepartment',label:'부서',aliases:[/부서|부서명|담당\s*부서/],multiline:false},
  {field:'attendance',label:'출석/참여',aliases:[/아이들\s*출석|출석\/참여|아동\s*출석|학생\s*출석|출석\s*인원|출석/],multiline:false},
  {field:'period',label:'기간',aliases:[/기간|보고\s*기간|날짜|일자|주간|일시/],multiline:false},
  {field:'writer',label:'작성자',aliases:[/작성자|작성|보고자|담당자|작성\s*담당/],multiline:false},
  {field:'thisWeek',label:'이번 주 활동',aliases:[/이번\s*주\s*활동|이번주\s*활동|이번\s*주\s*내용|금주\s*활동|금주\s*내용|이번\s*주/],multiline:true},
  {field:'nextWeek',label:'다음 주 계획',aliases:[/다음\s*주\s*계획|다음주\s*계획|다음\s*주\s*활동|다음주\s*활동|차주\s*계획|다음\s*주/],multiline:true},
  {field:'special',label:'특이사항',aliases:[/특이\s*사항|특이사항|지원\s*요청|요청\s*사항|비고/],multiline:true},
  {field:'prayer',label:'기도제목',aliases:[/기도\s*제목|기도제목|기도/],multiline:true}
];
function detectEducationDept(lines,fallback=''){
  const found=lines.join('\n').match(/영아부|유치부|초등부|청소년부|청년부/);
  return found?.[0]||fallback||'영아부';
}
function parseEducationDeptWeekly(doc,lines,title){
  const {fields,used}=parseKeyedFields(lines,EDUCATION_DEPT_WEEKLY_SCHEMA);
  const reportIndex=lines.findIndex(l=>/(영아부|유치부|초등부|청소년부|청년부)?.{0,12}(주간\s*보고서|보고서|주간보고서)/.test(l));
  const reportLine=reportIndex>=0?cleanLine(lines[reportIndex]):'';
  if(reportIndex>=0)used.add(reportIndex);
  const hasKeyed=Object.keys(fields).length>0;
  const leftovers=lines.filter((_,i)=>!used.has(i)).map(cleanLine).filter(Boolean);
  const next={...doc};
  next.reportTitle=fields.reportTitle||reportLine||doc.reportTitle||title||'부서별 주간보고서';
  next.subDepartment=detectEducationDept([fields.subDepartment||'',reportLine,...lines],doc.subDepartment);
  if(fields.period)next.period=fields.period;
  if(fields.writer)next.writer=fields.writer;
  if(fields.attendance)next.attendance=String(fields.attendance.match(/\d+/)?.[0]||fields.attendance||'');
  if(fields.thisWeek)next.thisWeek=fields.thisWeek;
  else if(!hasKeyed&&leftovers.length)next.thisWeek=leftovers.join('\n');
  if(fields.nextWeek)next.nextWeek=fields.nextWeek;
  if(fields.special)next.special=fields.special;
  if(fields.prayer)next.prayer=fields.prayer;
  return next;
}
function parseEducationWeekly(doc,lines,title){
  const next={...doc};
  const globalSchema=[
    {field:'reportTitle',aliases:[/제목|보고서명|문서\s*제목/],multiline:false},
    {field:'period',aliases:[/기간|보고\s*기간|날짜|일자|주간/],multiline:false},
    {field:'writer',aliases:[/작성자|작성|보고자|담당자/],multiline:false},
    {field:'summary',aliases:[/요약|교육부\s*주간\s*활동|전체\s*요약|주간\s*활동\s*요약/],multiline:true},
    {field:'commonPrayer',aliases:[/공동\s*기도제목|공동\s*기도|기도제목|기도/],multiline:true},
    {field:'support',aliases:[/공유|지원\s*요청|협조\s*요청|요청사항|확인사항/],multiline:true}
  ];
  const {fields}=parseKeyedFields(lines,globalSchema);
  if(fields.reportTitle)next.reportTitle=fields.reportTitle;
  else if(title)next.reportTitle=next.reportTitle||title;
  if(fields.period)next.period=fields.period;
  if(fields.writer)next.writer=fields.writer;
  if(fields.summary)next.summary=fields.summary;
  if(fields.commonPrayer)next.commonPrayer=fields.commonPrayer;
  if(fields.support)next.support=fields.support;
  EDU_DEPTS.forEach(dep=>{
    const depLines=lines.filter(l=>l.includes(dep));
    depLines.forEach(line=>{
      const stripped=line.replace(dep,'').trim();
      const att=matchFieldLine(stripped,[/아이들\s*출석|출석\/참여|출석\s*인원|출석/]);
      const th=matchFieldLine(stripped,[/이번\s*주\s*활동|이번주\s*활동|금주\s*활동/]);
      const nx=matchFieldLine(stripped,[/다음\s*주\s*계획|다음주\s*계획|다음\s*주\s*활동/]);
      const sp=matchFieldLine(stripped,[/특이\s*사항|특이사항|지원\s*요청|요청\s*사항/]);
      if(att!==null&&att)next[`${dep}_attendance`]=String(att.match(/\d+/)?.[0]||att);
      if(th!==null&&th)next[`${dep}_this`]=th;
      if(nx!==null&&nx)next[`${dep}_next`]=nx;
      if(sp!==null&&sp)next[`${dep}_special`]=sp;
    });
  });
  return next;
}
function classifySmartPaste(type,doc,text){
  const all=splitNonEmpty(text);
  const title=detectTitle(all,type)||doc.title||doc.reportTitle||doc.eventName||type;
  const eventLines=all.filter(l=>dateish(l)&&!moneyish(l));
  const budgetLines=all.filter(moneyish);
  const requestLines=sectionLines(all,[/협조|요청|확인|준비|참석|제출|공유|공지/]).filter(l=>!/기도/.test(l));
  const prayerLines=sectionLines(all,[/기도/]);
  const purposeLines=sectionLines(all,[/목적|취지|방향|주제|기대/]);
  const place=firstLine(all,[/장소|교회|본당|교육관|펜션|세미나실|비전홀|소예배실/],doc.place||doc.location||'');
  const period=firstLine(all,[/기간|일시|날짜|일정|\d{4}|\d{1,2}\s*월/],doc.period||doc.date||doc.month||'');
  if(type==='각부 월간행사 안내'){
    return {...doc,title,month:doc.month||period,events:eventLines.length?eventLines.map(parseSimpleEvent):(doc.events||[]),requests:requestLines.length?requestLines.join('\n'):doc.requests,prayers:prayerLines.length?prayerLines.join('\n'):doc.prayers};
  }
  if(type==='예산안'){
    const incomeLines=budgetLines.filter(l=>/수입|회비|지원|후원|헌금|보조/.test(l));
    const expenseLines=budgetLines.filter(l=>!incomeLines.includes(l));
    return {...doc,title: title.includes('예산')?title:(doc.title||'예산안'),basis:purposeLines.join('\n')||doc.basis||all[0],incomeItems:incomeLines.length?incomeLines.map(parseBudgetRow):(doc.incomeItems||[]),expenseItems:expenseLines.length?expenseLines.map(parseBudgetRow):(budgetLines.length?budgetLines.map(parseBudgetRow):(doc.expenseItems||[]))};
  }
  if(type==='행사 및 수련회 기획안'){
    return {...doc,title,period,place,purpose:purposeLines.join('\n')||doc.purpose||all.slice(0,3).join('\n'),summary:doc.summary||all.slice(0,5).join('\n'),scheduleItems:eventLines.length?eventLines.map((l,i)=>parseScheduleRow(l,/(둘째|2일|2일차)/.test(l)?'2일차':/(셋째|3일|3일차)/.test(l)?'3일차':'1일차')):(doc.scheduleItems||[]),expenseItems:budgetLines.length?budgetLines.map(parseBudgetRow):(doc.expenseItems||[])};
  }
  if(type==='세부 프로그램 문서'){
    const orderLines=all.filter(l=>dateish(l)||/^\d+\s*분/.test(l));
    const prepLines=all.filter(l=>/준비|물품|세팅|마이크|종이|펜|상품|간식/.test(l));
    return {...doc,title:title||doc.title,eventName:doc.eventName||title,programs:[{...programRow(1),name:title||'새 프로그램',time:firstLine(all,[/소요|시간/],''),target:firstLine(all,[/대상/],''),leader:firstLine(all,[/담당|진행자/],''),place,goal:purposeLines.join('\n')||'프로그램 목적을 입력하세요.',method:sectionLines(all,[/방법|진행|방식/]).join('\n')||all.filter(l=>!orderLines.includes(l)&&!prepLines.includes(l)).slice(1,4).join('\n'),materials:prepLines.join('\n'),setup:firstLine(all,[/세팅|공간/],''),order:orderLines.join('\n')||'5분 - 안내\n30분 - 진행\n10분 - 정리',note:sectionLines(all,[/유의|주의|안전/]).join('\n')}]};
  }
  if(type==='준비목록'){
    const prep=all.filter(l=>!/기획안|안내|보고|목적/.test(l)).map(parsePrepRow);
    return {...doc,title:title.includes('준비')?title:(doc.title||'준비목록'),items:prep.length?prep:(doc.items||[])};
  }
  if(type===CUE_DOC){
    const cueRows=eventLines.length?eventLines.map((l,i)=>({time:parseScheduleRow(l).start,order:String(i+1),title:parseScheduleRow(l).title,leader:'',note:''})):(doc.rows||[]);
    return {...doc,title:title.includes('큐시트')?title:(doc.title||'예배 및 행사 큐시트'),rows:cueRows};
  }
  if(type==='부서별 주간보고서'){
    return parseEducationDeptWeekly(doc,all,title);
  }
  if(type==='부서 통합 주간보고서'){
    return parseEducationWeekly(doc,all,title);
  }
  const keys=['summary','thisWeek','content','requests','note'];
  const k=keys.find(x=>x in doc)||'summary';
  return {...doc,title:doc.title||title,[k]:all.join('\n')};
}

function aliasesForQuickPath(path,label,type){
  const p=String(path||'');
  const base=[label,String(label||'').replace(/[()]/g,''),String(label||'').replace(/\s+/g,'')].filter(Boolean);
  const add=(arr)=>Array.from(new Set([...base,...arr].filter(Boolean)));
  if(['title','reportTitle','meetingName'].includes(p))return add(['제목','문서 제목','문서제목','보고서 제목','보고서명','행사명','문서명','프로그램명','큐시트 제목']);
  if(['eventName'].includes(p))return add(['행사명','프로그램명','행사 제목','행사제목']);
  if(['group','subDepartment','department'].includes(p))return add(['부서','부서명','모임','대상 부서','대상부서']);
  if(['period','date','dateTime','month'].includes(p))return add(['기간','일시','날짜','일자','보고 기간','보고기간','월','해당 월']);
  if(['writer'].includes(p))return add(['작성자','보고자','작성 담당','작성담당']);
  if(['manager','director'].includes(p))return add(['담당','담당자','총괄','진행','진행자','담당 교역자']);
  if(p.includes('attendance'))return add(['출석/참여','출석/참여','출석','출석 인원','출석인원','아동 출석','학생 출석']);
  if(p.includes('thisWeek'))return add(['이번 주 활동','이번주 활동','이번주활동','금주 활동','금주활동','이번 주 내용','이번주 내용']);
  if(p.includes('nextWeek'))return add(['다음 주 계획','다음주 계획','다음주계획','차주 계획','차주계획','다음 주 활동','다음주 활동']);
  if(p.includes('special'))return add(['특이사항','특이 사항','지원 요청','지원요청','요청사항','요청 사항','비고']);
  if(p.includes('prayer')||p.includes('Prayer')||p.includes('prayers'))return add(['기도제목','기도 제목','기도','공동 기도제목','공동기도제목']);
  if(p.includes('request')||p.includes('support'))return add(['협조 요청','협조요청','확인사항','확인 사항','요청사항','요청 사항','공유','지원 요청','지원요청']);
  if(p.includes('purpose')||p.includes('goal')||p.includes('basis'))return add(['목적','행사 목적','기대효과','기대 효과','취지','방향','산출근거','산출 근거']);
  if(p.includes('preparation')||p.includes('materials'))return add(['준비사항','준비 사항','준비물','물품','필요물품']);
  if(p.includes('method'))return add(['진행방법','진행 방법','방법','활동방법','활동 방법']);
  if(p.includes('order'))return add(['진행순서','진행 순서','순서','시간표','프로그램 순서']);
  if(p.includes('note')||p.includes('notes'))return add(['비고','메모','유의사항','유의 사항','주의사항','주의 사항','안내사항','안내 사항']);
  if(['place','location'].includes(p))return add(['장소','위치','모임 장소','행사 장소']);
  if(['target'].includes(p))return add(['대상','대상자','참가대상','참가 대상','인원','대상 및 인원']);
  if(['theme'].includes(p))return add(['주제','테마']);
  return base;
}
function aliasToRegex(alias){
  if(alias instanceof RegExp)return alias;
  const cleaned=String(alias||'').trim();
  const pattern=cleaned.split(/\s+/).map(x=>x.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('\\s*');
  return new RegExp(pattern);
}
function quickSmartSchema(type,doc){
  // v1.37: 자동정리 스키마를 '빠른 작성 칸'에만 묶지 않고,
  // 검수표에 보이는 동적 칸까지 확장합니다.
  // 문서마다 칸 이름이 달라도 label/path 기준으로 alias를 만들기 때문에
  // 칸 이름을 붙여 쓴 메모는 대부분 정확한 위치로 들어갑니다.
  return reviewFieldsFor(type,doc).map(f=>({
    field:f.path,
    label:f.label,
    aliases:aliasesForQuickPath(f.path,f.label,type).map(aliasToRegex),
    multiline:f.kind==='area'||/내용|활동|계획|기도|요청|목적|준비|순서|방법|비고|특이|유의|근거|확인|협조/.test(f.label)
  }));
}
function applyGeneralKeyedSmartFields(type,doc,text){
  const lines=splitNonEmpty(text);
  if(!lines.length)return doc;
  const schema=quickSmartSchema(type,doc);
  if(!schema.length)return doc;
  const {fields}=parseKeyedFields(lines,schema);
  let next={...doc};
  Object.entries(fields).forEach(([path,value])=>{
    if(!path||value==null)return;
    let v=String(value).trim();
    if(!v)return;
    if(/attendance/i.test(path))v=String(v.match(/\d+/)?.[0]||v);
    next=setByPath(next,path,v);
  });
  if(type==='부서별 주간보고서'&&!fields.subDepartment){
    const dep=detectEducationDept(lines,next.subDepartment);
    if(dep)next.subDepartment=dep;
  }
  return next;
}

function applySmartPaste(type,doc,text){return applyGeneralKeyedSmartFields(type,classifySmartPaste(type,doc,text),text)}
function smartPasteTargetsFor(type,selected=[]){
  const picked=(selected&&selected.length?selected:[type]).filter(Boolean);
  const unique=Array.from(new Set(picked));
  if(unique.includes('행사 및 수련회 기획안'))return unique.filter(t=>t!=='일정표');
  return unique;
}
function smartPasteExampleFor(type){
  if(type==='각부 월간행사 안내')return '7월 교육부 월간행사 안내\n7/7 오후 2시 교사기도회 비전홀\n7/14 오후 1시 여름사역 준비모임 교육관\n협조: 각 부서 참석 확인\n기도: 다음세대를 위해';
  if(type==='행사 및 수련회 기획안')return '청년부 여름수련회 기획안\n기간: 7월 25일~27일\n장소: 파주 살림채\n목적: 공동체가 함께 어울리고 예배로 세워지는 시간\n7/25 오후 7시 저녁집회 달빛관\n7/26 오전 10시 공동체 프로그램 세미나실\n준비물: 이름표, 음향, 간식\n예산: 숙박비 900,000원\n예산: 식비 750,000원';
  if(type==='예산안')return '수입 회비 25명 50,000원\n수입 교회지원 300,000원\n숙박비 객실예약 900,000원\n식비 25명 30,000원\n간식비 공동간식 150,000원';
  if(type==='세부 프로그램 문서')return '공동체 미션 프로그램\n목적: 서로를 알아가고 팀별 협력을 경험한다\n대상: 청년부 전체\n담당: 진행팀\n준비물: 미션카드, 펜, 상품\n5분 - 활동 안내\n25분 - 미션 진행\n10분 - 나눔 및 정리\n유의사항: 안전하게 이동하도록 안내한다';
  if(type==='준비목록')return '이름표\n마이크\n보조배터리\n간식\n현수막\n의자 세팅';
  if(type==='부서별 주간보고서')return '영아부 주간보고서\n출석/참여 8\n기간 2026.07.14\n작성자 김선규\n이번주 활동 = 분반\n다음주 계획 - 야외예배\n특이사항 - 없음\n기도제목 - 다음세대를 위해';
  if(type==='부서 통합 주간보고서')return '부서 통합 주간보고서\n기간 2026.07.14\n작성자 김선규\n영아부 출석/참여 8\n영아부 이번주 활동 분반\n영아부 다음주 계획 야외예배\n유치부 출석/참여 12\n공동 기도제목 - 다음세대를 위해';
  return '제목 또는 행사명\n주요 내용 1\n주요 내용 2\n요청사항 또는 기도제목';
}
function summarizeSmartPasteDoc(type,doc){
  if(!doc)return [];
  if(type==='각부 월간행사 안내')return [`제목: ${doc.title||'-'}`,`핵심일정: ${(doc.events||[]).filter(e=>e.title||e.date).length}개`,`협조요청: ${splitNonEmpty(doc.requests).length}줄`,`기도제목: ${splitNonEmpty(doc.prayers).length}줄`];
  if(type==='행사 및 수련회 기획안')return [`제목: ${doc.title||'-'}`,`기간: ${doc.period||'-'}`,`장소: ${doc.place||'-'}`,`상세일정: ${(doc.scheduleItems||[]).length}개`,`예산항목: ${(doc.expenseItems||[]).length}개`];
  if(type==='예산안')return [`수입: ${(doc.incomeItems||[]).length}개`,`지출: ${(doc.expenseItems||[]).length}개`];
  if(type==='세부 프로그램 문서')return [`프로그램: ${(doc.programs||[])[0]?.name||'-'}`,`진행순서: ${splitNonEmpty((doc.programs||[])[0]?.order).length}줄`,`준비물: ${splitNonEmpty((doc.programs||[])[0]?.materials).length}줄`];
  if(type==='준비목록')return [`준비항목: ${(doc.items||[]).length}개`];
  if(type==='부서별 주간보고서')return [`제목: ${doc.reportTitle||'-'}`,`부서: ${doc.subDepartment||'-'}`,`출석/참여: ${doc.attendance||'-'}명`,`기간: ${doc.period||'-'}`,`작성자: ${doc.writer||'-'}`,`이번 주 활동: ${doc.thisWeek||'-'}`,`다음 주 계획: ${doc.nextWeek||'-'}`,`특이사항: ${doc.special||'-'}`,`기도제목: ${doc.prayer||'-'}`];
  if(type==='부서 통합 주간보고서')return [`제목: ${doc.reportTitle||'-'}`,`기간: ${doc.period||'-'}`,`작성자: ${doc.writer||'-'}`,`영아부 출석: ${doc['영아부_attendance']||'-'}명`,`공동 기도제목: ${splitNonEmpty(doc.commonPrayer).length}줄`];
  if(type===CUE_DOC)return [`진행순서: ${(doc.rows||[]).length}개`];
  return [`내용: ${Object.values(doc).filter(v=>typeof v==='string'&&v.trim()).length}개 항목`];
}

function smartPasteDynamicTemplateFor(type,doc={}){
  const manual=smartPasteTemplateFor(type);
  if(manual&&manual!=='제목: \n기간: \n작성자: \n내용: ')return manual;
  const fields=reviewFieldsFor(type,doc).slice(0,14);
  if(fields.length)return [`${type}`, ...fields.map(f=>`${f.label}: `)].join('\n');
  return manual;
}
function fieldOptionsForLineMap(type,draft){
  const seen=new Set();
  return reviewFieldsFor(type,draft).filter(f=>{
    if(!f.path||seen.has(f.path))return false;
    seen.add(f.path); return true;
  });
}
function extractMappedValue(line,field,type){
  if(!field)return cleanLine(line);
  const aliases=aliasesForQuickPath(field.path,field.label,type).map(aliasToRegex);
  const matched=matchFieldLine(line,aliases);
  if(matched!==null)return matched||'';
  return lineValue(line)||cleanLine(line);
}
function guessLineFieldPath(type,draft,line){
  const fields=fieldOptionsForLineMap(type,draft);
  for(const f of fields){
    const aliases=aliasesForQuickPath(f.path,f.label,type).map(aliasToRegex);
    const matched=matchFieldLine(line,aliases);
    if(matched!==null)return f.path;
  }
  const raw=cleanLine(line);
  if(!raw)return '';
  if(type==='각부 월간행사 안내'){
    if(/기도/.test(raw))return 'prayers';
    if(/협조|확인|요청|참석|제출|준비/.test(raw))return 'requests';
    if(/문의|담당/.test(raw))return 'contact';
  }
  if(type==='행사 및 수련회 기획안'){
    if(/목적|취지|기대/.test(raw))return 'purpose';
    if(/준비|물품|세팅/.test(raw))return 'preparation';
    if(/장소|교육관|본당|홀|실|펜션/.test(raw))return 'place';
  }
  if(type==='세부 프로그램 문서'){
    if(/목적|기대/.test(raw))return 'programs.0.goal';
    if(/진행\s*방법|방법|방식/.test(raw))return 'programs.0.method';
    if(/준비|물품|세팅|마이크|펜|상품/.test(raw))return 'programs.0.materials';
    if(/^\d+\s*분|순서|진행순서/.test(raw))return 'programs.0.order';
    if(/유의|주의|안전/.test(raw))return 'programs.0.note';
  }
  if(type==='부서별 주간보고서'){
    if(/이번\s*주|금주/.test(raw))return 'thisWeek';
    if(/다음\s*주|차주/.test(raw))return 'nextWeek';
    if(/특이|비고|요청/.test(raw))return 'special';
    if(/기도/.test(raw))return 'prayer';
  }
  if(dateish(raw)){
    const firstDateField=fields.find(f=>/날짜|일시|기간|월/.test(f.label));
    if(firstDateField)return firstDateField.path;
  }
  if(moneyish(raw)){
    const moneyField=fields.find(f=>/금액|예산|지출|수입|근거/.test(f.label));
    if(moneyField)return moneyField.path;
  }
  return '';
}
function buildLineAssignments(type,draft,raw){
  const lines=splitNonEmpty(raw).slice(0,40);
  return lines.map((line,i)=>{
    const path=guessLineFieldPath(type,draft,line);
    const field=fieldOptionsForLineMap(type,draft).find(f=>f.path===path);
    return {id:`${i}-${line.slice(0,12)}`,line,path,value:extractMappedValue(line,field,type)};
  });
}
function SmartLineMapper({type,draft,raw,onPatch}){
  const fields=fieldOptionsForLineMap(type,draft);
  const [rows,setRows]=useState(()=>buildLineAssignments(type,draft,raw));
  useEffect(()=>{setRows(buildLineAssignments(type,draft,raw))},[type,raw]);
  if(!raw.trim()||!fields.length)return null;
  function patchRow(i,key,value){setRows(prev=>prev.map((r,idx)=>idx===i?{...r,[key]:value,value:key==='path'?extractMappedValue(r.line,fields.find(f=>f.path===value),type):r.value}:r));}
  function applyRows(){
    const acc={};
    rows.forEach(r=>{
      if(!r.path)return;
      const field=fields.find(f=>f.path===r.path);
      const v=String(r.value||'').trim();
      if(!v)return;
      if(field?.kind==='area')acc[r.path]=acc[r.path]?[acc[r.path],v].join('\n'):v;
      else acc[r.path]=v;
    });
    Object.entries(acc).forEach(([path,value])=>onPatch(path,value));
  }
  const matched=rows.filter(r=>r.path).length;
  return <div className="line-mapper-card">
    <div className="line-mapper-head"><div><b>원문 줄 빠른 배정</b><span>자동정리가 틀리면 세부 입력창을 열지 말고, 여기서 줄마다 들어갈 칸만 바꾸세요.</span></div><em>{matched}/{rows.length}줄 배정</em></div>
    <div className="line-mapper-table">
      <div className="line-mapper-row head"><b>원문</b><b>들어갈 칸</b><b>적용될 내용</b></div>
      {rows.map((r,i)=><div className="line-mapper-row" key={r.id}>
        <span className="raw-line">{r.line}</span>
        <select value={r.path} onChange={e=>patchRow(i,'path',e.target.value)}>
          <option value="">사용 안 함 / 확인 필요</option>
          {fields.map(f=><option key={f.path} value={f.path}>{f.label}</option>)}
        </select>
        <input value={r.value||''} onChange={e=>patchRow(i,'value',e.target.value)} />
      </div>)}
    </div>
    <div className="line-mapper-actions"><button type="button" onClick={applyRows}>배정표 내용을 검수 결과에 반영</button><span>반영 후 아래 칸맞춤 검수에서 한 번 더 확인하고 문서에 적용하세요.</span></div>
  </div>
}

function SmartPastePanel({type,doc,setDoc,selectedTypes=[],allDocs,setAllDocs}){
  const [raw,setRaw]=useState('');
  const [mode,setMode]=useState('checked');
  const [drafts,setDrafts]=useState(null);
  const targets=mode==='checked'?smartPasteTargetsFor(type,selectedTypes):[type];
  const canChecked=!!selectedTypes?.length;
  function makeDrafts(){
    if(!raw.trim())return;
    const next={};
    targets.forEach(t=>{
      const base=(t===type?doc:(allDocs?.[t]||withBase(t,initialData(t))));
      next[t]=withBase(t,applySmartPaste(t,base,raw));
    });
    setDrafts(next);
  }
  function applyDrafts(){
    if(!drafts)return;
    if(mode==='checked'&&setAllDocs){
      setAllDocs(prev=>{const next={...prev};Object.entries(drafts).forEach(([t,d])=>{next[t]=withBase(t,d)});return next;});
    }else if(drafts[type])setDoc(drafts[type]);
    setDrafts(null); setRaw('');
  }
  function patchDraft(t,path,value){
    setDrafts(prev=>prev?{...prev,[t]:setByPath(prev[t],path,value)}:prev);
  }
  function setExample(){setRaw(smartPasteExampleFor(type));setDrafts(null)}
  function setTemplate(){setRaw(smartPasteDynamicTemplateFor(type,doc));setDrafts(null)}
  const targetLabel=targets.length>1?`${targets.length}개 문서로 나눠 정리`:'현재 문서로 정리';
  return <section className="smart-paste-hub smart-paste-v134 smart-paste-v136" data-editor-title="자동정리">
    <div className="smart-hub-head"><div><b>1분 행정문서 작성</b><span>카톡·메모를 붙여넣고, 자동정리 결과를 칸별로 확인한 뒤 바로 적용합니다.</span></div><strong>{targetLabel}</strong></div>
    <div className="smart-paste-steps"><span><b>1</b> 붙여넣기</span><span><b>2</b> 자동정리</span><span><b>3</b> 빠른 검수/수정</span><span><b>4</b> 적용</span></div>
    <div className="smart-hub-target-row"><button type="button" className={mode==='current'?'active':''} onClick={()=>{setMode('current');setDrafts(null)}}>현재 문서만</button><button type="button" className={mode==='checked'?'active':''} onClick={()=>{setMode('checked');setDrafts(null)}} disabled={!canChecked}>체크한 문서에 나눠 적용</button><div className="smart-paste-targets compact"><b>적용 대상</b>{targets.map(t=><span key={t}>{t}</span>)}</div></div>
    <div className="paste-helper-row paste-helper-row-v137"><button type="button" className="primary-helper" onClick={setTemplate}>현재 문서 칸 만들기</button><button type="button" onClick={setExample}>예시 넣기</button><span><b>가장 쉬운 방법:</b> 칸 만들기 → 빈칸만 채우기 → 자동정리 결과 보기 → 적용</span></div>
    <textarea value={raw} onChange={e=>{setRaw(e.target.value);setDrafts(null)}} placeholder={smartPasteExampleFor(type)} />
    <div className="smart-paste-actions"><button type="button" className="btn secondary big-organize-btn" onClick={makeDrafts}>1. 자동정리 결과 보기</button><button type="button" className="btn" onClick={()=>{setRaw('');setDrafts(null)}}>비우기</button></div>
    <p className="hint smart-paste-note"><b>자동정리는 보조, 칸맞춤 검수가 핵심입니다.</b> 100% 맞지 않아도 원문 줄 빠른 배정에서 들어갈 칸만 바꾸면 세부 입력을 열지 않고 완성할 수 있습니다.</p>
    {drafts&&<div className="smart-draft-review smart-draft-review-v136"><div className="review-head"><b>자동정리 결과 확인 · 틀린 칸은 바로 수정</b><span>이 단계가 핵심입니다. 자동정리가 100%가 아니어도 여기서 빠르게 고치고 적용하면 됩니다.</span></div>
      <div className="smart-draft-grid">{Object.entries(drafts).map(([t,d])=><div className="smart-draft-card" key={t}><b>{t}</b>{summarizeSmartPasteDoc(t,d).map((line,i)=><span key={i}>{line}</span>)}</div>)}</div>
      <div className="smart-draft-editors">{Object.entries(drafts).map(([t,d])=><div className="smart-draft-editor-card" key={t}><h4>{t} 칸맞춤 검수</h4><SmartLineMapper type={t} draft={d} raw={raw} onPatch={(path,value)=>patchDraft(t,path,value)}/><SmartDraftEditor type={t} draft={d} onPatch={(path,value)=>patchDraft(t,path,value)}/></div>)}</div>
      <div className="smart-review-actions sticky-apply"><button type="button" className="btn secondary" onClick={applyDrafts}>2. 검수한 내용 문서에 적용</button><button type="button" className="btn" onClick={makeDrafts}>다시 정리</button><button type="button" className="btn" onClick={()=>setDrafts(null)}>결과 닫기</button></div></div>}
  </section>
}
function checkDocStatus(type,doc){
  const title=doc.title||doc.reportTitle||doc.eventName||doc.group||'';
  const checks=[{ok:!!String(title).trim(),text:'제목/문서명이 입력됨'}];
  if(type==='각부 월간행사 안내'){
    checks.push({ok:(doc.events||[]).some(e=>e.title||e.date),text:'월간 핵심일정 있음'});
    checks.push({ok:!!String(doc.requests||'').trim(),text:'확인 및 협조 요청 입력'});
    checks.push({ok:!!String(doc.prayers||'').trim(),text:'기도 제목 입력'});
  }else if(type==='행사 및 수련회 기획안'){
    checks.push({ok:!!String(doc.period||doc.date||'').trim(),text:'일정/기간 입력'});
    checks.push({ok:(doc.scheduleItems||[]).length>0,text:'상세 일정 있음'});
    checks.push({ok:(doc.incomeItems||[]).length+(doc.expenseItems||[]).length>0,text:'예산 항목 있음'});
  }else if(type==='예산안'){
    checks.push({ok:(doc.incomeItems||[]).length+(doc.expenseItems||[]).length>0,text:'수입/지출 항목 있음'});
  }else{
    checks.push({ok:true,text:'미리보기 확인 가능'});
  }
  return checks;
}
function DocumentCheckPanel({type,doc}){
  const checks=checkDocStatus(type,doc);
  const okCount=checks.filter(x=>x.ok).length;
  return <div className="doc-check-panel"><div><b>문서 상태</b><span>{okCount}/{checks.length} 확인됨</span></div><div className="doc-check-items">{checks.map((c,i)=><span key={i} className={c.ok?'ok':'warn'}>{c.ok?'✓':'!'} {c.text}</span>)}</div></div>
}

function quickField(label,path,kind='input',options=null,placeholder=''){return {label,path,kind,options,placeholder}}
function quickFieldsFor(type,doc={}){
  if(type==='기본 공지 안내문')return [quickField('제목','title'),quickField('대상','target'),quickField('일시','date'),quickField('장소','place'),quickField('안내 내용','content','area'),quickField('협조 요청','requests','area'),quickField('문의','contact'),quickField('하단 문구','footer')];
  if(type==='회의자료')return [quickField('회의명','title'),quickField('회의 유형','meetingType'),quickField('일시','date'),quickField('장소','place'),quickField('참석 대상','attendees','area'),quickField('작성자','writer'),quickField('회의 목적','purpose','area'),quickField('기도제목','prayer','area')];
  if(type==='연말/연차 부서 보고서')return [quickField('제목','title'),quickField('부서','department'),quickField('연도','year'),quickField('담당 교역자','pastor'),quickField('부장','leader'),quickField('작성자','writer'),quickField('요약','summary','area'),quickField('다음 해 계획','nextPlan','area')];
  if(type==='지출결의서')return [quickField('제목','title'),quickField('부서','department'),quickField('신청자','applicant'),quickField('작성일','writeDate'),quickField('사용일','useDate'),quickField('지출 목적','purpose','area'),quickField('지급 방법','paymentMethod'),quickField('증빙','receipt')];
  if(type==='차량/장소 사용 신청서')return [quickField('제목','title'),quickField('신청 유형','requestType','select',['차량 사용','장소 사용','차량+장소 사용']),quickField('부서','department'),quickField('신청자','applicant'),quickField('연락처','contact'),quickField('사용 목적','purpose','area'),quickField('사용 일시','date'),quickField('차량/장소','placeOrVehicle')];
  if(type==='부서별 주간보고서')return [
    quickField('문서 제목','reportTitle'),quickField('부서','subDepartment','select',EDU_DEPTS),quickField('출석/참여','attendance'),quickField('기간','period'),quickField('작성자','writer'),quickField('이번 주 활동','thisWeek','area'),quickField('다음 주 계획','nextWeek','area'),quickField('특이사항','special','area'),quickField('기도제목','prayer','area')
  ];
  if(type==='부서 통합 주간보고서')return [quickField('문서 제목','reportTitle'),quickField('기간','period'),quickField('작성자','writer'),quickField('전체 주간 활동 요약','summary','area'),quickField('공동 기도제목','commonPrayer','area'),quickField('공유/지원 요청','support','area')];
  if(type==='각부 월간행사 안내')return [quickField('제목','title'),quickField('부서/모임','group','select',['교육부','영아부','유치부','초등부','청소년부','청년부','속회','소그룹','기타']),quickField('월/기간','month'),quickField('확인 및 협조 요청','requests','area'),quickField('기도 제목','prayers','area'),quickField('문의/하단 정보','contact')];
  if(type==='행사 및 수련회 기획안')return [quickField('행사명/제목','title'),quickField('기간','period'),quickField('장소','place'),quickField('대상 및 인원','target'),quickField('담당','manager'),quickField('행사 목적','purpose','area'),quickField('준비사항','preparation','area')];
  if(type==='세부 프로그램 문서')return [quickField('문서 제목','title'),quickField('행사명','eventName'),quickField('기간','period'),quickField('담당','manager'),quickField('첫 프로그램 이름','programs.0.name'),quickField('목적/기대효과','programs.0.goal','area'),quickField('진행 방법','programs.0.method','area'),quickField('준비물','programs.0.materials','area'),quickField('진행 순서','programs.0.order','area'),quickField('유의사항','programs.0.note','area')];
  if(type==='예산안')return [quickField('문서 제목','title'),quickField('기간','period'),quickField('담당','manager'),quickField('산출 근거','basis','area'),quickField('비고 및 확인사항','notes','area')];
  if(type==='준비목록')return [quickField('문서 제목','title'),quickField('행사명','eventName'),quickField('기간','period'),quickField('담당','manager'),quickField('비고','notes','area')];
  if(type===CUE_DOC)return [quickField('큐시트 제목','title'),quickField('일시','date'),quickField('장소','place'),quickField('진행/총괄','director'),quickField('주제','theme')];
  if(type==='신청서 양식')return [quickField('제목','title'),quickField('행사명','eventName'),quickField('신청 대상','target'),quickField('신청 기간','period'),quickField('행사 일시','eventDate'),quickField('장소','place'),quickField('문의','contact'),quickField('안내사항','notes','area')];
  const fields=[]; const titlePath=titlePathOf(type); const metaPath=metaPathOf(type);
  if(titlePath)fields.push(quickField('제목',titlePath));
  if(metaPath)fields.push(quickField('기간/일시',metaPath));
  ['writer','manager','director'].forEach(k=>{if(Object.prototype.hasOwnProperty.call(doc,k))fields.push(quickField(k==='writer'?'작성자':k==='manager'?'담당':'진행/총괄',k))});
  ['content','summary','thisWeek','nextWeek','special','prayer','requests','note'].forEach(k=>{if(Object.prototype.hasOwnProperty.call(doc,k))fields.push(quickField(k,k,'area'))});
  return fields.slice(0,8);
}
function renderQuickField(f,doc,patch){
  const value=getByPath(doc,f.path)||'';
  if(f.kind==='area')return <Area key={f.path} label={f.label} value={value} onChange={v=>patch(f.path,v)}/>;
  if(f.kind==='select')return <Select key={f.path} label={f.label} value={value} options={f.options||[]} onChange={v=>patch(f.path,v)}/>;
  return <Field key={f.path} label={f.label} value={value} onChange={v=>patch(f.path,v)}/>;
}
function QuickWritePanel({type,doc,setDoc}){
  const fields=quickFieldsFor(type,doc);
  if(!fields.length)return null;
  function patch(path,value){setDoc(setByPath(doc,path,value))}
  return <section className="quick-write-panel" data-editor-title="빠른 작성">
    <div className="quick-write-head"><div><b>빠른 작성</b><span>자동정리가 어긋나도 이 핵심 칸만 고치면 문서가 바로 완성됩니다. 표·디자인·페이지는 필요할 때만 ‘더 자세히 수정하기’에서 조정합니다.</span></div><em>{type}</em></div>
    <div className="quick-write-grid">{fields.map(f=>renderQuickField(f,doc,patch))}</div>
  </section>
}
function smartPasteTemplateFor(type){
  if(type==='부서별 주간보고서')return '영아부 주간보고서\n출석/참여: \n기간: \n작성자: \n이번주 활동: \n다음주 계획: \n특이사항: \n기도제목: ';
  if(type==='부서 통합 주간보고서')return '부서 통합 주간보고서\n기간: \n작성자: \n전체 주간 활동 요약: \n공동 기도제목: \n공유/지원 요청: \n영아부 출석/참여: \n영아부 이번주 활동: \n영아부 다음주 계획: ';
  if(type==='각부 월간행사 안내')return '제목: \n부서: \n월/기간: \n일정: 7/7 / 오후 2시 / 행사명 / 장소\n일정: 7/18(토)-19(주일) / 오후 3시 / 부서 여름행사 / 수양관\n협조 요청: \n기도제목: \n문의: ';
  if(type==='행사 및 수련회 기획안')return '행사명: \n기간: \n장소: \n대상: \n담당: \n목적: \n준비사항: \n일정: 1일차 19:00 저녁집회\n예산: 숙박비 900,000원';
  if(type==='세부 프로그램 문서')return '프로그램명: \n대상: \n담당: \n목적: \n진행방법: \n준비물: \n진행순서: 5분 - 안내\n진행순서: 25분 - 활동\n유의사항: ';
  if(type==='예산안')return '제목: \n기간: \n담당: \n산출근거: \n수입: 회비 20명 50,000원\n지출: 식비 20명 10,000원\n지출: 간식비 100,000원';
  if(type==='준비목록')return '행사명: \n기간: \n담당: \n물품: 이름표\n세팅: 마이크\n식사: 간식\n행정: 신청자 명단';
  if(type===CUE_DOC)return '큐시트 제목: \n일시: \n장소: \n진행/총괄: \n13:40 리허설 사회자/방송팀\n14:00 오프닝 사회자\n14:30 말씀/강의 강사';
  return '제목: \n기간: \n작성자: \n내용: ';
}
function reviewFieldsFor(type,doc={}){
  const base=quickFieldsFor(type,doc);
  const extra=[];
  if(type==='각부 월간행사 안내'){
    (doc.events||[]).slice(0,6).forEach((_,i)=>{extra.push(quickField(`일정 ${i+1} 날짜/기간`,`events.${i}.date`));extra.push(quickField(`일정 ${i+1} 시간`,`events.${i}.time`));extra.push(quickField(`일정 ${i+1} 행사명`,`events.${i}.title`));extra.push(quickField(`일정 ${i+1} 장소`,`events.${i}.place`));});
  }
  if(type==='행사 및 수련회 기획안'){
    (doc.scheduleItems||[]).slice(0,6).forEach((_,i)=>{extra.push(quickField(`일정 ${i+1} 일차`,`scheduleItems.${i}.day`));extra.push(quickField(`일정 ${i+1} 시작`,`scheduleItems.${i}.start`));extra.push(quickField(`일정 ${i+1} 내용`,`scheduleItems.${i}.title`));});
    (doc.expenseItems||[]).slice(0,4).forEach((_,i)=>{extra.push(quickField(`예산 ${i+1} 항목`,`expenseItems.${i}.item`));extra.push(quickField(`예산 ${i+1} 금액`,`expenseItems.${i}.price`));});
  }
  if(type==='예산안'){
    (doc.incomeItems||[]).slice(0,3).forEach((_,i)=>{extra.push(quickField(`수입 ${i+1} 항목`,`incomeItems.${i}.item`));extra.push(quickField(`수입 ${i+1} 금액`,`incomeItems.${i}.price`));});
    (doc.expenseItems||[]).slice(0,5).forEach((_,i)=>{extra.push(quickField(`지출 ${i+1} 항목`,`expenseItems.${i}.item`));extra.push(quickField(`지출 ${i+1} 금액`,`expenseItems.${i}.price`));});
  }
  if(type==='준비목록'){
    (doc.items||[]).slice(0,8).forEach((_,i)=>{extra.push(quickField(`준비 ${i+1} 분류`,`items.${i}.category`));extra.push(quickField(`준비 ${i+1} 항목`,`items.${i}.item`));extra.push(quickField(`준비 ${i+1} 담당`,`items.${i}.owner`));});
  }
  if(type===CUE_DOC){
    (doc.rows||[]).slice(0,6).forEach((_,i)=>{extra.push(quickField(`순서 ${i+1} 시간`,`rows.${i}.time`));extra.push(quickField(`순서 ${i+1} 항목`,`rows.${i}.part`));extra.push(quickField(`순서 ${i+1} 내용`,`rows.${i}.content`));extra.push(quickField(`순서 ${i+1} 담당`,`rows.${i}.person`));});
  }
  return [...base,...extra];
}
function SmartDraftEditor({type,draft,onPatch}){
  const fields=reviewFieldsFor(type,draft);
  const filled=fields.filter(f=>String(getByPath(draft,f.path)||'').trim()).length;
  return <div className="smart-draft-editor"><div className="smart-draft-score"><b>빠른 검수</b><span>{filled}/{fields.length}칸 인식됨</span><em>틀린 칸은 여기서 바로 고친 뒤 적용하세요.</em></div><div className="smart-draft-edit-grid">{fields.map(f=>{
    const value=getByPath(draft,f.path)||'';
    if(f.kind==='area')return <label className="draft-field draft-field-area" key={f.path}><span>{f.label}</span><textarea value={value} onChange={e=>onPatch(f.path,e.target.value)} /></label>;
    if(f.kind==='select')return <label className="draft-field" key={f.path}><span>{f.label}</span><select value={value} onChange={e=>onPatch(f.path,e.target.value)}>{(f.options||[]).map(o=><option key={o}>{o}</option>)}</select></label>;
    return <label className="draft-field" key={f.path}><span>{f.label}</span><input value={value} onChange={e=>onPatch(f.path,e.target.value)} /></label>;
  })}</div></div>
}


function v2RequiredLabels(type){
  if(type==='기본 공지 안내문')return ['제목','대상','일시','장소','안내 내용','문의'];
  if(type==='회의자료')return ['회의명','일시','장소','참석 대상','주요 안건','결정사항'];
  if(type==='연말/연차 부서 보고서')return ['부서','연도','주요 사역','평가','다음 해 계획'];
  if(type==='지출결의서')return ['부서','신청자','지출 목적','지출 내역','증빙'];
  if(type==='차량/장소 사용 신청서')return ['신청 유형','부서','신청자','사용 일시','사용 목적'];
  if(type==='부서별 주간보고서')return ['부서','출석/참여','기간','작성자','이번 주 활동','다음 주 계획','특이사항','기도제목'];
  if(type==='부서 통합 주간보고서')return ['기간','작성자','전체 주간 활동 요약','공동 기도제목','공유/지원 요청'];
  if(type==='각부 월간행사 안내')return ['제목','월/기간','월간 핵심일정','확인 및 협조 요청','기도 제목','문의/하단 정보'];
  if(type==='행사 및 수련회 기획안')return ['행사명/제목','기간','장소','대상 및 인원','행사 목적','상세 일정','예산'];
  if(type==='세부 프로그램 문서')return ['문서 제목','프로그램명','목적/기대효과','진행 방법','준비물','진행 순서','유의사항'];
  if(type==='예산안')return ['문서 제목','기간','수입','지출','산출 근거'];
  if(type==='준비목록')return ['행사명','기간','준비 항목','담당'];
  if(type===CUE_DOC)return ['큐시트 제목','일시','장소','진행 순서','담당'];
  return ['제목','기간/일시','내용'];
}
function v2FieldImportance(field,type){
  const required=v2RequiredLabels(type).some(label=>String(field.label||'').replace(/\s+/g,'').includes(label.replace(/\s+/g,''))||label.replace(/\s+/g,'').includes(String(field.label||'').replace(/\s+/g,'')));
  if(required)return 'required';
  if(/일정|예산|수입|지출|준비|순서|항목/.test(field.label))return 'table';
  return 'optional';
}
function v2Progress(type,doc){
  const fields=reviewFieldsFor(type,doc).filter(f=>v2FieldImportance(f,type)==='required');
  const total=Math.max(1,fields.length);
  const filled=fields.filter(f=>String(getByPath(doc,f.path)||'').trim()).length;
  return {filled,total,percent:Math.round(filled/total*100)};
}
function V2InputField({field,doc,onPatch}){
  const value=getByPath(doc,field.path)||'';
  const requiredClass=String(value).trim()?'filled':'empty';
  if(field.kind==='area')return <label className={`v2-fill-field area ${requiredClass}`}><span>{field.label}</span><textarea value={value} placeholder={`${field.label}을 입력하세요`} onChange={e=>onPatch(field.path,e.target.value)} /></label>;
  if(field.kind==='select')return <label className={`v2-fill-field ${requiredClass}`}><span>{field.label}</span><select value={value} onChange={e=>onPatch(field.path,e.target.value)}>{(field.options||[]).map(o=><option key={o}>{o}</option>)}</select></label>;
  return <label className={`v2-fill-field ${requiredClass}`}><span>{field.label}</span><input value={value} placeholder={`${field.label} 입력`} onChange={e=>onPatch(field.path,e.target.value)} /></label>;
}
function V2QuickAddButtons({type,doc,setDoc}){
  const add=(patch)=>setDoc({...doc,...patch});
  const buttons=[];
  if(type==='주간 공지'){
    buttons.push(['+ 주요 공지',()=>add({items:[...(doc.items||[]),eventRow()]})]);
  }
  if(type==='각부 월간행사 안내'){
    buttons.push(['+ 핵심일정',()=>add({events:[...(doc.events||[]),eventRow()]})]);
    buttons.push(['+ 참고일정',()=>add({deptRows:[...(doc.deptRows||[]),deptRow()]})]);
  }
  if(type==='예산안'){
    buttons.push(['+ 수입',()=>add({incomeItems:[...(doc.incomeItems||[]),budgetRow()]})]);
    buttons.push(['+ 지출',()=>add({expenseItems:[...(doc.expenseItems||[]),budgetRow()]})]);
  }
  if(type==='준비목록')buttons.push(['+ 준비항목',()=>add({items:[...(doc.items||[]),prepRow('','','','','','물품')]})]);
  if(type==='세부 프로그램 문서')buttons.push(['+ 프로그램',()=>add({programs:[...(doc.programs||[]),programRow((doc.programs||[]).length+1)]})]);
  if(type===CUE_DOC)buttons.push(['+ 진행순서',()=>add({rows:[...(doc.rows||[]),cueRow()]})]);
  if(type==='회의자료'){
    buttons.push(['+ 안건',()=>add({agendaItems:[...(doc.agendaItems||[]),meetingAgendaRow()]})]);
    buttons.push(['+ 일정 확인',()=>add({meetingSchedules:[...(doc.meetingSchedules||[]),meetingScheduleRow()]})]);
    buttons.push(['+ 역할분담',()=>add({actionItems:[...(doc.actionItems||[]),meetingActionRow()]})]);
  }
  if(!buttons.length)return null;
  return <div className="v2-quick-add v237-quick-add v238-essential-add"><b>필요 항목 추가</b>{buttons.map(([label,fn])=><button type="button" key={label} onClick={fn}>{label}</button>)}<span>줄바꿈으로 충분한 항목은 제외하고, 실제 카드·표가 늘어나는 항목만 표시합니다.</span></div>;
}

function rowValue(row,key){return row?.[key]??''}
function V21MiniField({label,value,onChange,type='text',wide=false,placeholder=''}){return <label className={wide?'v21-mini-field wide':'v21-mini-field'}><span>{label}</span><input type={type} value={value||''} placeholder={placeholder} onChange={e=>onChange(e.target.value)} /></label>}
function scheduleTimeOptions(startHour=5,endHour=24,step=30){
  const start=Math.max(0,Math.min(23,Number(startHour)||5))*60;
  const endRaw=Math.max(1,Math.min(24,Number(endHour)||24))*60;
  const end=Math.max(start+step,endRaw);
  const list=[];
  for(let m=start;m<=end;m+=step){
    const h=Math.floor(m/60); const mm=m%60;
    if(h>=24)break;
    list.push(`${String(h).padStart(2,'0')}:${String(mm).padStart(2,'0')}`);
  }
  return list;
}
function koreanTimeLabel(value){
  const normalized=normalizeTimeText(value);
  const m=String(normalized||'').match(/^(\d{1,2}):(\d{2})$/);
  if(!m)return value||'';
  const h=Number(m[1]); const min=m[2];
  const meridiem=h<12?'오전':'오후';
  const hh=h===0?12:(h>12?h-12:h);
  return `${meridiem} ${hh}:${min}`;
}
function V21TimeSelect({label,value,onChange,options,placeholder}){
  const normalized=normalizeTimeText(value||'');
  const baseOptions=options?.length?options:scheduleTimeOptions(5,24,30);
  const optionList=normalized&&!baseOptions.includes(normalized)?[normalized,...baseOptions].sort((a,b)=>timeToMin(a)-timeToMin(b)):baseOptions;
  const current=normalized&&optionList.includes(normalized)?normalized:'';
  return <label className="v21-mini-field v21-time-select"><span>{label}</span><select value={current} onChange={e=>onChange(e.target.value)}><option value="">{placeholder||`${label} 선택`}</option>{optionList.map(o=><option key={o} value={o}>{koreanTimeLabel(o)}</option>)}</select></label>
}
function V21TimeField({label,value,onChange,onCommit}){
  function commit(v){const normalized=normalizeTimeText(v);(onCommit||onChange)(normalized||v)}
  return <label className="v21-mini-field v21-time-field"><span>{label}</span><input type="text" inputMode="numeric" value={value||''} placeholder="예: 13:30 / 오후 1:30" onFocus={e=>e.target.select()} onChange={e=>onChange(e.target.value)} onBlur={e=>commit(e.target.value)} /><small>클릭하면 전체 선택됩니다. 오후 1:30처럼 입력해도 13:30으로 정리됩니다.</small></label>
}
function V21MiniArea({label,value,onChange,placeholder=''}){return <label className="v21-mini-field wide"><span>{label}</span><textarea value={value||''} placeholder={placeholder} onChange={e=>onChange(e.target.value)} /></label>}
function V21Select({label,value,onChange,options}){return <label className="v21-mini-field"><span>{label}</span><select value={value||options?.[0]||''} onChange={e=>onChange(e.target.value)}>{(options||[]).map(o=><option key={o}>{o}</option>)}</select></label>}
function V21IconSelect({label='아이콘',value,onChange}){return <label className="v21-mini-field v21-icon-field"><span>{label}</span><select value={value||''} onChange={e=>onChange(e.target.value)}><option value="">없음</option>{ICON_OPTIONS.map(o=><option key={o} value={o}>{o}</option>)}</select></label>}
function V21RowCard({title,onDelete,children}){return <div className="v21-row-card"><div className="v21-row-card-head"><b>{title}</b>{onDelete&&<button type="button" onClick={onDelete}>삭제</button>}</div><div className="v21-row-card-body">{children}</div></div>}
function V21EventsBlock({doc,setDoc}){
  const rows=doc.events?.length?doc.events:[eventRow()];
  function setRows(next){setDoc({...doc,events:next})}
  function patch(i,k,v){
    let value=v;
    let extra=null;
    if(k==='date'){
      const parts=splitMonthlyDateTime(v);
      if(parts.time&&!rows[i]?.time){value=parts.date;extra={time:parts.time};}
    }
    setRows(rows.map((r,idx)=>idx===i?{...r,[k]:value,...(extra||{})}:r))
  }
  return <section className="v21-auto-block v224-monthly-event-editor v226-monthly-event-editor"><div className="v21-block-head"><div><b>월간 핵심일정 자동표</b><span>날짜/기간과 시간을 따로 입력하면 미리보기에서 날짜는 위, 시간은 아래로 안정적으로 정리됩니다.</span></div><button type="button" onClick={()=>setRows([...rows,eventRow()])}>+ 핵심일정 추가</button></div>{rows.map((r,i)=><V21RowCard key={i} title={`핵심일정 ${i+1}`} onDelete={rows.length>1?()=>setRows(rows.filter((_,idx)=>idx!==i)):null}><V21MiniField label="날짜/기간" placeholder="예: 7/18(토)-19(주일)" value={r.date} onChange={v=>patch(i,'date',v)}/><V21MiniField label="시간" placeholder="예: 오후 3:00" value={r.time||splitMonthlyDateTime(r.date).time} onChange={v=>patch(i,'time',v)}/><V21MiniField label="행사명" placeholder="예: 부서 여름행사" value={r.title} onChange={v=>patch(i,'title',v)}/><V21MiniField label="장소" placeholder="예: 수양관" value={r.place} onChange={v=>patch(i,'place',v)}/><V21MiniField label="대상" placeholder="예: 해당 부서 학생 및 교사" value={r.target} onChange={v=>patch(i,'target',v)}/><V21MiniArea label="내용" placeholder="예: 말씀과 공동체 프로그램" value={r.content} onChange={v=>patch(i,'content',v)}/></V21RowCard>)}</section>}
function makeDayLabels(count){const n=Math.max(1,Math.min(10,Number(count)||1));return Array.from({length:n},(_,i)=>`${i+1}일차`)}
function v25DaysForPreset(preset){
  if(preset==='당일 행사')return makeDayLabels(1);
  const m=String(preset||'').match(/(\d+)박\s*(\d+)일/);
  if(m)return makeDayLabels(Number(m[2]));
  return makeDayLabels(3);
}
function v25PresetFromDays(doc){
  const n=(doc.days||[]).length||1;
  if(doc.schedulePreset && v25DaysForPreset(doc.schedulePreset).length===n)return doc.schedulePreset;
  if(n<=1)return '당일 행사';
  if(n===2)return '1박 2일';
  if(n===3)return '2박 3일';
  if(n===4)return '3박 4일';
  if(n===5)return '4박 5일';
  if(n===6)return '5박 6일';
  return `${n-1}박 ${n}일`;
}
function V25ScheduleSetup({doc,setDoc,activeDay,setActiveDay}){
  const preset=v25PresetFromDays(doc);
  const days=doc.days?.length?doc.days:v25DaysForPreset(preset);
  function applyPreset(nextPreset){
    const nextDays=v25DaysForPreset(nextPreset);
    const allowed=new Set(nextDays);
    const nextRows=(doc.scheduleItems||[]).map(r=>({...r,day:allowed.has(r.day)?r.day:nextDays[0]}));
    setActiveDay?.(nextDays[0]);
    setDoc({...doc,schedulePreset:nextPreset,days:nextDays,scheduleItems:nextRows});
  }
  function patch(k,v){setDoc({...doc,[k]:v})}
  function addDay(){
    const nextDay=`${days.length+1}일차`;
    const nextDays=[...days,nextDay];
    setActiveDay?.(nextDay);
    setDoc({...doc,schedulePreset:`${nextDays.length-1}박 ${nextDays.length}일`,days:nextDays,scheduleItems:doc.scheduleItems||[]});
  }
  function removeDay(day){
    if(days.length<=1)return;
    const fallback=days.find(x=>x!==day)||'1일차';
    const nextDays=days.filter(x=>x!==day).map((_,i)=>`${i+1}일차`);
    const renameMap=Object.fromEntries(days.filter(x=>x!==day).map((old,i)=>[old,`${i+1}일차`]));
    const nextRows=(doc.scheduleItems||[])
      .filter(r=>(r.day||days[0])!==day)
      .map(r=>({...r,day:renameMap[r.day]||nextDays[0]}));
    const nextActive=nextDays.includes(activeDay)?renameMap[activeDay]||activeDay:nextDays[0];
    setActiveDay?.(nextActive);
    setDoc({...doc,schedulePreset:`${nextDays.length-1}박 ${nextDays.length}일`,days:nextDays,scheduleItems:nextRows});
  }
  return <section className="v25-schedule-setup v15-day-manager">
    <div className="v25-page-card-title"><b>일정표 설정</b><span>기본 선택은 3박4일까지 보이고, 그 이상은 “일차 추가”로 늘립니다.</span></div>
    <div className="v25-schedule-preset-row">
      {['당일 행사','1박 2일','2박 3일','3박 4일'].map(x=><button type="button" key={x} className={preset===x?'active':''} onClick={()=>applyPreset(x)}>{x}</button>)}
    </div>
    <div className="v25-day-manage-row">
      <div><b>현재 구성</b><span>{days.length}일 일정 · {days.join(' / ')}</span></div>
      <div className="v25-day-manage-actions">
        <button type="button" className="btn secondary" onClick={addDay}>+ 일차 추가</button>
        {days.length>1&&<button type="button" className="btn" onClick={()=>removeDay(days[days.length-1])}>마지막 일차 삭제</button>}
      </div>
    </div>
    <div className="v25-mini-grid">
      <V21Select label="시작 시간" value={String(doc.startHour||'8')} options={['5','6','7','8','9','10','11','12']} onChange={v=>patch('startHour',v)}/>
      <V21Select label="종료 시간" value={String(doc.endHour||'23')} options={['18','19','20','21','22','23','24']} onChange={v=>patch('endHour',v)}/>
      <V21Select label="시간 단위" value={String(doc.slotMinutes||'60')} options={['30','60']} onChange={v=>patch('slotMinutes',v)}/>
      <V21Select label="일정표 글씨" value={String(doc.scheduleFontScale||'100')} options={['85','95','100','110','120','130']} onChange={v=>patch('scheduleFontScale',v)}/>
      <V21Select label="출력 방식" value={String(doc.schedulePageMode||'한 페이지 맞춤')} options={['한 페이지 맞춤','일차별 여유형']} onChange={v=>patch('schedulePageMode',v)}/>
    </div>
    {(days.length>=4)&&<p className="v25-schedule-output-hint"><b>{days.length}일 일정 안내</b> 일정이 많으면 ‘일차별 여유형’을 선택해 A4 여러 장으로 나누면 더 읽기 좋습니다.</p>}
  </section>
}
function V229ScheduleRowEditor({row,index,days,onPatch,onDelete,total,doc}){
  const timeOptions=scheduleTimeOptions(doc?.startHour||5,doc?.endHour||24,30);
  const normalizedStart=normalizeTimeText(row.start||'');
  const normalizedEnd=normalizeTimeText(row.end||'');
  const timeTitle=normalizedStart&&normalizedEnd?`${koreanTimeLabel(normalizedStart)}-${koreanTimeLabel(normalizedEnd)}`:normalizedStart?koreanTimeLabel(normalizedStart):'시간 미선택';
  const titleText=[row.day,timeTitle,row.title].filter(Boolean).join(' · ');
  function nearestEndAfter(startValue){
    const startMin=timeToMin(startValue);
    const after=timeOptions.find(o=>timeToMin(o)>=startMin+60);
    return after||timeOptions.find(o=>timeToMin(o)>startMin)||timeOptions[timeOptions.length-1]||startValue;
  }
  function nearestStartBefore(endValue){
    const endMin=timeToMin(endValue);
    const before=[...timeOptions].reverse().find(o=>timeToMin(o)<=endMin-60);
    return before||timeOptions.find(o=>timeToMin(o)<endMin)||timeOptions[0]||endValue;
  }
  function changeStart(nextStart){
    if(!nextStart){onPatch({start:'',end:''},true);return;}
    const currentEnd=normalizeTimeText(row.end||'');
    const needEnd=!currentEnd || timeToMin(currentEnd)<=timeToMin(nextStart);
    const nextEnd=needEnd?nearestEndAfter(nextStart):currentEnd;
    onPatch({start:nextStart,end:nextEnd},true);
  }
  function changeEnd(nextEnd){
    if(!nextEnd){onPatch('end','',true);return;}
    const currentStart=normalizeTimeText(row.start||'');
    if(currentStart && timeToMin(nextEnd)<=timeToMin(currentStart)){
      onPatch({start:nearestStartBefore(nextEnd),end:nextEnd},true);
      return;
    }
    onPatch('end',nextEnd,true);
  }
  return <V21RowCard title={titleText||`일정 ${index+1}`} onDelete={total>1?onDelete:null}>
    <div className="v229-schedule-main v17-schedule-card">
      <div className="v17-time-pick-box">
        <div className="v17-time-pick-title"><b>시간 선택</b><span>시작과 종료 시간을 선택합니다.</span></div>
        <div className="v229-schedule-time-row">
          <V21Select label="일차" value={row.day} options={days} onChange={v=>onPatch('day',v,true)}/>
          <V21TimeSelect label="시작" value={row.start} options={timeOptions} placeholder="시작 선택" onChange={changeStart}/>
          <V21TimeSelect label="종료" value={row.end} options={timeOptions} placeholder="종료 선택" onChange={changeEnd}/>
          <V21IconSelect label="아이콘" value={row.icon} onChange={v=>onPatch('icon',v,false)}/>
        </div>
      </div>
      <div className="v229-schedule-title-row">
        <V21MiniField label="일정명" value={row.title} placeholder="예: 저녁예배 1 / 공동체 미션" onChange={v=>onPatch('title',v,false)}/>
        <V21MiniField label="장소" value={row.place} placeholder="예: 본당 / 세미나실 / 식당" onChange={v=>onPatch('place',v,false)}/>
      </div>
      <details className="v229-schedule-extra">
        <summary>담당/메모 더보기</summary>
        <V21MiniArea label="담당/메모" value={row.memo} placeholder="예: 찬양팀 준비, 이동 안내, 담당 교사 등" onChange={v=>onPatch('memo',v,false)}/>
      </details>
    </div>
  </V21RowCard>
}
function V21ScheduleBlock({doc,setDoc}){
  const rows=doc.scheduleItems?.length?doc.scheduleItems:[schedRow(doc.days?.[0]||'1일차')];
  const days=doc.days?.length?doc.days:['1일차'];
  const [activeDay,setActiveDay]=useState(days[0]||'1일차');
  useEffect(()=>{if(!days.includes(activeDay))setActiveDay(days[0]||'1일차')},[days.join('|')]);
  function setRows(next,sort=false){setDoc({...doc,scheduleItems:sort?sortScheduleRows(next,days,true):next})}
  function patch(i,k,v,commit=false){
    const isObjectPatch=typeof k==='object'&&k!==null;
    const next=isObjectPatch?rows.map((row,idx)=>idx===i?{...row,...k}:row):updateArray(rows,i,k,v);
    // 선택 직후 행 전체를 실제 배열에서 재정렬하면 드롭다운이 튀거나 값이 안 바뀐 것처럼 보일 수 있습니다.
    // 실제 데이터 순서는 안정적으로 두고, 화면 표시만 시간순으로 정렬합니다.
    setRows(next,false);
  }
  function add(day=activeDay){
    const target=day||days[0]||'1일차';
    const firstIndex=rows.findIndex(r=>(r.day||days[0])===target);
    const nextRow={...schedRow(target),start:'',end:'',title:'',place:'',memo:''};
    const next=firstIndex>=0?[...rows.slice(0,firstIndex),nextRow,...rows.slice(firstIndex)]:[nextRow,...rows];
    setActiveDay(target);
    setRows(next,false);
  }
  function sortActiveDay(){
    const target=activeDay||days[0]||'1일차';
    const sortedQueue=sortScheduleRows(rows.filter(r=>(r.day||days[0])===target),[target],true);
    const next=rows.map(r=>(r.day||days[0])===target ? sortedQueue.shift() : r);
    setRows(next,false);
  }
  const visible=rows.map((r,i)=>({...r,_i:i})).filter(r=>(r.day||days[0])===activeDay);
  return <section className="v21-auto-block v25-page-schedule-editor v229-schedule-editor schedule-day-editor-clear v15-schedule-add-visible v16-schedule-time-polish v17-schedule-select-editor v111-schedule-edit-order"><V25ScheduleSetup doc={doc} setDoc={setDoc} activeDay={activeDay} setActiveDay={setActiveDay}/><div className="v21-block-head"><div><b>상세 일정표</b><span>편집판은 추가 순서를 유지합니다. 필요할 때만 “현재 일차 시간순 정리”를 눌러 정돈하세요.</span></div><button type="button" onClick={()=>add(activeDay)}>+ {activeDay} 일정 추가</button></div><div className="schedule-day-tabs schedule-day-tabs-strong">{days.map(day=>{const count=rows.filter(r=>(r.day||days[0])===day).length;return <button type="button" key={day} className={activeDay===day?'active':''} onClick={()=>setActiveDay(day)}><span>{day}</span><small>{count}개</small></button>})}</div><div className="schedule-day-toolbar"><b className="schedule-day-title">{activeDay} 일정 수정</b><div><button type="button" className="btn" onClick={sortActiveDay}>현재 일차 시간순 정리</button><button type="button" className="btn secondary" onClick={()=>add(activeDay)}>+ 현재 일차에 추가</button></div></div><p className="schedule-time-help v17-schedule-time-help"><b>시간은 직접 쓰지 않고 선택합니다.</b> 새 일정을 추가한 뒤 시작 시간을 고르면 종료 시간은 기본 1시간 뒤로 자동 입력됩니다. 편집 중에는 카드가 자동으로 움직이지 않고, 원할 때 “현재 일차 시간순 정리”를 눌러 정돈합니다.</p>{visible.length?<div className="schedule-card-list">{visible.map((r,visibleIndex)=><V229ScheduleRowEditor key={`schedule-row-${r._i}`} row={r} index={r._i} days={days} doc={doc} total={rows.length} onDelete={()=>setRows(rows.filter((_,idx)=>idx!==r._i),false)} onPatch={(k,v,commit)=>patch(r._i,k,v,commit)}/>)}</div>:<div className="empty-day-schedule"><b>{activeDay} 일정이 없습니다.</b><span>위의 “현재 일차에 추가” 버튼을 누르면 새 입력칸이 바로 위쪽에 생깁니다.</span></div>}</section>
}
function V21BudgetBlock({doc,setDoc}){
  const income=doc.incomeItems?.length?doc.incomeItems:[budgetRow()];
  const expense=doc.expenseItems?.length?doc.expenseItems:[budgetRow()];
  const incomeTotal=budgetTotal(income);
  const expenseTotal=budgetTotal(expense);
  return <section className="v21-auto-block budget-oneview-block">
    <div className="v21-block-head"><div><b>수입·지출 자동 계산</b><span>수입계획과 지출계획을 좌우 스크롤 없이 카드형으로 한눈에 수정합니다.</span></div></div>
    <div className="budget-oneview-summary"><span><b>수입 합계</b><strong>{won(incomeTotal)}</strong></span><span><b>지출 합계</b><strong>{won(expenseTotal)}</strong></span><span className={(incomeTotal-expenseTotal)>=0?'good':'bad'}><b>차액</b><strong>{won(incomeTotal-expenseTotal)}</strong></span></div>
    <div className="v21-budget-grid v110-budget-grid"><div><h4>수입 계획</h4><BudgetRowsTable rows={income} onChange={rows=>setDoc({...doc,incomeItems:rows})} addLabel="+ 수입 항목"/></div><div><h4>지출 계획</h4><BudgetRowsTable rows={expense} onChange={rows=>setDoc({...doc,expenseItems:rows})} addLabel="+ 지출 항목"/></div></div>
  </section>
}
function V21PrepBlock({doc,setDoc}){const rows=doc.items?.length?doc.items:[prepRow('','','','','','물품')];function setRows(next){setDoc({...doc,items:next})}function patch(i,k,v){setRows(updateArray(rows,i,k,v))}return <section className="v21-auto-block"><div className="v21-block-head"><div><b>준비목록 체크리스트</b><span>물품·세팅·인력·행정 항목을 줄로 추가하면 A4 체크표로 정리됩니다.</span></div><button type="button" onClick={()=>setRows([...rows,prepRow('','','','','','물품')])}>+ 준비항목 추가</button></div>{rows.map((r,i)=><V21RowCard key={i} title={`준비항목 ${i+1}`} onDelete={rows.length>1?()=>setRows(rows.filter((_,idx)=>idx!==i)):null}><V21Select label="분류" value={r.category||'물품'} options={PREP_CATEGORIES} onChange={v=>patch(i,'category',v)}/><V21MiniField label="준비 항목" value={r.item} onChange={v=>patch(i,'item',v)}/><V21MiniField label="담당" value={r.owner} onChange={v=>patch(i,'owner',v)}/><V21MiniField label="기한" value={r.due} onChange={v=>patch(i,'due',v)}/><V21Select label="상태" value={r.status||'준비중'} options={['준비중','확인중','완료','보류']} onChange={v=>patch(i,'status',v)}/><V21MiniArea label="비고" value={r.note} onChange={v=>patch(i,'note',v)}/></V21RowCard>)}</section>}
function V21CueBlock({doc,setDoc}){const rows=doc.rows?.length?doc.rows:[cueRow()];function setRows(next){setDoc({...doc,rows:next})}function patch(i,k,v){setRows(updateArray(rows,i,k,v))}return <section className="v21-auto-block"><div className="v21-block-head"><div><b>큐시트 진행순서</b><span>시간, 순서, 담당을 추가하면 A4 가로 큐시트로 자동 정리됩니다.</span></div><button type="button" onClick={()=>setRows([...rows,cueRow()])}>+ 진행순서 추가</button></div>{rows.map((r,i)=><V21RowCard key={i} title={`순서 ${i+1}`} onDelete={rows.length>1?()=>setRows(rows.filter((_,idx)=>idx!==i)):null}><V21MiniField label="시간" value={r.time} onChange={v=>patch(i,'time',v)}/><V21MiniField label="순서/항목" value={r.part} onChange={v=>patch(i,'part',v)}/><V21MiniField label="내용" value={r.content} onChange={v=>patch(i,'content',v)}/><V21MiniField label="담당" value={r.person} onChange={v=>patch(i,'person',v)}/><V21MiniField label="방송/음향" value={r.tech} onChange={v=>patch(i,'tech',v)}/><V21MiniArea label="비고" value={r.note} onChange={v=>patch(i,'note',v)}/></V21RowCard>)}</section>}
function V21ProgramBlock({doc,setDoc}){const rows=doc.programs?.length?doc.programs:[programRow(1)];function setRows(next){setDoc({...doc,programs:next})}function patch(i,k,v){setRows(updateArray(rows,i,k,v))}return <section className="v21-auto-block"><div className="v21-block-head"><div><b>세부 프로그램 구성</b><span>프로그램별 진행 방법과 순서를 입력하면 전문 프로그램 문서로 정리됩니다.</span></div><button type="button" onClick={()=>setRows([...rows,programRow(rows.length+1)])}>+ 프로그램 추가</button></div>{rows.map((r,i)=><V21RowCard key={i} title={`프로그램 ${i+1}`} onDelete={rows.length>1?()=>setRows(rows.filter((_,idx)=>idx!==i)):null}><V21MiniField label="프로그램명" value={r.name} onChange={v=>patch(i,'name',v)}/><V21MiniField label="시간" value={r.time} onChange={v=>patch(i,'time',v)}/><V21MiniField label="대상" value={r.target} onChange={v=>patch(i,'target',v)}/><V21MiniField label="담당" value={r.leader} onChange={v=>patch(i,'leader',v)}/><V21MiniArea label="목적/기대효과" value={r.goal} onChange={v=>patch(i,'goal',v)}/><V21MiniArea label="진행 방법" value={r.method} onChange={v=>patch(i,'method',v)}/><V21MiniArea label="준비물" value={r.materials} onChange={v=>patch(i,'materials',v)}/><V21MiniArea label="진행 순서" value={r.order} onChange={v=>patch(i,'order',v)}/><V21MiniArea label="유의사항" value={r.note} onChange={v=>patch(i,'note',v)}/></V21RowCard>)}</section>}
function V21AutomationBlocks({type,doc,setDoc}){if(type==='각부 월간행사 안내')return <V21EventsBlock doc={doc} setDoc={setDoc}/>;if(type==='행사 및 수련회 기획안')return <><V21ScheduleBlock doc={doc} setDoc={setDoc}/><V21BudgetBlock doc={doc} setDoc={setDoc}/></>;if(type==='예산안')return <V21BudgetBlock doc={doc} setDoc={setDoc}/>;if(type==='준비목록')return <V21PrepBlock doc={doc} setDoc={setDoc}/>;if(type===CUE_DOC)return <V21CueBlock doc={doc} setDoc={setDoc}/>;if(type==='세부 프로그램 문서')return <V21ProgramBlock doc={doc} setDoc={setDoc}/>;return null}
function v21HasAutomationBlock(type){return ['각부 월간행사 안내','행사 및 수련회 기획안','예산안','준비목록',CUE_DOC,'세부 프로그램 문서'].includes(type)}


function v22Count(list){return Array.isArray(list)?list.length:0}
function v22AutomationSummary(type,doc){
  if(type==='각부 월간행사 안내')return `핵심일정 ${v22Count(doc.events)}개`;
  if(type==='행사 및 수련회 기획안')return `상세일정 ${v22Count(doc.scheduleItems)}개 · 수입 ${v22Count(doc.incomeItems)}개 · 지출 ${v22Count(doc.expenseItems)}개`;
  if(type==='예산안')return `수입 ${v22Count(doc.incomeItems)}개 · 지출 ${v22Count(doc.expenseItems)}개`;
  if(type==='준비목록')return `준비항목 ${v22Count(doc.items)}개`;
  if(type===CUE_DOC)return `진행순서 ${v22Count(doc.rows)}개`;
  if(type==='세부 프로그램 문서')return `프로그램 ${v22Count(doc.programs)}개`;
  return '자동화 항목';
}
function V22AutomationDrawer({type,doc,setDoc}){
  return <details className="v22-auto-drawer"><summary><div><b>자동화 입력</b><span>{v22AutomationSummary(type,doc)}</span></div><em>수정/추가</em></summary><V21AutomationBlocks type={type} doc={doc} setDoc={setDoc}/></details>
}

function v23Field(label,path,kind='input',options=null,placeholder='') { return {label,path,kind,options,placeholder}; }
function v23CoreFields(type,doc={}){
  if(type==='행사 및 수련회 기획안')return [v23Field('행사명','title'),v23Field('기간','period'),v23Field('장소','place'),v23Field('대상','target'),v23Field('담당','manager'),v23Field('목적','purpose','area'),v23Field('준비','preparation','area')];
  if(type==='각부 월간행사 안내')return [v23Field('제목','title'),v23Field('부서','group','select',['교육부','영아부','유치부','초등부','청소년부','청년부','속회','소그룹','기타']),v23Field('기간','month'),v23Field('문의','contact')];
  if(type==='예산안')return [v23Field('제목','title'),v23Field('기간','period'),v23Field('담당','manager'),v23Field('근거','basis','area'),v23Field('비고','notes','area')];
  if(type==='준비목록')return [v23Field('제목','title'),v23Field('행사명','eventName'),v23Field('기간','period'),v23Field('담당','manager'),v23Field('비고','notes','area')];
  if(type===CUE_DOC)return [v23Field('제목','title'),v23Field('일시','date'),v23Field('장소','place'),v23Field('총괄','director'),v23Field('주제','theme')];
  if(type==='세부 프로그램 문서')return [v23Field('제목','title'),v23Field('행사명','eventName'),v23Field('기간','period'),v23Field('담당','manager')];
  if(type==='부서별 주간보고서')return [v23Field('제목','reportTitle'),v23Field('부서','subDepartment','select',REPORT_DEPT_OPTIONS),v23Field('출석','attendance'),v23Field('기간','period'),v23Field('작성자','writer')];
  if(type==='부서 통합 주간보고서')return [v23Field('제목','reportTitle'),v23Field('기간','period'),v23Field('작성자','writer')];
  return quickFieldsFor(type,doc).filter(f=>!/(일정|예산|수입|지출|준비 \d|순서 \d)/.test(f.label)).slice(0,8).map(f=>v23Field(f.label,f.path,f.kind,f.options,f.placeholder));
}
function V23InputField({field,doc,onPatch}){
  const value=getByPath(doc,field.path)||'';
  const filled=String(value).trim()?'filled':'empty';
  const cls=`v23-field ${field.kind==='area'?'area ':''}${filled}`;
  const attrs={'data-editor-path':field.path,'data-editor-label':field.label};
  if(field.kind==='area')return <label className={cls} {...attrs}><span>{field.label}</span><textarea value={value} placeholder={field.placeholder||`${field.label} 입력`} onChange={e=>onPatch(field.path,e.target.value)} /></label>;
  if(field.kind==='select')return <label className={cls} {...attrs}><span>{field.label}</span><select value={value} onChange={e=>onPatch(field.path,e.target.value)}>{(field.options||[]).map(o=><option key={o}>{o}</option>)}</select></label>;
  return <label className={cls} {...attrs}><span>{field.label}</span><input value={value} placeholder={field.placeholder||`${field.label} 입력`} onChange={e=>onPatch(field.path,e.target.value)} /></label>;
}
function V23Fields({fields,doc,onPatch}){return <div className="v23-fields">{fields.map(f=><V23InputField key={f.path} field={f} doc={doc} onPatch={onPatch}/>)}</div>}
function docFormatRule(type){
  if(['기본 공지 안내문','각부 월간행사 안내','주간 공지','공문/협조 요청서','신청서 양식','차량/장소 사용 신청서','지출결의서'].includes(type))return {kind:'one',title:'한 장 완성형',desc:'A4 한 장 안에서 마무리하는 안내문입니다.',modes:['한 장에 맞추기','2페이지 허용']};
  if(['회의자료','연말/연차 부서 보고서','행사 및 수련회 기획안','행사 결과 보고서','부서 통합 주간보고서','부서별 주간보고서','7개부서 보고서','기획위원회 보고서'].includes(type))return {kind:'fixed',title:'페이지 고정형',desc:'페이지별 역할을 유지하며 작성하는 문서입니다.',modes:['페이지 역할 유지','넘치면 추가 페이지']};
  if(['예산안',CUE_DOC,'일정표','준비목록','부서행사 진행표(캘린더형)'].includes(type))return {kind:'table',title:'표 확장형',desc:'표 항목이 늘어나면 자동 분할하는 문서입니다.',modes:['표 자동 분할','한 장에 맞추기']};
  return {kind:'reading',title:'자료형 문서',desc:'섹션별 가독성을 유지하며 자연스럽게 확장합니다.',modes:['가독성 우선','한 장에 맞추기']};
}
function applyOutputMode(doc,setDoc,mode){
  const style={...(doc.style||{})};
  if(mode.includes('한 장')){style.autoFit=true;style.outputMode='fit-one'}
  else if(mode.includes('분할')||mode.includes('추가')){style.autoFit=false;style.outputMode='split'}
  else {style.outputMode='normal'}
  setDoc({...doc,style});
}
function V26TopTools({type,doc,setDoc}){
  const rule=docFormatRule(type);
  const active=doc.style?.outputMode || (doc.style?.autoFit?'fit-one':'normal');
  return <section className="v26-top-tools" data-editor-title="문서 도구">
    <div className="v26-tool-head"><div><b>문서 기본 도구</b><span>{rule.title} · {rule.desc}</span></div><em>{doc.style?.autoFit?'A4 자동 맞춤':'가독성 우선'}</em></div>
    <div className="v26-tool-row">
      <div className="v26-font-mini"><span>글자</span><FontQuickControls doc={doc} setDoc={setDoc} compact/></div>
      <div className="v26-output-rule"><span>출력</span>{rule.modes.map(m=><button type="button" key={m} className={(active==='fit-one'&&m.includes('한 장'))||(active==='split'&&(m.includes('분할')||m.includes('추가'))) ? 'active':''} onClick={()=>applyOutputMode(doc,setDoc,m)}>{m}</button>)}</div>
    </div>
  </section>
}
function V26CustomEditor({doc,setDoc,index}){
  const safe=Array.isArray(doc.customSections)?doc.customSections:[];
  const section=safe[index]||{title:`추가 페이지 ${index+1}`,body:'',size:'보통',newPage:true};
  function setSections(next){setDoc({...doc,customSections:next})}
  function patch(next){const copy=[...safe];copy[index]={...section,...next};setSections(copy)}
  function remove(){setSections(safe.filter((_,i)=>i!==index))}
  return <section className="v26-custom-editor"><div className="v23-tab-intro"><b>{section.newPage?'추가 페이지':'추가 섹션'} {index+1}</b><span>추가한 페이지도 문서 편집판에서 바로 수정합니다.</span></div><Field label="제목" value={section.title||''} onChange={v=>patch({title:v})}/><Area label="내용" value={section.body||''} onChange={v=>patch({body:v})}/><Select label="크기" value={section.size||'보통'} options={['작게','보통','크게','강조형']} onChange={v=>patch({size:v})}/><label className="check v26-check"><input type="checkbox" checked={!!section.newPage} onChange={e=>patch({newPage:e.target.checked})}/> 이 항목부터 새 A4 페이지</label><button type="button" className="btn danger" onClick={remove}>이 추가 페이지 삭제</button></section>
}
function V26PageManager({doc,setDoc}){
  const count=(doc.customSections||[]).length;
  return <section className="v26-page-manager"><div><b>페이지 추가</b><span>추가한 페이지는 위 탭에 자동으로 생기고 미리보기 클릭으로 다시 열 수 있습니다.</span></div><PageAddButton doc={doc} setDoc={setDoc} label="+ 추가 페이지"/><button type="button" className="btn secondary" onClick={()=>addCustomSection(doc,setDoc)}>+ 추가 섹션</button>{count>0&&<em>{count}개 추가됨</em>}</section>
}

function V23BudgetPart({doc,setDoc,kind='income'}){
  const isIncome=kind==='income';
  const rows=(isIncome?doc.incomeItems:doc.expenseItems)?.length?(isIncome?doc.incomeItems:doc.expenseItems):[budgetRow()];
  const key=isIncome?'incomeItems':'expenseItems';
  return <section className="v23-tab-block"><div className="v23-block-title"><b>{isIncome?'수입 항목':'지출 항목'}</b><span>{rows.length}개 · 합계 {won(budgetTotal(rows))}</span></div><BudgetRowsTable rows={rows} onChange={next=>setDoc({...doc,[key]:next})} addLabel={isIncome?'+ 수입 추가':'+ 지출 추가'}/></section>;
}
function V28RowsBlock({tab,doc,setDoc}){
  const rows=getByPath(doc,tab.path)||[];
  const safe=Array.isArray(rows)&&rows.length?rows:[tab.blank||{}];
  function setRows(next){setDoc(setByPath(doc,tab.path,next))}
  function patch(i,key,value){setRows(safe.map((r,idx)=>idx===i?{...r,[key]:value}:r))}
  return <section className="v23-tab-block v28-rows-block"><div className="v23-block-title"><b>{tab.title}</b><span>{safe.length}개 항목</span></div><div className="v28-rows-list">{safe.map((r,i)=><V21RowCard key={i} title={`${tab.rowLabel||'항목'} ${i+1}`} onDelete={safe.length>1?()=>setRows(safe.filter((_,idx)=>idx!==i)):null}>{(tab.columns||[]).map(col=>col.kind==='area'?<V21MiniArea key={col.key} label={col.label} value={r[col.key]||''} onChange={v=>patch(i,col.key,v)}/>:<V21MiniField key={col.key} label={col.label} value={r[col.key]||''} onChange={v=>patch(i,col.key,v)}/>)}</V21RowCard>)}</div><button type="button" className="btn secondary" onClick={()=>setRows([...safe,{...(tab.blank||{})}])}>+ {tab.rowLabel||'항목'} 추가</button></section>;
}

function WeeklyUnitNameField({value,onCommit,label='부서/팀명'}){
  return <label className="field weekly-unit-name-field"><span>{label}</span><input type="text" value={value??''} onChange={e=>onCommit(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur()}} placeholder="예: 교육부 / 예배부 / 선교부" /><small>입력하는 즉시 반영됩니다. 엔터를 누르지 않아도 됩니다.</small></label>
}
function WeeklyUnitsBlock({doc,setDoc}){
  const units=weeklyUnitRows(doc);
  function setRows(next){setDoc(patchWeeklyUnitRows(doc,next))}
  function patchUnit(id,key,value){setRows(units.map(r=>r.id===id?{...r,[key]:value}:r))}
  function addUnit(){setRows([...units,weeklyUnitRow(nextWeeklyUnitName(units),'','','','')])}
  function removeUnit(id){if(units.length<2)return;setRows(units.filter(r=>r.id!==id))}
  return <section className="v23-tab-block weekly-unit-manager weekly-id-manager"><div className="v23-block-title"><b>부서별 주간 현황</b><span>부서명을 자유롭게 바로 입력할 수 있습니다. 엔터를 누르지 않아도 미리보기에 반영됩니다.</span></div><div className="weekly-unit-list">{units.map((unit,i)=><div className="dept-edit weekly-unit-edit" key={unit.id}><div className="weekly-unit-head"><WeeklyUnitNameField value={unit.name} onCommit={v=>patchUnit(unit.id,'name',v)}/>{units.length>1&&<button type="button" onClick={()=>removeUnit(unit.id)}>삭제</button>}</div><div className="grid4 weekly-unit-grid"><Field label="출석/참여(명)" type="number" value={childAttendanceValue(unit.attendance)} onChange={v=>patchUnit(unit.id,'attendance',v)}/><Area label="이번 주 활동" value={unit.thisWeek} onChange={v=>patchUnit(unit.id,'thisWeek',v)}/><Area label="다음 주 계획" value={unit.nextWeek} onChange={v=>patchUnit(unit.id,'nextWeek',v)}/><Area label="특이사항" value={unit.special} onChange={v=>patchUnit(unit.id,'special',v)}/></div></div>)}</div><button type="button" className="btn secondary" onClick={addUnit}>+ 부서/팀 추가</button></section>
}
function V23TabContent({tab,doc,setDoc,onPatch}){
  if(tab.kind==='fields')return <><div className="v23-tab-intro"><b>{tab.title}</b><span>{tab.desc}</span></div><V23Fields fields={tab.fields||[]} doc={doc} onPatch={onPatch}/></>;
  if(tab.kind==='schedule')return <V21ScheduleBlock doc={doc} setDoc={setDoc}/>;
  if(tab.kind==='weekly')return <WeeklyUnitsBlock doc={doc} setDoc={setDoc}/>;
  if(tab.kind==='budget')return <V21BudgetBlock doc={doc} setDoc={setDoc}/>;
  if(tab.kind==='income')return <V23BudgetPart doc={doc} setDoc={setDoc} kind="income"/>;
  if(tab.kind==='expense')return <V23BudgetPart doc={doc} setDoc={setDoc} kind="expense"/>;
  if(tab.kind==='events')return <V21EventsBlock doc={doc} setDoc={setDoc}/>;
  if(tab.kind==='prep')return <V21PrepBlock doc={doc} setDoc={setDoc}/>;
  if(tab.kind==='cue')return <V21CueBlock doc={doc} setDoc={setDoc}/>;
  if(tab.kind==='program')return <V21ProgramBlock doc={doc} setDoc={setDoc}/>;
  if(tab.kind==='rows')return <V28RowsBlock tab={tab} doc={doc} setDoc={setDoc}/>;
  if(tab.kind==='custom')return <V26CustomEditor doc={doc} setDoc={setDoc} index={tab.index||0}/>;
  return null;
}
function v25Fields(...fields){return fields.filter(Boolean).map(f=>Array.isArray(f)?v23Field(...f):f)}
function v23BaseTabsFor(type,doc){
  if(type==='기본 공지 안내문')return [
    {id:'basic',label:'공지 개요',title:'공지 개요',desc:'제목, 대상, 일시, 장소를 수정합니다.',kind:'fields',fields:v25Fields(['제목','title'],['대상','target'],['일시','date'],['장소','place'])},
    {id:'content',label:'안내 내용',title:'안내 내용',desc:'A4 한 장 안에 들어갈 본문 안내를 작성합니다.',kind:'fields',fields:v25Fields(['안내 내용','content','area'])},
    {id:'bottom',label:'협조·문의',title:'협조 요청과 문의',desc:'협조 요청, 문의처, 하단 문구를 수정합니다.',kind:'fields',fields:v25Fields(['협조 요청','requests','area'],['문의','contact'],['하단 문구','footer'])}
  ];
  if(type==='회의자료')return [
    {id:'basic',label:'회의 개요',title:'회의 개요',desc:'회의명, 일시, 장소, 참석 대상과 목적을 수정합니다.',kind:'fields',fields:v25Fields(['회의명','title'],['회의 유형','meetingType'],['일시','date'],['장소','place'],['참석 대상','attendees','area'],['작성자','writer'],['회의 목적','purpose','area'])},
    {id:'decisions',label:'지난 결정',title:'지난 결정사항 점검',desc:'지난 회의 결정사항의 진행 상태를 확인합니다.',kind:'rows',path:'decisions',rowLabel:'결정사항',blank:meetingDecisionRow(),columns:[{key:'decision',label:'결정사항',kind:'area'},{key:'owner',label:'담당자'},{key:'status',label:'진행상태'},{key:'memo',label:'추가 확인',kind:'area'}]},
    {id:'reports',label:'부서별 보고',title:'부서별 보고',desc:'교회학교·부서별 보고와 요청, 기도제목을 정리합니다.',kind:'rows',path:'deptReports',rowLabel:'부서 보고',blank:meetingDeptReportRow(),columns:[{key:'dept',label:'부서'},{key:'report',label:'보고 내용',kind:'area'},{key:'request',label:'요청사항',kind:'area'},{key:'prayer',label:'기도제목',kind:'area'}]},
    {id:'agenda',label:'주요 안건',title:'주요 안건',desc:'회의에서 논의하고 결정할 안건을 정리합니다.',kind:'rows',path:'agendaItems',rowLabel:'안건',blank:meetingAgendaRow(),columns:[{key:'agenda',label:'안건'},{key:'detail',label:'논의 내용',kind:'area'},{key:'decisionNeeded',label:'결정 필요 사항',kind:'area'},{key:'memo',label:'참고',kind:'area'}]},
    {id:'schedule',label:'일정 확인',title:'일정 확인',desc:'다가오는 일정과 담당 부서를 확인합니다.',kind:'rows',path:'meetingSchedules',rowLabel:'일정',blank:meetingScheduleRow(),columns:[{key:'date',label:'날짜'},{key:'event',label:'행사명'},{key:'dept',label:'담당 부서'},{key:'prep',label:'준비사항',kind:'area'}]},
    {id:'support',label:'예산·지원',title:'예산/지원 요청',desc:'회의에서 승인·검토할 지원 요청을 정리합니다.',kind:'rows',path:'supportRequests',rowLabel:'지원 요청',blank:meetingSupportRow(),columns:[{key:'dept',label:'요청 부서'},{key:'content',label:'내용',kind:'area'},{key:'amount',label:'예상 금액'},{key:'decision',label:'결정 여부'}]},
    {id:'actions',label:'결정·기도',title:'결정사항 및 역할분담',desc:'회의 후 실행할 결정사항과 기도제목을 정리합니다.',kind:'rows',path:'actionItems',rowLabel:'결정사항',blank:meetingActionRow(),columns:[{key:'action',label:'결정 내용',kind:'area'},{key:'owner',label:'담당자'},{key:'due',label:'기한'},{key:'checked',label:'확인'}]},
    {id:'prayer',label:'기도제목',title:'기도제목',desc:'함께 기도할 제목을 정리합니다.',kind:'fields',fields:v25Fields(['기도제목','prayer','area'])}
  ];
  if(type==='연말/연차 부서 보고서')return [
    {id:'basic',label:'부서 개요',title:'부서 개요',desc:'부서명, 연도, 담당자를 수정합니다.',kind:'fields',fields:v25Fields(['제목','title'],['부서','department'],['연도','year'],['담당 교역자','pastor'],['부장','leader'],['작성자','writer'],['요약','summary','area'])},
    {id:'ministries',label:'주요 사역',title:'한 해 주요 사역',desc:'월별 주요 사역과 참여 인원을 정리합니다.',kind:'rows',path:'ministries',rowLabel:'사역',blank:annualMinistryRow(),columns:[{key:'month',label:'월'},{key:'ministry',label:'주요 사역',kind:'area'},{key:'participants',label:'참여 인원'},{key:'note',label:'비고',kind:'area'}]},
    {id:'attendance',label:'출석·참여',title:'출석/참여 현황',desc:'평균 출석, 최대 출석, 새친구 현황을 수정합니다.',kind:'fields',fields:v25Fields(['평균 출석','avgAttendance'],['최대 출석','maxAttendance'],['새친구','newFriends'],['특이사항','attendanceNote','area'])},
    {id:'budget',label:'예산 요약',title:'예산 집행 요약',desc:'예산과 집행, 잔액을 표로 정리합니다.',kind:'rows',path:'budgetRows',rowLabel:'예산 항목',blank:annualBudgetRow(),columns:[{key:'category',label:'구분'},{key:'budget',label:'예산'},{key:'spent',label:'집행'},{key:'balance',label:'잔액'},{key:'note',label:'비고',kind:'area'}]},
    {id:'review',label:'평가',title:'평가',desc:'감사 제목, 잘된 점, 어려웠던 점, 개선할 점을 수정합니다.',kind:'fields',fields:v25Fields(['감사 제목','thanks','area'],['잘된 점','strengths','area'],['어려웠던 점','difficulties','area'],['개선할 점','improvements','area'])},
    {id:'next',label:'다음 해 계획',title:'다음 해 계획',desc:'다음 해 방향, 지원 요청, 기도제목을 수정합니다.',kind:'fields',fields:v25Fields(['다음 해 계획','nextPlan','area'],['필요한 지원','support','area'],['기도제목','prayer','area'])}
  ];
  if(type==='지출결의서')return [
    {id:'basic',label:'기본 정보',title:'기본 정보',desc:'부서, 신청자, 지출 목적을 수정합니다.',kind:'fields',fields:v25Fields(['제목','title'],['부서','department'],['신청자','applicant'],['작성일','writeDate'],['사용일','useDate'],['지출 목적','purpose','area'])},
    {id:'items',label:'지출 내역',title:'지출 내역',desc:'지출 항목을 표로 입력하고 합계를 확인합니다.',kind:'rows',path:'items',rowLabel:'지출 항목',blank:expenditureRow(),columns:[{key:'item',label:'항목'},{key:'detail',label:'내용',kind:'area'},{key:'qty',label:'수량'},{key:'price',label:'단가/금액'},{key:'note',label:'비고',kind:'area'}]},
    {id:'proof',label:'증빙·결재',title:'증빙 및 결재',desc:'증빙, 지급방법, 결재란을 수정합니다.',kind:'fields',fields:v25Fields(['지급 방법','paymentMethod'],['증빙','receipt'],['비고','memo','area'],['결재란','approval'])}
  ];
  if(type==='차량/장소 사용 신청서')return [
    {id:'basic',label:'신청 정보',title:'신청 정보',desc:'신청 부서, 신청자, 연락처, 목적을 수정합니다.',kind:'fields',fields:v25Fields(['제목','title'],['신청 유형','requestType','select',['차량 사용','장소 사용','차량+장소 사용']],['부서','department'],['신청자','applicant'],['연락처','contact'],['사용 목적','purpose','area'])},
    {id:'use',label:'사용 정보',title:'사용 정보',desc:'사용 일시, 차량/장소, 인원, 운전자, 이동 구간을 수정합니다.',kind:'fields',fields:v25Fields(['사용 일시','date'],['차량/장소','placeOrVehicle'],['사용 인원','people'],['운전자','driver'],['이동 구간','route','area'])},
    {id:'checks',label:'확인 사항',title:'확인 사항',desc:'안전, 반납, 정리 등 확인사항을 수정합니다.',kind:'rows',path:'checks',rowLabel:'확인 항목',blank:useCheckRow(),columns:[{key:'item',label:'확인 항목',kind:'area'},{key:'checked',label:'상태'},{key:'memo',label:'메모',kind:'area'}]},
    {id:'approval',label:'승인',title:'승인',desc:'유의사항과 승인란을 수정합니다.',kind:'fields',fields:v25Fields(['유의사항','note','area'],['승인란','approval'])}
  ];
  if(type==='행사 및 수련회 기획안')return [
    {id:'p1',label:'1P 목적·개요',title:'1페이지 목적·개요',desc:'문서 1페이지 순서대로 행사 목적, 개요, 담당 및 역할, 준비사항을 수정합니다.',kind:'fields',fields:v25Fields(['행사 목적','purpose','area'],['행사명','title'],['주제','theme'],['기간','period'],['장소','place'],['대상·인원','target'],['담당','manager'],['담당 및 역할','roles','area'],['준비사항','notes','area'])},
    {id:'p2',label:'2P 상세일정',title:'2페이지 상세일정',desc:'몇 박 며칠인지 선택하고 일정표 전체를 수정합니다.',kind:'schedule',count:(doc.scheduleItems||[]).length},
    {id:'p3',label:'3P 수입·지출',title:'3페이지 수입·지출',desc:'수입과 지출을 표로 입력하고 합계를 자동 계산합니다.',kind:'budget',count:(doc.incomeItems||[]).length+(doc.expenseItems||[]).length}
  ];
  if(type==='각부 월간행사 안내')return [
    {id:'top',label:'상단 정보',title:'상단 정보',desc:'카톡 공유 이미지의 제목, 부서, 기간, 문의처를 수정합니다.',kind:'fields',fields:v25Fields(['제목','title'],['부서','group','select',['교육부','영아부','유치부','초등부','청소년부','청년부','속회','소그룹','기타']],['기간','month'],['문의','contact'])},
    {id:'events',label:'핵심일정',title:'월간 핵심일정',desc:'날짜/기간과 시간을 따로 입력하고, 장소·대상·내용을 줄 맞춤으로 정리합니다.',kind:'events',count:(doc.events||[]).length},
    {id:'dept',label:'참고 일정',title:'부서/모임별 참고 일정',desc:'부서별 참고 일정을 표로 추가합니다.',kind:'rows',path:'deptRows',rowLabel:'참고 일정',blank:deptRow(),columns:[{key:'name',label:'부서/모임'},{key:'note',label:'내용',kind:'area'}]},
    {id:'bottom',label:'협조·기도',title:'협조 요청과 기도 제목',desc:'공지 하단에 들어갈 협조 요청과 기도 제목을 수정합니다.',kind:'fields',fields:v25Fields(['협조 요청','requests','area'],['기도 제목','prayers','area'],['하단 문구','footer'],['문의','contact'])}
  ];
  if(type==='예산안')return [
    {id:'basic',label:'기본 정보',title:'예산안 기본 정보',desc:'제목, 기간, 담당, 산출 근거를 수정합니다.',kind:'fields',fields:v25Fields(['제목','title'],['기간','period'],['담당','manager'],['산출 근거','basis','area'])},
    {id:'income',label:'수입 계획',title:'수입 계획',desc:'수입 항목을 표로 입력하고 합계를 확인합니다.',kind:'income',count:(doc.incomeItems||[]).length},
    {id:'expense',label:'지출 계획',title:'지출 계획',desc:'지출 항목을 표로 입력하고 합계를 확인합니다.',kind:'expense',count:(doc.expenseItems||[]).length},
    {id:'notes',label:'확인사항',title:'비고 및 확인사항',desc:'예산안 하단 확인사항을 수정합니다.',kind:'fields',fields:v25Fields(['비고','notes','area'])}
  ];
  if(type==='준비목록')return [
    {id:'basic',label:'준비 개요',title:'준비 개요',desc:'행사명, 기간, 담당자를 수정합니다.',kind:'fields',fields:v25Fields(['제목','title'],['행사명','eventName'],['기간','period'],['담당','manager'])},
    {id:'items',label:'준비 체크리스트',title:'준비 체크리스트',desc:'물품, 세팅, 담당, 상태를 줄로 추가합니다.',kind:'prep',count:(doc.items||[]).length},
    {id:'note',label:'비고',title:'비고',desc:'준비목록 하단 비고를 수정합니다.',kind:'fields',fields:v25Fields(['비고','notes','area'])}
  ];
  if(type===CUE_DOC)return [
    {id:'basic',label:'행사 개요',title:'예배/행사 개요',desc:'일시, 장소, 대상, 총괄, 주제를 수정합니다.',kind:'fields',fields:v25Fields(['제목','title'],['일시','date'],['장소','place'],['대상','target'],['총괄','director'],['주제','theme'])},
    {id:'rows',label:'진행 큐시트',title:'진행 큐시트',desc:'시간, 순서, 내용, 담당, 방송/음향을 추가합니다.',kind:'cue',count:(doc.rows||[]).length},
    {id:'checks',label:'체크·유의',title:'진행/방송 체크와 유의사항',desc:'진행 전 확인할 체크사항과 유의사항을 수정합니다.',kind:'fields',fields:v25Fields(['진행/방송 체크','checks','area'],['유의사항','notice','area'])}
  ];
  if(type==='세부 프로그램 문서')return [
    {id:'basic',label:'개요',title:'프로그램 개요',desc:'문서 제목, 행사명, 기간, 첫 프로그램 개요를 수정합니다.',kind:'fields',fields:v25Fields(['문서 제목','title'],['행사명','eventName'],['기간','period'],['프로그램명','programs.0.name'],['소요시간','programs.0.time'],['대상','programs.0.target'],['담당자','programs.0.leader'],['장소','programs.0.place'])},
    {id:'goal',label:'목적',title:'목적/기대효과',desc:'프로그램 목적과 기대효과를 수정합니다.',kind:'fields',fields:v25Fields(['목적/기대효과','programs.0.goal','area'])},
    {id:'method',label:'진행방법',title:'진행 방법',desc:'활동 흐름과 진행자 안내를 수정합니다.',kind:'fields',fields:v25Fields(['진행 방법','programs.0.method','area'])},
    {id:'materials',label:'준비물',title:'준비물 및 세팅',desc:'준비물과 공간 세팅을 수정합니다.',kind:'fields',fields:v25Fields(['준비물','programs.0.materials','area'],['세팅','programs.0.setup','area'])},
    {id:'order',label:'진행순서',title:'진행 순서',desc:'시간별 진행 순서를 수정합니다.',kind:'fields',fields:v25Fields(['진행 순서','programs.0.order','area'])},
    {id:'note',label:'유의사항',title:'유의사항',desc:'안전, 안내, 진행 유의사항을 수정합니다.',kind:'fields',fields:v25Fields(['유의사항','programs.0.note','area'])},
    {id:'program',label:'전체 관리',title:'프로그램 전체 관리',desc:'프로그램을 여러 개 추가하거나 전체 구조를 수정합니다.',kind:'program',count:(doc.programs||[]).length}
  ];
  if(type==='부서별 주간보고서')return [
    {id:'basic',label:'기본 정보',title:'주간보고 기본 정보',desc:'부서, 기간, 작성자, 출석을 수정합니다.',kind:'fields',fields:v25Fields(['제목','reportTitle'],['부서','subDepartment','select',REPORT_DEPT_OPTIONS],['출석/참여','attendance'],['기간','period'],['작성자','writer'])},
    {id:'report',label:'보고 내용',title:'이번 주와 다음 주',desc:'이번 주 활동과 다음 주 계획을 수정합니다.',kind:'fields',fields:v25Fields(['이번 주 활동','thisWeek','area'],['다음 주 계획','nextWeek','area'])},
    {id:'extra',label:'특이·기도',title:'특이사항과 기도제목',desc:'특이사항, 요청, 기도제목을 수정합니다.',kind:'fields',fields:v25Fields(['특이사항','special','area'],['기도제목','prayer','area'])}
  ];
  if(type==='부서 통합 주간보고서')return [
    {id:'basic',label:'기본 정보',title:'통합 주간보고 기본 정보',desc:'제목, 기간, 작성자를 수정합니다.',kind:'fields',fields:v25Fields(['제목','reportTitle'],['기간','period'],['작성자','writer'])},
    {id:'summary',label:'요약·기도',title:'전체 주간 활동 요약',desc:'공동 보고 내용, 기도제목, 지원요청을 작성합니다.',kind:'fields',fields:v25Fields(['활동요약','summary','area'],['기도제목','commonPrayer','area'],['지원요청','support','area'])},
    {id:'departments',label:'부서별 현황',title:'부서별 주간 현황',desc:'부서명 추가·삭제와 각 부서의 출석, 이번 주, 다음 주, 특이사항을 수정합니다.',kind:'weekly',count:weeklyUnitRows(doc).length}
  ];
  if(type==='행사 결과 보고서')return [
    {id:'basic',label:'행사 개요',title:'행사 개요',desc:'행사명, 기간, 장소, 대상, 참석, 작성자를 수정합니다.',kind:'fields',fields:v25Fields(['제목','title'],['행사명','eventName'],['기간','period'],['장소','place'],['대상','target'],['참석','participants'],['작성자','writer'],['요약','summary','area'])},
    {id:'result',label:'진행 결과',title:'진행 결과',desc:'진행 결과와 재정 보고를 수정합니다.',kind:'fields',fields:v25Fields(['진행 결과','result','area'],['참석 및 재정 보고','finance','area'])},
    {id:'review',label:'평가·후속',title:'잘된 점과 보완점',desc:'평가와 후속 조치를 수정합니다.',kind:'fields',fields:v25Fields(['잘된 점','strengths','area'],['보완점','improvements','area'],['후속 조치','followup','area'],['요청사항','requests','area'])}
  ];
  if(type==='회의록')return [
    {id:'basic',label:'회의 정보',title:'회의 정보',desc:'회의명, 일시, 장소, 참석자, 사회, 기록을 수정합니다.',kind:'fields',fields:v25Fields(['회의명','meetingName'],['일시','dateTime'],['장소','place'],['참석자','attendees','area'],['사회','presider'],['기록','recorder'],['회의 목적','purpose','area'])},
    {id:'agenda',label:'안건',title:'안건',desc:'회의 안건을 수정합니다.',kind:'fields',fields:v25Fields(['안건','agenda','area'])},
    {id:'discussion',label:'논의 내용',title:'논의 내용',desc:'회의 중 논의된 내용을 수정합니다.',kind:'fields',fields:v25Fields(['논의 내용','discussion','area'])},
    {id:'resolution',label:'결의·서명',title:'결의 사항과 확인',desc:'결의 사항과 확인/서명을 수정합니다.',kind:'fields',fields:v25Fields(['결의 사항','resolution','area'],['확인/서명','approval'])}
  ];
  if(type==='일정표')return [
    {id:'basic',label:'기본 정보',title:'일정 기본 정보',desc:'제목, 기간, 장소, 담당자를 수정합니다.',kind:'fields',fields:v25Fields(['제목','title'],['기간','period'],['장소','place'],['담당','manager'],['안내사항','notice','area'])},
    {id:'p2',label:'시간표',title:'시간표',desc:'일정표 시간과 내용을 수정합니다.',kind:'schedule',count:(doc.scheduleItems||[]).length}
  ];
  if(type==='부서행사 진행표(캘린더형)')return [
    {id:'basic',label:'기본 정보',title:'월간 달력 기본 정보',desc:'제목, 월, 부서, 안내사항을 수정합니다.',kind:'fields',fields:v25Fields(['제목','title'],['월','month'],['부서','department'],['안내사항','notice','area'])}
  ];
  if(type==='주간 공지')return [
    {id:'basic',label:'기본 정보',title:'주간 공지 기본 정보',desc:'제목, 기간, 대상을 수정합니다.',kind:'fields',fields:v25Fields(['제목','title'],['기간','period'],['대상','target'])},
    {id:'items',label:'주요 공지',title:'이번 주 주요 공지',desc:'공지 항목을 여러 개 추가·삭제하며 관리합니다.',kind:'rows',path:'items',rowLabel:'공지',blank:eventRow(),columns:[{key:'date',label:'날짜/일시'},{key:'title',label:'공지 제목'},{key:'place',label:'장소'},{key:'target',label:'대상'},{key:'content',label:'내용',kind:'area'}]},
    {id:'extra',label:'확인·기도',title:'확인사항과 기도제목',desc:'확인사항과 기도제목은 줄 단위로 입력합니다.',kind:'fields',fields:v25Fields(['확인사항','requests','area'],['기도제목','prayer','area'])}
  ];
  if(type==='기획위원회 보고서')return [
    {id:'basic',label:'보고 정보',title:'보고 정보',desc:'제목, 기간, 작성자를 수정합니다.',kind:'fields',fields:v25Fields(['제목','title'],['기간','period'],['작성자','writer'])},
    {id:'body',label:'보고 내용',title:'보고 내용',desc:'보고 요약, 주요 안건, 결의사항을 수정합니다.',kind:'fields',fields:v25Fields(['보고 요약','summary','area'],['주요 안건','agenda','area'],['결의 및 진행사항','decisions','area'])},
    {id:'extra',label:'요청·기도',title:'요청사항과 기도제목',desc:'요청사항과 기도제목을 수정합니다.',kind:'fields',fields:v25Fields(['요청사항','requests','area'],['기도제목','prayer','area'])}
  ];
  if(type==='심방 보고서')return [
    {id:'basic',label:'심방 개요',title:'심방 개요',desc:'심방일, 심방자, 대상, 장소, 구분을 수정합니다.',kind:'fields',fields:v25Fields(['제목','title'],['심방일','date'],['심방자','visitor'],['대상','person'],['장소','place'],['구분','typeOfVisit'])},
    {id:'body',label:'내용·기도',title:'심방 내용과 기도제목',desc:'심방 내용, 기도제목, 후속 돌봄을 수정합니다.',kind:'fields',fields:v25Fields(['심방 내용','summary','area'],['기도제목','prayer','area'],['후속 돌봄 계획','followup','area'],['비고','note','area'])}
  ];
  if(type==='세미나/교육자료')return [
    {id:'basic',label:'자료 소개',title:'자료 소개',desc:'부제, 강사, 일시, 장소, 대상, 주제를 수정합니다.',kind:'fields',fields:v25Fields(['제목','title'],['부제','subtitle'],['강사','speaker'],['일시','date'],['장소','place'],['대상','target'],['주제','topic'])},
    {id:'content',label:'교육 내용',title:'교육 내용',desc:'목표, 진행 흐름, 핵심 문장, 나눔 질문을 수정합니다.',kind:'fields',fields:v25Fields(['교육 목표','goals','area'],['진행 흐름','outline','area'],['핵심 문장','keyText','area'],['나눔 질문','questions','area'],['메모/안내','memo','area'])}
  ];
  if(type==='신청서 양식')return [
    {id:'basic',label:'신청 안내',title:'신청 안내',desc:'행사명, 신청 대상, 신청 기간, 행사 일시와 장소를 수정합니다.',kind:'fields',fields:v25Fields(['제목','title'],['행사명','eventName'],['신청 대상','target'],['신청 기간','period'],['행사 일시','eventDate'],['장소','place'],['문의','contact'])},
    {id:'applicant',label:'신청자 정보',title:'신청자 정보 항목',desc:'신청자가 작성할 인적사항 항목을 한 줄에 하나씩 입력합니다.',kind:'fields',fields:v25Fields(['신청자 정보 항목','applicantFields','area'])},
    {id:'details',label:'신청 내용',title:'신청 내용 항목과 안내사항',desc:'참석 일정, 식사 여부, 요청사항처럼 신청 내용에 필요한 항목을 정리합니다.',kind:'fields',fields:v25Fields(['신청 내용 항목','applicationFields','area'],['안내사항','notes','area'])},
    {id:'consent',label:'동의·서명',title:'개인정보 동의 및 서명',desc:'개인정보 수집·이용 안내와 서명란을 수정합니다.',kind:'fields',fields:v25Fields(['개인정보 동의 안내','privacy','area'],['서명 날짜','signatureDate'],['서명자 표시','signatureLabel'],['담당자 확인란','approval'])}
  ];
  if(type==='7개부서 보고서')return [
    {id:'basic',label:'기본 정보',title:'보고 기본 정보',desc:'제목, 기간, 부서와 작성자를 수정합니다.',kind:'fields',fields:v25Fields(['제목','reportTitle'],['부서','department'],['기간','period'],['작성자','writer'])},
    {id:'report',label:'활동·계획',title:'활동과 계획',desc:'이번 주 활동과 다음 주 계획을 수정합니다.',kind:'fields',fields:v25Fields(['이번 주 주요 활동','thisWeek','area'],['다음 주 활동 계획','nextWeek','area'])},
    {id:'extra',label:'요청·기도',title:'요청사항과 기도제목',desc:'특이사항, 요청사항, 기도제목을 수정합니다.',kind:'fields',fields:v25Fields(['특이사항 및 요청사항','special','area'],['기도제목','prayer','area'])}
  ];
  if(type==='공문/협조 요청서')return [
    {id:'basic',label:'문서 개요',title:'문서 개요',desc:'문서번호, 작성일, 보내는 곳, 받는 곳, 건명을 수정합니다.',kind:'fields',fields:v25Fields(['제목','title'],['문서번호','docNo'],['작성일','date'],['보내는 곳','sender'],['받는 곳','receiver'],['건명','subject'])},
    {id:'background',label:'요청 배경',title:'요청 배경',desc:'요청 배경을 수정합니다.',kind:'fields',fields:v25Fields(['요청 배경','background','area'])},
    {id:'request',label:'협조 요청',title:'협조 요청 내용',desc:'협조 요청 내용을 수정합니다.',kind:'fields',fields:v25Fields(['협조 요청 내용','request','area'])},
    {id:'schedule',label:'진행 일정',title:'진행 일정',desc:'진행 일정을 수정합니다.',kind:'fields',fields:v25Fields(['진행 일정','schedule','area'])},
    {id:'reply',label:'회신·문의',title:'회신 및 문의',desc:'회신 안내와 맺음말을 수정합니다.',kind:'fields',fields:v25Fields(['회신 및 문의','reply','area'],['맺음말','closing'])}
  ];
  if(type==='만족도 조사')return [
    {id:'basic',label:'조사 목적',title:'조사 목적',desc:'제목, 대상, 목적을 수정합니다.',kind:'fields',fields:v25Fields(['제목','title'],['대상','target'],['조사 목적','purpose','area'])},
    {id:'questions',label:'문항',title:'조사 문항',desc:'객관식/주관식 문항을 수정합니다.',kind:'fields',fields:v25Fields(['주관식 문항','openQuestions','area'])},
    {id:'guide',label:'안내',title:'안내',desc:'응답 안내 문구를 수정합니다.',kind:'fields',fields:v25Fields(['안내','guide','area'])}
  ];
  const core=v23CoreFields(type,doc);
  return [{id:'basic',label:'문서 수정',title:'문서 수정',desc:'이 문서의 핵심 정보를 수정합니다.',kind:'fields',fields:core}];
}

function v23TabsFor(type,doc){
  const base=v23BaseTabsFor(type,doc);
  const custom=(doc.customSections||[]).map((s,i)=>({id:`custom-${i}`,label:s?.newPage?`${base.length+i+1}P 추가`:`추가 ${i+1}`,title:s?.title||`추가 페이지 ${i+1}`,desc:'사용자가 추가한 페이지/섹션입니다.',kind:'custom',index:i,count:0}));
  return [...base,...custom];
}

function normalizeJumpText(text){return String(text||'').replace(/\n/g,'').replace(/\r/g,'').replace(/[\s·/\\()\[\]{}:：,.-]+/g,'').trim()}
function tabIdByEditorPath(type,path){
  const p=String(path||'');
  if(!p)return '';
  let tabs=[];
  try{tabs=v23BaseTabsFor(type,{})||[]}catch{tabs=[]}
  for(const tab of tabs){
    if(tab.path && (p===tab.path || p.startsWith(`${tab.path}.`)))return tab.id;
    for(const f of (tab.fields||[])){
      if(f?.path && (p===f.path || p.startsWith(`${f.path}.`)))return tab.id;
    }
  }
  return '';
}
function tabIdBySectionTitle(type,title,idx){
  const t=normalizeJumpText(title);
  const has=(...words)=>words.some(w=>t.includes(normalizeJumpText(w)));
  if(type==='기본 공지 안내문'){
    if(has('안내 내용'))return 'content';
    if(has('확인 및 협조','협조','문의'))return 'bottom';
    return 'basic';
  }
  if(type==='회의자료'){
    if(has('지난 결정'))return 'decisions';
    if(has('부서별 보고'))return 'reports';
    if(has('주요 안건'))return 'agenda';
    if(has('일정 확인'))return 'schedule';
    if(has('예산 지원','지원 요청'))return 'support';
    if(has('결정사항 및 역할분담'))return 'actions';
    if(has('기도제목'))return 'prayer';
    return 'basic';
  }
  if(type==='연말/연차 부서 보고서'){
    if(has('한 해 주요 사역'))return 'ministries';
    if(has('출석 참여'))return 'attendance';
    if(has('예산 집행'))return 'budget';
    if(has('평가'))return 'review';
    if(has('다음 해 계획'))return 'next';
    return 'basic';
  }
  if(type==='지출결의서'){
    if(has('지출 내역'))return 'items';
    if(has('증빙','결재'))return 'proof';
    return 'basic';
  }
  if(type==='차량/장소 사용 신청서'){
    if(has('사용 정보','사용 목적'))return 'use';
    if(has('확인 사항'))return 'checks';
    if(has('승인'))return 'approval';
    return 'basic';
  }
  if(type==='각부 월간행사 안내'){
    if(has('월간 핵심 일정','핵심 일정'))return 'events';
    if(has('부서 모임별 참고 일정','참고 일정'))return 'dept';
    if(has('확인 및 협조','기도 제목','협조','기도'))return 'bottom';
    return 'top';
  }
  if(type==='부서 통합 주간보고서'){
    if(has('부서별 주간 현황'))return 'departments';
    if(has('주간 활동 요약','공동 기도제목','공유 지원 요청','지원 요청'))return 'summary';
    return 'basic';
  }
  if(type==='7개부서 보고서'){
    if(has('이번 주 주요 활동','다음 주 활동 계획'))return 'report';
    if(has('특이사항','요청사항','기도제목'))return 'extra';
    return 'basic';
  }
  if(type==='회의록'){
    if(has('안건'))return 'agenda';
    if(has('논의 내용'))return 'discussion';
    if(has('결의 사항','확인 및 서명'))return 'resolution';
    return 'basic';
  }
  if(type==='공문/협조 요청서'){
    if(has('요청 배경'))return 'background';
    if(has('협조 요청 내용'))return 'request';
    if(has('진행 일정'))return 'schedule';
    if(has('회신 및 문의'))return 'reply';
    return 'basic';
  }
  if(type==='만족도 조사'){
    if(has('객관식 문항','주관식 문항'))return 'questions';
    if(has('안내'))return 'guide';
    return 'basic';
  }
  let tabs=[];
  try{tabs=v23BaseTabsFor(type,{})||[]}catch{tabs=[]}
  const exact=tabs.find(tab=>normalizeJumpText(tab.title)===t || normalizeJumpText(tab.label)===t);
  if(exact)return exact.id;
  const partial=tabs.find(tab=>{
    const a=normalizeJumpText(tab.title), b=normalizeJumpText(tab.label);
    return (a&&t.includes(a)) || (b&&t.includes(b)) || (a&&a.includes(t)) || (b&&b.includes(t));
  });
  return partial?.id||'';
}
function previewBlockKeyFor(type,title,idx){return tabIdBySectionTitle(type,title,idx)||sectionQuickKey(title,idx)}

function v23ProgressFromTabs(tabs,doc){
  const fields=tabs.flatMap(t=>t.fields||[]);
  const total=Math.max(1,fields.length);
  const filled=fields.filter(f=>String(getByPath(doc,f.path)||'').trim()).length;
  return {filled,total,percent:Math.round(filled/total*100)};
}
function V2FillBoard({type,doc,setDoc}){
  const tabs=v23TabsFor(type,doc);
  const [active,setActive]=useState(tabs[0]?.id||'basic');
  const [status,setStatus]=useState('');
  useEffect(()=>{
    function onJump(e){
      const d=e.detail||{};
      if(d.type&&d.type!==type)return;
      const target=d.tab||d.quickKey;
      if(target&&tabs.some(t=>t.id===target)){
        setActive(target);
        setStatus(d.label?`미리보기에서 ‘${d.label}’ 항목을 선택했습니다.`:'미리보기에서 선택한 항목을 열었습니다.');
        setTimeout(()=>{
          const drawer=document.querySelector('.edit-drawer');
          if(drawer)drawer.open=true;
          const path=d.path?CSS.escape(String(d.path)):'';
          const focusTarget=path?document.querySelector(`[data-editor-path="${path}"]`):null;
          const targetEl=focusTarget||document.querySelector('.v23-active-card');
          targetEl?.classList?.add('editor-jump-highlight');
          const panel=document.querySelector('.form-pane.compact-form-pane')||document.querySelector('.form-pane');
          if(panel&&targetEl&&panel.contains(targetEl)){
            const pr=panel.getBoundingClientRect();
            const tr=targetEl.getBoundingClientRect();
            const nextTop=Math.max(0,panel.scrollTop+(tr.top-pr.top)-82);
            panel.scrollTo({top:nextTop,behavior:'smooth'});
          }
          // v2.11: 입력칸 focus가 브라우저/미리보기 스크롤을 끌고 가는 현상이 있어 자동 포커스는 하지 않습니다.
          setTimeout(()=>targetEl?.classList?.remove('editor-jump-highlight'),1300);
        },90);
      }
    }
    window.addEventListener('docworkshop:quick-tab',onJump);
    return ()=>window.removeEventListener('docworkshop:quick-tab',onJump);
  },[type,tabs.map(t=>t.id).join('|')]);
  useEffect(()=>{if(!tabs.some(t=>t.id===active))setActive(tabs[0]?.id||'basic')},[type,active,tabs.map(t=>t.id).join('|')]);
  const tab=tabs.find(t=>t.id===active)||tabs[0];
  const progress=v23ProgressFromTabs(tabs,doc);
  function patch(path,value){setDoc(setByPath(doc,path,value));}
  async function copyBlankTemplate(){
    const text=[type,...tabs.flatMap(t=>(t.fields||[]).map(f=>`${f.label}: ${getByPath(doc,f.path)||''}`))].join('\n');
    try{await navigator.clipboard?.writeText(text);setStatus('현재 탭의 입력 양식을 복사했습니다.');}
    catch{setStatus('복사가 제한되었습니다. 보이는 칸을 그대로 채우면 됩니다.');}
  }
  return <section className="v2-fill-board v23-page-editor" data-editor-title="페이지별 수정">
    <div className="v23-head"><div><p>페이지별 수정판</p><h3>{type}</h3></div><div className="v23-progress"><b>{progress.percent}%</b><span>{progress.filled}/{progress.total}</span></div></div>
    <V2QuickAddButtons type={type} doc={doc} setDoc={setDoc}/>
    <div className="v23-tabbar" role="tablist">{tabs.map(t=><button type="button" key={t.id} className={t.id===active?'active':''} onClick={()=>setActive(t.id)}><b>{t.label}</b>{Number.isFinite(t.count)&&<em>{t.count}</em>}</button>)}</div>
    <div className="v23-active-card"><V23TabContent tab={tab} doc={doc} setDoc={setDoc} onPatch={patch}/></div>
    <div className="v23-actions"><button type="button" onClick={copyBlankTemplate}>입력 양식 복사</button>{status&&<small>{status}</small>}</div>
  </section>
}


function v237FormatCount(type,doc){
  if(type==='주간 공지')return `주요공지 ${v22Count(doc.items)}개`;
  if(type==='각부 월간행사 안내')return `핵심 ${v22Count(doc.events)}개 · 참고 ${v22Count(doc.deptRows)}개`;
  if(type==='행사 및 수련회 기획안')return `일정 ${v22Count(doc.scheduleItems)}개 · 예산 ${(doc.incomeItems||[]).length+(doc.expenseItems||[]).length}개`;
  if(type==='세부 프로그램 문서')return `프로그램 ${v22Count(doc.programs)}개`;
  if(type==='예산안')return `예산 ${(doc.incomeItems||[]).length+(doc.expenseItems||[]).length}개`;
  if(type==='준비목록')return `준비 ${v22Count(doc.items)}개`;
  if(type===CUE_DOC)return `순서 ${v22Count(doc.rows)}개`;
  if(type==='회의자료')return `안건 ${v22Count(doc.agendaItems)}개`;
  return '기본 항목';
}
function V237FormAdjustPanel({type,doc,setDoc}){
  const hasAdjust=['기본 공지 안내문','주간 공지','각부 월간행사 안내','부서별 주간보고서','부서 통합 주간보고서','7개부서 보고서','행사 및 수련회 기획안','세부 프로그램 문서','예산안','준비목록',CUE_DOC,'회의자료'].includes(type);
  return <div className="v237-form-adjust-panel">
    <div className="v237-adjust-summary"><b>{v237FormatCount(type,doc)}</b><span>반복 항목은 위 페이지별 수정판의 ‘항목 추가’ 버튼과 각 탭 안의 삭제 버튼으로 관리합니다.</span></div>
    <V2QuickAddButtons type={type} doc={doc} setDoc={setDoc}/>
    {!hasAdjust&&<div className="v237-no-adjust"><b>이 문서는 별도 양식 조정이 많지 않습니다.</b><span>기본 내용은 페이지별 수정판에서 수정하고, 페이지 나눔은 문서가 잘릴 때만 조정해 주세요.</span></div>}
    {hasAdjust&&<div className="v237-adjust-guide"><b>안전하게 조정하기</b><span>빈 화면으로 멈추지 않도록 전체 편집기를 이 안에 다시 불러오지 않고, 반복 항목 추가·삭제와 구조 안내만 제공합니다.</span></div>}
  </div>;
}
function V222ToolButton({active,onClick,title,desc,badge}){return <button type="button" className={active?'v222-tool-btn active':'v222-tool-btn'} onClick={onClick}><b>{title}</b><span>{desc}</span>{badge&&<em>{badge}</em>}</button>}
function v222ToolBadges(type,doc){
  if(type==='각부 월간행사 안내')return {form:`일정 ${v22Count(doc.events)}개`,design:'네이비',output:'A4 1장'};
  if(type==='주간 공지')return {form:`공지 ${v22Count(doc.items)}개`,design:'한장형',output:'A4'};
  if(type==='행사 및 수련회 기획안')return {form:`일정 ${v22Count(doc.scheduleItems)}개`,design:'디자인',output:'3쪽'};
  if(type==='세부 프로그램 문서')return {form:`프로그램 ${v22Count(doc.programs)}개`,design:'디자인',output:'페이지'};
  if(type==='예산안')return {form:`예산 ${v22Count(doc.incomeItems)+v22Count(doc.expenseItems)}개`,design:'표',output:'페이지'};
  return {form:'항목 추가',design:'색상',output:'출력'};
}
function V224PageStructurePanel({type,doc,setDoc}){
  const labels=labelsFor(type);
  return <div className="v224-page-structure"><div className="v224-page-add"><V26PageManager doc={doc} setDoc={setDoc}/></div><div className="v224-section-settings"><b>페이지 나눔 조정</b><p>보통은 그대로 두셔도 됩니다. PDF 저장 시 내용이 잘리거나 특정 내용을 다음 페이지에서 시작하고 싶을 때만 조정하세요.</p>{labels.map((l,i)=><div className="label-row" key={i}><Field label={`섹션 ${i+1} 제목`} value={doc.labels?.[i]||l} onChange={v=>setDoc({...doc,labels:{...(doc.labels||{}),[i]:v}})} /><div className="section-controls page-placement-controls"><label className="check"><input type="checkbox" checked={!!doc.breaks?.[i]} onChange={e=>setDoc({...doc,breaks:{...(doc.breaks||{}),[i]:e.target.checked}})} /> 이 부분을 다음 페이지에서 시작하기</label><div className="placement-buttons"><button type="button" onClick={()=>setDoc({...doc,breaks:{...(doc.breaks||{}),[i]:false}})}>현재 페이지에 두기</button><button type="button" onClick={()=>setDoc({...doc,breaks:{...(doc.breaks||{}),[i]:true}})}>다음 페이지로 넘기기</button></div><label className="check danger-check"><input type="checkbox" checked={!!doc.hiddenSections?.[i]} onChange={e=>setDoc({...doc,hiddenSections:{...(doc.hiddenSections||{}),[i]:e.target.checked}})} /> 이 항목 사용 안 함</label></div></div>)}</div><CustomSectionsEditor doc={doc} setDoc={setDoc}/></div>
}
function BasicSimpleSettings({type,doc,setDoc}){
  const st={...baseExtras(type).style,...(doc?.style||{})};
  const fs=clampFont(st.fontScale);
  const preset='행정 보고형';
  const resetBasic=()=>updateDocStyle(doc,setDoc,{...st,...basicUnifiedStyle(100),titleScale:100,bodyScale:100,tableScale:100,listScale:100,autoFit:false,fontTargets:{},activeFontTarget:'',activeFontTargets:[],activeFontLabel:''});
  const setFont=(value)=>updateDocStyle(doc,setDoc,{...st,fontScale:value,bodyScale:100,tableScale:100,listScale:100,autoFit:false});
  const setDensity=(mode)=>{
    if(mode==='roomy') updateDocStyle(doc,setDoc,{...st,fontScale:104,autoFit:false,outputMode:'normal'});
    if(mode==='normal') updateDocStyle(doc,setDoc,{...st,fontScale:100,autoFit:false,outputMode:'normal'});
    if(mode==='compact') updateDocStyle(doc,setDoc,{...st,fontScale:96,autoFit:true,outputMode:'fit-one'});
  };
  const fontMode=fs<=96?'small':fs>=106?'large':'normal';
  const densityMode=st.autoFit?'compact':fs>=103?'roomy':'normal';
  const fontLabel=fontMode==='small'?'작게':fontMode==='large'?'크게':'기본';
  const densityLabel=densityMode==='roomy'?'여유롭게':densityMode==='compact'?'압축':'기본';
  return <section className="basic-103-simple-settings" data-editor-title="간단 설정">
    <details className="basic-simple-card">
      <summary><b>간단 설정</b><span>현재: 글자 {fontLabel} · 밀도 {densityLabel}</span></summary>
      <div className="basic-simple-body">
        <div className="basic-control-group">
          <div className="basic-control-title"><b>글자 크기</b><span>문서 전체 글자 크기 · 표 안 글씨 포함</span></div>
          <div className="basic-segment" role="group" aria-label="글자 크기">
            <button type="button" className={fontMode==='small'?'active':''} onClick={()=>setFont(94)}>작게</button>
            <button type="button" className={fontMode==='normal'?'active':''} onClick={()=>setFont(100)}>기본</button>
            <button type="button" className={fontMode==='large'?'active':''} onClick={()=>setFont(108)}>크게</button>
          </div>
        </div>
        <div className="basic-control-group">
          <div className="basic-control-title"><b>문서 밀도</b><span>A4 안에서 여백과 간격을 조정</span></div>
          <div className="basic-segment" role="group" aria-label="문서 밀도">
            <button type="button" className={densityMode==='roomy'?'active':''} onClick={()=>setDensity('roomy')}>여유롭게</button>
            <button type="button" className={densityMode==='normal'?'active':''} onClick={()=>setDensity('normal')}>기본</button>
            <button type="button" className={densityMode==='compact'?'active':''} onClick={()=>setDensity('compact')}>압축</button>
          </div>
        </div>
        <button type="button" className="basic-reset-btn" onClick={resetBasic}>기본 양식으로 되돌리기</button>
        <p className="basic-simple-note">처음 사용자는 이 설정을 열지 않아도 됩니다. 내용만 바꾸면 바로 PDF/PNG로 저장할 수 있습니다.</p>
      </div>
    </details>
    <details className="basic-advanced-card">
      <summary><b>문서가 잘릴 때만 사용</b><span>대부분은 열지 않아도 됩니다</span></summary>
      <div className="basic-advanced-body"><V224PageStructurePanel type={type} doc={doc} setDoc={setDoc}/></div>
    </details>
  </section>
}
function V238LiteSettings({type,doc,setDoc}){
  return <BasicSimpleSettings type={type} doc={doc} setDoc={setDoc}/>
}
function GenericEditor({type,doc,setDoc,selectedTypes=[],allDocs,setAllDocs}){const inputScopeRef=useRef(null);return <div className="generic-editor-scope v2-generic-scope v26-editor-scope v222-simple-tools-scope v238-editor-scope" ref={inputScopeRef}>
  <V26TopTools type={type} doc={doc} setDoc={setDoc}/>
  <V2FillBoard type={type} doc={doc} setDoc={setDoc}/>
  <V238LiteSettings type={type} doc={doc} setDoc={setDoc}/>
  <div className="easy-detail-note v238-detail-note">기본 작성은 위 페이지별 수정판에서 끝내고, 문서가 잘리거나 여백을 조정해야 할 때만 아래 설정을 여세요.</div>
</div>}
function QuickGuide(){return <div className="quick-guide"><b>10분 작성 순서</b><span>1 문서 선택</span><span>2 내용 입력</span><span>3 미리보기 확인</span><span>4 PDF/PNG 저장</span></div>}
function MobileNotice(){return <div className="mobile-notice"><b>모바일 간편모드</b><span>휴대폰에서는 ①문서 선택 ②핵심 입력 ③미리보기 ④저장 순서만 보이게 정리했습니다. 세부 편집은 필요할 때만 열어 주세요.</span></div>}
function MobileDocPicker({type,setType,setSelected,setStage}){
  const [query,setQuery]=useState('');
  const favorites=['기본 공지 안내문','각부 월간행사 안내','부서별 주간보고서','부서 통합 주간보고서','행사 및 수련회 기획안'];
  const allTypes=CATEGORIES.flatMap(cat=>cat.types);
  const filtered=query.trim()?allTypes.filter(t=>t.includes(query.trim())):favorites.filter(t=>allTypes.includes(t));
  function changeDoc(next){setType(next);setSelected?.([next]);setStage?.('write');setTimeout(()=>document.querySelector('.mobile-quick-edit')?.scrollIntoView({behavior:'smooth',block:'start'}),60)}
  return <div className="mobile-doc-picker" id="mobile-docs"><div className="mobile-picker-title"><b>문서 선택</b><span>표 작성 부담이 적은 간단 문서 먼저</span></div>
    <div className="mobile-favorite-docs">{filtered.map(t=><button type="button" key={t} className={type===t?'active':''} onClick={()=>changeDoc(t)}>{t}</button>)}</div>
    <label className="mobile-search-wrap"><span>문서 검색</span><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="예: 월간행사, 주간보고" /></label>
    <label className="mobile-select-wrap"><span>전체 양식</span><select value={type} onChange={e=>changeDoc(e.target.value)}>{CATEGORIES.map(cat=><optgroup key={cat.name} label={cat.name}>{cat.types.map(t=><option key={t} value={t}>{t}</option>)}</optgroup>)}</select></label>
    <div className="mobile-current-doc">현재 선택: <b>{type}</b></div></div>}

function MobileQuickStartPanel({type,setStage,onHome}){
  const steps=[
    {key:'write',label:'1 입력',desc:'내용 먼저 채우기',selector:'.mobile-quick-edit'},
    {key:'preview',label:'2 확인',desc:'A4 미리보기',selector:'.preview-pane'},
    {key:'save',label:'3 저장',desc:'클라우드·PDF/PNG',selector:'#mobile-save-area'}
  ];
  function go(step){
    setStage?.(step.key);
    setTimeout(()=>scrollToMobileTarget(step.selector),40);
  }
  return <section className="mobile-work-hub" aria-label="모바일 작업 홈">
    <div className="mobile-work-head"><div><em>모바일 간편 사용</em><b>{type}</b><span>휴대폰에서는 자주 쓰는 항목만 크게 보여드립니다.</span></div><button type="button" onClick={onHome}>홈</button></div>
    <div className="mobile-work-steps">{steps.map(step=><button type="button" key={step.key} onClick={()=>go(step)}><strong>{step.label}</strong><small>{step.desc}</small></button>)}</div>
  </section>
}

function getByPath(obj,path){
  if(!path)return '';
  return pathTokens(path).reduce((cur,k)=>cur==null?'':cur[k],obj)??'';
}

function scrollToMobileTarget(selector,openDrawer=false){
  if(openDrawer){const drawer=document.querySelector('.edit-drawer'); if(drawer)drawer.open=true;}
  const target=document.querySelector(selector);
  target?.scrollIntoView({behavior:'smooth',block:'start'});
}
function MobileModeBar({stage,setStage}){
  const go=(next,selector)=>{setStage?.(next);setTimeout(()=>scrollToMobileTarget(selector),30)};
  return <div className="mobile-mode-bar mobile-unified-bar mobile-stage-tabs"><div><b>모바일 작업 순서</b><span>입력 → 확인 → 저장 순서로 화면을 나눴습니다. 아래 버튼으로 바로 이동할 수 있습니다.</span></div><div><button type="button" className={stage==='write'?'active':''} onClick={()=>go('write','.mobile-quick-edit')}>입력</button><button type="button" className={stage==='preview'?'active':''} onClick={()=>go('preview','.preview-pane')}>미리보기</button><button type="button" className={stage==='save'?'active':''} onClick={()=>go('save','#mobile-save-area')}>저장</button></div></div>
}
function MobileExportPanel({busy,onPDF,onPNG,savedAt}){
  return <div className="mobile-export-panel" id="mobile-export"><div><b>저장·출력</b><span>먼저 위쪽 ‘PC·모바일 이어쓰기’에서 클라우드에 저장하고, 필요하면 PDF/PNG로 내려받으세요.</span></div><div className="mobile-export-buttons"><button type="button" disabled={!!busy} onClick={onPDF}>{busy==='PDF'?'PDF 만드는 중…':'PDF 저장'}</button><button type="button" disabled={!!busy} onClick={onPNG}>{busy==='PNG'?'PNG 만드는 중…':'PNG 저장'}</button></div>{savedAt&&<em>{savedAt}</em>}<small className="mobile-export-tip">PDF/PNG 저장은 휴대폰 기종에 따라 시간이 걸릴 수 있습니다. 중요한 출력은 PC 사용을 권장합니다.</small></div>
}
function MobileBottomNav({stage,setStage,onHome}){
  const go=(next,selector)=>{setStage?.(next);setTimeout(()=>scrollToMobileTarget(selector),30)};
  return <nav className="mobile-bottom-nav mobile-direct-export-nav mobile-easy-bottom-nav" aria-label="모바일 빠른 이동"><button type="button" onClick={onHome}>홈</button><button type="button" className={stage==='write'?'active':''} onClick={()=>go('write','.mobile-quick-edit')}>입력</button><button type="button" className={stage==='preview'?'active':''} onClick={()=>go('preview','.preview-pane')}>확인</button><button type="button" className={stage==='save'?'active':''} onClick={()=>go('save','#mobile-save-area')}>저장</button></nav>
}

function FirstUsePanel({type,setType,setSelected,easyMode,setEasyMode,onPDF,onPNG,busy,savedAt}){
  const cards=[
    {label:'기본 공지 안내문',doc:'기본 공지 안내문',desc:'교사회의·기도회·부서 안내를 A4/PNG 한 장으로 정리'},
    {label:'각부 월간행사 안내',doc:'각부 월간행사 안내',desc:'월간 핵심일정과 협조·기도제목을 카카오톡 공유용으로 정리'},
    {label:'부서별 주간보고서',doc:'부서별 주간보고서',desc:'한 부서의 출석·활동·계획·기도제목을 보고서로 정리'},
    {label:'부서 통합 주간보고서',doc:'부서 통합 주간보고서',desc:'여러 부서의 주간 현황을 한 장 보고서로 모아 정리'},
    {label:'행사 및 수련회 기획안',doc:'행사 및 수련회 기획안',desc:'목적·개요·일정표·예산안을 3쪽 기획서로 정리'}
  ];
  function choose(doc){setType(doc);setSelected?.(defaultBundleFor(doc));setTimeout(()=>scrollToMobileTarget('.edit-drawer',true),80)}
  const step=[
    {n:'1',t:'문서 고르기',d:'만들 자료를 먼저 선택',a:()=>scrollToMobileTarget('.beginner-doc-cards')},
    {n:'2',t:'내용 입력',d:'오른쪽/아래 입력창에서 수정',a:()=>scrollToMobileTarget('.edit-drawer',true)},
    {n:'3',t:'미리보기 확인',d:'A4 모양을 바로 확인',a:()=>scrollToMobileTarget('.preview-pane')},
    {n:'4',t:'PDF 저장',d:'PDF/PNG 저장',a:()=>scrollToMobileTarget('#mobile-export')}
  ];
  return <section className="beginner-panel" aria-label="처음 사용 안내">
    <div className="beginner-head">
      <div><span className="beginner-kicker">처음 사용 안내</span><h3>오늘 필요한 문서를 골라주세요</h3><p>반복되는 교회 문서 작성, 이제 10분 안에 끝낼 수 있습니다. 자주 쓰는 5개 문서를 고르고 내용만 채우면 A4/PDF/PNG로 바로 정리됩니다.</p></div>
      <div className="beginner-mode-toggle"><span>{easyMode?'간편 보기':'더 자세히 수정 보기'}</span><button type="button" onClick={()=>setEasyMode(!easyMode)}>{easyMode?'더 자세히 수정하기':'간편 보기로'}</button></div>
    </div>
    <div className="simple-principle-strip"><span><b>1</b> 문서 선택</span><span><b>2</b> 내용 입력</span><span><b>3</b> 미리보기 확인</span><span><b>4</b> PDF/PNG 저장</span></div>
    <div className="beginner-doc-cards">{cards.map(c=><button type="button" key={c.doc} className={type===c.doc?'active':''} onClick={()=>choose(c.doc)}><b>{c.label}</b><span>{c.desc}</span></button>)}</div>
    <div className="beginner-steps">{step.map(s=><button type="button" key={s.n} onClick={s.a}><b>{s.n}</b><span><strong>{s.t}</strong><em>{s.d}</em></span></button>)}</div>
    <div className="beginner-quick-actions"><button type="button" onClick={()=>scrollToMobileTarget('.edit-drawer',true)}>내용 입력하기</button><button type="button" onClick={()=>scrollToMobileTarget('.preview-pane')}>미리보기 보기</button><button type="button" className="primary" disabled={!!busy} onClick={onPDF}>{busy==='PDF'?'PDF 만드는 중…':'PDF 저장'}</button><button type="button" disabled={!!busy} onClick={onPNG}>{busy==='PNG'?'PNG 만드는 중…':'PNG 저장'}</button>{savedAt&&<small>{savedAt}</small>}<em className="simple-mode-note">처음에는 내용만 입력해도 충분합니다. 글자·페이지 세부 설정은 필요할 때만 열어 사용하세요.</em></div>
  </section>
}

function mobileQuickMeta(type,tab){
  const label=tab?.label||tab?.title||'항목';
  const base={title:label,desc:tab?.desc||'이 부분을 빠르게 수정합니다.'};
  if(type==='부서별 주간보고서'){
    if(tab?.id==='basic')return {title:'기본정보',desc:'부서 · 기간 · 작성자 · 출석'};
    if(tab?.id==='content')return {title:'보고내용',desc:'예배/모임 · 이번 주 활동 · 다음 주 계획'};
    if(tab?.id==='prayer')return {title:'특이·기도',desc:'특이사항 · 지원 요청 · 기도제목'};
  }
  if(type==='부서 통합 주간보고서'){
    if(tab?.id==='basic')return {title:'기본정보',desc:'제목 · 기간 · 작성자'};
    if(tab?.id==='summary')return {title:'보고요약',desc:'전체 주간 활동 요약'};
    if(tab?.id==='departments')return {title:'부서현황',desc:'부서별 출석 · 활동 · 다음 계획'};
    if(tab?.id==='prayer')return {title:'기도·지원',desc:'공동 기도제목 · 공유/지원 요청'};
  }
  if(type==='기본 공지 안내문'){
    if(tab?.id==='basic')return {title:'공지개요',desc:'제목 · 일시 · 장소 · 대상'};
    if(tab?.id==='content')return {title:'공지내용',desc:'안내문 · 주요 내용'};
    if(tab?.id==='requests')return {title:'협조·문의',desc:'확인사항 · 문의처'};
  }
  if(type==='각부 월간행사 안내'){
    if(tab?.id==='basic')return {title:'기본정보',desc:'제목 · 기간 · 담당'};
    if(tab?.id==='events')return {title:'핵심일정',desc:'날짜 · 시간 · 행사명 · 장소'};
    if(tab?.id==='reference')return {title:'참고일정',desc:'부서/모임별 참고 일정'};
    if(tab?.id==='requests')return {title:'협조·문의',desc:'확인 및 협조 · 문의'};
  }
  return base;
}
function MobileQuickEdit({type,doc,setDoc,setStage,mobileSimple,setMobileSimple}){
  const tabs=v23TabsFor(type,doc);
  const compactTabs=tabs.filter(t=>['fields','events','schedule','budget','income','expense','prep','cue'].includes(t.kind)).slice(0,6);
  const [active,setActive]=useState(compactTabs[0]?.id||tabs[0]?.id||'basic');
  useEffect(()=>{
    if(!compactTabs.some(t=>t.id===active))setActive(compactTabs[0]?.id||tabs[0]?.id||'basic');
    function onJump(e){const d=e.detail||{}; if(d.type&&d.type!==type)return; if(d.tab&&compactTabs.some(t=>t.id===d.tab))setActive(d.tab);}
    window.addEventListener('docworkshop:quick-tab',onJump);
    return ()=>window.removeEventListener('docworkshop:quick-tab',onJump);
  },[type,compactTabs.map(t=>t.id).join('|'),active]);
  const tab=compactTabs.find(t=>t.id===active)||compactTabs[0]||tabs[0];
  function patch(path,value){setDoc(setByPath(doc,path,value))}
  function jumpPreview(){setStage?.('preview');setTimeout(()=>scrollToMobileTarget('.preview-pane'),30)}
  function toggleFullEdit(){
    const next=!mobileSimple;
    setMobileSimple?.(next);
    setTimeout(()=>scrollToMobileTarget(next?'.mobile-quick-edit':'.edit-drawer',!next),60);
  }
  if(!tab)return null;
  const meta=mobileQuickMeta(type,tab);
  const fieldContent=tab.kind==='fields'?<V23Fields fields={(tab.fields||[]).slice(0,6)} doc={doc} onPatch={patch}/>:<div className="mobile-mini-auto-card"><b>{tab.title||tab.label}</b><span>{tab.desc||'이 항목은 ‘더 자세히 수정하기’에서 조정할 수 있습니다.'}</span><button type="button" onClick={()=>{setMobileSimple?.(false);setTimeout(()=>scrollToMobileTarget('.edit-drawer',true),70)}}>전체 편집 열기</button></div>;
  return <div className="mobile-quick-edit v24-mobile-lite-panel v236-quick-write">
    <div className="mobile-lite-head v236-mobile-lite-head"><div><em>빠른 작성</em><b>수정할 항목을 선택하세요</b><span>휴대폰에서는 자주 쓰는 칸만 먼저 수정합니다. 세부 구조는 아래 전체 편집에서 열 수 있습니다.</span></div><button type="button" onClick={jumpPreview}>미리보기</button></div>
    <div className="mobile-lite-tabs v236-choice-cards">{compactTabs.map(t=>{const m=mobileQuickMeta(type,t);return <button type="button" key={t.id} className={t.id===tab.id?'active':''} onClick={()=>setActive(t.id)}><strong>{t.id===tab.id?'✓ ':''}{m.title}</strong><small>{m.desc}</small></button>})}</div>
    <div className="mobile-current-edit"><span>현재 수정 중</span><b>{meta.title}</b><em>아래 내용을 수정하면 미리보기에 바로 반영됩니다.</em></div>
    <div className="mobile-lite-body v236-quick-body">{fieldContent}</div>
    <div className="mobile-full-edit-gate"><div><b>전체 편집이 필요하신가요?</b><span>페이지별 구성, 모든 섹션, 디자인·출력 설정은 전체 편집에서 조정합니다.</span></div><button type="button" onClick={toggleFullEdit}>{mobileSimple?'전체 편집 열기':'전체 편집 닫기'}</button></div>
  </div>
}
function blankDeep(v){
  if(Array.isArray(v)){return v.length?[blankDeep(v[0])]:[]}
  if(v&&typeof v==='object'){const out={};Object.entries(v).forEach(([k,val])=>{if(['style','labels','breaks','hiddenSections'].includes(k))out[k]=val;else out[k]=blankDeep(val)});return out}
  if(typeof v==='number')return v;
  return '';
}
function blankDocFor(type){const base=withBase(type,initialData(type));const blanked=blankDeep(base);return withBase(type,{...blanked,style:base.style,labels:base.labels,breaks:{},hiddenSections:{},customSections:[]})}

function BudgetRowsTable({rows,onChange,addLabel='항목 추가'}){
  const safe=rows?.length?rows:[budgetRow()];
  function patch(i,key,value){ onChange(updateArray(safe,i,key,value)); }
  const many=safe.length>3;
  return <div className="budget-card-editor budget-direct-editor budget-collapsible-editor">
    <div className="budget-card-guide"><span>금액을 직접 입력하는 방식입니다.</span><em>항목이 많아지면 <b>열기/접기</b> 표시를 보고 필요한 항목만 펼쳐 수정합니다.</em></div>
    <div className="budget-card-list">
      {safe.map((r,i)=>{
        const title=r.item?.trim()||`항목 ${i+1}`;
        const amount=budgetAmount(r);
        return <details className="budget-card-input budget-collapsible-card" key={i} open={!many || i===safe.length-1}>
          <summary className="budget-card-head"><b>{title}</b><span>{r.detail||'산출 내용 미입력'}</span><strong>{won(amount)}</strong></summary>
          <div className="budget-card-body-fields">
            {safe.length>1&&<div className="budget-row-delete"><button type="button" onClick={()=>onChange(safe.filter((_,idx)=>idx!==i))}>이 항목 삭제</button></div>}
            <label className="budget-field item"><span>항목명</span><input value={r.item||''} onChange={e=>patch(i,'item',e.target.value)} placeholder="예: 참가비 / 숙박 / 식비" /></label>
            <label className="budget-field detail"><span>산출 내용</span><input value={r.detail||''} onChange={e=>patch(i,'detail',e.target.value)} placeholder="예: 청년 25명 / 펜션 예약 / 식사 준비" /></label>
            <label className="budget-field amount"><span>금액</span><input inputMode="numeric" value={r.amount||''} onChange={e=>patch(i,'amount',e.target.value)} placeholder="예: 300000" /></label>
            <details className="budget-detail-calc">
              <summary>수량×단가 상세 산출 사용</summary>
              <p>금액 칸이 비어 있을 때만 아래 수량×단가가 합계에 반영됩니다.</p>
              <div className="budget-card-mini-grid">
                <label className="budget-field"><span>수량</span><input inputMode="numeric" value={r.qty||''} onChange={e=>patch(i,'qty',e.target.value)} placeholder="1" /></label>
                <label className="budget-field"><span>단가</span><input inputMode="numeric" value={r.price||''} onChange={e=>patch(i,'price',e.target.value)} placeholder="30000" /></label>
              </div>
            </details>
            <label className="budget-field note"><span>비고</span><input value={r.note||''} onChange={e=>patch(i,'note',e.target.value)} placeholder="필요 시 메모" /></label>
          </div>
        </details>
      })}
    </div>
    <div className="budget-card-actions"><button type="button" className="btn secondary" onClick={()=>onChange([...safe,budgetRow()])}>{addLabel}</button><p className="hint">합계: <b>{won(budgetTotal(safe))}</b></p></div>
  </div>
}
function BudgetEditor({title,rows,onChange}){return <Box title={title}><BudgetRowsTable rows={rows} onChange={onChange}/></Box>}
function BudgetPairEditor({incomeRows,expenseRows,onIncomeChange,onExpenseChange,title='수입·지출 예산 입력'}){
  const income=incomeRows?.length?incomeRows:[budgetRow()];
  const expense=expenseRows?.length?expenseRows:[budgetRow()];
  const incomeTotal=budgetTotal(income);
  const expenseTotal=budgetTotal(expense);
  return <Box title={title} className="budget-pair-box budget-oneview-box"><p className="hint">수입과 지출을 금액 중심 카드형으로 수정합니다. 기본은 금액 직접 입력이고, 필요할 때만 상세 산출을 열어 사용합니다.</p><div className="budget-oneview-summary"><span><b>수입 합계</b><strong>{won(incomeTotal)}</strong></span><span><b>지출 합계</b><strong>{won(expenseTotal)}</strong></span><span className={(incomeTotal-expenseTotal)>=0?'good':'bad'}><b>차액</b><strong>{won(incomeTotal-expenseTotal)}</strong></span></div><div className="budget-pair-editor v110-budget-pair-editor"><section><h4>수입 예산</h4><BudgetRowsTable rows={income} onChange={onIncomeChange} addLabel="수입 항목 추가"/></section><section><h4>지출 예산</h4><BudgetRowsTable rows={expense} onChange={onExpenseChange} addLabel="지출 항목 추가"/></section></div></Box>
}
function EventsEditor({rows,onChange}){
  const safe=rows?.length?rows:[eventRow()];
  function patch(i,key,value){
    let next=safe;
    if(key==='date'){
      const parts=splitMonthlyDateTime(value);
      if(parts.time&&!safe[i]?.time){
        next=updateArray(updateArray(safe,i,'date',parts.date),i,'time',parts.time);
        onChange(next);
        return;
      }
    }
    onChange(updateArray(safe,i,key,value));
  }
  return <Box title="월간 핵심 일정"><p className="hint">날짜/기간과 시간을 따로 입력하면 미리보기에서 날짜는 위, 시간은 아래로 정리됩니다. 예: 날짜 7/18(토)-19(주일), 시간 오후 3:00</p>{safe.map((r,i)=><div className="repeat" key={i}><div className="row-head"><b>일정 {i+1}</b><button disabled={safe.length<2} onClick={()=>onChange(safe.filter((_,idx)=>idx!==i))}>삭제</button></div><div className="grid2"><Field label="날짜/기간" value={r.date} onChange={v=>patch(i,'date',v)}/><Field label="시간" value={r.time||splitMonthlyDateTime(r.date).time} onChange={v=>patch(i,'time',v)}/><Field label="행사명" value={r.title} onChange={v=>patch(i,'title',v)}/><Field label="장소" value={r.place} onChange={v=>patch(i,'place',v)}/><Field label="대상" value={r.target} onChange={v=>patch(i,'target',v)}/><Area label="내용" value={r.content} onChange={v=>patch(i,'content',v)}/></div></div>)}<button className="btn secondary" onClick={()=>onChange([...safe,eventRow()])}>일정 추가</button></Box>
}
function renderEditor(type,d,setD){
  if(type==='기본 설정') return <><Box title="교회 기본 설정"><div className="grid3"><Field label="교회명" value={d.church} onChange={v=>setD({...d,church:v})}/><Select label="기본 부서/모임" value={d.defaultGroup} options={DEPARTMENTS} onChange={v=>setD({...d,defaultGroup:v})}/><Field label="담당자" value={d.manager} onChange={v=>setD({...d,manager:v})}/></div><Field label="문의 문구" value={d.contact} onChange={v=>setD({...d,contact:v})}/><Field label="하단 문구" value={d.footer} onChange={v=>setD({...d,footer:v})}/></Box></>;
  if(type==='각부 월간행사 안내') return <><Box title="기본 정보"><div className="grid3"><Select label="부서/모임" value={d.group} options={DEPARTMENTS} onChange={v=>setD({...d,group:v,title:`${v} ${d.month?.replace(/^\d{4}년\s*/,'')||'월간'} 행사 안내`})}/><Field label="제목" value={d.title} onChange={v=>setD({...d,title:v})}/><Field label="기간" value={d.month} onChange={v=>setD({...d,month:v})}/></div></Box><EventsEditor rows={d.events} onChange={v=>setD({...d,events:v})}/><DeptEditor rows={d.deptRows} onChange={v=>setD({...d,deptRows:v})}/><MonthlyLineEditor label="확인 및 협조 요청" value={d.requests} onChange={v=>setD({...d,requests:v})}/><MonthlyLineEditor label="기도 제목" value={d.prayers} onChange={v=>setD({...d,prayers:v})}/><Field label="하단 문구" value={d.footer} onChange={v=>setD({...d,footer:v})}/><Field label="문의" value={d.contact} onChange={v=>setD({...d,contact:v})}/></>;
  if(type==='주간 공지') return <><Box title="기본 정보"><div className="grid3"><Field label="제목" value={d.title} onChange={v=>setD({...d,title:v})}/><Field label="기간" value={d.period} onChange={v=>setD({...d,period:v})}/><Field label="대상" value={d.target} onChange={v=>setD({...d,target:v})}/></div></Box><EventsEditor rows={d.items} onChange={v=>setD({...d,items:v})}/><Area label={labelOf(d,1,'확인사항')} value={d.requests} onChange={v=>setD({...d,requests:v})}/><Area label={labelOf(d,2,'기도제목')} value={d.prayer} onChange={v=>setD({...d,prayer:v})}/></>;
  if(type==='부서 통합 주간보고서'){const units=weeklyUnitRows(d);function setRows(next){setD(patchWeeklyUnitRows(d,next))}function patchUnit(id,key,value){setRows(units.map(r=>r.id===id?{...r,[key]:value}:r))}function addUnit(){setRows([...units,weeklyUnitRow(nextWeeklyUnitName(units),'','','','')])}function removeUnit(id){if(units.length<2)return;setRows(units.filter(r=>r.id!==id))}return <><Box title="기본 정보"><div className="grid3"><Field label="제목" value={d.reportTitle} onChange={v=>setD({...d,reportTitle:v})}/><Field label="기간" value={d.period} onChange={v=>setD({...d,period:v})}/><Field label="작성자" value={d.writer} onChange={v=>setD({...d,writer:v})}/></div><Area label={labelOf(d,0,'전체 주간 활동 요약')} value={d.summary} onChange={v=>setD({...d,summary:v})}/></Box><Box title={labelOf(d,1,'부서별 주간 현황')}><p className="hint">부서명은 자유롭게 바꿀 수 있습니다. 입력하는 즉시 반영되며, 엔터를 누르지 않아도 됩니다.</p>{units.map(unit=><div className="dept-edit weekly-unit-edit" key={unit.id}><div className="weekly-unit-head"><WeeklyUnitNameField value={unit.name} onCommit={v=>patchUnit(unit.id,'name',v)}/>{units.length>1&&<button type="button" onClick={()=>removeUnit(unit.id)}>삭제</button>}</div><div className="grid4"><Field label="출석/참여(명)" type="number" value={childAttendanceValue(unit.attendance)} onChange={v=>patchUnit(unit.id,'attendance',v)}/><Field label="이번 주 활동" value={unit.thisWeek} onChange={v=>patchUnit(unit.id,'thisWeek',v)}/><Field label="다음 주 활동" value={unit.nextWeek} onChange={v=>patchUnit(unit.id,'nextWeek',v)}/><Field label="특이사항" value={unit.special} onChange={v=>patchUnit(unit.id,'special',v)}/></div></div>)}<button className="btn secondary" type="button" onClick={addUnit}>부서/팀 추가</button></Box><Area label={labelOf(d,2,'공동 기도제목')} value={d.commonPrayer} onChange={v=>setD({...d,commonPrayer:v})}/><Area label={labelOf(d,3,'공유/지원 요청')} value={d.support} onChange={v=>setD({...d,support:v})}/></>;}
    if(type==='부서별 주간보고서') return <><StaticBox title="기본 정보"><div className="grid4"><Field label="제목" value={d.reportTitle} onChange={v=>setD({...d,reportTitle:v})}/><Select label="부서" value={d.subDepartment} options={REPORT_DEPT_OPTIONS} onChange={v=>setD({...d,subDepartment:v,reportTitle:`${v} 주간보고서`})}/><Field label="기간" value={d.period} onChange={v=>setD({...d,period:v})}/><Field label="작성자" value={d.writer} onChange={v=>setD({...d,writer:v})}/></div><Field label="출석/참여(명)" type="number" value={childAttendanceValue(d.attendance)} onChange={v=>setD({...d,attendance:v})}/></StaticBox><Area label={labelOf(d,1,'이번 주 활동')} value={d.thisWeek} onChange={v=>setD({...d,thisWeek:v})}/><Area label={labelOf(d,2,'다음 주 계획')} value={d.nextWeek} onChange={v=>setD({...d,nextWeek:v})}/><Area label={labelOf(d,3,'특이사항 및 지원 요청')} value={d.special} onChange={v=>setD({...d,special:v})}/><Area label={labelOf(d,4,'기도제목')} value={d.prayer} onChange={v=>setD({...d,prayer:v})}/></>;
  if(type==='7개부서 보고서') return <><Box title="기본 정보"><div className="grid3"><Select label="부서" value={d.department} options={DEPARTMENTS.slice(0,7)} onChange={v=>setD({...d,department:v,reportTitle:`${v} 보고`})}/><Field label="기간" value={d.period} onChange={v=>setD({...d,period:v})}/><Field label="작성자" value={d.writer} onChange={v=>setD({...d,writer:v})}/></div><p className="hint">미리보기 제목은 선택한 부서명에 따라 자동으로 “선교부 보고”, “예배부 보고”처럼 표시됩니다.</p></Box><Area label={labelOf(d,0,'이번 주 주요 활동')} value={d.thisWeek} onChange={v=>setD({...d,thisWeek:v})}/><Area label={labelOf(d,1,'특이사항 및 요청사항')} value={d.special} onChange={v=>setD({...d,special:v})}/><Area label={labelOf(d,2,'다음 주 활동 계획')} value={d.nextWeek} onChange={v=>setD({...d,nextWeek:v})}/><Area label={labelOf(d,3,'기도제목')} value={d.prayer} onChange={v=>setD({...d,prayer:v})}/></>;
  if(type==='행사 및 수련회 기획안') return <>
    <Box title="기본 정보"><div className="grid3"><Field label="문서 제목" value={d.title} onChange={v=>setD({...d,title:v})}/><Field label="주제" value={d.theme} onChange={v=>setD({...d,theme:v})}/><Field label="일시/기간" value={d.period||d.date} onChange={v=>setD({...d,period:v,date:v})}/><Field label="장소" value={d.place} onChange={v=>setD({...d,place:v})}/><Field label="대상" value={d.target} onChange={v=>setD({...d,target:v})}/><Field label="일정 글씨 크기(%)" type="number" value={d.scheduleFontScale||'82'} onChange={v=>setD({...d,scheduleFontScale:v})}/></div></Box>
    <Box title="1페이지 내용 입력"><Area label={labelOf(d,0,'행사 목적')} value={d.purpose} onChange={v=>setD({...d,purpose:v})}/><Area label={labelOf(d,2,'담당 및 역할')} value={d.roles} onChange={v=>setD({...d,roles:v})}/><Area label={labelOf(d,3,'준비사항')} value={d.notes||d.preparation} onChange={v=>setD({...d,notes:v,preparation:v})}/></Box>
    <V21ScheduleBlock doc={d} setDoc={setD}/>
    <BudgetPairEditor title="수입·지출 예산 입력" incomeRows={d.incomeItems} expenseRows={d.expenseItems} onIncomeChange={v=>setD({...d,incomeItems:v})} onExpenseChange={v=>setD({...d,expenseItems:v})}/>
  </>;
  if(type==='세부 프로그램 문서') return <ProgramDocEditor doc={d} setDoc={setD}/>;
    if(type==='예산안') return <><Box title="기본 정보"><div className="grid4"><Field label="제목" value={d.title} onChange={v=>setD({...d,title:v})}/><Field label="사업/행사" value={d.project} onChange={v=>setD({...d,project:v})}/><Field label="기간" value={d.period} onChange={v=>setD({...d,period:v})}/><Field label="대상" value={d.target} onChange={v=>setD({...d,target:v})}/></div><Area label="산출 근거" value={d.basis} onChange={v=>setD({...d,basis:v})}/></Box><BudgetPairEditor title="수입·지출 예산 입력" incomeRows={d.incomeItems} expenseRows={d.expenseItems} onIncomeChange={v=>setD({...d,incomeItems:v})} onExpenseChange={v=>setD({...d,expenseItems:v})}/><Area label="비고 및 확인사항" value={d.notes} onChange={v=>setD({...d,notes:v})}/></>;
  if(type==='회의록') return <><Box title="회의 정보"><div className="grid4"><Field label="회의명" value={d.meetingName} onChange={v=>setD({...d,meetingName:v})}/><Field label="일시" value={d.dateTime} onChange={v=>setD({...d,dateTime:v})}/><Field label="장소" value={d.place} onChange={v=>setD({...d,place:v})}/><Field label="참석자" value={d.attendees} onChange={v=>setD({...d,attendees:v})}/><Field label="사회" value={d.presider} onChange={v=>setD({...d,presider:v})}/><Field label="기록" value={d.recorder} onChange={v=>setD({...d,recorder:v})}/></div></Box><Area label={labelOf(d,0,'회의 정보')} value={d.purpose} onChange={v=>setD({...d,purpose:v})}/><Area label={labelOf(d,1,'안건')} value={d.agenda} onChange={v=>setD({...d,agenda:v})}/><Area label={labelOf(d,2,'논의 내용')} value={d.discussion} onChange={v=>setD({...d,discussion:v})}/><Area label={labelOf(d,3,'결의 사항')} value={d.resolution} onChange={v=>setD({...d,resolution:v})}/><Field label="확인/서명" value={d.approval} onChange={v=>setD({...d,approval:v})}/></>;
  if(type==='일정표') return <SimpleScheduleEditor doc={d} setDoc={setD}/>;
  if(type==='수련회 계획안') return <><Box title="기본 정보"><div className="grid3"><Field label="제목" value={d.title} onChange={v=>setD({...d,title:v})}/><Field label="주제" value={d.theme} onChange={v=>setD({...d,theme:v})}/><Field label="기간" value={d.period} onChange={v=>setD({...d,period:v})}/><Field label="장소" value={d.place} onChange={v=>setD({...d,place:v})}/><Field label="대상" value={d.target} onChange={v=>setD({...d,target:v})}/></div></Box><Box title="내용 입력"><Area label={labelOf(d,0,'목적')} value={d.purpose} onChange={v=>setD({...d,purpose:v})}/><Area label={labelOf(d,1,'주요 프로그램')} value={d.program} onChange={v=>setD({...d,program:v})}/><Area label={labelOf(d,4,'섬김이 및 역할')} value={d.roles} onChange={v=>setD({...d,roles:v})}/><Area label={labelOf(d,5,'준비사항')} value={d.preparation} onChange={v=>setD({...d,preparation:v})}/></Box><BudgetPairEditor title="수입·지출 예산 입력" incomeRows={d.incomeItems} expenseRows={d.expenseItems} onIncomeChange={v=>setD({...d,incomeItems:v})} onExpenseChange={v=>setD({...d,expenseItems:v})}/></>;
  if(type==='세미나/교육자료') return <><Box title="기본 정보"><div className="grid3"><Field label="제목" value={d.title} onChange={v=>setD({...d,title:v})}/><Field label="부제" value={d.subtitle} onChange={v=>setD({...d,subtitle:v})}/><Field label="강사/인도자" value={d.speaker} onChange={v=>setD({...d,speaker:v})}/><Field label="일시" value={d.date} onChange={v=>setD({...d,date:v})}/><Field label="장소" value={d.place} onChange={v=>setD({...d,place:v})}/><Field label="대상" value={d.target} onChange={v=>setD({...d,target:v})}/></div></Box><Field label="주제/본문" value={d.topic} onChange={v=>setD({...d,topic:v})}/><Area label="교육 목표" value={d.goals} onChange={v=>setD({...d,goals:v})}/><Area label="진행 흐름" value={d.outline} onChange={v=>setD({...d,outline:v})}/><Area label="핵심 문장" value={d.keyText} onChange={v=>setD({...d,keyText:v})}/><Area label="나눔 질문" value={d.questions} onChange={v=>setD({...d,questions:v})}/><Area label="메모/안내" value={d.memo} onChange={v=>setD({...d,memo:v})}/></>;
  if(isCueType(type)) return <CueSheetEditor doc={d} setDoc={setD} type={type}/>;
  if(type==='부서행사 진행표(캘린더형)') return <CalendarEditor doc={d} setDoc={setD}/>;
  if(type==='준비목록') return <PrepListEditor doc={d} setDoc={setD}/>;
  if(type==='만족도 조사') return <SurveyEditor doc={d} setDoc={setD}/>;
  if(type==='신청서 양식') return <><Field label="제목" value={d.title} onChange={v=>setD({...d,title:v})}/><div className="grid3"><Field label="행사명" value={d.eventName} onChange={v=>setD({...d,eventName:v})}/><Field label="신청 대상" value={d.target} onChange={v=>setD({...d,target:v})}/><Field label="신청 기간" value={d.period} onChange={v=>setD({...d,period:v})}/><Field label="행사 일시" value={d.eventDate} onChange={v=>setD({...d,eventDate:v})}/><Field label="장소" value={d.place} onChange={v=>setD({...d,place:v})}/><Field label="문의" value={d.contact} onChange={v=>setD({...d,contact:v})}/></div><Area label="신청자 정보 항목" value={d.applicantFields||d.fields} onChange={v=>setD({...d,applicantFields:v})}/><Area label="신청 내용 항목" value={d.applicationFields} onChange={v=>setD({...d,applicationFields:v})}/><Area label="안내사항" value={d.notes} onChange={v=>setD({...d,notes:v})}/><Area label="개인정보 동의 안내" value={d.privacy} onChange={v=>setD({...d,privacy:v})}/><div className="grid3"><Field label="서명 날짜" value={d.signatureDate} onChange={v=>setD({...d,signatureDate:v})}/><Field label="서명자 표시" value={d.signatureLabel} onChange={v=>setD({...d,signatureLabel:v})}/><Field label="담당자 확인란" value={d.approval} onChange={v=>setD({...d,approval:v})}/></div></>;
  if(type==='행사 결과 보고서') return <><Box title="기본 정보"><div className="grid3"><Field label="제목" value={d.title} onChange={v=>setD({...d,title:v})}/><Field label="행사명" value={d.eventName} onChange={v=>setD({...d,eventName:v})}/><Field label="기간" value={d.period} onChange={v=>setD({...d,period:v})}/><Field label="장소" value={d.place} onChange={v=>setD({...d,place:v})}/><Field label="대상" value={d.target} onChange={v=>setD({...d,target:v})}/><Field label="참석" value={d.participants} onChange={v=>setD({...d,participants:v})}/><Field label="작성자" value={d.writer} onChange={v=>setD({...d,writer:v})}/></div></Box><Area label={labelOf(d,1,'진행 결과')} value={d.result} onChange={v=>setD({...d,result:v})}/><Area label={labelOf(d,2,'참석 및 재정 보고')} value={d.finance} onChange={v=>setD({...d,finance:v})}/><Area label={labelOf(d,3,'잘된 점과 보완점')+' - 잘된 점'} value={d.strengths} onChange={v=>setD({...d,strengths:v})}/><Area label={labelOf(d,3,'잘된 점과 보완점')+' - 보완점'} value={d.improvements} onChange={v=>setD({...d,improvements:v})}/><Area label={labelOf(d,4,'후속 조치 및 요청')+' - 후속 조치'} value={d.followup} onChange={v=>setD({...d,followup:v})}/><Area label={labelOf(d,4,'후속 조치 및 요청')+' - 요청사항'} value={d.requests} onChange={v=>setD({...d,requests:v})}/></>;
  if(type==='공문/협조 요청서') return <><Box title="문서 개요"><div className="grid3"><Field label="제목" value={d.title} onChange={v=>setD({...d,title:v})}/><Field label="문서번호" value={d.docNo} onChange={v=>setD({...d,docNo:v})}/><Field label="작성일" value={d.date} onChange={v=>setD({...d,date:v})}/><Field label="보내는 곳" value={d.sender} onChange={v=>setD({...d,sender:v})}/><Field label="받는 곳" value={d.receiver} onChange={v=>setD({...d,receiver:v})}/><Field label="제목/건명" value={d.subject} onChange={v=>setD({...d,subject:v})}/></div></Box><Area label={labelOf(d,1,'요청 배경')} value={d.background} onChange={v=>setD({...d,background:v})}/><Area label={labelOf(d,2,'협조 요청 내용')} value={d.request} onChange={v=>setD({...d,request:v})}/><Area label={labelOf(d,3,'진행 일정')} value={d.schedule} onChange={v=>setD({...d,schedule:v})}/><Area label={labelOf(d,4,'회신 및 문의')} value={d.reply} onChange={v=>setD({...d,reply:v})}/><Area label="맺음말" value={d.closing} onChange={v=>setD({...d,closing:v})}/></>;
  if(type==='심방 보고서') return <><Box title="심방 개요"><div className="grid3"><Field label="제목" value={d.title} onChange={v=>setD({...d,title:v})}/><Field label="심방일" value={d.date} onChange={v=>setD({...d,date:v})}/><Field label="심방자" value={d.visitor} onChange={v=>setD({...d,visitor:v})}/><Field label="대상" value={d.person} onChange={v=>setD({...d,person:v})}/><Field label="장소" value={d.place} onChange={v=>setD({...d,place:v})}/><Field label="구분" value={d.typeOfVisit} onChange={v=>setD({...d,typeOfVisit:v})}/></div></Box><Area label={labelOf(d,1,'심방 내용')} value={d.summary} onChange={v=>setD({...d,summary:v})}/><Area label={labelOf(d,2,'기도제목')} value={d.prayer} onChange={v=>setD({...d,prayer:v})}/><Area label={labelOf(d,3,'후속 돌봄 계획')} value={d.followup} onChange={v=>setD({...d,followup:v})}/><Area label={labelOf(d,4,'비고')} value={d.note} onChange={v=>setD({...d,note:v})}/></>;
  if(type==='기획위원회 보고서') return <><Box title="기본 정보"><div className="grid3"><Field label="제목" value={d.title} onChange={v=>setD({...d,title:v})}/><Field label="기간" value={d.period} onChange={v=>setD({...d,period:v})}/><Field label="작성자" value={d.writer} onChange={v=>setD({...d,writer:v})}/></div></Box><Area label={labelOf(d,0,'보고 요약')} value={d.summary} onChange={v=>setD({...d,summary:v})}/><Area label={labelOf(d,1,'주요 안건')} value={d.agenda} onChange={v=>setD({...d,agenda:v})}/><Area label={labelOf(d,2,'결의 및 진행사항')} value={d.decisions} onChange={v=>setD({...d,decisions:v})}/><Area label={labelOf(d,3,'요청사항')} value={d.requests} onChange={v=>setD({...d,requests:v})}/><Area label={labelOf(d,4,'기도제목')} value={d.prayer} onChange={v=>setD({...d,prayer:v})}/></>;
  return <Area label="내용" value={d.content} onChange={v=>setD({...d,content:v})}/>;
}

function Page({children,doc,className='',pageNo,orientation='portrait'}){const st={...baseExtras('').style,...(doc?.style||{})};st.preset=normalizePreset(st.preset);const fs=clampFont(st.fontScale,75,145);const titleAdj=clampFont(st.titleScale||100,80,130)/100;const bodyAdj=clampFont(st.bodyScale||100,80,130)/100;const tableAdj=clampFont(st.tableScale||100,80,130)/100;const listAdj=clampFont(st.listScale||100,80,130)/100;const vars={'--primary':st.primary,'--accent':st.accent,'--soft':st.soft,'--paper':st.paper,'--fontScale':fs,'--bodySize':`${14*fs/100*bodyAdj}px`,'--h1Size':`${31*fs/100*titleAdj}px`,'--h2Size':`${20*fs/100*titleAdj}px`,'--tableSize':`${13*fs/100*tableAdj}px`,'--smallSize':`${11*fs/100*bodyAdj}px`,'--eventTitleSize':`${18*fs/100*titleAdj}px`,'--listSize':`${13*fs/100*listAdj}px`,'--scheduleTextScale':`${fs/100*tableAdj}`,'--calendarTextScale':`${fs/100*tableAdj}`};const targetCss=fontTargetCSS(st);return <div className={'page export-page style-'+presetClass(st.preset)+' '+(st.autoFit?'font-auto-fit ':'')+(orientation==='landscape'?'landscape ':'')+className} data-orientation={orientation} data-preset={st.preset} style={vars}>{targetCss&&<style dangerouslySetInnerHTML={{__html:targetCss}}/>}{pageNo&&<div className="page-badge">{pageNo}쪽</div>}{children}</div>}
function Header({title,meta,doc,titlePath,metaPath}){return <><div className="doc-header"><div className="logo-mark">✝</div><div><h1><Edit path={titlePath} value={title}/></h1>{meta!==undefined&&meta!==null&&String(meta)!==''&&<p><Edit path={metaPath} value={meta}/></p>}</div></div><div className="header-line"/></>}
function sectionQuickKey(title,idx){
  const t=String(title||'').replace(/\s+/g,'');
  if(/진행방법|방법/.test(t))return 'method';
  if(/목적|기대효과/.test(t))return 'goal';
  if(/준비물|세팅/.test(t))return 'materials';
  if(/진행순서|순서/.test(t))return 'order';
  if(/유의사항|주의/.test(t))return 'note';
  if(/프로그램개요|개요|문서정보/.test(t))return 'basic';
  if(/일정표|시간표|상세일정|일정/.test(t))return 'p2';
  if(/수입|지출|예산/.test(t))return 'p3';
  if(/협조|기도/.test(t))return 'bottom';
  if(/월간핵심|핵심일정/.test(t))return 'events';
  if(/수입계획/.test(t))return 'income';
  if(/지출계획/.test(t))return 'expense';
  return idx===0?'basic':String(idx||'');
}
function sectionSizeClass(size){return size==='작게'?'size-small':size==='크게'?'size-large':size==='강조형'?'size-feature':''}
function labelOf(doc,idx,fallback){return String((doc?.labels?.[idx]||fallback||'')||'')}
function sectionDisplayNo(doc,idx){
  const hidden=doc?.hiddenSections||{};
  const hiddenBefore=Object.entries(hidden).filter(([k,v])=>!!v && Number(k)<idx).length;
  return Math.max(1,idx+1-hiddenBefore);
}
function Section({idx,title,titlePath,children,doc,size,displayNo,className='',block}){
  if(doc?.hiddenSections?.[idx])return null;
  const displayTitle=String((titlePath?title:labelOf(doc,idx,title))||title||'');
  const no=displayNo||sectionDisplayNo(doc,idx);
  const sectionKey=block || (idx>=10?`custom-${idx-10}`:sectionQuickKey(displayTitle,idx));
  return <section className={'doc-section preview-jump-section '+(doc.breaks?.[idx]?'force-page ':'')+sectionSizeClass(size)+' '+className} data-section-title={displayTitle} data-section-idx={idx} data-quick-key={sectionKey} data-block-id={sectionKey} data-edit-block={sectionKey}><h2><span className="section-num">{String(no).padStart(2,'0')}</span><Edit as="strong" className="section-title-text" path={titlePath||`labels.${idx}`} value={displayTitle}/></h2>{children}</section>
}
function InfoGrid({items}){return <div className="info-grid" {...fontTargetAttrs('info-grid','정보칸 전체')}>{items.map(([k,v],i)=><div className="info" key={k} {...fontTargetAttrs(`info:${i}:${k}`,`${k} 정보칸`)}><b {...fontTargetAttrs(`info-label:${i}:${k}`,`${k} 제목`)}>{k}</b><span {...fontTargetAttrs(`info-value:${i}:${k}`,`${k} 내용`)}>{showValue(v)}</span></div>)}</div>}
function PList({text,path,noBullet=false,keepBlank=false}){const directEdit=useContext(PreviewDirectEditContext);const key=path?`block:${path}`:'list:block';const raw=keepBlank?String(text??'').replace(/\r/g,'').split('\n').map(s=>s.trim()):lines(text);const arr=raw.length?raw:[''];return <ul className={'plain-list editable-block '+(noBullet?'no-bullet-list':'')} data-edit-path={path||undefined} data-edit-kind={path?'list':undefined} data-preview-direct-edit="on" {...fontTargetAttrs(key,prettyFontLabel(key))} contentEditable={!!path} suppressContentEditableWarning spellCheck={false}>{arr.map((x,i)=><li key={i} className={x?'':'empty-list-line'} {...fontTargetAttrs(`${key}:line:${i}`,`목록 ${i+1}줄`)}>{x||' '}</li>)}</ul>}
function ProgramOrderList({text,path}){const directEdit=useContext(PreviewDirectEditContext);const key=path?`block:${path}`:'program-order:block';const arr=lines(text);return <ol className="program-order-list editable-block" data-edit-path={path||undefined} data-edit-kind={path?'list':undefined} data-preview-direct-edit="on" {...fontTargetAttrs(key,prettyFontLabel(key))} contentEditable={!!path} suppressContentEditableWarning spellCheck={false}>{(arr.length?arr:['']).map((x,i)=><li key={i} {...fontTargetAttrs(`${key}:line:${i}`,`진행 순서 ${i+1}`)}>{x||' '}</li>)}</ol>}
function Table({heads,rows}){const tableKey=`table:${heads.join('|')}:${rows.length}`;return <table className="doc-table" {...fontTargetAttrs(tableKey,'표 전체')}><thead><tr>{heads.map((h,i)=><th key={h} {...fontTargetAttrs(`${tableKey}:head:${i}`,`표 제목 ${h}`)}>{h}</th>)}</tr></thead><tbody>{rows.map((r,i)=><tr key={i}>{r.map((c,j)=><td key={j} {...fontTargetAttrs(`${tableKey}:cell:${i}:${j}`,`표 ${i+1}행 ${j+1}열`)}>{showValue(c)}</td>)}</tr>)}</tbody></table>}
function MoneyTable({rows}){const safe=rows||[];return <Table heads={['항목','산출 내용','금액','비고']} rows={safe.map(r=>[blank(r.item),blank(r.detail),won(budgetAmount(r)),blank(r.note)])}/>}
function SplitText({text,path}){const directEdit=useContext(PreviewDirectEditContext);const key=path?`block:${path}`:'text:block';return <div className="text-box editable-block" data-edit-path={path||undefined} data-edit-kind={path?'paragraphs':undefined} data-preview-direct-edit="on" {...fontTargetAttrs(key,prettyFontLabel(key))} contentEditable={!!path} suppressContentEditableWarning spellCheck={false}>{lines(text).map((x,i)=><p key={i} {...fontTargetAttrs(`${key}:line:${i}`,`본문 ${i+1}줄`)}>{x}</p>)}</div>}
function customBlocks(doc,startIdx){return (doc.customSections||[]).filter(s=>s && (s.title||s.body)).map((s,i)=>({title:s.title||'추가 섹션',titlePath:`customSections.${i}.title`,body:<SplitText text={s.body} path={`customSections.${i}.body`}/>,idx:startIdx+i,customNewPage:!!s.newPage,size:s.size||'보통'}))}
function CustomSectionsPreview({doc,startIdx=10}){const blocks=customBlocks(doc,startIdx);if(!blocks.length)return null;return <>{blocks.map(b=><Section key={b.idx} idx={b.idx} title={b.title} titlePath={b.titlePath} size={b.size} doc={{...doc,breaks:{...(doc.breaks||{}),[b.idx]:b.customNewPage}}}>{b.body}</Section>)}</>}
function estimateBlockHeight(block){
  const txt=(block.title||'')+' '+String(block.body?.props?.text||'');
  const titleH=42;
  if(block.size==='강조형') return 150;
  if(block.size==='크게') return 170;
  if(block.size==='작게') return 92;
  // rough defaults by content type
  const body=block.body;
  const cls=String(body?.type?.name||body?.type||'');
  if(cls.includes('Table')) return 190;
  if(cls.includes('InfoGrid')) return 130;
  const lines=String(txt).split(/\n|<br>|\./).length + Math.ceil(String(txt).length/58);
  return Math.min(360, titleH + Math.max(70, lines*18));
}
function splitIntoPages(doc,blocks){
  const base=blocks.map((b,i)=>({...b,idx:i})).filter(b=>!doc.hiddenSections?.[b.idx]);
  const all=[...base,...customBlocks(doc,base.length)];
  const pages=[];let current=[];let used=150; // header + footer allowance
  const limit=920;
  all.forEach((b)=>{
    const shouldBreak=!!(doc.breaks?.[b.idx]||b.customNewPage);
    const h=estimateBlockHeight(b);
    if((shouldBreak || used + h > limit) && current.length){pages.push(current);current=[];used=150}
    current.push(b);used += h;
  });
  if(current.length)pages.push(current);
  return pages.length?pages:[[]];
}
function buildGenericPages(type,doc,blocks,options={}){const pages=splitIntoPages(doc,blocks);const footer=options.footer;return pages.map((p,pi)=><Page doc={doc} key={pi} className={options.className||''} orientation={options.orientation||'portrait'} pageNo={pages.length>1?pi+1:null}><Header title={titleOf(type,doc)} meta={doc.period||doc.month||doc.dateTime||''} doc={doc} titlePath={titlePathOf(type)} metaPath={metaPathOf(type)}/>{p.map(b=><Section key={b.idx} idx={b.idx} title={b.title} titlePath={b.titlePath} size={b.size} doc={doc} block={b.block||previewBlockKeyFor(type,b.title,b.idx)}>{b.body}</Section>)}{footer?footer:<Footer />}</Page>)}
function buildExtraPages(type,doc,startIdx=10,options={}){const blocks=customBlocks(doc,startIdx);if(!blocks.length)return null;const pages=[];let current=[];blocks.forEach(b=>{if(b.customNewPage&&current.length){pages.push(current);current=[]}current.push(b)});if(current.length)pages.push(current);const pageNoStart=Number(options.pageNoStart)||2;return pages.map((p,pi)=><Page doc={doc} key={'extra'+pi} className={options.className||''} orientation={options.orientation||'portrait'} pageNo={pageNoStart+pi}><Header title={titleOf(type,doc)} meta={doc.period||doc.month||doc.dateTime||''} doc={doc} titlePath={titlePathOf(type)} metaPath={metaPathOf(type)}/>{p.map(b=><Section key={b.idx} idx={b.idx} title={b.title} titlePath={b.titlePath} size={b.size} doc={{...doc,breaks:{...(doc.breaks||{}),[b.idx]:b.customNewPage}}} block={b.block||`custom-${b.idx-startIdx}`}>{b.body}</Section>)}<Footer/></Page>)}
function cleanFooterText(text){const value=String(text||'').trim();return /기도\s*부탁/.test(value)?'':value}
function Footer(){return null}

function splitMonthlyDateTime(value){
  const raw=String(value||'').replace(/\s+/g,' ').trim();
  if(!raw)return {date:'',time:''};
  const explicit=raw.split(/\n+/).map(x=>x.trim()).filter(Boolean);
  if(explicit.length>=2)return {date:explicit[0],time:explicit.slice(1).join(' ')};
  const m=raw.match(/^(.*?)(\s*(?:오전|오후|AM|PM|am|pm)\s*\d{1,2}(?::\d{2})?\s*(?:시|분)?(?:\s*[-~–]\s*(?:오전|오후|AM|PM|am|pm)?\s*\d{1,2}(?::\d{2})?\s*(?:시|분)?)?.*)$/);
  if(m&&m[1].trim()&&m[2].trim())return {date:m[1].trim(),time:m[2].trim()};
  const m2=raw.match(/^(.*?)(\s*\d{1,2}:\d{2}(?:\s*[-~–]\s*\d{1,2}:\d{2})?.*)$/);
  if(m2&&m2[1].trim()&&m2[2].trim())return {date:m2[1].trim(),time:m2[2].trim()};
  return {date:raw,time:''};
}
function formatMonthlyDatePart(value){
  const raw=String(value||'').replace(/\s+/g,' ').trim();
  if(!raw)return '';
  // 날짜 범위 표기는 7/18(토)-19(주일)처럼 입력해도 7/18(토) – 19(주일)로 통일합니다.
  return raw.replace(/\s*[-~–—]\s*/g,' – ');
}
function monthlyDateParts(dateValue,timeValue){
  const explicitTime=String(timeValue||'').trim();
  const split=splitMonthlyDateTime(dateValue);
  return {date:split.date,time:explicitTime||split.time};
}
function MonthlyDateBox({value,time='',path,timePath=''}){
  const parts=monthlyDateParts(value,time);
  const empty=!parts.date&&!parts.time;
  const dateText=formatMonthlyDatePart(parts.date);
  const dateClass=['monthly-date-stack',dateText.length>=11?'monthly-date-period':'',parts.time?'has-time':'date-only'].filter(Boolean).join(' ');
  if(empty)return <div className="monthly-date-stack monthly-date-placeholder" data-placeholder={'예: 7/18(토)-19(주일)\n오후 3:00'} {...fontTargetAttrs(`path:${path}`,prettyFontLabel(path))}></div>;
  return <div className={dateClass} {...fontTargetAttrs(`path:${path}`,prettyFontLabel(path))}>
    <span className="monthly-date-line editable-text" data-edit-path={path} data-edit-kind="text" data-preview-direct-edit="on" contentEditable={!!path} suppressContentEditableWarning spellCheck={false}>{dateText}</span>
    {parts.time&&<span className="monthly-time-line editable-text" data-edit-path={timePath||path} data-edit-kind="text" data-preview-direct-edit="on" contentEditable={!!(timePath||path)} suppressContentEditableWarning spellCheck={false}>{parts.time}</span>}
  </div>
}
function MonthlyReferenceTable({rows}){
  const safe=Array.isArray(rows)?rows:[];
  return <div className="monthly-ref-table" {...fontTargetAttrs('monthly-ref-table','부서/모임별 참고 일정 전체')}>
    <div className="monthly-ref-head monthly-ref-row"><b>구분</b><b>내용</b></div>
    {safe.slice(0,6).map((r,i)=><div className="monthly-ref-row" key={i}>
      <div className="monthly-ref-name"><Edit path={`deptRows.${i}.name`} value={r.name}/></div>
      <div className="monthly-ref-note editable-text" data-edit-path={`deptRows.${i}.note`} data-edit-kind="text" data-preview-direct-edit="on" contentEditable suppressContentEditableWarning spellCheck={false} {...fontTargetAttrs(`path:deptRows.${i}.note`,`참고 일정 ${i+1} 내용`)}>{String(r.note||'')}</div>
    </div>)}
  </div>
}

function MonthlyEventsBlock({events,startIndex=0}){
  const safe=Array.isArray(events)?events:[];
  return <div className="monthly-events compact-monthly-events monthly-flow-events" {...fontTargetAttrs('events:block','월간 핵심일정 전체')}>
    {safe.map((e,i)=>{const realIndex=startIndex+i;return <div className="month-event" key={realIndex} {...fontTargetAttrs(`events.${realIndex}:row`,`월간 핵심일정 ${realIndex+1} 전체`)}>
      <div className="num" {...fontTargetAttrs(`events.${realIndex}:num`,`월간 핵심일정 ${realIndex+1} 번호`)}><span>{String(realIndex+1).padStart(2,'0')}</span></div>
      <div className="date" {...fontTargetAttrs(`events.${realIndex}:dateBox`,`월간 핵심일정 ${realIndex+1} 날짜칸`)}><MonthlyDateBox path={`events.${realIndex}.date`} timePath={`events.${realIndex}.time`} value={e.date} time={e.time}/></div>
      <div className="evt" {...fontTargetAttrs(`events.${realIndex}:contentBox`,`월간 핵심일정 ${realIndex+1} 내용칸`)}><b {...fontTargetAttrs(`events.${realIndex}:titleLine`,`월간 핵심일정 ${realIndex+1} 제목줄`)}><Edit path={`events.${realIndex}.title`} value={e.title}/></b><div className="monthly-detail-grid" {...fontTargetAttrs(`events.${realIndex}:detailGrid`,`월간 핵심일정 ${realIndex+1} 장소·대상·내용`)}><span className="monthly-label">장소</span><span className="monthly-value"><Edit path={`events.${realIndex}.place`} value={e.place}/></span><span className="monthly-label">대상</span><span className="monthly-value"><Edit path={`events.${realIndex}.target`} value={e.target}/></span><span className="monthly-label">내용</span><span className="monthly-value monthly-content-value"><Edit path={`events.${realIndex}.content`} value={e.content}/></span></div></div>
    </div>})}
  </div>
}
function MonthlyRestSections({doc}){
  const show=(idx)=>!doc.hiddenSections?.[idx];
  return <>
    <div className="monthly-grid-sections">
      {show(1)&&<Section idx={1} title="부서/모임별 참고 일정" doc={doc} block="dept">
        <MonthlyReferenceTable rows={doc.deptRows||[]}/>
      </Section>}
      {show(2)&&<Section idx={2} title="확인 및 협조 요청" doc={doc} block="bottom">
        <PList text={doc.requests} path="requests" noBullet={true} keepBlank={true}/>
      </Section>}
    </div>
    {show(3)&&<Section idx={3} title="기도 제목" doc={doc} block="bottom">
      <PList text={doc.prayers} path="prayers" noBullet={true} keepBlank={true}/>
    </Section>}
  </>
}
function MonthlyFlowPage({doc,eventChunk,startIndex=0,showRest=false,pageNo,totalPages,density=''}){
  const hasEvents=Array.isArray(eventChunk)&&eventChunk.length>0;
  const pageClass=`monthly monthly-fixed monthly-flow-page monthly-${density||'normal'} ${hasEvents?'has-monthly-events':''} ${showRest?'has-monthly-rest':''}`;
  return <Page doc={doc} className={pageClass} pageNo={totalPages>1?pageNo:null}>
    <div className="monthly-inner">
      <Header title={titleOf('각부 월간행사 안내',doc)} meta={doc.month||''} doc={doc} titlePath="title" metaPath="month"/>
      <div className="monthly-content monthly-a4-safe">
        {hasEvents&&<Section idx={0} title={startIndex>0?'월간 핵심 일정 계속':'월간 핵심 일정'} doc={doc} block="events">
          <MonthlyEventsBlock events={eventChunk} startIndex={startIndex}/>
        </Section>}
        {showRest&&<MonthlyRestSections doc={doc}/>}      
      </div>
      <div className="monthly-bottom"><b><Edit path="footer" value={cleanFooterText(doc.footer)}/></b><small><Edit path="contact" value={doc.contact}/></small></div>
    </div>
  </Page>
}
function monthlyLineCount(text){return splitNonEmpty(text).length}
function monthlyOnePageDensity(doc){
  // v2.18: 기본 샘플은 월간 핵심일정 5개를 기준으로 A4 한 장을 꽉 채웁니다.
  // 일정 추가 직후에는 내용이 비어 있어도 카드가 실제로 생기므로,
  // 입력된 일정만 세면 자동 압축이 늦게 작동해 아래 섹션이 A4 밖으로 밀릴 수 있습니다.
  const eventCount=Array.isArray(doc.events)?doc.events.length:0;
  const filledEventCount=(doc.events||[]).filter(e=>e&&(e.date||e.time||e.title||e.place||e.target||e.content)).length;
  const deptCount=Array.isArray(doc.deptRows)?Math.min(doc.deptRows.length,6):0;
  const filledDeptCount=(doc.deptRows||[]).filter(r=>r&&(r.name||r.note)).length;
  const requestCount=monthlyLineCount(doc.requests);
  const prayerCount=monthlyLineCount(doc.prayers);
  const contactLen=String(doc.contact||'').length;
  const score=Math.max(0,eventCount-5)*2.2 + Math.max(0,filledEventCount-5)*.35 + Math.max(0,Math.max(deptCount,filledDeptCount)-4)*.7 + Math.max(0,requestCount-2)*.8 + Math.max(0,prayerCount-2)*.8 + (contactLen>45?1:0) + (contactLen>65?1:0);
  if(eventCount>=10 || score>=12) return 'onepage-micro';
  if(eventCount>=8 || score>=8.5) return 'onepage-ultra';
  if(eventCount>=7 || score>=6) return 'onepage-tight';
  if(eventCount>=6 || score>=3.5) return 'onepage-compact';
  return 'onepage-normal';
}
function monthlyChunkPages(doc){
  const eventsVisible=!doc.hiddenSections?.[0];
  const restVisible=[1,2,3].some(i=>!doc.hiddenSections?.[i]);
  const events=eventsVisible?(doc.events||[]):[];
  // v2.18: 5개 일정까지는 기본형으로 A4를 넓게 사용하고,
  // 6개 이상부터 일정 행 수 기준으로 자동 압축합니다.
  return [{eventChunk:events,startIndex:0,showRest:restVisible,density:monthlyOnePageDensity(doc)}];
}
function MonthlyPreview({doc}){
  const extra=customBlocks(doc,4);
  const hasManualBreak=[0,1,2,3].some(i=>doc.breaks?.[i]);
  if(hasManualBreak){
    return buildGenericPages('각부 월간행사 안내',doc,[
      {title:'월간 핵심 일정',body:<div className="monthly-events">{(doc.events||[]).map((e,i)=><div className="month-event" key={i}><div className="num">{String(i+1).padStart(2,'0')}</div><div className="date"><MonthlyDateBox path={`events.${i}.date`} timePath={`events.${i}.time`} value={e.date} time={e.time}/></div><div className="evt"><b><Edit path={`events.${i}.title`} value={e.title}/></b><div className="monthly-detail-grid"><span className="monthly-label">장소</span><span className="monthly-value"><Edit path={`events.${i}.place`} value={e.place}/></span><span className="monthly-label">대상</span><span className="monthly-value"><Edit path={`events.${i}.target`} value={e.target}/></span><span className="monthly-label">내용</span><span className="monthly-value monthly-content-value"><Edit path={`events.${i}.content`} value={e.content}/></span></div></div></div>)}</div>},
      {title:'부서/모임별 참고 일정',body:<Table heads={['구분','내용']} rows={(doc.deptRows||[]).map(r=>[blank(r.name),blank(r.note)])}/>},
      {title:'확인 및 협조 요청',body:<PList text={doc.requests} path="requests" noBullet={true} keepBlank={true}/>},
      {title:'기도 제목',body:<PList text={doc.prayers} path="prayers" noBullet={true} keepBlank={true}/>}
    ],{footer:<div className="monthly-bottom page-bottom-flow"><b><Edit path="footer" value={cleanFooterText(doc.footer)}/></b><small><Edit path="contact" value={doc.contact}/></small></div>});
  }
  const pages=monthlyChunkPages(doc);
  const totalPages=pages.length+(extra.length?1:0);
  return <>{pages.map((p,i)=><MonthlyFlowPage key={i} doc={doc} {...p} pageNo={i+1} totalPages={totalPages}/>) }{extra.length?buildExtraPages('각부 월간행사 안내',doc,4,{className:'monthly-extra-page',pageNoStart:pages.length+1}):null}</>;
}
function WeeklyStatusTable({doc,units}){
  const safe=Array.isArray(units)&&units.length?units:weeklyUnitRows(doc);
  return <table className="doc-table weekly-status-table weekly-status-stable"><colgroup><col style={{width:'14%'}}/><col style={{width:'10%'}}/><col style={{width:'25%'}}/><col style={{width:'25%'}}/><col style={{width:'26%'}}/></colgroup><thead><tr>{['부서','출석/참여','이번 주 활동','다음 주 계획','특이사항'].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{safe.map((unit,i)=><tr key={unit.id||i}><td className="weekly-dept-name"><span>{showValue(ev(`weeklyUnitRows.${i}.name`,unit.name))}</span></td><td className="weekly-attendance"><AttendanceNumber path={`weeklyUnitRows.${i}.attendance`} value={unit.attendance}/></td><td><div className="weekly-cell-wrap">{showValue(ev(`weeklyUnitRows.${i}.thisWeek`,unit.thisWeek))}</div></td><td><div className="weekly-cell-wrap">{showValue(ev(`weeklyUnitRows.${i}.nextWeek`,unit.nextWeek))}</div></td><td><div className="weekly-cell-wrap">{showValue(ev(`weeklyUnitRows.${i}.special`,unit.special))}</div></td></tr>)}</tbody></table>
}
function WeeklyPreview({doc,type}){if(type==='부서 통합 주간보고서'){const units=weeklyUnitRows(doc);return buildGenericPages(type,doc,[{title:'전체 주간 활동 요약',body:<SplitText text={doc.summary} path="summary"/>},{title:'부서별 주간 현황',body:<WeeklyStatusTable doc={doc} units={units}/>},{title:'공동 기도제목',body:<PList text={doc.commonPrayer} path="commonPrayer"/>},{title:'공유/지원 요청',body:<PList text={doc.support} path="support"/>}]);}
 if(type==='부서별 주간보고서') return buildGenericPages(type,doc,[{title:'예배/모임 현황',body:<InfoGrid items={[["부서",ev("subDepartment",doc.subDepartment)],["출석/참여",<AttendanceNumber path="attendance" value={doc.attendance}/>],["기간",ev("period",doc.period)],["작성자",ev("writer",doc.writer)]]}/>},{title:'이번 주 활동',body:<SplitText text={doc.thisWeek} path="thisWeek"/>},{title:'다음 주 계획',body:<SplitText text={doc.nextWeek} path="nextWeek"/>},{title:'특이사항 및 지원 요청',body:<SplitText text={doc.special} path="special"/>},{title:'기도제목',body:<PList text={doc.prayer} path="prayer"/>}]);
 return buildGenericPages(type,doc,[{title:'이번 주 주요 활동',body:<SplitText text={doc.thisWeek} path="thisWeek"/>},{title:'특이사항 및 요청사항',body:<SplitText text={doc.special} path="special"/>},{title:'다음 주 활동 계획',body:<SplitText text={doc.nextWeek} path="nextWeek"/>},{title:'기도제목',body:<PList text={doc.prayer} path="prayer"/>}]);}
function EventPlanPreview({doc}){return buildGenericPages('행사 기획안',doc,[
  {title:'행사 목적',body:<SplitText text={doc.purpose} path="purpose"/>},
  {title:'행사 개요',body:<InfoGrid items={[["주제",ev("theme",doc.theme)],["일시",ev("date",doc.date)],["장소",ev("place",doc.place)],["대상",ev("target",doc.target)]]}/>},
  {title:'진행 순서',body:<PList text={doc.program} path="program"/>},
  {title:'담당 및 역할',body:<PList text={doc.roles} path="roles"/>},
  {title:'준비사항',body:<PList text={doc.notes} path="notes"/>},
  {title:'예산 계획',customNewPage:true,body:<><h3>수입</h3><MoneyTable rows={doc.incomeItems}/><h3>지출</h3><MoneyTable rows={doc.expenseItems}/><div className="total">총지출 {won(budgetTotal(doc.expenseItems))}</div></>}
],{className:'plan-doc-page'});}
function BudgetPreview({doc}){return buildGenericPages('예산안',doc,[{title:'산출 근거',body:<><InfoGrid items={[["사업/행사",ev("project",doc.project)],["기간",ev("period",doc.period)],["대상",ev("target",doc.target)]]}/><SplitText text={doc.basis} path="basis"/></>},{title:'수입 계획',body:<><MoneyTable rows={doc.incomeItems}/><div className="total">수입 합계 {won(budgetTotal(doc.incomeItems))}</div></>},{title:'지출 계획',body:<><MoneyTable rows={doc.expenseItems}/><div className="total">지출 합계 {won(budgetTotal(doc.expenseItems))}</div></>},{title:'비고 및 확인사항',body:<SplitText text={doc.notes} path="notes"/>}]);}
function MeetingPreview({doc}){return buildGenericPages('회의록',doc,[{title:'회의 정보',body:<InfoGrid items={[["일시",ev("dateTime",doc.dateTime)],["장소",ev("place",doc.place)],["참석",ev("attendees",doc.attendees)],["사회",ev("presider",doc.presider)],["기록",ev("recorder",doc.recorder)]]}/>},{title:'안건',body:<PList text={doc.agenda} path="agenda"/>},{title:'논의 내용',body:<SplitText text={doc.discussion} path="discussion"/>},{title:'결의 사항',body:<SplitText text={doc.resolution} path="resolution"/>},{title:'확인 및 서명',body:<div className="signbox">확인: <Edit path="approval" value={doc.approval}/> &nbsp;&nbsp;&nbsp; 서명: __________________</div>}]);}
function BasicNoticePreview({doc}){return buildGenericPages('기본 공지 안내문',doc,[{title:'공지 개요',body:<InfoGrid items={[["대상",ev("target",doc.target)],["일시",ev("date",doc.date)],["장소",ev("place",doc.place)],["문의",ev("contact",doc.contact)]]}/>},{title:'안내 내용',body:<SplitText text={doc.content} path="content"/>},{title:'확인 및 협조',body:<PList text={doc.requests} path="requests"/>},{title:'문의',body:<><SplitText text={doc.footer} path="footer"/><div className="signbox"><Edit path="contact" value={doc.contact}/></div></>}],{className:'notice-onepage-page'});}
function MeetingMaterialPreview({doc}){return buildGenericPages('회의자료',doc,[{title:'회의 개요',body:<><InfoGrid items={[["회의 유형",ev("meetingType",doc.meetingType)],["일시",ev("date",doc.date)],["장소",ev("place",doc.place)],["참석 대상",ev("attendees",doc.attendees)],["작성자",ev("writer",doc.writer)]]}/><SplitText text={doc.purpose} path="purpose"/></>},{title:'지난 결정사항 점검',body:<Table heads={["결정사항","담당","진행상태","추가 확인"]} rows={(doc.decisions||[]).map(r=>[r.decision,r.owner,r.status,r.memo])}/>},{title:'부서별 보고',body:<Table heads={["부서","보고 내용","요청사항","기도제목"]} rows={(doc.deptReports||[]).map(r=>[r.dept,r.report,r.request,r.prayer])}/>},{title:'주요 안건',body:<Table heads={["안건","논의 내용","결정 필요","참고"]} rows={(doc.agendaItems||[]).map(r=>[r.agenda,r.detail,r.decisionNeeded,r.memo])}/>},{title:'일정 확인',customNewPage:true,body:<Table heads={["날짜","행사명","담당 부서","준비사항"]} rows={(doc.meetingSchedules||[]).map(r=>[r.date,r.event,r.dept,r.prep])}/>},{title:'예산/지원 요청',body:<Table heads={["요청 부서","내용","예상 금액","결정 여부"]} rows={(doc.supportRequests||[]).map(r=>[r.dept,r.content,r.amount,r.decision])}/>},{title:'결정사항 및 역할분담',body:<Table heads={["결정 내용","담당자","기한","확인"]} rows={(doc.actionItems||[]).map(r=>[r.action,r.owner,r.due,r.checked])}/>},{title:'기도제목',body:<PList text={doc.prayer} path="prayer"/>}],{className:'meeting-material-page compact-report'});}
function AnnualReportPreview({doc}){
  const pages=[
    {sections:[
      {idx:0,title:'부서 개요',block:'basic',body:<><InfoGrid items={[["부서",ev("department",doc.department)],["연도",ev("year",doc.year)],["담당 교역자",ev("pastor",doc.pastor)],["부장",ev("leader",doc.leader)],["작성자",ev("writer",doc.writer)]]}/><SplitText text={doc.summary} path="summary"/></>},
      {idx:1,title:'한 해 주요 사역',block:'ministries',body:<Table heads={["월","주요 사역","참여 인원","비고"]} rows={(doc.ministries||[]).map(r=>[r.month,r.ministry,r.participants,r.note])}/>}
    ]},
    {sections:[
      {idx:2,title:'출석/참여 현황',block:'attendance',body:<><InfoGrid items={[["평균 출석",ev("avgAttendance",doc.avgAttendance)],["최대 출석",ev("maxAttendance",doc.maxAttendance)],["새친구",ev("newFriends",doc.newFriends)]]}/><SplitText text={doc.attendanceNote} path="attendanceNote"/></>},
      {idx:3,title:'예산 집행 요약',block:'budget',body:<Table heads={["구분","예산","집행","잔액","비고"]} rows={(doc.budgetRows||[]).map(r=>[r.category,r.budget,r.spent,r.balance,r.note])}/>}
    ]},
    {sections:[
      {idx:4,title:'평가',block:'review',body:<div className="annual-review-grid"><div><h3>감사 제목</h3><PList text={doc.thanks} path="thanks"/><h3>잘된 점</h3><PList text={doc.strengths} path="strengths"/></div><div><h3>어려웠던 점</h3><PList text={doc.difficulties} path="difficulties"/><h3>개선할 점</h3><PList text={doc.improvements} path="improvements"/></div></div>}
    ]},
    {sections:[
      {idx:5,title:'다음 해 계획',block:'next',body:<><SplitText text={doc.nextPlan} path="nextPlan"/><div className="annual-next-grid"><div><h3>필요한 지원</h3><PList text={doc.support} path="support"/></div><div><h3>기도제목</h3><PList text={doc.prayer} path="prayer"/></div></div></>}
    ]}
  ];
  const visiblePages=pages.map(pg=>({...pg,sections:pg.sections.filter(sec=>!doc.hiddenSections?.[sec.idx])})).filter(pg=>pg.sections.length);
  const pageTotal=visiblePages.length;
  return <>{visiblePages.map((pg,pi)=><Page doc={doc} key={pi} className="annual-report-page annual-fixed-page compact-report" pageNo={pageTotal>1?pi+1:null}><Header title={titleOf('연말/연차 부서 보고서',doc)} meta={doc.year||''} doc={doc} titlePath="title" metaPath="year"/>{pg.sections.map(sec=><Section key={sec.idx} idx={sec.idx} title={sec.title} doc={doc} block={sec.block}>{sec.body}</Section>)}<Footer/></Page>)}{buildExtraPages('연말/연차 부서 보고서',doc,6,{className:'annual-report-page annual-fixed-page annual-extra-page',pageNoStart:pageTotal+1})}</>
}

function ApplicationFormPreview({doc}){
  const applicant=lines(doc.applicantFields||doc.fields||`성명\n연락처\n소속/부서\n비상 연락처`);
  const details=lines(doc.applicationFields||`참석 일정\n식사 여부\n요청사항`);
  return <Page doc={doc} className="application-form-page standard-application-form"><Header title={titleOf('신청서 양식',doc)} meta={doc.period||''} doc={doc} titlePath="title" metaPath="period"/>
    <Section idx={0} title="신청 안내" doc={doc} block="basic"><InfoGrid items={[["행사명",ev("eventName",doc.eventName)],["신청 대상",ev("target",doc.target)],["신청 기간",ev("period",doc.period)],["행사 일시",ev("eventDate",doc.eventDate)],["장소",ev("place",doc.place)],["문의",ev("contact",doc.contact)]]}/></Section>
    <Section idx={1} title="신청자 정보" doc={doc} block="applicant"><Table heads={["항목","기입란"]} rows={applicant.map(x=>[x,''])}/></Section>
    <Section idx={2} title="신청 내용" doc={doc} block="details"><Table heads={["항목","기입란"]} rows={details.map(x=>[x,''])}/></Section>
    <Section idx={3} title="안내사항" doc={doc} block="details"><PList text={doc.notes} path="notes"/></Section>
    <Section idx={4} title="개인정보 동의 및 서명" doc={doc} block="consent"><div className="application-consent-box"><PList text={doc.privacy} path="privacy"/><div className="application-check-line">□ 위 개인정보 수집 및 이용에 동의합니다.</div><div className="application-sign-row"><span><Edit path="signatureDate" value={doc.signatureDate}/></span><span><Edit path="signatureLabel" value={doc.signatureLabel}/> : ____________________</span><span><Edit path="approval" value={doc.approval}/></span></div></div></Section>
    <Footer/></Page>
}

function SpendingResolutionPreview({doc}){const total=(doc.items||[]).reduce((s,r)=>s+num(r.qty||1)*num(r.price),0);return buildGenericPages('지출결의서',doc,[{title:'기본 정보',body:<InfoGrid items={[["부서",ev("department",doc.department)],["신청자",ev("applicant",doc.applicant)],["작성일",ev("writeDate",doc.writeDate)],["사용일",ev("useDate",doc.useDate)],["지급 방법",ev("paymentMethod",doc.paymentMethod)]]}/>},{title:'지출 목적',body:<SplitText text={doc.purpose} path="purpose"/>},{title:'지출 내역',body:<><Table heads={["항목","내용","수량","단가/금액","합계","비고"]} rows={(doc.items||[]).map(r=>[r.item,r.detail,r.qty,Number(num(r.price)).toLocaleString('ko-KR'),won(num(r.qty||1)*num(r.price)),r.note])}/><div className="total">지출 합계 {won(total)}</div></>},{title:'증빙 및 결재',body:<><InfoGrid items={[["증빙",ev("receipt",doc.receipt)],["비고",ev("memo",doc.memo)]]}/><div className="signbox"><Edit path="approval" value={doc.approval}/></div></>}],{className:'spending-resolution-page'});}
function UseRequestPreview({doc}){return buildGenericPages('차량/장소 사용 신청서',doc,[{title:'신청 정보',body:<InfoGrid items={[["신청 유형",ev("requestType",doc.requestType)],["부서",ev("department",doc.department)],["신청자",ev("applicant",doc.applicant)],["연락처",ev("contact",doc.contact)]]}/>},{title:'사용 목적',body:<SplitText text={doc.purpose} path="purpose"/>},{title:'사용 정보',body:<InfoGrid items={[["사용 일시",ev("date",doc.date)],["차량/장소",ev("placeOrVehicle",doc.placeOrVehicle)],["사용 인원",ev("people",doc.people)],["운전자",ev("driver",doc.driver)],["이동 구간",ev("route",doc.route)]]}/>},{title:'확인 사항',body:<Table heads={["확인 항목","상태","메모"]} rows={(doc.checks||[]).map(r=>[r.item,r.checked,r.memo])}/>},{title:'승인',body:<><SplitText text={doc.note} path="note"/><div className="signbox"><Edit path="approval" value={doc.approval}/></div></>}],{className:'use-request-page'});}

function ProgramDocPreview({doc}){
  const rows=Array.isArray(doc.programs)&&doc.programs.length?doc.programs:[];
  if(!rows.length)return <>
    <Page doc={doc} className="program-doc-page program-doc-clean"><Header title={titleOf('세부 프로그램 문서',doc)} meta={doc.period||''} doc={doc} titlePath="title" metaPath="period"/><Section idx={0} title="프로그램 개요" doc={doc}><SplitText text="프로그램을 추가해 주세요."/></Section><Footer/></Page>
    {buildExtraPages('세부 프로그램 문서',doc,6,{className:'program-extra-page',pageNoStart:2})}
  </>;
  const totalPages=rows.length*2;
  return <>
    {rows.flatMap((p,i)=>{
      const baseNo=i*2+1;
      const titleLabel=`프로그램 ${String(i+1).padStart(2,'0')} · ${p.name||'세부 프로그램'}`;
      const meta=[doc.eventName,doc.period].filter(Boolean).join(' · ');
      const pageDoc={...doc,labels:{...(doc.labels||{}),0:titleLabel}};
      return [
        <Page doc={doc} key={`program-${i}-1`} className="program-doc-page program-doc-clean program-doc-page-a" pageNo={totalPages>1?baseNo:null}><Header title={titleOf('세부 프로그램 문서',doc)} meta={meta} doc={doc} titlePath="title"/><Section idx={0} title={titleLabel} doc={pageDoc} block="basic"><InfoGrid items={[["프로그램",ev(`programs.${i}.name`,p.name)],["소요시간",ev(`programs.${i}.time`,p.time)],["대상",ev(`programs.${i}.target`,p.target)],["담당자",ev(`programs.${i}.leader`,p.leader)],...(p.place?[["장소",ev(`programs.${i}.place`,p.place)]]:[])]}/></Section><Section idx={1} title="목적/기대효과" doc={doc} block="goal"><SplitText text={p.goal} path={`programs.${i}.goal`}/></Section><Section idx={2} title="진행 방법" doc={doc} block="method"><SplitText text={p.method} path={`programs.${i}.method`}/></Section><Footer/></Page>,
        <Page doc={doc} key={`program-${i}-2`} className="program-doc-page program-doc-clean program-doc-page-b" pageNo={totalPages>1?baseNo+1:null}><Header title={titleOf('세부 프로그램 문서',doc)} meta={meta} doc={doc} titlePath="title"/><Section idx={3} title="준비물 및 세팅" doc={doc} block="materials"><div className="program-two"><div><b>준비물</b><PList text={p.materials} path={`programs.${i}.materials`}/></div><div><b>세팅/공간 구성</b><PList text={p.setup} path={`programs.${i}.setup`}/></div></div></Section><Section idx={4} title="진행 순서" doc={doc} block="order"><ProgramOrderList text={p.order} path={`programs.${i}.order`}/></Section><Section idx={5} title="유의사항" doc={doc} block="note"><SplitText text={p.note} path={`programs.${i}.note`}/></Section><Footer/></Page>
      ];
    })}
    {buildExtraPages('세부 프로그램 문서',doc,6,{className:'program-extra-page',pageNoStart:totalPages+1})}
  </>
}

function minToTimeLabel(min){const h=Math.floor(min/60);const m=String(min%60).padStart(2,'0');return `${String(h).padStart(2,'0')}:${m}`}
function scheduleAutoFitScale(doc){
  const rows=Array.isArray(doc?.scheduleItems)?doc.scheduleItems.length:0;
  const days=Array.isArray(doc?.days)&&doc.days.length?doc.days.length:1;
  const start=(Number(doc?.startHour)||8);
  const end=(Number(doc?.endHour)||23);
  const span=Math.max(8,end-start);
  const base=Number(doc?.scheduleFontScale)||105;
  const penalty=Math.max(0,rows-8)*3 + Math.max(0,days-3)*7 + Math.max(0,span-14)*1.5;
  return Math.max(58,Math.min(base,105-penalty));
}
function scheduleAutoRowHeight(intervalCount,dayCount){
  const maxHeight=dayCount>=4?700:730;
  const raw=Math.floor(maxHeight/Math.max(1,intervalCount+1));
  return Math.max(7,Math.min(28,raw));
}
function displayTimeLabel(min){const h=Math.floor(min/60);const m=min%60;return m?`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`:`${String(h).padStart(2,'0')}:00`}
function SimpleTimetable({doc}){
  const days=(Array.isArray(doc.days)&&doc.days.length?doc.days:['1일차']).filter(Boolean);
  const slot=Math.max(15,Math.min(120,Number(doc.slotMinutes)||60));
  const rangeStart=(Number(doc.startHour)||8)*60;
  const rangeEnd=(Number(doc.endHour)||23)*60;
  const startMin=Math.min(rangeStart,rangeEnd-slot);
  const endMin=Math.max(rangeStart+slot,rangeEnd);
  const rawRows=Array.isArray(doc.scheduleItems)?doc.scheduleItems:[];
  const rows=rawRows.map((r,i)=>{
    const s=timeToMin(r.start||'09:00');
    let e=timeToMin(r.end||addMinutes(r.start||'09:00',slot));
    if(e<=s)e=s+slot;
    const sourceIndex=Number.isInteger(r._sourceIndex)?r._sourceIndex:i;
    return {...r,_index:sourceIndex,_start:Math.max(startMin,Math.min(endMin,s)),_end:Math.max(startMin+slot,Math.min(endMin,e))};
  }).filter(r=>r._end>startMin&&r._start<endMin);
  const timeSet=new Set([startMin,endMin]);
  for(let t=startMin;t<=endMin;t+=slot)timeSet.add(t);
  rows.forEach(r=>{timeSet.add(r._start);timeSet.add(r._end)});
  const times=Array.from(timeSet).filter(t=>t>=startMin&&t<=endMin).sort((a,b)=>a-b);
  const intervals=times.slice(0,-1).map((t,i)=>({start:t,end:times[i+1]})).filter(x=>x.end>x.start);
  const starting=new Map();
  rows.forEach(r=>{const key=`${r.day||days[0]}|${r._start}`;if(!starting.has(key))starting.set(key,[]);starting.get(key).push(r)});
  const covered={};
  const autoScale=scheduleAutoFitScale({...doc, scheduleFontScale:doc.scheduleFontScale||100});
  const scheduleScale=clampFont(autoScale,58,140)/100;
  const rowH=scheduleAutoRowHeight(intervals.length,days.length);
  const compact=intervals.length>14||days.length>3||rows.length>10;
  const tableStyle={'--scheduleTextScale':scheduleScale,'--scheduleRowH':`${rowH}px`};
  return <table className={`simple-timetable ${compact?'compact-timetable':''}`} style={tableStyle}><thead><tr><th>시간</th>{days.map(day=><th key={day}>{day}</th>)}</tr></thead><tbody>{intervals.map((interval,rowIdx)=><tr key={interval.start}><th>{displayTimeLabel(interval.start)}</th>{days.map(day=>{
    const coverKey=`${day}|${rowIdx}`;
    if(covered[coverKey])return null;
    const evs=starting.get(`${day}|${interval.start}`)||[];
    if(!evs.length)return <td key={day}></td>;
    const maxEnd=Math.max(...evs.map(e=>e._end));
    const span=Math.max(1,intervals.filter(x=>x.start>=interval.start&&x.end<=maxEnd).length);
    for(let j=rowIdx+1;j<rowIdx+span;j++)covered[`${day}|${j}`]=true;
    return <td key={day} rowSpan={span} className="simple-schedule-event">{evs.map(e=><div key={e._index} className="simple-schedule-event-item"><b>{e.icon?`${e.icon} `:''}<Edit path={`scheduleItems.${e._index}.title`} value={e.title||'일정'}/></b>{(e.place||e.memo)&&<small>{[e.place,e.memo].filter(Boolean).join(' · ')}</small>}</div>)}</td>;
  })}</tr>)}</tbody></table>
}

function ScheduleGrid({doc}){return <div className="schedule-simple-wrap schedule-tight-grid"><SimpleTimetable doc={doc}/></div>}
function SchedulePreview({doc}){const show=(idx)=>!doc.hiddenSections?.[idx];return <><Page doc={doc} className="schedule-page schedule-page-tight schedule-onepage-safe"><Header title={doc.title} meta={[doc.period,doc.place].filter(Boolean).join(' · ')} doc={doc} titlePath="title"/>{show(0)&&<Section idx={0} title="일정 기본 정보" doc={doc} className="schedule-info-section"><InfoGrid items={[["기간",ev("period",doc.period)], ...(doc.place?[["장소",ev("place",doc.place)]]:[]), ["담당",ev("manager",doc.manager)]]}/></Section>}{show(1)&&<Section idx={1} title="시간표" doc={doc} className="schedule-table-section"><ScheduleGrid doc={{...doc,scheduleFontScale:doc.scheduleFontScale||'100',timetableHeight:doc.timetableHeight||'560',maxRowHeight:doc.maxRowHeight||'44'}}/></Section>}{show(2)&&<Section idx={2} title="안내사항" doc={doc} className="schedule-notice-section"><SplitText text={doc.notice} path="notice"/></Section>}</Page>{buildExtraPages('일정표',doc,3,{className:'schedule-extra-page',pageNoStart:2})}</>}

function CueSheetTable({rows=[],baseIndex=0}){const heads=['시간','구분','진행 내용','담당자','방송/음향','준비물','비고'];const widths=['8%','9%','29%','10%','14%','14%','16%'];return <table className="doc-table cue-sheet-table"><colgroup>{widths.map((w,i)=><col key={i} style={{width:w}} />)}</colgroup><thead><tr>{heads.map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{(rows.length?rows:[cueRow()]).map((r,i)=>{const idx=baseIndex+i;return <tr key={i}><td>{showValue(ev(`rows.${idx}.time`,r.time))}</td><td>{showValue(ev(`rows.${idx}.part`,r.part))}</td><td className="cue-content-cell">{showValue(ev(`rows.${idx}.content`,r.content))}</td><td>{showValue(ev(`rows.${idx}.person`,r.person))}</td><td>{showValue(ev(`rows.${idx}.tech`,r.tech))}</td><td>{showValue(ev(`rows.${idx}.ready`,r.ready))}</td><td>{showValue(ev(`rows.${idx}.note`,r.note))}</td></tr>})}</tbody></table>}
function CueSheetPreview({doc,type}){const rows=doc.rows||[];const perPage=8;const chunks=[];for(let i=0;i<Math.max(1,rows.length);i+=perPage)chunks.push(rows.slice(i,i+perPage));const totalPages=chunks.length+1;const cueDoc=withBase(CUE_DOC,doc);return <>
  {chunks.map((chunk,pi)=><Page doc={cueDoc} key={pi} className="cue-doc-page cue-landscape-safe" orientation="landscape" pageNo={totalPages>1?pi+1:null}><Header title={titleOf(CUE_DOC,cueDoc)} meta={`${cueDoc.date||''} · ${cueDoc.place||''}`} doc={cueDoc} titlePath="title" metaPath="date"/>{pi===0&&<Section idx={0} title="예배/행사 개요" doc={cueDoc}><InfoGrid items={[["일시",ev("date",cueDoc.date)],["장소",ev("place",cueDoc.place)],["대상",ev("target",cueDoc.target)],["진행/총괄",ev("director",cueDoc.director)],["주제",ev("theme",cueDoc.theme)]]}/></Section>}<Section idx={1} title="진행 큐시트" doc={cueDoc}><CueSheetTable rows={chunk} baseIndex={pi*perPage}/></Section></Page>)}
  <Page doc={cueDoc} className="cue-doc-page cue-landscape-safe" orientation="landscape" pageNo={totalPages>1?totalPages:null}><Header title={titleOf(CUE_DOC,cueDoc)} meta={`${cueDoc.date||''} · ${cueDoc.place||''}`} doc={cueDoc} titlePath="title" metaPath="date"/><div className="two-col"><Section idx={2} title="진행/방송 체크" doc={cueDoc}><PList text={cueDoc.checks} path="checks"/></Section><Section idx={3} title="진행 유의사항" doc={cueDoc}><SplitText text={cueDoc.notice} path="notice"/></Section></div><Footer/></Page>
  {buildExtraPages(CUE_DOC,cueDoc,4,{className:'cue-doc-page cue-landscape-safe',orientation:'landscape',pageNoStart:totalPages+1})}
</>}

function monthLabel(ym){const [y,m]=parseMonth(ym).split('-');return `${y}년 ${Number(m||1)}월`}
function CalendarGrid({doc}){const ym=parseMonth(doc.month||'2026-06');const [yy,mm]=ym.split('-').map(Number);const year=yy||2026,month=(mm||6)-1;const first=new Date(year,month,1);const last=new Date(year,month+1,0).getDate();const start=first.getDay();const cells=[];for(let i=0;i<start;i++)cells.push(null);for(let d=1;d<=last;d++)cells.push(d);while(cells.length%7)cells.push(null);const events=normalizeCalRows(doc.calendarItems||[],ym);const scale=Math.max(70,Math.min(150,Number(doc.calendarFontScale)||110))/100;return <div className="month-calendar perpetual-calendar calendar-size-control" style={{'--calendarTextScale':scale}}><div className="cal-week cal-head">{['일','월','화','수','목','금','토'].map(x=><b key={x}>{x}</b>)}</div><div className="cal-body">{cells.map((day,i)=>{const dayEvents=day?events.filter(e=>calendarDay(e)===day):[];return <div className={'cal-cell '+(!day?'muted':'')} key={i}>{day&&<><span className="cal-date">{day}</span>{dayEvents.map((e,idx)=><div className="cal-item" key={idx}>{e.icon&&<span className="cal-emoji">{e.icon}</span>}<b><Edit path={`calendarItems.${events.indexOf(e)}.title`} value={e.title}/></b>{e.memo&&<small><Edit path={`calendarItems.${events.indexOf(e)}.memo`} value={e.memo}/></small>}</div>)}</>}</div>})}</div></div>}
function CalendarPreview({doc}){return <><Page doc={doc} className="calendar-page"><Header title={doc.title} meta={`${monthLabel(doc.month)} · ${doc.department||''}`} doc={doc} titlePath="title" metaPath="month"/><Section idx={0} title="월간 달력" doc={doc}><CalendarGrid doc={doc}/></Section><Section idx={1} title="안내사항" doc={doc}><SplitText text={doc.notice} path="notice"/></Section></Page>{buildExtraPages('부서행사 진행표(캘린더형)',doc,2,{className:'calendar-extra-page',pageNoStart:2})}</>}
function PrepGrouped({items}){const rows=items||[];return <div className="prep-groups">{PREP_CATEGORIES.map(cat=>{const group=rows.filter(r=>(r.category||'물품')===cat);if(!group.length)return null;return <div className="prep-group" key={cat}><h3>{cat}</h3><Table heads={['준비 항목','담당','기한','상태','비고']} rows={group.map(r=>{const i=rows.indexOf(r);return [ev(`items.${i}.item`,r.item),ev(`items.${i}.owner`,r.owner),ev(`items.${i}.due`,r.due),ev(`items.${i}.status`,r.status),ev(`items.${i}.note`,r.note)]})}/></div>})}</div>}
function PrepChecklistTable({items=[],baseIndex=0}){const rows=items.length?items:[prepRow('준비 항목을 입력해 주세요','','','','')];const heads=['분류','준비 항목','담당','기한','상태','비고'];const widths=['10%','31%','12%','10%','12%','25%'];return <table className="doc-table prep-check-table"><colgroup>{widths.map((w,i)=><col key={i} style={{width:w}}/>)}</colgroup><thead><tr>{heads.map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{rows.map((r,i)=>{const idx=baseIndex+i;return <tr key={i}><td>{showValue(ev(`items.${idx}.category`,r.category||'물품'))}</td><td className="prep-item-cell">{showValue(ev(`items.${idx}.item`,r.item))}</td><td>{showValue(ev(`items.${idx}.owner`,r.owner))}</td><td>{showValue(ev(`items.${idx}.due`,r.due))}</td><td className="prep-status-cell">{showValue(ev(`items.${idx}.status`,r.status))}</td><td>{showValue(ev(`items.${idx}.note`,r.note))}</td></tr>})}</tbody></table>}
function PrepListPreview({doc}){const rows=(doc.items&&doc.items.length?doc.items:[prepRow('준비 항목을 입력해 주세요','','','','')]);const chunks=[];const firstPageCount=12;const otherPageCount=16;let offset=0;chunks.push(rows.slice(0,firstPageCount));offset=firstPageCount;while(offset<rows.length){chunks.push(rows.slice(offset,offset+otherPageCount));offset+=otherPageCount;}return <>
  {chunks.map((chunk,pi)=>{const baseIndex=pi===0?0:firstPageCount+(pi-1)*otherPageCount;const isLast=pi===chunks.length-1;return <Page doc={doc} key={pi} className="prep-doc-page prep-a4-safe" pageNo={chunks.length>1?pi+1:null}><Header title={titleOf('준비목록',doc)} meta={doc.period||''} doc={doc} titlePath="title" metaPath="period"/>{pi===0&&<Section idx={0} title="준비 개요" doc={doc} className="prep-overview-section"><InfoGrid items={[["행사/자료명",ev("eventName",doc.eventName)],["기간",ev("period",doc.period)],["담당",ev("manager",doc.manager)]]}/></Section>}<Section idx={1} title={pi===0?'준비 체크리스트':'준비 체크리스트 계속'} doc={doc} className="prep-table-section"><PrepChecklistTable items={chunk} baseIndex={baseIndex}/></Section>{isLast&&<Section idx={2} title="비고" doc={doc} className="prep-note-section"><SplitText text={doc.notes} path="notes"/></Section>}<Footer/></Page>})}
  {buildExtraPages('준비목록',doc,3,{className:'prep-extra-page',pageNoStart:chunks.length+1})}
</>}


function ResultReportPreview({doc}){return buildGenericPages('행사 결과 보고서',doc,[{title:'행사 개요',body:<><InfoGrid items={[["행사명",ev("eventName",doc.eventName)],["기간",ev("period",doc.period)],["장소",ev("place",doc.place)],["대상",ev("target",doc.target)],["참석",ev("participants",doc.participants)],["작성자",ev("writer",doc.writer)]]}/><SplitText text={doc.summary} path="summary"/></>},{title:'진행 결과',body:<SplitText text={doc.result} path="result"/>},{title:'참석 및 재정 보고',body:<SplitText text={doc.finance} path="finance"/>},{title:'잘된 점과 보완점',body:<div className="two-col"><div><h3>잘된 점</h3><PList text={doc.strengths} path="strengths"/></div><div><h3>보완점</h3><PList text={doc.improvements} path="improvements"/></div></div>},{title:'후속 조치 및 요청',customNewPage:true,body:<><h3>후속 조치</h3><PList text={doc.followup} path="followup"/><h3>요청사항</h3><PList text={doc.requests} path="requests"/></>}],{className:'result-report-page compact-report'});}
function CooperationDocPreview({doc}){return buildGenericPages('공문/협조 요청서',doc,[{title:'문서 개요',body:<InfoGrid items={[["문서번호",ev("docNo",doc.docNo)],["작성일",ev("date",doc.date)],["보내는 곳",ev("sender",doc.sender)],["받는 곳",ev("receiver",doc.receiver)],["건명",ev("subject",doc.subject)]]}/>},{title:'요청 배경',body:<SplitText text={doc.background} path="background"/>},{title:'협조 요청 내용',body:<PList text={doc.request} path="request"/>},{title:'진행 일정',body:<PList text={doc.schedule} path="schedule"/>},{title:'회신 및 문의',body:<><PList text={doc.reply} path="reply"/><div className="signbox"><Edit path="closing" value={doc.closing}/></div></>}]);}
function VisitReportPreview({doc}){return buildGenericPages('심방 보고서',doc,[{title:'심방 개요',body:<InfoGrid items={[["심방일",ev("date",doc.date)],["심방자",ev("visitor",doc.visitor)],["대상",ev("person",doc.person)],["장소",ev("place",doc.place)],["구분",ev("typeOfVisit",doc.typeOfVisit)]]}/>},{title:'심방 내용',body:<SplitText text={doc.summary} path="summary"/>},{title:'기도제목',body:<PList text={doc.prayer} path="prayer"/>},{title:'후속 돌봄 계획',body:<PList text={doc.followup} path="followup"/>},{title:'비고',body:<SplitText text={doc.note} path="note"/>}]);}


function scheduleDayChunks(days=[],mode='한 페이지 맞춤'){
  const safe=(Array.isArray(days)&&days.length?days:['1일차']).filter(Boolean);
  if(mode!=='일차별 여유형')return [safe];
  const chunks=[];
  for(let i=0;i<safe.length;i+=2)chunks.push(safe.slice(i,i+2));
  return chunks.length?chunks:[safe];
}
function scheduleDocForDays(planDoc,dayChunk){
  const allRows=Array.isArray(planDoc.scheduleItems)?planDoc.scheduleItems:[];
  const set=new Set(dayChunk);
  const filtered=allRows.map((r,i)=>({...r,_sourceIndex:i})).filter(r=>set.has(r.day||dayChunk[0]));
  return {...planDoc,days:dayChunk,scheduleItems:filtered,slotMinutes:planDoc.slotMinutes||'60',startHour:planDoc.startHour||'8',endHour:planDoc.endHour||'23',scheduleFontScale:planDoc.scheduleFontScale||'105',timetableHeight:720,maxRowHeight:44};
}
function EventRetreatPlanPreview({doc}){
  const planDoc=withBase('행사 및 수련회 기획안',doc);
  const days=(Array.isArray(planDoc.days)&&planDoc.days.length?planDoc.days:['1일차']).filter(Boolean);
  const scheduleMode=planDoc.schedulePageMode||'한 페이지 맞춤';
  const scheduleChunks=scheduleDayChunks(days,scheduleMode);
  const meta=planDoc.period||planDoc.date||'';
  const scheduleTotal=scheduleChunks.length;
  const budgetPageNo=2+scheduleTotal;
  return <>
    <Page doc={planDoc} className="event-retreat-page event-retreat-cover" pageNo={1}>
      <Header title={titleOf('행사 및 수련회 기획안',planDoc)} meta={meta} doc={planDoc} titlePath="title" metaPath="period"/>
      <Section idx={0} title="행사 목적" doc={planDoc} block="p1"><SplitText text={planDoc.purpose} path="purpose"/></Section>
      <Section idx={1} title="행사 개요" doc={planDoc} block="p1"><InfoGrid items={[["주제",ev("theme",planDoc.theme)],["기간",ev("period",planDoc.period||planDoc.date)],...(planDoc.place?[["장소",ev("place",planDoc.place)]]:[]),["대상",ev("target",planDoc.target)]]}/></Section>
      <Section idx={2} title="담당 및 역할" doc={planDoc} block="p1"><PList text={planDoc.roles} path="roles"/></Section>
      <Section idx={3} title="준비사항" doc={planDoc} block="p1"><PList text={planDoc.notes||planDoc.preparation} path="notes"/></Section>
      <Footer/>
    </Page>
    {scheduleChunks.map((chunk,idx)=>{
      const scheduleDoc=scheduleDocForDays(planDoc,chunk);
      const title=scheduleMode==='일차별 여유형'?`일정표 ${chunk.join(' · ')}`:'일정표';
      return <Page doc={planDoc} key={chunk.join('|')+idx} className="event-retreat-page event-retreat-schedule-page" pageNo={2+idx}>
        <Header title={titleOf('행사 및 수련회 기획안',planDoc)} meta={meta} doc={planDoc} titlePath="title" metaPath="period"/>
        <Section idx={4} title={title} doc={planDoc} block="p2"><ScheduleGrid doc={scheduleDoc}/></Section>
        {scheduleMode==='일차별 여유형'&&<div className="schedule-split-note">일정표를 여유형으로 나누어 표시했습니다. 원본 일정 입력은 동일하게 유지됩니다.</div>}
        <Footer/>
      </Page>
    })}
    <Page doc={planDoc} className="event-retreat-page event-retreat-budget-page" pageNo={budgetPageNo}>
      <Header title={titleOf('행사 및 수련회 기획안',planDoc)} meta={meta} doc={planDoc} titlePath="title" metaPath="period"/>
      <Section idx={5} title="수입·지출 예산안" doc={planDoc} block="p3">
        <div className="budget-two-tables"><div><h3>수입</h3><MoneyTable rows={planDoc.incomeItems}/><div className="total">수입 합계 {won(budgetTotal(planDoc.incomeItems))}</div></div><div><h3>지출</h3><MoneyTable rows={planDoc.expenseItems}/><div className="total">지출 합계 {won(budgetTotal(planDoc.expenseItems))}</div></div></div>
      </Section>
      <Footer/>
    </Page>
    {buildExtraPages('행사 및 수련회 기획안',planDoc,6,{className:'event-retreat-extra-page',pageNoStart:budgetPageNo+1})}
  </>;
}

function GenericPreview({type,doc}){if(type==='기본 공지 안내문')return <BasicNoticePreview doc={doc}/>;if(type==='회의자료')return <MeetingMaterialPreview doc={doc}/>;if(type==='연말/연차 부서 보고서')return <AnnualReportPreview doc={doc}/>;if(type==='지출결의서')return <SpendingResolutionPreview doc={doc}/>;if(type==='차량/장소 사용 신청서')return <UseRequestPreview doc={doc}/>;if(type==='각부 월간행사 안내')return <MonthlyPreview doc={doc}/>;if(['부서 통합 주간보고서','부서별 주간보고서','7개부서 보고서'].includes(type))return <WeeklyPreview type={type} doc={doc}/>;if(type==='행사 및 수련회 기획안')return <EventRetreatPlanPreview doc={doc}/>;if(type==='세부 프로그램 문서')return <ProgramDocPreview doc={doc}/>;if(type==='행사 결과 보고서')return <ResultReportPreview doc={doc}/>;if(type==='공문/협조 요청서')return <CooperationDocPreview doc={doc}/>;if(type==='심방 보고서')return <VisitReportPreview doc={doc}/>;if(type==='예산안')return <BudgetPreview doc={doc}/>;if(type==='회의록')return <MeetingPreview doc={doc}/>;if(type==='일정표')return <SchedulePreview doc={doc}/>;if(type==='부서행사 진행표(캘린더형)')return <CalendarPreview doc={doc}/>;if(isCueType(type))return <CueSheetPreview doc={doc} type={type}/>;if(type==='주간 공지')return buildGenericPages(type,doc,[{title:'이번 주 주요 공지',body:<div className="notice-cards">{(doc.items||[]).map((x,i)=><div className="notice-card" key={i}><b><Edit path={`items.${i}.date`} value={x.date}/> · <Edit path={`items.${i}.title`} value={x.title}/></b><p><Edit path={`items.${i}.place`} value={x.place}/> / <Edit path={`items.${i}.target`} value={x.target}/></p><p><Edit path={`items.${i}.content`} value={x.content}/></p></div>)}</div>},{title:'확인사항',body:<PList text={doc.requests} path="requests" noBullet={doc.requestsBullet===false}/>},{title:'기도제목',body:<PList text={doc.prayer} path="prayer"/>}]);if(type==='기획위원회 보고서')return buildGenericPages(type,doc,[{title:'보고 요약',body:<SplitText text={doc.summary} path="summary"/>},{title:'주요 안건',body:<PList text={doc.agenda} path="agenda"/>},{title:'결의 및 진행사항',body:<PList text={doc.decisions} path="decisions"/>},{title:'요청사항',body:<PList text={doc.requests} path="requests" noBullet={doc.requestsBullet===false}/>},{title:'기도제목',body:<PList text={doc.prayer} path="prayer"/>}]);if(false&&type==='수련회 계획안')return buildGenericPages(type,doc,[
  {title:'목적',body:<SplitText text={doc.purpose} path="purpose"/>},
  {title:'주요 프로그램',body:<PList text={doc.program} path="program"/>},
  {title:'일정표',body:<ScheduleGrid doc={{...doc,slotMinutes:'60',startHour:'7',endHour:'24',scheduleFontScale:92}}/>},
  {title:'섬김이 및 역할',body:<PList text={doc.roles} path="roles"/>},
  {title:'준비사항',body:<PList text={doc.preparation} path="preparation"/>},
  {title:'예산',customNewPage:true,body:<><MoneyTable rows={doc.expenseItems}/><div className="total">합계 {won(budgetTotal(doc.expenseItems))}</div></>}
],{className:'retreat-doc-page'});if(type==='세미나/교육자료')return buildGenericPages(type,doc,[{title:'자료 소개',body:<InfoGrid items={[["부제",ev("subtitle",doc.subtitle)],["강사",ev("speaker",doc.speaker)],["일시",ev("date",doc.date)],["장소",ev("place",doc.place)],["대상",ev("target",doc.target)],["주제",ev("topic",doc.topic)]]}/>},{title:'교육 목표',body:<PList text={doc.goals} path="goals"/>},{title:'진행 흐름',body:<PList text={doc.outline} path="outline"/>},{title:'핵심 문장',body:<div className="quote"><Edit path="keyText" value={doc.keyText} as="div"/></div>},{title:'나눔 질문',body:<PList text={doc.questions} path="questions"/>},{title:'메모/안내',body:<SplitText text={doc.memo} path="memo"/>}]);if(type==='준비목록')return <PrepListPreview doc={doc}/>;if(type==='만족도 조사')return buildGenericPages(type,doc,[{title:'조사 목적',body:<SplitText text={doc.purpose} path="purpose"/>},{title:'객관식 문항',body:<div>{(doc.surveyQuestions||[]).map((q,i)=><div className="question" key={i}><b>{i+1}. {q.question}</b><PList text={q.options}/></div>)}</div>},{title:'주관식 문항',body:<PList text={doc.openQuestions} path="openQuestions"/>},{title:'안내',body:<SplitText text={doc.guide} path="guide"/>}]);if(type==='신청서 양식')return <ApplicationFormPreview doc={doc}/>;if(type==='기본 설정')return <Page doc={doc}><Header title="기본 설정" meta={doc.church} doc={doc} metaPath="church"/><InfoGrid items={[["교회명",ev("church",doc.church)],["기본 부서",ev("defaultGroup",doc.defaultGroup)],["담당자",ev("manager",doc.manager)],["문의 문구",ev("contact",doc.contact)],["하단 문구",ev("footer",doc.footer)]]}/></Page>;return <Page doc={doc}><Header title={titleOf(type,doc)} doc={doc} titlePath={titlePathOf(type)}/><SplitText text={doc.content} path="content"/></Page>}

function exportPages(root){return root?[...root.querySelectorAll('.export-page')]:[]}
function lockExportTypography(source,target){
  if(!source||!target||typeof window==='undefined')return;
  const srcNodes=[source,...source.querySelectorAll('*')];
  const tgtNodes=[target,...target.querySelectorAll('*')];
  const cssVars=['--fontScale','--bodySize','--h1Size','--h2Size','--tableSize','--smallSize','--eventTitleSize','--listSize','--scheduleTextScale','--calendarTextScale'];
  cssVars.forEach(name=>{
    const value=source.style.getPropertyValue(name)||window.getComputedStyle(source).getPropertyValue(name);
    if(value)target.style.setProperty(name,value.trim());
  });
  srcNodes.forEach((src,i)=>{
    const tgt=tgtNodes[i];
    if(!tgt)return;
    const cs=window.getComputedStyle(src);
    // 미리보기에서 계산된 실제 글자 크기를 내보내기 복제본에 고정합니다.
    // 모바일/브라우저별 media query 또는 export-clone CSS 때문에 PDF/PNG 글자 배율이 달라지는 문제를 막습니다.
    if(cs.fontSize)tgt.style.setProperty('font-size',cs.fontSize,'important');
    if(cs.lineHeight)tgt.style.setProperty('line-height',cs.lineHeight,'important');
    if(cs.letterSpacing)tgt.style.setProperty('letter-spacing',cs.letterSpacing,'important');
  });
}
async function waitExportPaint(){
  try{if(document.fonts?.ready)await document.fonts.ready;}catch{}
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
}
async function renderExportPage(page){
  const node=page.cloneNode(true);
  const stage=document.createElement('div');
  const appClass=page.closest('.app')?.className||'';
  const isLand=page.classList.contains('landscape')||page.dataset.orientation==='landscape';
  const pageW=isLand?1123:794;
  const pageH=isLand?794:1123;
  stage.className=`${appClass} export-stage v1-4-export-stage v1-12-export-font-lock v2-27-fixed-export-stage`;
  stage.style.cssText=`position:fixed;left:-12000px;top:0;width:${pageW}px;height:${pageH}px;overflow:hidden;background:#fff;z-index:-1;pointer-events:none;`;
  node.classList.add('export-clone','export-font-locked','v2-27-export-page-clone');
  node.style.setProperty('position','relative','important');
  node.style.setProperty('left','0','important');
  node.style.setProperty('top','0','important');
  node.style.setProperty('right','auto','important');
  node.style.setProperty('bottom','auto','important');
  node.style.setProperty('transform','none','important');
  node.style.setProperty('zoom','1','important');
  node.style.setProperty('margin','0','important');
  node.style.setProperty('box-shadow','none','important');
  node.style.setProperty('border-radius','0','important');
  node.style.setProperty('width',`${pageW}px`,'important');
  node.style.setProperty('min-width',`${pageW}px`,'important');
  node.style.setProperty('max-width',`${pageW}px`,'important');
  node.style.setProperty('height',`${pageH}px`,'important');
  node.style.setProperty('min-height',`${pageH}px`,'important');
  node.style.setProperty('max-height',`${pageH}px`,'important');
  lockExportTypography(page,node);
  stage.appendChild(node);
  document.body.appendChild(stage);
  try{
    await waitExportPaint();
    const canvas=await html2canvas(node,{
      scale:2,
      backgroundColor:'#ffffff',
      useCORS:true,
      width:pageW,
      height:pageH,
      windowWidth:pageW,
      windowHeight:pageH,
      scrollX:0,
      scrollY:0,
      x:0,
      y:0
    });
    return {canvas,isLand};
  }finally{stage.remove()}
}
async function exportPDF(previewRef,type,fileName){const pages=exportPages(previewRef.current);if(!pages.length)throw new Error('저장할 페이지가 없습니다.');const base=sanitize(fileName||type);let pdf=null;for(let i=0;i<pages.length;i++){const {canvas,isLand}=await renderExportPage(pages[i]);const img=canvas.toDataURL('image/png');const orient=isLand?'l':'p';const w=isLand?297:210,h=isLand?210:297;if(!pdf)pdf=new jsPDF(orient,'mm','a4');else pdf.addPage('a4',orient);pdf.addImage(img,'PNG',0,0,w,h,undefined,'FAST');}pdf.save(`${base}.pdf`)}
async function exportPNG(previewRef,type,fileName){const pages=exportPages(previewRef.current);if(!pages.length)throw new Error('저장할 페이지가 없습니다.');const base=sanitize(fileName||type);for(let i=0;i<pages.length;i++){const {canvas}=await renderExportPage(pages[i]);const a=document.createElement('a');a.href=canvas.toDataURL('image/png');a.download=pages.length===1?`${base}.png`:`${base}-${i+1}.png`;a.click();}}
function encodeSharePayload(payload){return btoa(unescape(encodeURIComponent(JSON.stringify(payload))))}
function decodeSharePayload(text){return JSON.parse(decodeURIComponent(escape(atob(text))))}


function cloudDate(value){
  if(!value)return '';
  try{return new Date(value).toLocaleString('ko-KR',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}catch{return ''}
}
function CloudSyncPanel({auth,all,setAll,type,setType,bundleTypes,setBundleTypes,setSavedAt}){
  const [open,setOpen]=useState(false);
  const [docs,setDocs]=useState([]);
  const [loading,setLoading]=useState(false);
  const [cloudId,setCloudId]=useState(()=>{try{return localStorage.getItem('church-docs-kit-basic-v1-cloud-doc-id')||''}catch{return ''}});
  const [title,setTitle]=useState(()=>{try{return localStorage.getItem('church-docs-kit-basic-v1-cloud-title')||''}catch{return ''}});
  const [message,setMessage]=useState('');
  const hasSession=!!auth?.session?.access_token;
  const defaultTitle=title||`${type} ${new Date().toLocaleDateString('ko-KR')}`;
  async function refresh(){
    if(!hasSession){setMessage('로그인 후 사용할 수 있습니다.');return;}
    setLoading(true);setMessage('');
    try{const data=await listCloudDocuments(auth.session);setDocs(data?.documents||[]);setMessage('내 문서 목록을 불러왔습니다.');}
    catch(e){setMessage(readableSupabaseError(e));}
    finally{setLoading(false);}
  }
  async function saveCloud(asNew=false){
    if(!hasSession){setMessage('로그인 후 사용할 수 있습니다.');return;}
    setLoading(true);setMessage('클라우드에 저장하는 중입니다…');
    try{
      const data=await saveCloudDocument(auth.session,{id:asNew?'':cloudId,title:defaultTitle,doc_type:type,bundle_types:bundleTypes,data:all});
      const saved=data?.document||{};
      if(saved.id){setCloudId(saved.id);try{localStorage.setItem('church-docs-kit-basic-v1-cloud-doc-id',saved.id)}catch{}}
      if(saved.title){setTitle(saved.title);try{localStorage.setItem('church-docs-kit-basic-v1-cloud-title',saved.title)}catch{}}
      setMessage('클라우드 저장 완료 · 다른 기기에서 같은 이메일로 불러올 수 있습니다.');
      setSavedAt?.('클라우드 저장 완료');
      await refresh();
    }catch(e){setMessage(readableSupabaseError(e));}
    finally{setLoading(false);}
  }
  async function loadOne(doc){
    if(!hasSession)return;
    if(!confirm(`“${doc.title}” 문서를 불러올까요?\n현재 화면의 내용은 불러온 문서로 바뀝니다.`))return;
    setLoading(true);setMessage('불러오는 중입니다…');
    try{
      const data=await loadCloudDocument(auth.session,doc.id);
      const loaded=data?.document;
      if(!loaded?.data)throw new Error('문서 데이터가 없습니다.');
      const merged=merge(loaded.data);
      setAll(merged);
      const nextType=loaded.doc_type||type;
      setType(nextType);
      setBundleTypes(Array.isArray(loaded.bundle_types)&&loaded.bundle_types.length?loaded.bundle_types:[nextType]);
      setCloudId(loaded.id);setTitle(loaded.title||'');
      try{localStorage.setItem('church-docs-kit-basic-v1-cloud-doc-id',loaded.id);localStorage.setItem('church-docs-kit-basic-v1-cloud-title',loaded.title||'')}catch{}
      saveToStorage(merged);
      setMessage('불러오기 완료 · 이제 이 기기에서도 이어서 수정할 수 있습니다.');
      setSavedAt?.('클라우드 문서 불러옴');
    }catch(e){setMessage(readableSupabaseError(e));}
    finally{setLoading(false);}
  }
  async function removeOne(doc){
    if(!hasSession)return;
    if(!confirm(`“${doc.title}” 문서를 클라우드 목록에서 삭제할까요?\n현재 기기에 저장된 내용은 삭제되지 않습니다.`))return;
    setLoading(true);setMessage('삭제 중입니다…');
    try{await deleteCloudDocument(auth.session,doc.id);if(cloudId===doc.id){setCloudId('');try{localStorage.removeItem('church-docs-kit-basic-v1-cloud-doc-id')}catch{}}setMessage('클라우드 문서를 삭제했습니다.');await refresh();}
    catch(e){setMessage(readableSupabaseError(e));}
    finally{setLoading(false);}
  }
  useEffect(()=>{if(open&&hasSession&&docs.length===0)refresh();},[open]);
  return <section className="cloud-sync-panel" id="mobile-save-area" aria-label="PC 모바일 이어쓰기">
    <div className="cloud-sync-head">
      <div><b>PC·모바일 이어쓰기</b><span>같은 이메일로 로그인하면 내 문서를 클라우드에 저장하고 다른 기기에서 불러올 수 있습니다.</span></div>
      <div className="cloud-sync-actions"><button type="button" onClick={()=>setOpen(v=>!v)}>{open?'내 문서 닫기':'내 문서 열기'}</button><button type="button" className="primary" disabled={loading||!hasSession} onClick={()=>saveCloud(false)}>{loading?'처리 중…':(cloudId?'클라우드 저장':'새 문서 저장')}</button></div>
    </div>
    {open&&<div className="cloud-sync-body">
      <div className="cloud-save-row"><label><span>저장 이름</span><input value={title} onChange={e=>{setTitle(e.target.value);try{localStorage.setItem('church-docs-kit-basic-v1-cloud-title',e.target.value)}catch{}}} placeholder={`${type} ${new Date().toLocaleDateString('ko-KR')}`} /></label><button type="button" disabled={loading||!hasSession} onClick={()=>saveCloud(false)}>{cloudId?'현재 문서에 덮어쓰기':'클라우드에 저장'}</button><button type="button" disabled={loading||!hasSession} onClick={()=>saveCloud(true)}>새 이름으로 저장</button><button type="button" disabled={loading||!hasSession} onClick={refresh}>목록 새로고침</button></div>
      <p className="cloud-tip">모바일에서는 신청·확인·간단 수정이 가능하고, PDF/PNG 저장은 PC 환경이 가장 안정적입니다.</p>
      {message&&<div className={message.includes('완료')||message.includes('불러왔')||message.includes('삭제')?'cloud-message ok':'cloud-message'}>{message}</div>}
      <div className="cloud-doc-list">
        {docs.length===0?<div className="cloud-empty">아직 클라우드에 저장된 문서가 없습니다.</div>:docs.map(d=><article key={d.id} className={cloudId===d.id?'active':''}>
          <div><b>{d.title||'제목 없음'}</b><span>{d.doc_type||'문서'} · {cloudDate(d.updated_at)}</span></div>
          <div className="cloud-doc-actions"><button type="button" onClick={()=>loadOne(d)}>불러오기</button><button type="button" onClick={()=>removeOne(d)}>삭제</button></div>
        </article>)}
      </div>
    </div>}
  </section>
}


function AssistantStartPanel({type,setType,setSelected,recentDocs=[]}){
  const shortcuts=[
    ['기본 공지','기본 공지 안내문'],['월간 안내','각부 월간행사 안내'],['부서보고','부서별 주간보고서'],['통합보고','부서 통합 주간보고서'],['수련회기획','행사 및 수련회 기획안']
  ];
  function choose(t){setType(t);setSelected?.(defaultBundleFor(t));setTimeout(()=>document.querySelector('.edit-drawer')?.setAttribute('open',''),60)}
  return <div className="assistant-start-panel"><b>빠른 시작</b><p>만들 문서를 고르면 바로 입력 단계로 이동합니다.</p><div className="assistant-shortcuts">{shortcuts.map(([label,t])=><button type="button" key={t} className={type===t?'active':''} onClick={()=>choose(t)}>{label}</button>)}</div>{recentDocs.length? <><b className="recent-title">최근 작업</b><div className="recent-docs">{recentDocs.slice(0,4).map(t=><button type="button" key={t} onClick={()=>choose(t)}>{t}</button>)}</div></>:null}</div>
}


const DASHBOARD_DOC_CARDS=[
  {type:'기본 공지 안내문',icon:'📣',desc:'회의·기도회·부서 공지를 한 장 안내문으로 정리'},
  {type:'각부 월간행사 안내',icon:'🗓️',desc:'월간 일정과 협조 요청을 카카오톡/인쇄용으로 정리'},
  {type:'부서별 주간보고서',icon:'📋',desc:'한 부서의 출석·활동·다음 주 계획을 보고'},
  {type:'부서 통합 주간보고서',icon:'👥',desc:'여러 부서 현황을 한 장 보고서로 통합'},
  {type:'행사 및 수련회 기획안',icon:'🧾',desc:'개요·일정표·예산안을 묶어 기획안 작성'}
];
function dashboardDate(value){try{return value?new Date(value).toLocaleDateString('ko-KR',{year:'numeric',month:'2-digit',day:'2-digit'}):''}catch{return ''}}
function DashboardCloudDocuments({auth,onLoadDocument,onOpenWriter}){
  const [docs,setDocs]=useState([]);
  const [loading,setLoading]=useState(false);
  const [message,setMessage]=useState('');
  const hasSession=!!auth?.session?.access_token;
  async function refresh(){
    if(!hasSession){setMessage('로그인 후 내 문서를 볼 수 있습니다.');return;}
    setLoading(true);setMessage('');
    try{const data=await listCloudDocuments(auth.session);setDocs(data?.documents||[]);}
    catch(e){setMessage(readableSupabaseError(e));}
    finally{setLoading(false);}
  }
  useEffect(()=>{refresh()},[hasSession]);
  async function loadDoc(d){
    if(!hasSession)return;
    setLoading(true);setMessage('문서를 불러오는 중입니다…');
    try{
      const data=await loadCloudDocument(auth.session,d.id);
      const loaded=data?.document;
      if(!loaded?.data)throw new Error('문서 데이터가 없습니다.');
      onLoadDocument?.(loaded);
      setMessage('문서를 불러왔습니다.');
    }catch(e){setMessage(readableSupabaseError(e));}
    finally{setLoading(false);}
  }
  async function removeDoc(d){
    if(!hasSession)return;
    if(!confirm(`“${d.title||'제목 없음'}” 문서를 클라우드 목록에서 삭제할까요?`))return;
    setLoading(true);setMessage('삭제 중입니다…');
    try{await deleteCloudDocument(auth.session,d.id);setMessage('삭제했습니다.');await refresh();}
    catch(e){setMessage(readableSupabaseError(e));}
    finally{setLoading(false);}
  }
  const rows=docs.slice(0,5);
  return <section className="dash-section dash-documents-section" id="dashboard-documents">
    <div className="dash-section-head"><div><h2>내 문서</h2><p>클라우드에 저장한 문서를 PC·모바일에서 이어서 열 수 있습니다.</p></div><div className="dash-section-actions"><button type="button" onClick={refresh} disabled={loading}>{loading?'불러오는 중…':'새로고침'}</button><button type="button" className="dash-soft-btn" onClick={onOpenWriter}>작성 화면으로</button></div></div>
    <div className="dash-doc-table" role="table" aria-label="내 문서 목록">
      <div className="dash-doc-row dash-doc-head" role="row"><span>제목</span><span>최종 수정일</span><span>형식</span><span>관리</span></div>
      {rows.length? rows.map(d=><div className="dash-doc-row" role="row" key={d.id}>
        <span><b>{d.title||'제목 없음'}</b><em>{d.doc_type||'문서'}</em></span>
        <span>{dashboardDate(d.updated_at||d.created_at)}</span>
        <span>{d.doc_type?.includes('기획안')?'A4':'PDF'}</span>
        <span className="dash-doc-buttons"><button type="button" onClick={()=>loadDoc(d)}>불러오기</button><button type="button" onClick={()=>removeDoc(d)}>삭제</button></span>
      </div>) : <div className="dash-empty-docs">아직 저장된 문서가 없습니다. 작성 화면에서 <b>클라우드 저장</b>을 누르면 이곳에 표시됩니다.</div>}
    </div>
    {message&&<p className={message.includes('삭제')||message.includes('불러')?'dash-message ok':'dash-message'}>{message}</p>}
  </section>
}
function DashboardHomePanel({currentType,recentDocs,onOpenDoc,onOpenWriter,onLoadDocument,auth}){
  return <>
    <section className="product-dash-hero">
      <div><h2>반복되는 교회 문서, 10분 안에 완성하세요.</h2><p>공지 · 월간행사 · 주간보고서 · 기획안 · PDF/PNG 저장까지 한 화면에서 진행합니다.</p><div className="dash-chip-row"><span>A4 인쇄 최적화</span><span>PDF/PNG 저장</span><span>PC·모바일 이어쓰기</span></div></div>
      <button type="button" className="dash-primary-cta" onClick={()=>onOpenDoc(currentType||'기본 공지 안내문')}>현재 문서 작성하기</button>
    </section>
    <section className="dash-section">
      <div className="dash-section-head"><div><h2>문서 만들기</h2><p>필요한 문서를 선택하면 작성 화면으로 이동합니다.</p></div></div>
      <div className="dash-doc-card-grid">
        {DASHBOARD_DOC_CARDS.map(card=><button type="button" className="dash-doc-card" key={card.type} onClick={()=>onOpenDoc(card.type)}>
          <span className="dash-card-icon">{card.icon}</span><b>{card.type}</b><em>{card.desc}</em>
        </button>)}
      </div>
    </section>
    <DashboardCloudDocuments auth={auth} onLoadDocument={onLoadDocument} onOpenWriter={onOpenWriter}/>
    <section className="dash-section dash-small-grid">
      <article><h3>최근 작업</h3>{recentDocs?.length?<div className="dash-recent-list">{recentDocs.slice(0,4).map(t=><button key={t} type="button" onClick={()=>onOpenDoc(t)}>{t}</button>)}</div>:<p>문서를 열면 최근 작업이 여기에 표시됩니다.</p>}</article>
      <article><h3>사용 흐름</h3><ol><li>문서 선택</li><li>내용 입력</li><li>미리보기 확인</li><li>PDF/PNG 저장</li></ol></article>
      <article><h3>모바일 사용</h3><p>신청·확인·간단 수정은 모바일에서 가능하고, PDF/PNG 저장은 PC 환경이 가장 안정적입니다.</p></article>
    </section>
  </>
}
function DashboardTemplatesPanel({onOpenDoc}){
  return <section className="dash-section">
    <div className="dash-section-head"><div><h2>템플릿</h2><p>BASIC에서 제공하는 5가지 교회 실무 문서 양식입니다.</p></div></div>
    <div className="dash-doc-card-grid">
      {DASHBOARD_DOC_CARDS.map(card=><button type="button" className="dash-doc-card" key={card.type} onClick={()=>onOpenDoc(card.type)}>
        <span className="dash-card-icon">{card.icon}</span><b>{card.type}</b><em>{card.desc}</em>
      </button>)}
    </div>
    <div className="dash-info-box"><b>템플릿 사용 방법</b><p>카드를 누르면 작성 화면으로 이동합니다. 대표 샘플을 수정하거나 빈 양식으로 바꿔서 사용할 수 있습니다.</p></div>
  </section>
}
function DashboardSettingsPanel({auth,onOpenWriter}){
  const email=auth?.email||'로그인 계정';
  return <section className="dash-section">
    <div className="dash-section-head"><div><h2>설정</h2><p>접속·저장·모바일 사용 안내입니다.</p></div><button type="button" className="dash-soft-btn" onClick={onOpenWriter}>작성 화면으로</button></div>
    <div className="dash-setting-grid">
      <article><h3>로그인 계정</h3><p>{email}</p><small>승인된 이메일만 작성기에 접속할 수 있습니다.</small></article>
      <article><h3>개인 기기 사용</h3><p>개인 PC와 본인 휴대폰에서는 로그아웃하지 말고 창만 닫아 주세요.</p><small>같은 기기에서는 세션이 유지되어 다시 접속이 쉬워집니다.</small></article>
      <article><h3>공용 PC 사용</h3><p>교회 공용 PC나 다른 사람의 기기에서는 사용 후 로그아웃해 주세요.</p><small>개인정보와 문서 내용을 보호하기 위한 설정입니다.</small></article>
      <article><h3>클라우드 저장</h3><p>내 문서 저장을 쓰려면 Supabase SQL Editor에서 user_documents 테이블을 먼저 만들어야 합니다.</p><small>파일: supabase_cloud_documents.sql</small></article>
      <article><h3>모바일 로그인</h3><p>새 휴대폰이나 새 브라우저에서는 승인 이메일과 접속코드를 입력하면 됩니다.</p><small>베타 기간에는 메일 로그인 없이 접속코드 방식으로 사용합니다.</small></article>
      <article><h3>출력 권장 환경</h3><p>PDF/PNG 저장은 PC 또는 노트북 환경이 가장 안정적입니다.</p><small>모바일은 신청·확인·간단 수정 용도로 권장합니다.</small></article>
    </div>
  </section>
}
function ProductDashboard({auth,currentType,recentDocs,onOpenDoc,onOpenWriter,onLoadDocument}){
  const [active,setActive]=useState('home');
  function go(section){
    if(section==='write'){onOpenWriter?.();return;}
    setActive(section);
  }
  return <div className="product-dashboard-shell">
    <aside className="product-dash-sidebar">
      <div className="product-dash-brand"><span className="brand-mark">✚</span><div><b>교회문서키트</b><em>BASIC</em></div></div>
      <nav className="product-dash-nav" aria-label="홈 메뉴">
        <button type="button" className={active==='home'?'active':''} onClick={()=>go('home')}><span>🏠</span>홈</button>
        <button type="button" className={active==='write'?'active':''} onClick={()=>go('write')}><span>✎</span>문서 작성</button>
        <button type="button" className={active==='docs'?'active':''} onClick={()=>go('docs')}><span>📁</span>내 문서</button>
        <button type="button" className={active==='templates'?'active':''} onClick={()=>go('templates')}><span>📄</span>템플릿</button>
        <button type="button" className={active==='settings'?'active':''} onClick={()=>go('settings')}><span>⚙</span>설정</button>
      </nav>
      <div className="product-dash-note"><b>모바일 사용</b><p>신청·확인·간단 수정은 모바일 가능, PDF/PNG 저장은 PC 권장입니다.</p></div>
    </aside>
    <main className="product-dash-main">
      <header className="product-dash-top">
        <div><p className="dash-eyebrow">교회 실무 문서 작성기</p><h1>교회문서키트 BASIC</h1><p>교회 실무 문서를 빠르게 작성하고 저장하세요.</p></div>
        <div className="dash-user-pill"><span>👤</span><div><b>사용자</b><em>{auth?.email||'로그인 계정'}</em></div></div>
      </header>
      {active==='home'&&<DashboardHomePanel auth={auth} currentType={currentType} recentDocs={recentDocs} onOpenDoc={onOpenDoc} onOpenWriter={onOpenWriter} onLoadDocument={onLoadDocument}/>}      
      {active==='docs'&&<DashboardCloudDocuments auth={auth} onLoadDocument={onLoadDocument} onOpenWriter={onOpenWriter}/>}      
      {active==='templates'&&<DashboardTemplatesPanel onOpenDoc={onOpenDoc}/>}      
      {active==='settings'&&<DashboardSettingsPanel auth={auth} onOpenWriter={onOpenWriter}/>}      
    </main>
  </div>
}

function DocMenuItem({t,type,setType,selected,onToggle,setSelected}){
  const checked=selected.includes(t);
  function openDoc(e){
    e?.preventDefault?.();
    e?.stopPropagation?.();
    const next=t==='행사 및 수련회 계획안'||t==='수련회 계획안'||t==='행사 기획안'?'행사 및 수련회 기획안':t;
    setType(next);
    setSelected?.([next]);
    requestAnimationFrame(()=>document.querySelector('.preview-wrap')?.scrollTo?.({top:0,left:0,behavior:'auto'}));
  }
  function toggleAndOpen(e){
    e?.preventDefault?.();
    e?.stopPropagation?.();
    setType(t);
    setSelected?.(prev=>{
      const exists=prev.includes(t);
      const next=exists?prev.filter(x=>x!==t):[...prev,t];
      return next.length?next:[t];
    });
  }
  return <div className={'doc-choice '+(type===t?'active':'')+' '+(checked?'checked':'')} data-doc-choice={t} onClick={openDoc} role="button" tabIndex={0} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){openDoc(e)}}}>
    <button type="button" className="doc-bundle-toggle" aria-label={`${t} 통합 PDF 포함`} aria-pressed={checked} onClick={toggleAndOpen}>{checked?'✓':''}</button>
    <button type="button" className="doc-open-btn" onClick={openDoc} aria-current={type===t?'page':undefined}>{t}</button>
  </div>
}
function SelectedDocsPreview({types,all,currentType}){
  const list=(types&&types.length?types:[currentType]).filter(Boolean);
  return <>{list.map((t,i)=><div className="selected-doc-preview" data-doc-type={t} key={t+i}><GenericPreview type={t} doc={all[t]||withBase(t,initialData(t))}/></div>)}</>
}


function RibbonStyleTools({doc,setDoc,type,compact=false}){
  const st={...baseExtras(type).style,...(doc?.style||{})};
  st.preset=normalizePreset(st.preset);
  function patch(next){setDoc({...doc,style:{...st,...next}})}
  function applyPreset(p){patch(presetStylePatch(p))}
  function setTheme(theme){patch({theme,...THEMES[theme]})}
  const recommended={
    '각부 월간행사 안내':['행정 보고형','카톡 공지형','월간 일정형'],
    '부서 통합 주간보고서':['행정 보고형','교육 자료형'],
    '부서별 주간보고서':['행정 보고형','교육 자료형'],
    '행사 및 수련회 기획안':['수련회 기획형','행정 보고형','예산 정리형'],
    '예산안':['예산 정리형','행정 보고형'],
    [CUE_DOC]:['큐시트 진행형','행정 보고형'],
    '세미나/교육자료':['교육 자료형','카톡 공지형'],
    '주간 공지':['카톡 공지형','행사 포스터형']
  };
  const first=[...(recommended[type]||[])];
  const presets=[...first,...Object.keys(DESIGN_PRESETS).filter(x=>!first.includes(x))];
  return <div className={compact?'ribbon-design-tools compact':'ribbon-design-tools'}>
    <div className="design-purpose-row">
      {presets.slice(0,compact?5:8).map(p=><button type="button" key={p} className={st.preset===p?'active':''} title={DESIGN_PRESETS[p]} onClick={()=>applyPreset(p)}>
        <span className={'mini-design-swatch mini-'+presetClass(p)}></span><b>{p}</b>
      </button>)}
    </div>
    <div className="design-detail-row">
      <label className="ribbon-select"><span>색상</span><select value={st.theme||'클래식 네이비'} onChange={e=>setTheme(e.target.value)}>{Object.keys(THEMES).map(t=><option key={t} value={t}>{t}</option>)}</select></label>
      <label className="ribbon-color"><span>대표</span><input type="color" value={st.primary||'#0b2d5c'} onChange={e=>patch({primary:e.target.value})}/></label>
      <label className="ribbon-color"><span>포인트</span><input type="color" value={st.accent||'#2f6fad'} onChange={e=>patch({accent:e.target.value})}/></label>
    </div>
  </div>
}

function DocumentRibbon({type,doc,setDoc,view,setView,busy,onPDF,onPNG,onSave,onBackup,onShare,onSample,onBlank,onImport,savedAt,onHelp}){
  const [tab,setTab]=useState('홈');
  function jump(selector,openDrawer=false){
    if(openDrawer){const drawer=document.querySelector('.edit-drawer'); if(drawer)drawer.open=true;}
    document.querySelector(selector)?.scrollIntoView({behavior:'smooth',block:'start'});
  }
  const tabs=['홈','문서','입력','글자','디자인','페이지','저장·출력'];
  return <div className="document-ribbon document-ribbon-clean" aria-label="문서 편집 빠른 메뉴">
    <div className="ribbon-main-line">
      <div className="ribbon-current"><b>{type}</b><span>자주 쓰는 기능은 위에서 바로 조정합니다.</span></div>
      <div className="ribbon-tab-row" role="tablist" aria-label="빠른 메뉴 탭">
        {tabs.map(t=><button key={t} type="button" role="tab" aria-selected={tab===t} className={tab===t?'active':''} onClick={()=>setTab(t)}>{t}</button>)}
      </div>
      <div className="ribbon-hero-actions"><button type="button" className="ribbon-help-btn" onClick={onHelp}>사용법</button><button type="button" onClick={onSave}>저장하기</button><button type="button" disabled={!!busy} onClick={onPDF}>{busy==='PDF'?'PDF 중…':'PDF 저장'}</button><button type="button" disabled={!!busy} onClick={onPNG}>{busy==='PNG'?'PNG 중…':'PNG 저장'}</button></div>
    </div>
    <div className={'ribbon-panel ribbon-panel-'+tab.replace('·','-')}>
      {tab==='홈'&&<div className="ribbon-home-grid"><div className="ribbon-group"><em>바로 작업</em><button type="button" onClick={()=>jump('.edit-drawer',true)}>전체 입력</button><button type="button" onClick={()=>jump('.preview-pane')}>미리보기</button><button type="button" onClick={()=>setView(view==='fit'?'large':'fit')}>{view==='fit'?'크게 보기':'한눈 보기'}</button></div><div className="ribbon-group"><em>자주 쓰는 저장</em><button type="button" onClick={onSave}>저장</button><button type="button" disabled={!!busy} onClick={onPDF}>PDF</button><button type="button" disabled={!!busy} onClick={onPNG}>PNG</button></div><div className="ribbon-group"><em>빠른 글자</em><FontQuickControls doc={doc} setDoc={setDoc} compact/></div><div className="ribbon-group"><em>추천 디자인</em><RibbonStyleTools type={type} doc={doc} setDoc={setDoc} compact/></div></div>}
      {tab==='문서'&&<div className="ribbon-group wide"><em>문서 관리</em><button type="button" onClick={()=>jump('.sidebar')}>문서 선택</button><button type="button" onClick={onSave}>저장하기</button><button type="button" onClick={onBackup}>자료 내보내기</button>{onImport&&<label className="file-btn ribbon-file-btn">자료 가져오기<input type="file" accept=".json" onChange={onImport}/></label>}<button type="button" onClick={onShare}>공유 링크</button><button type="button" onClick={onSample}>대표 샘플로 되돌리기</button><button type="button" onClick={onBlank}>빈 양식으로 시작</button>{savedAt&&<small>{savedAt}</small>}</div>}
      {tab==='입력'&&<div className="ribbon-group wide"><em>입력 이동</em><button type="button" onClick={()=>jump('.edit-drawer',true)}>전체 입력 열기</button><button type="button" onClick={()=>jump('[data-editor-title="기본 정보"]',true)}>기본 정보</button><button type="button" onClick={()=>jump('[data-editor-title*="일정"]',true)}>일정 입력</button><button type="button" onClick={()=>jump('[data-editor-title*="예산"]',true)}>예산 입력</button><button type="button" onClick={()=>jump('.v226-work-tools-panel',true)}>출력 설정</button><button type="button" onClick={()=>jump('.preview-pane')}>미리보기</button></div>}
      {tab==='글자'&&<div className="ribbon-group ribbon-font-group wide"><em>글자 크기</em><FontQuickControls doc={doc} setDoc={setDoc}/></div>}
      {tab==='디자인'&&<div className="ribbon-group ribbon-design-group wide"><em>디자인 선택</em><RibbonStyleTools type={type} doc={doc} setDoc={setDoc}/></div>}
      {tab==='페이지'&&<div className="ribbon-group wide"><em>페이지/보기</em><PageAddButton doc={doc} setDoc={setDoc} label="+ 페이지"/><PageDeleteButton doc={doc} setDoc={setDoc} label="- 페이지"/><button type="button" onClick={()=>setView(view==='fit'?'large':'fit')}>{view==='fit'?'크게 보기':'한눈 보기'}</button><button type="button" onClick={()=>jump('.preview-pane')}>미리보기로 이동</button><button type="button" onClick={()=>{setDoc({...doc,style:{...(doc.style||{}),autoFit:!(doc.style?.autoFit)}})}}>{doc.style?.autoFit?'자동 맞춤 끄기':'A4 자동 맞춤'}</button></div>}
      {tab==='저장·출력'&&<div className="ribbon-group wide export-priority"><em>저장·출력</em><button type="button" className="strong" disabled={!!busy} onClick={onPDF}>{busy==='PDF'?'PDF 만드는 중…':'PDF 저장'}</button><button type="button" className="strong" disabled={!!busy} onClick={onPNG}>{busy==='PNG'?'PNG 만드는 중…':'PNG 저장'}</button><button type="button" onClick={onSave}>현재 내용 저장</button><button type="button" onClick={onBackup}>자료 백업</button>{savedAt&&<small>{savedAt}</small>}</div>}
    </div>
  </div>
}


function BundleExportPanel({selected,setSelected,onToggle,onExport,type}){const presets=[{name:'현재 문서',docs:[type]},{name:'행사/수련회 패키지',docs:['행사 및 수련회 기획안','준비목록','행사 결과 보고서']},{name:'예배·행사 진행 패키지',docs:[CUE_DOC,'준비목록','행사 결과 보고서']}];return <details className="bundle-export-panel compact-bundle"><summary><b>묶음 PDF 만들기</b><span>자주 쓰는 묶음을 선택해 한 번에 저장합니다.</span></summary><div className="bundle-presets">{presets.map(p=><button type="button" key={p.name} onClick={()=>setSelected(p.docs.filter(t=>BUNDLE_DOC_TYPES.includes(t)))}>{p.name}</button>)}</div><div className="bundle-selected"><b>선택됨</b>{selected.map(t=><span key={t}>{t}<button onClick={()=>onToggle(t)}>×</button></span>)}{!selected.length&&<em>선택된 문서가 없습니다.</em>}</div><details className="bundle-more"><summary>문서 직접 고르기</summary><div className="bundle-checks">{BUNDLE_DOC_TYPES.map(t=><label key={t} className="check"><input type="checkbox" checked={selected.includes(t)} onChange={()=>onToggle(t)}/>{t}</label>)}</div></details><button className="btn save-btn" onClick={onExport}>선택 문서 통합 PDF 저장</button><p className="hint">수련회 자료처럼 계획안·일정표·준비목록을 한 번에 묶어 출력할 때 사용합니다.</p></details>}



function pathQuickTabFromPreviewClick(docType,path){
  const p=String(path||'');
  if(!p)return '';
  const directTab=tabIdByEditorPath(docType,p);
  if(directTab)return directTab;
  if(/^customSections\.\d+\./.test(p)){
    const m=p.match(/^customSections\.(\d+)\./);
    return m?`custom-${m[1]}`:'';
  }
  if(docType==='세부 프로그램 문서'){
    if(/programs\.\d+\.(goal)/.test(p))return 'goal';
    if(/programs\.\d+\.(method)/.test(p))return 'method';
    if(/programs\.\d+\.(materials|setup)/.test(p))return 'materials';
    if(/programs\.\d+\.(order)/.test(p))return 'order';
    if(/programs\.\d+\.(note)/.test(p))return 'note';
    if(/programs\.\d+\./.test(p)||/^(title|eventName|period|manager)$/.test(p))return 'basic';
  }
  if(docType==='행사 및 수련회 기획안'){
    if(/scheduleItems|days|startHour|endHour|slotMinutes|scheduleFontScale/.test(p))return 'p2';
    if(/incomeItems|expenseItems/.test(p))return 'p3';
    return 'p1';
  }
  if(docType==='각부 월간행사 안내'){
    if(/events\./.test(p))return 'events';
    if(/requests|prayers|footer|contact/.test(p))return 'bottom';
    return 'top';
  }
  if(docType==='예산안'){
    if(/incomeItems/.test(p))return 'income';
    if(/expenseItems/.test(p))return 'expense';
    if(/notes/.test(p))return 'notes';
    return 'basic';
  }
  if(docType==='준비목록'){
    if(/items\./.test(p))return 'items';
    if(/notes/.test(p))return 'note';
    return 'basic';
  }
  if(isCueType(docType)){
    if(/rows\./.test(p))return 'rows';
    if(/checks|notice/.test(p))return 'checks';
    return 'basic';
  }
  if(docType==='부서별 주간보고서'){
    if(/thisWeek|nextWeek/.test(p))return 'report';
    if(/special|prayer/.test(p))return 'extra';
    return 'basic';
  }
  if(docType==='부서 통합 주간보고서'){
    if(/summary|commonPrayer|support/.test(p))return 'summary';
    return 'basic';
  }
  return '';
}

function quickTabFromPreviewClick(docType,sectionKey,sectionTitle){
  const t=String(sectionTitle||'').replace(/\s+/g,'');
  const key=sectionKey||sectionQuickKey(sectionTitle,0);
  if(/^custom-\d+$/.test(String(key)))return String(key);
  const titleTab=tabIdBySectionTitle(docType,sectionTitle,0);
  if(titleTab)return titleTab;
  if(docType==='세부 프로그램 문서'){
    if(['basic','goal','method','materials','order','note','program'].includes(key))return key;
    if(/목적|기대/.test(t))return 'goal';
    if(/진행방법|방법/.test(t))return 'method';
    if(/준비물|세팅/.test(t))return 'materials';
    if(/진행순서|순서/.test(t))return 'order';
    if(/유의사항|주의/.test(t))return 'note';
    return 'basic';
  }
  if(docType==='행사 및 수련회 기획안'){
    if(key==='p2'||/일정/.test(t))return 'p2';
    if(key==='p3'||/예산|수입|지출/.test(t))return 'p3';
    return 'p1';
  }
  if(docType==='각부 월간행사 안내'){
    if(key==='events'||/일정/.test(t))return 'events';
    if(key==='bottom'||/협조|기도/.test(t))return 'bottom';
    return 'top';
  }
  if(docType==='예산안'){
    if(key==='income'||/수입/.test(t))return 'income';
    if(key==='expense'||/지출/.test(t))return 'expense';
    return 'basic';
  }
  if(docType==='준비목록'){
    if(/준비항목|체크리스트/.test(t))return 'items';
    return 'basic';
  }
  if(isCueType(docType)){
    if(/진행|순서|큐시트/.test(t))return 'rows';
    return 'basic';
  }
  if(docType==='부서별 주간보고서'){
    if(/이번|다음|활동|계획/.test(t))return 'report';
    if(/특이|기도/.test(t))return 'extra';
    return 'basic';
  }
  if(docType==='부서 통합 주간보고서'){
    if(/요약|기도|지원|요청/.test(t))return 'summary';
    return 'basic';
  }
  if(docType==='행사 결과 보고서'){
    if(/진행결과|재정|참석/.test(t))return 'result';
    if(/잘된점|보완점|후속|요청/.test(t))return 'review';
    return 'basic';
  }
  if(docType==='회의록'){
    if(/안건|결정|후속/.test(t))return 'agenda';
    return 'basic';
  }
  if(docType==='일정표'){
    if(/시간표|일정/.test(t))return 'p2';
    return 'basic';
  }
  if(docType==='기획위원회 보고서'){
    if(/요청|기도/.test(t))return 'extra';
    if(/요약|안건|결의|진행/.test(t))return 'body';
    return 'basic';
  }
  if(docType==='심방 보고서'){
    if(/심방내용|기도|후속|비고/.test(t))return 'body';
    return 'basic';
  }
  if(docType==='세미나/교육자료'){
    if(/목표|진행|핵심|질문|메모|안내/.test(t))return 'content';
    return 'basic';
  }
  if(docType==='신청서 양식'){
    if(key==='applicant'||/신청자정보/.test(t))return 'applicant';
    if(key==='details'||/신청내용|안내사항/.test(t))return 'details';
    if(key==='consent'||/개인정보|동의|서명/.test(t))return 'consent';
    return 'basic';
  }
  return 'basic';
}

const GUIDE_DOC_TIPS={
  '기본 공지 안내문':['공지 제목·일시·장소를 먼저 입력하세요.','카카오톡 공유용은 본문을 짧게 쓰고 확인사항을 카드처럼 정리하면 좋습니다.','PNG 저장 후 단체방에 올리면 이미지 안내문처럼 사용할 수 있습니다.'],
  '각부 월간행사 안내':['핵심 일정은 3~5개 정도가 가장 잘 보입니다.','확인 및 협조 요청은 줄바꿈으로 나누면 미리보기에서 깔끔하게 정리됩니다.','기도제목은 짧은 문장으로 2~3개 정도 입력하는 것을 권장합니다.'],
  '부서별 주간보고서':['부서명·기간·작성자를 먼저 입력한 뒤 이번 주 활동과 다음 주 계획을 정리하세요.','출석 숫자는 크게 보이도록 구성되어 있습니다.','표 안 글씨가 길면 문서 기본도구에서 글씨 크기를 작게 조정하세요.'],
  '부서 통합 주간보고서':['부서/팀명은 엔터 없이 입력하면 바로 반영됩니다.','교육부뿐 아니라 예배부·선교부·속회·소그룹 등으로 자유롭게 바꿀 수 있습니다.','부서별 현황의 문장이 길면 자동 줄바꿈되지만, 보고용으로는 짧게 정리하는 것이 좋습니다.'],
  '행사 및 수련회 기획안':['1쪽은 목적·개요·역할·준비사항을 정리합니다.','2쪽 일정표는 일차별로 입력하고, 필요할 때 “현재 일차 시간순 정리”를 눌러 정돈하세요.','일정이 많으면 출력 방식을 “일차별 여유형”으로 바꾸면 A4 여러 장으로 더 읽기 좋습니다.','예산은 금액 중심으로 입력하고, 필요할 때만 상세 산출을 열어 사용하세요.']
};
function BuiltInGuideModal({type,onClose,onJump}){
  const tips=GUIDE_DOC_TIPS[type]||['왼쪽에서 문서를 선택하고, 문서 편집판에서 내용을 입력하세요.','미리보기를 확인한 뒤 PDF 또는 PNG로 저장하세요.'];
  const homeUrl=appHomeUrl();
  return <div className="guide-backdrop" role="dialog" aria-modal="true" aria-label="교회문서키트 BASIC 사용법" onMouseDown={onClose}>
    <div className="guide-modal" onMouseDown={e=>e.stopPropagation()}>
      <div className="guide-head"><div><span>도움말</span><h2>교회문서키트 BASIC 사용법</h2><p>작성 중 헷갈릴 때 바로 확인하는 간단 설명서입니다.</p></div><button type="button" onClick={onClose}>닫기</button></div>
      <div className="guide-steps">
        <button type="button" onClick={()=>onJump?.('.sidebar')}><b>1</b><strong>문서 선택</strong><em>필요한 문서 5종 중 하나를 고릅니다.</em></button>
        <button type="button" onClick={()=>onJump?.('.edit-drawer',true)}><b>2</b><strong>내용 입력</strong><em>문서 편집판에서 제목·일정·표를 수정합니다.</em></button>
        <button type="button" onClick={()=>onJump?.('.preview-pane')}><b>3</b><strong>미리보기 확인</strong><em>A4 모양과 줄바꿈을 확인합니다.</em></button>
        <button type="button" onClick={()=>onJump?.('.document-ribbon .ribbon-panel-저장-출력')}><b>4</b><strong>PDF/PNG 저장</strong><em>회의자료·카톡 이미지로 저장합니다.</em></button>
      </div>
      <div className="guide-grid">
        <section><h3>현재 문서 사용 팁</h3><ul>{tips.map((t,i)=><li key={i}>{t}</li>)}</ul></section>
        <section><h3>저장·접속 안내</h3><ul><li>베타 기간에는 승인 이메일과 접속코드로 접속합니다.</li><li>계속 사용할 주소는 작성기 기본 주소입니다.</li><li>개인 PC와 본인 휴대폰에서는 로그아웃하지 않고 창만 닫아도 됩니다.</li><li>PC와 모바일을 함께 쓰려면 “PC·모바일 이어쓰기”에서 클라우드 저장 후 다른 기기에서 불러오세요.</li><li>공용 PC에서는 “공용 PC에서 로그아웃”을 눌러 주세요.</li></ul><div className="guide-url"><code>{homeUrl}</code></div></section>
        <section><h3>자주 묻는 질문</h3><dl><dt>매번 이메일 로그인해야 하나요?</dt><dd>개인 PC와 본인 휴대폰에서는 로그아웃하지 않으면 접속 상태가 유지됩니다.</dd><dt>일정표가 많으면 어떻게 하나요?</dt><dd>행사 및 수련회 기획안에서 일정표 출력 방식을 “일차별 여유형”으로 선택하세요.</dd><dt>글씨가 표 밖으로 나가면요?</dt><dd>문서 기본도구에서 글자 크기를 작게 조정하거나 문장을 짧게 나눠 주세요.</dd></dl></section>
        <section><h3>바로 이동</h3><div className="guide-actions"><button type="button" onClick={()=>onJump?.('.edit-drawer',true)}>문서 편집판 열기</button><button type="button" onClick={()=>onJump?.('.preview-pane')}>미리보기 보기</button><button type="button" onClick={()=>onJump?.('.document-ribbon')}>저장 메뉴 보기</button></div></section>
      </div>
    </div>
  </div>;
}

function AppShell({auth}){
  const [all,setAll]=useAutosave();
  const [type,setType]=useState('기본 공지 안내문');
  const [view,setView]=useState('fit');
  const [savedAt,setSavedAt]=useState('');
  const [bundleTypes,setBundleTypes]=useState(()=>['기본 공지 안내문']);
  const [fileName,setFileName]=useState('교회문서키트_BASIC_문서');
  const [busy,setBusy]=useState('');
  const [mobileSimple,setMobileSimple]=useState(true);
  const [mobileStage,setMobileStage]=useState('write');
  const [easyMode,setEasyMode]=useState(()=>{try{return localStorage.getItem('church-docs-workshop-easy-mode')!=='off'}catch{return true}});
  const [appScreen,setAppScreen]=useState(()=>{try{const seen=localStorage.getItem('church-docs-kit-basic-v1-23-dashboard-seen');if(!seen){localStorage.setItem('church-docs-kit-basic-v1-23-dashboard-seen','1');localStorage.setItem('church-docs-kit-basic-v1-screen','home');return 'home'}return localStorage.getItem('church-docs-kit-basic-v1-screen')||'home'}catch{return 'home'}});
  const [helpOpen,setHelpOpen]=useState(false);
  const [recentDocs,setRecentDocs]=useState(()=>{try{return JSON.parse(localStorage.getItem('church-docs-workshop-recent-docs')||'[]')}catch{return []}});
  useEffect(()=>{try{localStorage.setItem('church-docs-workshop-easy-mode',easyMode?'on':'off')}catch{}},[easyMode]);
  useEffect(()=>{try{localStorage.setItem('church-docs-kit-basic-v1-screen',appScreen)}catch{}},[appScreen]);
  useEffect(()=>{setRecentDocs(prev=>{const next=[type,...prev.filter(x=>x!==type)].slice(0,8);try{localStorage.setItem('church-docs-workshop-recent-docs',JSON.stringify(next))}catch{}return next})},[type]);
  const previewRef=useRef(null);
  const fontDragRef=useRef(null);
  const ignoreNextFontClickRef=useRef(false);
  const doc=all[type]||withBase(type,initialData(type));
  function clearAllPreviewFontSelections(){
    setAll(prev=>{
      let changed=false;
      const next={...prev};
      Object.entries(prev||{}).forEach(([docType,item])=>{
        const st=item?.style||{};
        if(st.activeFontTarget||(Array.isArray(st.activeFontTargets)&&st.activeFontTargets.length)||st.activeFontLabel){
          changed=true;
          next[docType]={...item,style:{...st,activeFontTarget:'',activeFontTargets:[],activeFontLabel:''}};
        }
      });
      return changed?next:prev;
    });
  }
  useEffect(()=>{
    const onPointerDown=(e)=>{
      const target=e.target;
      if(!target?.closest)return;
      if(previewRef.current?.contains(target)){
        if(!target.closest('[data-font-key]')) clearAllPreviewFontSelections();
        return;
      }
      if(target.closest('.ribbon-panel-글자,.font-detail-row,.font-quick-controls'))return;
      clearAllPreviewFontSelections();
      try{window.getSelection?.()?.removeAllRanges?.()}catch{}
    };
    const onKeyDown=(e)=>{
      if(e.key==='Escape'){
        clearAllPreviewFontSelections();
        try{window.getSelection?.()?.removeAllRanges?.()}catch{}
      }
    };
    document.addEventListener('pointerdown',onPointerDown,true);
    document.addEventListener('keydown',onKeyDown,true);
    return ()=>{
      document.removeEventListener('pointerdown',onPointerDown,true);
      document.removeEventListener('keydown',onKeyDown,true);
    };
  },[]);
  useEffect(()=>{
    // v2.10: 예전 저장자료나 링크에서 비슷한 이름으로 들어와도 대표 행사기획안 문서로 열리게 보정합니다.
    const aliases={'행사 및 수련회 계획안':'행사 및 수련회 기획안','수련회 계획안':'행사 및 수련회 기획안','행사 기획안':'행사 및 수련회 기획안'};
    if(aliases[type]){setType(aliases[type]);setBundleTypes([aliases[type]]);}
  },[type]);
  useEffect(()=>{
    const root=previewRef.current;
    enhancePreviewFontTargets(root);
    const id=requestAnimationFrame(()=>enhancePreviewFontTargets(root));
    return ()=>cancelAnimationFrame(id);
  },[all,type,bundleTypes,view]);
  const shownTypes=(bundleTypes.length&&bundleTypes.includes(type))?bundleTypes:[type];
  useEffect(()=>{try{const p=new URLSearchParams(location.search);const share=p.get('share');if(share){const payload=decodeSharePayload(share);if(payload?.type&&payload?.doc){setAll(prev=>({...prev,[payload.type]:withBase(payload.type,payload.doc)}));setType(payload.type);setBundleTypes([payload.type]);history.replaceState(null,'',location.pathname)}}}catch(e){console.warn('공유 링크를 불러오지 못했습니다.',e)}},[]);
  function v219CaptureEditorPanelState(){
    const panel=document.querySelector('.form-pane.compact-form-pane')||document.querySelector('.form-pane');
    const active=document.activeElement;
    const fieldWrap=active?.closest?.('[data-editor-path]');
    const activePath=fieldWrap?.getAttribute?.('data-editor-path')||'';
    const isTextControl=active&&/^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName||'');
    return {
      top:panel?.scrollTop||0,
      left:panel?.scrollLeft||0,
      activePath,
      tag:active?.tagName||'',
      selectionStart:isTextControl&&typeof active.selectionStart==='number'?active.selectionStart:null,
      selectionEnd:isTextControl&&typeof active.selectionEnd==='number'?active.selectionEnd:null
    };
  }
  function v219RestoreEditorPanelState(state){
    if(!state)return;
    const restore=()=>{
      const panel=document.querySelector('.form-pane.compact-form-pane')||document.querySelector('.form-pane');
      if(panel){panel.scrollTop=state.top||0;panel.scrollLeft=state.left||0;}
      if(state.activePath){
        try{
          const key=CSS.escape(String(state.activePath));
          const target=document.querySelector(`[data-editor-path="${key}"] input,[data-editor-path="${key}"] textarea,[data-editor-path="${key}"] select`);
          if(target&&document.activeElement!==target){target.focus({preventScroll:true});}
          if(target&&typeof target.setSelectionRange==='function'&&state.selectionStart!==null){
            const len=String(target.value||'').length;
            const st=Math.min(state.selectionStart,len), en=Math.min(state.selectionEnd??state.selectionStart,len);
            target.setSelectionRange(st,en);
          }
        }catch{}
      }
    };
    restore();
    requestAnimationFrame(restore);
    setTimeout(restore,50);
  }
  function setDoc(next){const state=v219CaptureEditorPanelState();setAll({...all,[type]:withBase(type,next)});v219RestoreEditorPanelState(state)}
  function commitPreviewEditElement(el){
    if(!el||!previewRef.current?.contains(el))return;
    const path=el.getAttribute('data-edit-path');
    if(!path)return;
    const editType=el.closest('[data-doc-type]')?.getAttribute('data-doc-type')||type;
    const editDoc=all[editType]||withBase(editType,initialData(editType));
    let value=editableCommitValue(el);
    if(editType==='부서행사 진행표(캘린더형)'&&path==='month')value=parseMonth(value);
    if(String(getByPath(editDoc,path)??'')===String(value??''))return;
    setAll(prev=>{
      const liveDoc=prev[editType]||withBase(editType,initialData(editType));
      if(String(getByPath(liveDoc,path)??'')===String(value??''))return prev;
      return {...prev,[editType]:withBase(editType,setByPath(liveDoc,path,value))};
    });
  }
  function handlePreviewBlur(e){
    const el=e.target.closest?.('[data-edit-path]');
    if(el&&previewRef.current?.contains(el)){
      commitPreviewEditElement(el);
      el.classList?.remove('preview-inline-editing');
      setSavedAt('미리보기 수정 내용이 저장되었습니다');
    }
  }
  function handlePreviewBeforeInput(e){
    // v2.22: 기본 모드에서도 미리보기 직접 수정 허용.
    // 입력 중에는 상태를 즉시 갱신하지 않고, blur/Enter 시점에만 저장해 React 재렌더링 충돌을 줄입니다.
    const el=e.target.closest?.('[data-edit-path]');
    if(!el||!previewRef.current?.contains(el))return;
  }
  function handlePreviewFocus(e){
    const el=e.target.closest?.('[data-edit-path]');
    if(el&&previewRef.current?.contains(el)){
      el.classList?.add('preview-inline-editing');
    }
  }
  function handlePreviewEditKeyDown(e){
    if(e.key!=='Enter')return;
    const el=e.target.closest?.('[data-edit-path]');
    if(!el||!previewRef.current?.contains(el))return;
    // 미리보기 직접 수정에서는 Enter를 명확한 줄바꿈으로 고정합니다.
    // 특히 span 기반 편집칸은 브라우저가 첫 Enter를 임시 DOM으로 처리하다가
    // React 리렌더링 시 원래 값으로 돌아가지 않도록 저장은 blur 시점으로 미룹니다.
    e.preventDefault();
    const ok=insertEditableLineBreak(el);
    if(!ok)return;
    // Enter 직후에는 바로 저장/리렌더링하지 않습니다.
    // 그래야 첫 Enter가 즉시 다음 줄로 보이고, 이어서 입력할 수 있습니다.
    // 실제 저장은 blur 시점에 처리됩니다.
    setSavedAt('미리보기에서 줄바꿈을 입력했습니다');
  }
  function handlePreviewFontSelect(e){
    if(ignoreNextFontClickRef.current){ignoreNextFontClickRef.current=false;return;}
    // 클릭은 내용 수정에만 사용합니다. 글자 크기 조절 대상은 드래그/텍스트 선택으로 자동 지정됩니다.
  }
  function applyPreviewFontSelection(keys,labels,targetType){
    if(!keys?.length)return;
    const targetDoc=all[targetType]||withBase(targetType,initialData(targetType));
    const st={...baseExtras('').style,...(targetDoc.style||{})};
    setAll({...all,[targetType]:withBase(targetType,{...targetDoc,style:{...st,activeFontTarget:keys[0],activeFontTargets:keys,activeFontLabel:keys.length>1?`${keys.length}개 글씨 영역`:prettyFontLabel(keys[0],labels?.[0])}})});
    if(targetType!==type)setType(targetType);
  }
  function handlePreviewFontDragStart(e){
    if(e.button!==0||!previewRef.current?.contains(e.target))return;
    fontDragRef.current={x:e.clientX,y:e.clientY};
  }
  function selectFontTargetsByRect(e){
    const root=previewRef.current;
    const start=fontDragRef.current;
    fontDragRef.current=null;
    if(!root||!start)return false;
    const dx=Math.abs(e.clientX-start.x),dy=Math.abs(e.clientY-start.y);
    if(dx<8&&dy<8)return false;
    const rect={left:Math.min(start.x,e.clientX),right:Math.max(start.x,e.clientX),top:Math.min(start.y,e.clientY),bottom:Math.max(start.y,e.clientY)};
    const candidates=Array.from(root.querySelectorAll('[data-font-key]')).filter(el=>{
      const r=el.getBoundingClientRect();
      if(r.width<1||r.height<1)return false;
      return !(r.right<rect.left||r.left>rect.right||r.bottom<rect.top||r.top>rect.bottom);
    });
    if(!candidates.length)return false;
    const leafTargets=candidates.filter(el=>!candidates.some(other=>other!==el&&el.contains(other)));
    const targetType=leafTargets[0]?.closest('[data-doc-type]')?.getAttribute('data-doc-type')||type;
    const sameDoc=leafTargets.filter(el=>(el.closest('[data-doc-type]')?.getAttribute('data-doc-type')||type)===targetType);
    const keys=Array.from(new Set(sameDoc.map(el=>el.getAttribute('data-font-key')).filter(Boolean))).slice(0,120);
    const labels=sameDoc.map(el=>el.getAttribute('data-font-label')||'').filter(Boolean);
    if(keys.length){applyPreviewFontSelection(keys,labels,targetType);ignoreNextFontClickRef.current=true;return true;}
    return false;
  }
  function handlePreviewRangeFontSelect(e){
    const root=previewRef.current;
    if(!root){fontDragRef.current=null;return;}
    const sel=window.getSelection?.();
    if(sel&&sel.rangeCount&&!sel.isCollapsed){
      const range=sel.getRangeAt(0);
      const candidates=Array.from(root.querySelectorAll('[data-font-key]')).filter(el=>{
        try{return range.intersectsNode(el)}catch{return false}
      });
      if(candidates.length){
        const leafTargets=candidates.filter(el=>!candidates.some(other=>other!==el&&el.contains(other)));
        const targetType=leafTargets[0]?.closest('[data-doc-type]')?.getAttribute('data-doc-type')||type;
        const sameDoc=leafTargets.filter(el=>(el.closest('[data-doc-type]')?.getAttribute('data-doc-type')||type)===targetType);
        const keys=Array.from(new Set(sameDoc.map(el=>el.getAttribute('data-font-key')).filter(Boolean))).slice(0,80);
        if(keys.length){
          const labels=sameDoc.map(el=>el.getAttribute('data-font-label')||'').filter(Boolean);
          applyPreviewFontSelection(keys,labels,targetType);
          fontDragRef.current=null;
          return;
        }
      }
    }
    if(selectFontTargetsByRect(e)){e.preventDefault();return;}
    fontDragRef.current=null;
  }
  function v211CaptureScrollState(){
    const nodes=[window,document.documentElement,document.body,previewRef.current,document.querySelector('.preview-pane'),document.querySelector('.workspace.preview-first-workspace')].filter(Boolean);
    return nodes.map(node=>{
      if(node===window)return {node,top:window.scrollY||0,left:window.scrollX||0,kind:'window'};
      return {node,top:node.scrollTop||0,left:node.scrollLeft||0,kind:'el'};
    });
  }
  function v211RestoreScrollState(state){
    (state||[]).forEach(item=>{
      try{
        if(item.kind==='window') window.scrollTo(item.left,item.top);
        else { item.node.scrollTop=item.top; item.node.scrollLeft=item.left; }
      }catch{}
    });
  }
  function v211LockPreviewScroll(state){
    const restore=()=>v211RestoreScrollState(state);
    restore();
    requestAnimationFrame(restore);
    [40,100,180,320,520].forEach(ms=>setTimeout(restore,ms));
  }
  function handlePreviewJump(e){
    const root=previewRef.current;
    const target=e.target;
    if(!root||!target?.closest)return;
    if(!target.closest('[data-font-key]')) clearAllPreviewFontSelections();
    // v2.9: 표/일정표 내부를 클릭해도 가장 가까운 문서 섹션(data-edit-block)으로 올려서 찾습니다.
    const pathEl=target.closest('[data-edit-path]');
    // v2.22: 기본 모드에서도 미리보기 글자를 직접 수정합니다.
    // 글자 영역을 클릭한 경우에는 편집에 집중하고, 빈 여백/카드 영역을 클릭한 경우에만 오른쪽 편집판으로 이동합니다.
    if(pathEl && (pathEl.isContentEditable || pathEl.closest?.('[contenteditable="true"]')))return;
    const sectionEl=target.closest('[data-edit-block],[data-block-id],[data-quick-key],.preview-jump-section,.doc-section');
    const looseEl=target.closest('.doc-header,.money-summary,.doc-table,.smart-schedule,.schedule-table-section,.program-card,.notice-card,.event-card,.monthly-event-card,.info-grid,.text-box,.plain-list');
    let chosen=pathEl || sectionEl || looseEl;
    if(looseEl && !looseEl.getAttribute?.('data-edit-block') && !looseEl.getAttribute?.('data-block-id') && !looseEl.getAttribute?.('data-quick-key')){
      chosen=looseEl.closest('[data-edit-block],[data-block-id],[data-quick-key],.preview-jump-section,.doc-section') || pathEl || looseEl;
    }
    if(!chosen||!root.contains(chosen))return;
    const scrollState=v211CaptureScrollState();
    const docRoot=chosen.closest('[data-doc-type]') || target.closest('[data-doc-type]');
    const docType=docRoot?.getAttribute('data-doc-type') || type;
    const sectionForTitle=chosen.closest?.('.preview-jump-section,.doc-section,[data-edit-block]') || chosen;
    const title=sectionForTitle.getAttribute?.('data-section-title') || sectionForTitle.querySelector?.('h2,.section-title-text,h1,b')?.textContent || chosen.getAttribute?.('data-font-label') || '';
    const rawKey=sectionForTitle.getAttribute?.('data-edit-block') || sectionForTitle.getAttribute?.('data-block-id') || sectionForTitle.getAttribute?.('data-quick-key') || chosen.getAttribute?.('data-edit-block') || chosen.getAttribute?.('data-block-id') || chosen.getAttribute?.('data-quick-key') || '';
    const path=pathEl?.getAttribute('data-edit-path') || '';
    const sectionIdx=Number(sectionForTitle.getAttribute?.('data-section-idx'))||0;
    const key=rawKey || sectionQuickKey(title,sectionIdx);
    const tab=pathQuickTabFromPreviewClick(docType,path) || quickTabFromPreviewClick(docType,key,title);
    if(!tab)return;
    e.preventDefault?.();
    e.stopPropagation?.();
    const label=title || path || tab;
    const detail={type:docType,tab,quickKey:key,path,label,lockPreview:true};
    const dispatch=()=>window.dispatchEvent(new CustomEvent('docworkshop:quick-tab',{detail}));
    if(docType!==type){setType(docType);setBundleTypes(prev=>prev.includes(docType)?prev:[docType]);setTimeout(dispatch,180);} else dispatch();
    const highlight=sectionForTitle.closest?.('.preview-jump-section') || sectionForTitle;
    highlight.classList?.add('preview-jump-selected');
    setTimeout(()=>highlight.classList?.remove('preview-jump-selected'),1100);
    const drawer=document.querySelector('.edit-drawer');
    if(drawer)drawer.open=true;
    v211LockPreviewScroll(scrollState);
  }
  function resetDoc(){if(confirm('현재 작성 중인 내용이 대표 샘플 내용으로 바뀝니다.\n계속하시겠습니까?'))setDoc(withBase(type,initialData(type)))}
  function startBlank(){if(confirm('현재 작성 중인 내용이 비워집니다.\n빈 양식으로 다시 시작하시겠습니까?'))setDoc(blankDocFor(type))}
  function saveNow(){if(!saveToStorage(all)){setSavedAt('저장 실패 · 자료 내보내기를 이용해 주세요');return}const t=new Date();setSavedAt(`${String(t.getHours()).padStart(2,'0')}:${String(t.getMinutes()).padStart(2,'0')} 저장됨`)}
  function exportData(){const url=URL.createObjectURL(new Blob([JSON.stringify(all,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='church-docs-data.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),0);setSavedAt('백업 파일을 저장했습니다')}
  async function shareCurrent(){try{const url=`${location.origin}${location.pathname}?share=${encodeSharePayload({type,doc})}`;if(url.length>60000)throw new Error('링크가 너무 깁니다.');if(!navigator.clipboard?.writeText)throw new Error('클립보드를 사용할 수 없습니다.');await navigator.clipboard.writeText(url);setSavedAt('공유 링크가 복사되었습니다')}catch{setSavedAt('공유 링크 실패 · 자료 내보내기를 이용해 주세요')}}
  function toggleBundle(t){setBundleTypes(prev=>prev.includes(t)?prev.filter(x=>x!==t):[...prev,t])}
  function importData(e){const input=e.target;const f=input.files?.[0];if(!f)return;const r=new FileReader();r.onload=()=>{try{const parsed=JSON.parse(r.result);if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error('잘못된 자료 형식');setAll(merge(parsed));setSavedAt('자료를 가져왔습니다')}catch{setSavedAt('가져오기 실패 · JSON 백업 파일을 확인해 주세요.')}finally{input.value=''}};r.onerror=()=>{setSavedAt('파일을 읽지 못했습니다');input.value=''};r.readAsText(f)}
  const exportName=shownTypes.length>1?'교회문서키트_BASIC_선택문서':type;
  useEffect(()=>{setFileName(exportName)},[exportName]);
  const safeFileName=sanitize(fileName||exportName);
  async function runExport(kind){if(busy)return;setBusy(kind);setSavedAt(`${kind} 만드는 중…`);try{if(kind==='PDF')await exportPDF(previewRef,exportName,safeFileName);else await exportPNG(previewRef,exportName,safeFileName);setSavedAt(`${kind} 저장을 시작했습니다`)}catch(e){console.error(`${kind} 저장 실패`,e);setSavedAt(`${kind} 저장 실패 · 다시 시도해 주세요`)}finally{setBusy('')}}
  function openDashboardDoc(nextType){
    const t=nextType||type||'기본 공지 안내문';
    setType(t);
    setBundleTypes(defaultBundleFor(t));
    setAppScreen('writer');
    requestAnimationFrame(()=>document.querySelector('.edit-drawer')?.setAttribute('open',''));
  }
  function loadDashboardCloudDocument(loaded){
    const merged=merge(loaded.data);
    const nextType=loaded.doc_type||type||'기본 공지 안내문';
    setAll(merged);
    setType(nextType);
    setBundleTypes(Array.isArray(loaded.bundle_types)&&loaded.bundle_types.length?loaded.bundle_types:[nextType]);
    saveToStorage(merged);
    setSavedAt('클라우드 문서를 불러왔습니다');
    setAppScreen('writer');
  }
  if(appScreen==='home')return <ProductDashboard auth={auth} currentType={type} recentDocs={recentDocs} onOpenDoc={openDashboardDoc} onOpenWriter={()=>setAppScreen('writer')} onLoadDocument={loadDashboardCloudDocument}/>;
  return <div className={`app basic-product-app v61-simple-compose v62-polished-ui v63-layout-fix v98-schedule-day-editor v99-preview-sync-layout v100-a4-editor-stabilize v101-edit-spacing-stable v102-schedule-draft-confirm v103-input-mobile-fix v104-cuesheet-schedule-plan-fix v105-final-layout-fix v106-plan-cue-final v107-final-schedule-polish v108-prep-a4-safe v109-page-section-add v110-page-delete v111-result-preview-fix v114-intuitive-input-panel v117-schedule-preset-cleanup v118-preview-toolbar v1-1-mobile-simple v1-2-mobile-unified v1-3-korean-input-stable v1-4-export-size-stable v1-9-monthly-line-editor v1-10-global-font-scale v1-11-hwp-ribbon v1-12-export-font-lock v1-13-preview-font-select v1-14-ribbon-menu-plus v1-15-drag-font-size v1-16-clean-ribbon-design v1-17-practical-design-drag v1-18-selection-clear v1-18-monthly-prayer-lines v1-19-simple-preview-edit v1-22-ribbon-font-compact v1-23-auto-font-select v1-24-font-target-all v1-25-table-font-adjust v1-26-edit-linebreak-stable v1-27-edu-attendance-number v1-28-kakao-modern v1-29-program-hwp-menu v1-30-first-use-friendly v1-31-simple-workflow v1-32-stable-admin v1-33-input-stability v1-34-smart-organize v1-35-smart-schema v1-36-admin-fast v1-37-universal-compose v2-admin-zero-error v2-1-pro-sample v2-2-preview-focused v2-3-page-tabs v2-4-preview-linked v2-4-mobile-lite v2-5-page-editor v2-6-block-editor v2-7-block-link v2-8-admin-forms v2-9-preview-a4-fix v2-10-no-page-scroll v2-10-doc-open-fix v2-11-scroll-lock v2-11-plan-open-fix v2-11-2-a4-program-fix v2-11-3-preview-click-fix v2-13-monthly-a4-safe v2-14-annual-form-fix v2-15-monthly-onepage-fit v2-16-monthly-fuller-onepage v2-17-onepage-autofit v2-18-monthly-5-full-sample v2-19-editor-panel-stable v2-20-preview-edit-safe v2-22-tools-panel-simple v2-23-monthly-onepage-polish v2-24-monthly-usability v2-25-monthly-period-date v2-26-editor-tools-monthly-split v2-27-pdf-monthly-input-emoji v2-28-work-tools-overlap-fix v2-29-schedule-editor-more-fix v2-30-schedule-editor-fit v2-31-schedule-font-control v2-32-mobile-flow v2-33-mobile-top-actions-fix v2-34-mobile-simple-docs v2-35-mobile-direct-export v2-36-mobile-quick-write v2-37-editor-stability v-basic-1-26-mobile-easy v-basic-1-24-otp-login v-basic-1-23-dashboard-stable v-basic-1-20-cloud-sync v-basic-1-19-enter-linebreak v-basic-1-16-guide-built-in v-basic-1-15-sales-ready v-basic-1-14-schedule-time-readable v-basic-1-13-final-polish v-basic-1-12-usability-final v-basic-1-11-final-stabilize v-basic-1-9-editor-layout-fix v-basic-1-8-time-weekly-fix v-basic-1-7-schedule-select-time v-basic-1-6-schedule-time-polish v-basic-1-5-schedule-dept-polish v-basic-1-4-complete-set v-basic-1-2-pwa-usability v-basic-1-0-8-email-auth v-basic-1-0-7-unified-design mobile-stage-${mobileStage} ${easyMode?'easy-mode':'advanced-mode'} ${mobileSimple?'mobile-simple-on':'mobile-detail-on'}`}> 
    <aside className="sidebar">
      <div className="brand"><b>교회문서키트</b><span>BASIC 작성기</span></div>
      <div className="select-help"><b>문서 선택</b><span>공지문·월간행사·주간보고·수련회 기획안 5종을 제공합니다.</span></div><AssistantStartPanel type={type} setType={setType} setSelected={setBundleTypes} recentDocs={recentDocs}/>
      {CATEGORIES.map(cat=><div className="menu-group" key={cat.name}><h4>{cat.name}</h4>{cat.types.map(t=><DocMenuItem key={t} t={t} type={type} setType={setType} selected={bundleTypes} onToggle={toggleBundle} setSelected={setBundleTypes}/>)}</div>)}
    </aside>
    <main className="editor">
      <div className="topbar simple-topbar">
        <button type="button" className="back-dashboard-btn" onClick={()=>setAppScreen('home')}>← 홈</button>
        <div className="top-title"><h2>{type}</h2><p>반복되는 교회 문서를 10분 안에 작성하고 PDF/PNG로 저장합니다.</p></div>
        <div className="actions primary-actions">
          <button type="button" className="help-main-button" onClick={()=>setHelpOpen(true)}>사용법</button>
          {easyMode? <>
            <button onClick={()=>setView(view==='fit'?'large':'fit')}>{view==='fit'?'크게보기':'한눈보기'}</button>
            <button className="save-btn" onClick={saveNow}>저장하기</button>
            <button type="button" className="sample-reset-btn" onClick={resetDoc}>대표 샘플로 되돌리기</button>
            <button className="strong-export" disabled={!!busy} onClick={()=>runExport('PDF')}>{busy==='PDF'?'PDF 만드는 중…':'PDF 저장'}</button>
            <button disabled={!!busy} onClick={()=>runExport('PNG')}>{busy==='PNG'?'PNG 만드는 중…':'PNG 저장'}</button>
            <button type="button" className="advanced-toggle-top" onClick={()=>setEasyMode(false)}>더 자세히 수정하기</button>
            {savedAt&&<span className="save-status">{savedAt}</span>}
          </> : <>
            <button onClick={()=>setView(view==='fit'?'large':'fit')}>{view==='fit'?'크게보기':'한눈보기'}</button>
            <button className="save-btn" onClick={saveNow}>저장하기</button>
            {savedAt&&<span className="save-status">{savedAt}</span>}
            <label className="export-name-field"><span>저장 파일명</span><input value={fileName} onChange={e=>setFileName(e.target.value)} placeholder={exportName}/></label>
            <button disabled={!!busy} onClick={()=>runExport('PDF')}>{busy==='PDF'?'PDF 만드는 중…':'PDF 저장'}</button>
            <button disabled={!!busy} onClick={()=>runExport('PNG')}>{busy==='PNG'?'PNG 만드는 중…':'PNG 저장'}</button>
            <details className="more-actions"><summary>더보기</summary><div><button onClick={shareCurrent}>공유 링크</button><button onClick={exportData}>자료 내보내기</button><label className="file-btn">가져오기<input type="file" accept=".json" onChange={importData}/></label><button onClick={resetDoc}>대표 샘플로 되돌리기</button><button onClick={startBlank}>빈 양식으로 시작</button></div></details>
          </>}
        </div>
      </div>
      <MobileQuickStartPanel type={type} setStage={setMobileStage} onHome={()=>setAppScreen('home')}/>
      <CloudSyncPanel auth={auth} all={all} setAll={setAll} type={type} setType={setType} bundleTypes={bundleTypes} setBundleTypes={setBundleTypes} setSavedAt={setSavedAt}/>
      <FirstUsePanel type={type} setType={setType} setSelected={setBundleTypes} easyMode={easyMode} setEasyMode={setEasyMode} busy={busy} onPDF={()=>runExport('PDF')} onPNG={()=>runExport('PNG')} savedAt={savedAt}/>
      <MobileDocPicker type={type} setType={setType} setSelected={setBundleTypes} setStage={setMobileStage}/>
      <MobileNotice/>
      <MobileModeBar stage={mobileStage} setStage={setMobileStage}/>
      <MobileQuickEdit type={type} doc={doc} setDoc={setDoc} setStage={setMobileStage} mobileSimple={mobileSimple} setMobileSimple={setMobileSimple}/><MobileExportPanel busy={busy} onPDF={()=>runExport('PDF')} onPNG={()=>runExport('PNG')} savedAt={savedAt}/>
      <DocumentRibbon type={type} doc={doc} setDoc={setDoc} view={view} setView={setView} busy={busy} onPDF={()=>runExport('PDF')} onPNG={()=>runExport('PNG')} onSave={saveNow} onBackup={exportData} onShare={shareCurrent} onSample={resetDoc} onBlank={startBlank} onImport={importData} savedAt={savedAt} onHelp={()=>setHelpOpen(true)}/>
      <div className="workspace preview-first-workspace">
        <section className="form-pane compact-form-pane"><details className="edit-drawer v22-controller-drawer" open><summary><b>문서 편집판</b><span>미리보기에서 선택한 페이지·섹션·표를 수정합니다.</span></summary><GenericEditor type={type} doc={doc} setDoc={setDoc} selectedTypes={bundleTypes} allDocs={all} setAllDocs={setAll}/></details></section>
        <section className="preview-pane">
          <div className="preview-head"><div><b>완성 미리보기</b><small>{shownTypes.length>1?`${shownTypes.length}개 문서가 하나의 자료로 묶여 보입니다.`:(easyMode?'미리보기 글자를 바로 수정할 수 있습니다. 빈 여백을 클릭하면 오른쪽 편집판으로 이동합니다.':'더 자세히 수정하는 화면에서는 미리보기 글자도 직접 수정할 수 있습니다.')}</small></div><div className="preview-head-actions"><button type="button" className="preview-reset-btn" onClick={()=>previewRef.current?.scrollTo?.({top:0,left:0,behavior:'smooth'})}>맨 위로</button><PageAddButton doc={doc} setDoc={setDoc} label="+ 페이지 추가"/><PageDeleteButton doc={doc} setDoc={setDoc} label="- 페이지 삭제"/><span>{view==='fit'?'A4 전체 한눈보기':'A4 실제 비율 크게보기'}</span></div></div>
          <div className={'preview-wrap '+view} ref={previewRef} onBlurCapture={handlePreviewBlur} onBeforeInputCapture={handlePreviewBeforeInput} onFocusCapture={handlePreviewFocus} onKeyDownCapture={handlePreviewEditKeyDown} onClickCapture={handlePreviewJump} onMouseDownCapture={easyMode?undefined:handlePreviewFontDragStart} onMouseUpCapture={easyMode?undefined:handlePreviewRangeFontSelect}><PreviewDirectEditContext.Provider value={true}><SelectedDocsPreview types={shownTypes} all={all} currentType={type}/></PreviewDirectEditContext.Provider></div>
        </section>
      </div>
      <MobileBottomNav stage={mobileStage} setStage={setMobileStage} onHome={()=>setAppScreen('home')}/>
    </main>
    {helpOpen&&<BuiltInGuideModal type={type} onClose={()=>setHelpOpen(false)} onJump={(selector,open)=>{setHelpOpen(false);setTimeout(()=>scrollToMobileTarget(selector,open),60)}}/>}
  </div>
}


const BETA_ROLE_OPTIONS=['담임목사','부목사/전도사','교육부 담당자','교회학교 부장','교사','청년부/청소년부 리더','행정간사','평신도 사역자','기타'];
const BETA_DOC_OPTIONS=['기본 공지 안내문','각부 월간행사 안내','부서별 주간보고서','부서 통합 주간보고서','행사 및 수련회 기획안'];
const BETA_DEVICE_OPTIONS=['윈도우 PC','Mac','태블릿','스마트폰','아직 모르겠습니다'];

function BetaApplyPage(){
  const [form,setForm]=useState({name:'',church:'',role:'',phone:'',email:'',documents:[],device:'',message:'',consent:false});
  const [status,setStatus]=useState('idle');
  const [error,setError]=useState('');
  const [saved,setSaved]=useState(null);
  function update(key,value){setForm(prev=>({...prev,[key]:value}))}
  function toggleDoc(doc){setForm(prev=>({
    ...prev,
    documents:prev.documents.includes(doc)?prev.documents.filter(x=>x!==doc):[...prev.documents,doc]
  }))}
  async function submit(e){
    e.preventDefault();
    setError('');setSaved(null);setStatus('saving');
    try{
      const data=await submitBetaApplication(form);
      setSaved(data?.application||{});
      setStatus('done');
    }catch(e){
      setStatus('idle');
      setError(readableSupabaseError(e));
    }
  }
  const home=appHomeUrl().replace(/\/(apply|admin)\/?$/,'');
  return <div className="beta-public-page beta-apply-page">
    <div className="beta-hero-card">
      <div className="auth-logo">✚</div>
      <p className="beta-eyebrow">교회문서키트 BASIC</p>
      <h1>베타테스터 신청</h1>
      <p>교회 공지문, 주간보고서, 월간행사 안내, 행사 및 수련회 기획안을 웹에서 작성하고 PDF/PNG로 저장하는 교회 실무자용 문서 작성기입니다.</p>
      <div className="beta-hero-actions"><a href={home}>작성기 로그인 화면</a><a href="/admin">관리자 승인 화면</a></div>
    </div>
    <form className="beta-form-card" onSubmit={submit}>
      <h2>신청 정보</h2>
      <p className="beta-muted">선정되신 분은 아래 이메일 주소로 작성기 사용 권한이 등록됩니다.</p>
      <div className="beta-grid two">
        <label><span>이름 *</span><input value={form.name} onChange={e=>update('name',e.target.value)} placeholder="홍길동" required /></label>
        <label><span>교회명</span><input value={form.church} onChange={e=>update('church',e.target.value)} placeholder="예: 부천오정교회" /></label>
      </div>
      <div className="beta-grid two">
        <label><span>사역/직분</span><select value={form.role} onChange={e=>update('role',e.target.value)}><option value="">선택해 주세요</option>{BETA_ROLE_OPTIONS.map(x=><option key={x} value={x}>{x}</option>)}</select></label>
        <label><span>연락처 *</span><input value={form.phone} onChange={e=>update('phone',e.target.value)} placeholder="010-0000-0000" required /></label>
      </div>
      <div className="beta-grid two">
        <label><span>로그인용 이메일 *</span><input type="email" value={form.email} onChange={e=>update('email',e.target.value)} placeholder="name@example.com" required /></label>
        </div>
      <fieldset className="beta-checks"><legend>테스트해보고 싶은 문서</legend>{BETA_DOC_OPTIONS.map(doc=><label key={doc}><input type="checkbox" checked={form.documents.includes(doc)} onChange={()=>toggleDoc(doc)} /> <span>{doc}</span></label>)}</fieldset>
      <label><span>남기고 싶은 말</span><textarea value={form.message} onChange={e=>update('message',e.target.value)} rows={4} placeholder="평소 교회 문서 작성에서 불편했던 점이나 기대하는 점을 적어주세요." /></label>
      <label className="beta-consent"><input type="checkbox" checked={form.consent} onChange={e=>update('consent',e.target.checked)} required /> <span>베타테스트 접속 안내와 피드백 확인을 위해 이름, 교회명, 연락처, 이메일 주소를 수집하는 것에 동의합니다.</span></label>
      {error&&<div className="beta-error">{error}</div>}
      {status==='done'&&<div className="beta-success"><b>신청이 완료되었습니다.</b><br/>관리자가 승인하면 입력하신 이메일로 작성기 로그인이 가능해집니다. 신청 이메일: {saved?.email||form.email}</div>}
      <button className="beta-primary" disabled={status==='saving'}>{status==='saving'?'신청 저장 중…':'베타테스터 신청하기'}</button>
    </form>
  </div>
}

function BetaAdminPage(){
  const [passcode,setPasscode]=useState(()=>{try{return sessionStorage.getItem('church-docs-kit-admin-passcode')||''}catch{return ''}});
  const [apps,setApps]=useState([]);
  const [status,setStatus]=useState('idle');
  const [error,setError]=useState('');
  const [copiedId,setCopiedId]=useState('');
  async function refresh(e){
    e?.preventDefault?.();
    setStatus('loading');setError('');
    try{
      const data=await loadBetaApplications(passcode);
      try{sessionStorage.setItem('church-docs-kit-admin-passcode',passcode)}catch{}
      setApps(data?.applications||[]);
      setStatus('ready');
    }catch(e){setStatus('idle');setError(readableSupabaseError(e));}
  }
  async function handleAction(app,action){
    const label=action==='approve'?'승인':action==='reject'?'거절':'대기 전환';
    if(!confirm(`${app.name||app.email} 신청을 ${label} 처리할까요?`))return;
    setStatus('working');setError('');
    try{await updateBetaApplication(passcode,app.id,action);await refresh();}
    catch(e){setStatus('ready');setError(readableSupabaseError(e));}
  }
  function mailText(app){
    const base=appHomeUrl().replace(/\/admin\/?$/,'');
    return `안녕하세요. ${app.name||''}님.\n\n교회문서키트 BASIC 베타테스터로 선정되셨습니다.\n아래 작성기 주소로 접속하신 뒤, 신청하신 이메일(${app.email})과 안내받은 접속코드로 접속해 주세요.\n\n작성기 주소:\n${base}\n\n사용 방법:\n1. 작성기 주소에 접속합니다.\n2. 신청하신 이메일을 입력합니다.\n3. 관리자가 안내한 접속코드를 입력합니다.\n4. 작성기 화면이 열리면 문서를 선택해 작성합니다.\n5. PDF 또는 PNG로 저장해봅니다.\n\n중요 안내:\n- 베타 기간에는 승인 이메일과 접속코드로 접속합니다.\n- 접속 후에는 작성기 기본 주소를 즐겨찾기 또는 바탕화면 바로가기로 저장해 주세요.\n- 개인 PC와 본인 휴대폰에서는 로그아웃하지 않고 창만 닫으셔도 됩니다.\n- 공용 PC에서 사용하신 경우에만 “공용 PC에서 로그아웃”을 눌러주세요.\n\n감사합니다.`;
  }
  async function copyMail(app){
    try{await copyTextToClipboard(mailText(app));setCopiedId(app.id);setTimeout(()=>setCopiedId(''),1800)}
    catch{alert(mailText(app))}
  }
  const counts=apps.reduce((m,a)=>{m[a.status]=(m[a.status]||0)+1;return m},{})
  return <div className="beta-public-page beta-admin-page">
    <div className="beta-hero-card admin">
      <div className="auth-logo">✚</div>
      <p className="beta-eyebrow">교회문서키트 BASIC</p>
      <h1>베타 신청 관리</h1>
      <p>신청자 목록을 확인하고 승인 버튼으로 작성기 사용 권한을 자동 등록합니다.</p>
      <div className="beta-status-pills"><span>대기 {counts.pending||0}</span><span>승인 {counts.approved||0}</span><span>거절 {counts.rejected||0}</span></div>
    </div>
    <form className="beta-admin-login" onSubmit={refresh}>
      <label><span>관리자 비밀번호</span><input type="password" value={passcode} onChange={e=>setPasscode(e.target.value)} placeholder="Vercel ADMIN_PASSCODE" /></label>
      <button className="beta-primary" disabled={status==='loading'||status==='working'}>{status==='loading'?'불러오는 중…':'신청자 목록 불러오기'}</button>
      <a className="beta-secondary-link" href="/apply">신청 페이지 보기</a>
    </form>
    {error&&<div className="beta-error wide">{error}</div>}
    <div className="beta-admin-note"><b>승인</b>을 누르면 해당 이메일이 <code>allowed_users</code>에 <code>plan=beta</code>로 자동 등록됩니다. 안내문 복사는 메일 발송용 문구만 복사합니다.</div>
    <div className="beta-list">
      {apps.length===0?<div className="beta-empty">아직 불러온 신청자가 없습니다.</div>:apps.map(app=><article className={`beta-app-card status-${app.status||'pending'}`} key={app.id}>
        <header><div><b>{app.name||'(이름 없음)'}</b><span>{app.church||'교회명 없음'} · {app.role||'직분 미입력'}</span></div><em>{app.status==='approved'?'승인됨':app.status==='rejected'?'거절됨':'대기중'}</em></header>
        <p className="beta-email">{app.email}</p>{app.phone&&<p><b>연락처</b> {app.phone}</p>}
        <p><b>희망 문서</b> {(app.documents||[]).join(', ')||'미선택'}</p>
        <p><b>사용 기기</b> {app.device||'미입력'}</p>
        {app.message&&<blockquote>{app.message}</blockquote>}
        <small>신청일: {app.created_at?new Date(app.created_at).toLocaleString('ko-KR'):''}</small>
        <div className="beta-card-actions">
          <button onClick={()=>handleAction(app,'approve')} disabled={status==='working'}>승인 및 등록</button>
          <button onClick={()=>handleAction(app,'pending')} disabled={status==='working'}>대기</button>
          <button onClick={()=>handleAction(app,'reject')} disabled={status==='working'}>거절</button>
          <button className="copy" onClick={()=>copyMail(app)}>{copiedId===app.id?'안내문 복사됨':'안내문 복사'}</button>
        </div>
      </article>)}
    </div>
  </div>
}


function App(){
  const path=window.location.pathname.replace(/\/+$/,'');
  if(path.endsWith('/apply'))return <BetaApplyPage/>;
  if(path.endsWith('/admin'))return <BetaAdminPage/>;
  return <AuthGate><AppShell/></AuthGate>;
}

export default App;
