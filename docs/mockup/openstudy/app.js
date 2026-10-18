/* OpenStudy interactive prototype. Buildless, offline, and file:// compatible. */
(() => {
  'use strict';
  const D = window.OpenStudyData;
  const copy = value => JSON.parse(JSON.stringify(value));
  const S = {
    authenticated:false, role:'owner', branch:'all', route:'home', channel:'gangnam',
    navOpen:false, panel:null, taskTab:'all', homeTab:'today', reservationView:'calendar',
    seatZone:'A', seatBranch:'gangnam', clockedIn:false, notifications:{task:true,chat:true,notice:true},
    filters:{}, drafts:{}, tasks:copy(D.tasks), messages:copy(D.messages), members:copy(D.members),
    reservations:copy(D.reservations), facilities:copy(D.facilities), inquiries:copy(D.inquiries),
    notices:copy(D.notices), unread:Object.fromEntries(D.channels.map(c=>[c.id,c.unread]))
  };
  const app = document.getElementById('app');
  const dialog = document.getElementById('detail');
  const paths = {
    logo:'M4 5v15l8-3 8 3V5l-8-2-8 2Zm8-2v14',
    home:'m3 10 9-7 9 7M5 9v12h5v-7h4v7h5V9',
    tasks:'M9 5h11v16H4V5h3m2-2h6v4H9V3Zm-2 9 2 2 4-4m2 3h3M7 18h11',
    chat:'M21 11.5a8.5 8.5 0 0 1-8.5 8.5H5l-3 2V11.5A8.5 8.5 0 0 1 10.5 3h2a8.5 8.5 0 0 1 8.5 8.5ZM7 9h10M7 13h6',
    members:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm8-7a4 4 0 0 1 0 8',
    calendar:'M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm2 10h2m4 0h2m-8 4h2m4 0h2',
    seats:'M5 11V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v6M3 10v7h18v-7M5 17v4m14-4v4M3 13h18',
    facility:'m14 6 4 4m-2-7a6 6 0 0 0-7 8L3 17a2.8 2.8 0 0 0 4 4l6-6a6 6 0 0 0 8-7l-4 4-5-5 4-4Z',
    inquiry:'M9 9a3 3 0 0 1 6 0c0 2-3 2-3 4m0 4h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
    notice:'m3 10 15-6v16L3 14v-4Zm3 5 2 6h3l-2-5m12-8v8',
    clock:'M12 7v5l3 2m6-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
    settings:'m9 3-1 3-3 1-2 4 2 2v4l4 2 2-1 3 1 4-2v-3l2-3-2-4-3-1-1-3H9Zm6 9a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
    branch:'M3 21h18M5 21V5l7-2v18M12 8h7v13M8 7v2m0 3v2m0 3v1m7-7h1m-1 4h1',
    search:'m21 21-5-5m2-6a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z',
    bell:'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4',
    chevron:'m9 5 7 7-7 7', down:'m6 9 6 6 6-6', plus:'M12 5v14M5 12h14',
    arrow:'M4 12h16m-6-6 6 6-6 6', back:'M20 12H4m6-6-6 6 6 6',
    check:'m5 12 4 4L19 6', close:'m6 6 12 12M6 18 18 6', menu:'M4 6h16M4 12h16M4 18h16',
    hash:'M5 9h15M4 15h15M11 3 7 21M18 3l-4 18',
    eye:'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Zm13 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
    lock:'M6 10V7a6 6 0 0 1 12 0v3M5 10h14v11H5V10Zm7 4v3',
    mail:'M3 5h18v14H3V5Zm0 0 9 8 9-8',
    leaf:'M20 3C7 3 2 9 6 16s17 1 14-13ZM5 21l10-11M9 15l-1-5m4 2 5 1',
    sun:'M12 2v2m0 16v2M2 12h2m16 0h2M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2m-2 7a5 5 0 1 1-10 0 5 5 0 0 1 10 0Z',
    pin:'m9 3 9 6-3 3-1 5-3 1-5-4-3-1 6-10Zm0 14-5 5',
    send:'m3 3 19 9-19 9 4-9-4-9Zm4 9h15',
    clip:'m8 12 6-6a3 3 0 0 1 4 4l-8 8a5 5 0 0 1-7-7l8-8m-3 9 6-6',
    smile:'M8 14s1 3 4 3 4-3 4-3M8 9h.01M16 9h.01m5 3a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
    list:'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
    grid:'M3 3h7v7H3V3Zm11 0h7v7h-7V3ZM3 14h7v7H3v-7Zm11 0h7v7h-7v-7Z',
    filter:'M3 4h18l-7 8v7l-4 2v-9L3 4Z',
    logout:'M9 3H4v18h5m-1-9h13m-5-5 5 5-5 5',
    report:'M4 21V3h16v18H4Zm4-4v-4m4 4V7m4 10v-7',
    info:'M12 11v6m0-10h.01m9 5a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
    shield:'m12 2 8 4v6c0 6-8 10-8 10s-8-4-8-10V6l8-4Zm-4 10 3 3 5-6',
    help:'M12 17h.01M9 9a3 3 0 0 1 6 0c0 2-3 2-3 4m9-1a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z'
  };
  const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] || paths.info}"/></svg>`;
  const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const person = id => D.people.find(p=>p.id===id) || D.people[0];
  const me = () => person(S.role==='owner'?'owner':'minji');
  const branchName = id => id==='all'?'전체 지점':D.branches.find(b=>b.id===id)?.name || '강남점';
  const scoped = rows => rows.filter(row=>S.branch==='all'||row.branch===S.branch||row.branch==='all');
  const visibleChannels = () => D.channels.filter(c=>S.role==='owner'||c.branch==='all'||c.branch==='gangnam');
  const branchStaff = () => D.people.filter(p=>p.id!=='owner'&&(S.branch==='all'||p.branch===S.branch));
  const avatar = (id,extra='') => {const p=person(id);return `<span class="avatar ${p.color} ${extra}" aria-hidden="true">${p.initials}</span>`;};
  const badge = (text,cls) => {
    const style=cls||({'완료':'green','이용 완료':'gray','이용 중':'green','진행 중':'blue','할 일':'gray','높음':'red','만료 예정':'orange','만료':'gray','취소':'red','예약 확정':'green','보통':'gray','낮음':'gray'}[text]||'gray');
    return `<span class="pill ${style}">${['진행 중','예약 확정','이용 중'].includes(text)?'<i class="dot"></i>':''}${esc(text)}</span>`;
  };
  const act = (action,label,extra='',cls='btn') => `<button type="button" class="${cls}" data-action="${action}" ${extra}>${label}</button>`;
  const link = (route,label,cls='btn',extra='') => `<a href="#/${route}" class="${cls}" ${extra}>${label}</a>`;
  const empty = (title='검색 결과가 없어요',text='검색어나 필터를 바꿔 다시 확인해 주세요.') => `<div class="empty">${icon('search')}<b>${title}</b><p>${text}</p></div>`;
  const tip = text => `<div class="tip">${icon('info')}<span>${text}</span></div>`;
  const option = (value,label,selected) => `<option value="${esc(value)}" ${String(value)===String(selected)?'selected':''}>${esc(label)}</option>`;
  const statusOptions = current => ['할 일','진행 중','완료'].map(v=>option(v,v,current)).join('');
  const personOptions = (selected,branch) => D.people.filter(p=>p.id!=='owner'&&(!branch||p.branch===branch)).map(p=>option(p.id,p.name,selected)).join('');
  const filter = page => S.filters[page] || (S.filters[page]={q:'',status:'',assignee:'',due:'',date:''});
  const fmtDate = date => date?.replaceAll('-','.') || '—';
  const getTime = () => new Date().toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'Asia/Seoul'});
  let theme='forest';
  try {const saved=localStorage.getItem('openstudy-theme');if(['forest','navy','sand'].includes(saved))theme=saved;} catch { /* restricted storage still allows in-memory preview */ }
  document.documentElement.dataset.theme=theme;
  const themeNames={forest:'포레스트',navy:'네이비',sand:'샌드'};
  const themeDescriptions={forest:'딥그린 · 아이보리',navy:'네이비 · 쿨그레이',sand:'브라운 · 웜베이지'};
  function themes(mini=false) {
    if(mini)return `<div class="login-theme"><span>화면 테마</span>${Object.keys(themeNames).map(t=>act('theme',`<i class="theme-dot"></i><span class="sr-only">${themeNames[t]} 테마</span>`,`data-theme-value="${t}" aria-label="${themeNames[t]} 테마" aria-pressed="${theme===t}"`,`theme-mini swatch-${t} ${theme===t?'active':''}`)).join('')}</div>`;
    return `<div class="theme-options">${Object.keys(themeNames).map(t=>act('theme',`<div class="theme-art" aria-hidden="true"><i></i><span></span></div><span class="selected-mark">${theme===t?'✓':''}</span><b>${themeNames[t]}</b><small>${themeDescriptions[t]}</small>`,`data-theme-value="${t}" aria-pressed="${theme===t}"`,`theme-card swatch-${t} ${theme===t?'active':''}`)).join('')}</div>`;
  }
  function illustration() {
    return `<svg class="room-art" viewBox="0 0 520 310" role="img" aria-label="책과 식물이 놓인 햇살 가득한 스터디카페"><defs><pattern id="room-grid" width="27" height="27" patternUnits="userSpaceOnUse"><path d="M27 0H0v27" fill="none" stroke="currentColor" stroke-opacity=".05"/></pattern></defs><path fill="url(#room-grid)" d="M0 0h520v310H0z"/><path d="M30 260h460" stroke="currentColor" stroke-opacity=".2"/><rect x="135" y="18" width="228" height="163" rx="112" fill="var(--surface)" fill-opacity=".7"/><path d="M135 177V94a114 100 0 0 1 228 0v83M249 20v158M136 106h226" fill="none" stroke="currentColor" stroke-opacity=".22" stroke-width="3"/><path d="m270 108-40 70h57l42-70" fill="var(--accent)" fill-opacity=".5"/><path d="m212 145-20 33h29l20-33" fill="var(--accent)" fill-opacity=".35"/><rect x="99" y="178" width="303" height="12" rx="4" fill="currentColor" opacity=".6"/><path d="M118 190v69m264-69v69" stroke="currentColor" stroke-width="8" opacity=".4"/><rect x="232" y="139" width="85" height="40" rx="4" fill="var(--primary)"/><path d="m232 177-8 5h102l-9-5" fill="var(--rail)"/><rect x="239" y="145" width="71" height="27" rx="1" fill="var(--soft)"/><path d="m253 153 6 5-6 5m15 0h15" stroke="var(--primary)" fill="none" stroke-width="2"/><rect x="153" y="166" width="42" height="7" rx="1" fill="#c6b18d"/><rect x="160" y="159" width="40" height="7" rx="1" fill="var(--accent)"/><rect x="152" y="173" width="49" height="5" rx="1" fill="var(--primary)" opacity=".5"/><path d="M345 163h18v15h-18zm18 3c10-2 10 10 0 7" fill="none" stroke="currentColor" stroke-width="2" opacity=".7"/><path d="M343 153c-3-4 4-5 1-9m8 9c-3-4 4-5 1-9" stroke="currentColor" stroke-opacity=".35" fill="none"/><rect x="222" y="199" width="65" height="37" rx="12" fill="var(--accent)"/><path d="m228 234-5 26m57-26 5 26" stroke="currentColor" stroke-width="4" opacity=".4"/><path d="M65 244c0-47 6-72 2-108m0 52c-22-3-29-17-29-31 25 1 28 14 29 31Zm1-24c21-2 33-20 31-34-23 5-29 17-31 34Zm0-20c-20-8-21-22-16-35 16 10 18 24 16 35Zm-1 65c-21-2-32-15-33-28 25 0 33 13 33 28Zm1 15c22-5 35-18 32-34-25 6-29 21-32 34Z" fill="var(--primary)" fill-opacity=".65" stroke="currentColor" stroke-opacity=".3"/><path d="M45 231h42l-7 29H52Z" fill="#c7b294"/><path d="M423 246v-39m0 16c-16-2-22-12-23-22 20 1 23 13 23 22Zm0-11c16-3 19-13 18-21-15 2-18 13-18 21Z" fill="var(--primary)" opacity=".55"/><path d="M408 239h30l-5 21h-20Z" fill="var(--accent)"/><circle cx="416" cy="65" r="20" fill="var(--accent)" opacity=".5"/><path d="M416 53v13l8 5" stroke="currentColor" stroke-width="1.5" fill="none" opacity=".6"/></svg>`;
  }
  function login() {
    app.innerHTML=`<main id="main" class="login-page"><section class="login-visual"><div class="wordmark"><span class="brand-symbol">${icon('logo')}</span>OpenStudy</div><div class="login-copy"><div class="eyebrow">A good space starts with us</div><h1>좋은 공간은,<br><em>함께</em> 만들어지니까.</h1><p>작은 할 일부터 하루의 운영까지.<br>우리 팀의 모든 이야기가 연결되는 곳, OpenStudy.</p></div>${illustration()}<div class="visual-footer"><span>SPACE TO FOCUS. ROOM TO GROW.</span><span>OpenStudy Workspace © 2026</span></div></section><section class="login-side">${themes(true)}<div class="login-wrap"><div class="wordmark login-mobile-brand"><span class="brand-symbol">${icon('logo')}</span>OpenStudy</div><span class="login-badge">${icon('leaf')} 우리 팀의 운영 워크스페이스</span><h2>다시 만나 반가워요</h2><p>함께 만드는 더 좋은 하루,<br>OpenStudy에서 오늘의 업무를 시작해 보세요.</p><form id="login-form" novalidate><div id="login-error" class="form-error" role="alert" hidden></div><div class="field"><label for="email">이메일</label><input id="email" name="email" type="email" autocomplete="username" placeholder="name@openstudy.demo" required></div><div class="field"><label for="password">비밀번호</label><div class="password-wrap"><input id="password" name="password" type="password" autocomplete="current-password" placeholder="비밀번호를 입력해 주세요" required>${act('password-toggle',icon('eye'),'aria-label="비밀번호 표시" aria-pressed="false"','icon-btn')}</div></div><div class="login-meta"><span class="muted">데모에서는 임의의 이메일·비밀번호를 사용해요.</span>${act('forgot','비밀번호 찾기','','text-link')}</div><button type="submit" class="btn primary login-submit">워크스페이스 로그인 ${icon('arrow')}</button></form><div class="divider">입력 없이 목업 둘러보기</div><div class="demo-logins">${act('demo-login',`${icon('branch')}<span><b>사장님으로 체험</b><small>전체 지점 · 업무 배정</small></span>`,'data-role="owner"','demo-login')}${act('demo-login',`${icon('members')}<span><b>직원으로 체험</b><small>내 업무 · 팀 채팅</small></span>`,'data-role="staff"','demo-login')}</div><p class="login-note">디자인 검토용 목업입니다. 실제 계정 없이 체험할 수 있으며,<br>입력한 비밀번호는 저장하지 않습니다.</p><p class="login-bottom">집중하는 공간, 연결되는 우리 팀.</p></div></section></main>`;
  }
  const menus = [
    ['home','home','대시보드'],['tasks','tasks','업무 관리'],['members','members','회원·이용권'],
    ['reservations','calendar','예약 관리'],['spaces','seats','좌석·사물함'],['facilities','facility','시설·점검'],
    ['inquiries','inquiry','고객 문의'],['notices','notice','공지사항'],['attendance','clock','근무·근태'],
    ['employees','members','직원 관리'],['settings','settings','설정']
  ];
  const titles=Object.fromEntries(menus.map(([r,,n])=>[r,n]));titles.chat='팀 채팅';
  function sidebar() {
    const common=`<div class="side-brand"><div>OpenStudy<small>TEAM WORKSPACE</small></div>${icon('leaf')}</div><div class="side-workspace"><div class="workspace-label">MY WORKSPACE</div><div class="branch-control">${icon('branch')}<div class="grow"><select aria-label="지점 선택" id="branch-select">${S.role==='owner'?option('all','전체 지점',S.branch):''}${D.branches.filter(b=>S.role==='owner'||b.id==='gangnam').map(b=>option(b.id,b.name,S.branch)).join('')}</select><small>${S.role==='owner'?'2개의 공간, 하나의 팀':'강남점 운영팀'}</small></div></div></div>`;
    if(S.route==='chat')return common+`<nav class="side-nav" aria-label="채팅 탐색"><div class="nav-group between"><span>채널</span>${act('demo-hint',icon('plus'),'aria-label="채널 추가" data-message="채널 생성은 실제 서비스 연동 후 사용할 수 있어요."','icon-btn')}</div>${visibleChannels().map(c=>`<a href="#/chat/${c.id}" class="nav-link channel ${S.channel===c.id?'active':''}" ${S.channel===c.id?'aria-current="page"':''}>${icon('hash')}<span class="label">${c.name}</span>${S.unread[c.id]?`<span class="count">${S.unread[c.id]}</span>`:''}</a>`).join('')}<div class="nav-group spaced">다이렉트 메시지</div>${D.people.filter(p=>p.id!==me().id&&(S.role==='owner'||p.branch==='gangnam'||p.id==='owner')).map(p=>`<a href="#/chat/dm-${p.id}" class="nav-link channel ${S.channel===`dm-${p.id}`?'active':''}" ${S.channel===`dm-${p.id}`?'aria-current="page"':''}><i class="dm-presence"></i><span class="label">${p.name}</span><small>${p.role}</small></a>`).join('')}</nav><div class="side-note"><div>${icon('shield')} 우리 팀만의 대화 공간</div>작은 공유가 좋은 인수인계가 돼요.</div>`;
    return common+`<nav class="side-nav" aria-label="업무 메뉴"><div class="nav-group">워크스페이스</div>${menus.filter(([r])=>!['employees','settings'].includes(r)).map(([r,i,n],idx)=>`${idx===2?'<div class="nav-group spaced">매장 운영</div>':''}${idx===8?'<div class="nav-group spaced">우리 팀</div>':''}<a href="#/${r}" class="nav-link ${S.route===r?'active':''}" ${S.route===r?'aria-current="page"':''}>${icon(i)}<span class="label">${n}</span>${r==='tasks'?`<span class="count">${scoped(S.tasks).filter(t=>t.status!=='완료').length}</span>`:r==='inquiries'?`<span class="count">${scoped(S.inquiries).filter(t=>t.status!=='완료').length}</span>`:''}</a>`).join('')}${S.role==='owner'?`<a href="#/employees" class="nav-link ${S.route==='employees'?'active':''}" ${S.route==='employees'?'aria-current="page"':''}>${icon('members')}<span class="label">직원 관리</span></a>`:''}<div class="nav-group spaced">환경설정</div><a href="#/settings" class="nav-link ${S.route==='settings'?'active':''}" ${S.route==='settings'?'aria-current="page"':''}>${icon('settings')}<span class="label">설정</span></a></nav><div class="side-note"><div>${icon('leaf')} 오늘도, 좋은 공간을 함께.</div>디자인 프리뷰 <span class="mono">v1.0</span></div>`;
  }
  function shell(content) {
    const p=me();
    app.innerHTML=`<div class="workspace ${S.navOpen?'nav-open':''}"><nav class="rail" aria-label="빠른 이동"><a href="#/home" class="rail-logo" aria-label="OpenStudy 홈">${icon('logo')}</a>${[['home','home','홈'],['tasks','tasks','업무'],['chat/gangnam','chat','채팅']].map(([r,i,n])=>link(r,`${icon(i)}<span>${n}</span>`,`rail-item ${S.route===r.split('/')[0]?'active':''}`,S.route===r.split('/')[0]?'aria-current="page"':'')).join('')}<div class="rail-spacer"></div>${act('help',`${icon('help')}<span>도움말</span>`,'','rail-item desktop-only')}${link('settings',`${icon('settings')}<span>설정</span>`,`rail-item ${S.route==='settings'?'active':''}`,S.route==='settings'?'aria-current="page"':'')}${act('profile',avatar(p.id),'aria-label="사용자 메뉴"','rail-profile')}</nav><aside class="sidebar" id="sidebar">${sidebar()}</aside>${act('close-nav','<span class="sr-only">메뉴 닫기</span>','aria-label="메뉴 닫기"','nav-backdrop')}<section class="shell-main"><header class="topbar"><div class="flex">${act('toggle-nav',icon('menu'),`aria-label="메뉴 열기" aria-controls="sidebar" aria-expanded="${S.navOpen}"`,'icon-btn mobile-menu')}<div class="breadcrumb"><span class="workspace-crumb">워크스페이스</span><span class="slash">/</span><strong>${titles[S.route]||'대시보드'}</strong></div></div><form class="global-search" id="global-search">${icon('search')}<input name="q" aria-label="업무 검색" placeholder="업무 검색" autocomplete="off"><kbd>/</kbd></form><div class="top-actions">${act('notifications',icon('bell'),'aria-label="알림 보기"','icon-btn notification-btn')}<span class="top-divider"></span>${act('profile',`${avatar(p.id)}<span><b>${p.name}</b><small>${S.role==='owner'?'사장님':'직원 · 강남점'}</small></span>${icon('down')}`,'aria-label="사용자 메뉴 및 역할 전환"','profile-button')}</div></header><main id="main" class="${S.route==='chat'?'chat-main':'page-scroll'}" tabindex="-1">${content}</main></section></div>`;
    if(S.route==='chat'){const el=document.querySelector('.messages');if(el)el.scrollTop=el.scrollHeight;}
  }
  function heading(title,subtitle,actions='') {return `<div class="page-heading"><div><h1>${title}</h1><p>${subtitle}</p></div><div class="heading-actions">${actions}</div></div>`;}
  function taskRow(t) {
    return `<div class="task-preview ${t.status==='완료'?'done':''}">${act('quick-complete',t.status==='완료'?icon('check'):'',`data-id="${t.id}" aria-label="${esc(t.title)} ${t.status==='완료'?'다시 열기':'완료'}" aria-pressed="${t.status==='완료'}"`,`task-check ${t.status==='완료'?'done':''}`)}<button type="button" class="grow" style="text-align:left;padding:0" data-action="task-detail" data-id="${t.id}"><b>${esc(t.title)}</b><small>${branchName(t.branch)} <span aria-hidden="true">·</span> ${esc(t.category)} <span aria-hidden="true">·</span> ${t.due===D.today?'오늘':fmtDate(t.due)}</small></button>${t.priority==='높음'?badge('높음'):badge(t.status)}${avatar(t.assignee)}</div>`;
  }
  function dashboard() {
    const tasks=scoped(S.tasks), done=tasks.filter(t=>t.status==='완료').length, open=tasks.length-done;
    const todayTasks=tasks.filter(t=>t.due===D.today),myTasks=todayTasks.filter(t=>t.assignee===me().id);
    const displayTasks=S.homeTab==='mine'?myTasks:todayTasks;
    const branches=D.branches.filter(b=>S.branch==='all'||b.id===S.branch);
    const used=branches.reduce((n,b)=>n+b.used,0),seats=branches.reduce((n,b)=>n+b.seats,0);
    const issues=scoped(S.facilities).filter(i=>i.status!=='완료');
    const inquiries=scoped(S.inquiries).filter(i=>i.status!=='완료');
    const staff=branchStaff(),rate=Math.round(used/seats*100),completion=todayTasks.length?Math.round(todayTasks.filter(t=>t.status==='완료').length/todayTasks.length*100):0;
    return `<div class="page">${heading(`안녕하세요, ${me().name}님 <span style="font-size:21px">☀</span>`,S.role==='owner'?'우리 공간의 오늘을 한눈에 확인하고, 팀과 함께 하루를 시작해요.':'오늘의 내 업무를 확인하고, 동료에게 필요한 이야기를 남겨요.',`<span class="date-label">${icon('calendar')}<span class="mono">2026. 10. 17.</span> 토요일</span>`)}<section class="welcome-card"><div><div class="eyebrow">${S.role==='owner'?'Together, better spaces':'Your day, connected'}</div><h2>${S.role==='owner'?'집중할 수 있는 공간,<br>오늘도 <strong>함께 만들어요.</strong>':'오늘의 작은 실천이,<br><strong>좋은 공간</strong>을 만들어요.'}</h2><p>지금 ${branchName(S.branch)}에서 ${staff.length}명의 동료가 하루를 준비하고 있어요.</p></div><div class="welcome-side"><div class="hero-indicator"><i class="dot"></i> 모든 공간이 정상 운영 중이에요</div><div class="hero-date">오늘 남은 업무 <strong>${open}개</strong> · 함께 채워 갈 하루</div>${link('tasks',`오늘의 업무 확인 ${icon('arrow')}`,'btn')}</div><svg class="hero-leaf" viewBox="0 0 200 200" fill="none" aria-hidden="true"><path d="M85 210C95 152 120 110 167 35M123 112C80 115 55 88 47 61c40-9 72 17 76 51ZM147 74c-8-41 8-63 40-73 3 34-7 57-40 73ZM103 150c43 4 68-11 80-45-36-4-68 12-80 45ZM88 181c-43-3-64-22-70-55 43-3 65 20 70 55Z" stroke="currentColor" stroke-width="2" fill="currentColor"/></svg></section><section class="stat-grid" aria-label="운영 핵심 지표">${stat('현재 이용 좌석',used,`/ ${seats}석`,'seats',`<span class="positive">${rate}%</span>의 공간이 채워졌어요`)}${stat('오늘의 업무',todayTasks.filter(t=>t.status!=='완료').length,'건','tasks',`전체 ${todayTasks.length}건 중 ${todayTasks.filter(t=>t.status==='완료').length}건 완료`)}${stat('확인이 필요한 문의',inquiries.length,'건','inquiry','회원의 이야기를 기다리고 있어요')}${stat('오늘의 근무자',staff.length,'명','members',`${S.branch==='all'?'2개 지점':'소속 지점'} 운영팀이 함께하고 있어요`)}</section><div class="dashboard-grid"><div class="stack"><section class="card"><div class="card-header"><h2>오늘의 업무 <span class="number">${todayTasks.length}</span></h2>${link('tasks',`전체 보기 ${icon('chevron')}`,'text-link')}</div><div class="tabs" role="tablist" aria-label="홈 업무 범위">${act('home-tab','오늘의 업무',`data-value="today" role="tab" aria-selected="${S.homeTab==='today'}"`,`tab ${S.homeTab==='today'?'active':''}`)}${act('home-tab','내 업무',`data-value="mine" role="tab" aria-selected="${S.homeTab==='mine'}"`,`tab ${S.homeTab==='mine'?'active':''}`)}</div><div class="dashboard-list">${displayTasks.length?displayTasks.slice(0,5).map(taskRow).join(''):empty('오늘 배정된 업무가 없어요','전체 업무에서 우리 팀의 할 일을 확인해 보세요.')}</div><div class="card-footer between"><span>하나씩 완료하며 오늘을 채워가요.</span><span class="mono" style="color:var(--primary)">${completion}% 완료</span></div><div class="progress" style="height:3px;border-radius:0"><i style="width:${completion}%"></i></div></section><section class="card"><div class="card-header"><h2>확인이 필요한 일</h2>${link('facilities',`점검 보기 ${icon('chevron')}`,'text-link')}</div><div class="card-body">${issues.slice(0,2).map(i=>`<button class="issue-item" style="width:100%;text-align:left" data-action="record-detail" data-type="facilities" data-id="${i.id}"><span class="issue-icon">${icon('facility')}</span><span class="grow"><b>${esc(i.title)}</b><p>${branchName(i.branch)} · ${person(i.assignee).name} 담당</p></span>${badge(i.status)}</button>`).join('')||empty('처리할 시설 점검이 없어요','모든 점검을 완료했어요.')}</div></section>${recentReports()}<section class="card"><div class="card-header"><h2>팀에게 전하는 소식</h2>${link('notices',`전체 공지 ${icon('chevron')}`,'text-link')}</div><div class="card-body">${scoped(S.notices).slice(0,3).map(n=>`<button class="notice-preview" data-action="notice-detail" data-id="${n.id}"><b>${n.pinned?'<span class="pill">중요</span>':''}${esc(n.title)}</b><small>${branchName(n.branch)} · ${person(n.author).name} · ${fmtDate(n.date)}</small></button>`).join('')}</div></section></div><aside class="stack dashboard-aside"><section class="card"><div class="card-header"><h2>우리 공간은 지금</h2>${link('spaces',icon('arrow'),'text-link','aria-label="좌석 현황 자세히"')}</div><div class="card-body"><div class="occupancy"><div class="donut" style="--used:${rate}%"><div><strong>${rate}<span style="font-size:13px">%</span></strong><small>좌석 이용률</small></div></div><div class="legend"><div><span class="legend-label"><i class="dot"></i>이용 중</span><b>${used}</b></div><div><span class="legend-label"><i class="dot free"></i>이용 가능</span><b>${seats-used}</b></div></div></div>${branches.map(b=>`<div class="branch-usage"><div class="between"><b>${b.name}</b><small class="mono">${b.used} / ${b.seats}석</small></div><div class="progress"><i style="width:${b.used/b.seats*100}%"></i></div></div>`).join('')}</div><div class="card-footer">${icon('leaf')} 쾌적한 공간을 유지하고 있어요</div></section><section class="card"><div class="card-header"><h2>오늘 함께하는 동료</h2>${link('attendance',icon('arrow'),'text-link','aria-label="근무표 보기"')}</div><div class="card-body">${staff.map(p=>`<div class="shift-person">${avatar(p.id,'online')}<div class="grow"><b>${p.name} <span class="muted" style="font-size:10px;font-weight:400">${p.role}</span></b><small class="mono">${p.shift}</small></div>${badge(p.id==='minji'||p.id==='yujin'?'근무 중':'예정',p.id==='minji'||p.id==='yujin'?'green':'gray')}</div>`).join('')}<div class="shift-summary">${icon('clock')} 교대 전, 인수인계를 남겨 주세요.</div></div></section><section class="card"><div class="card-header"><h2>대화로 이어지는 업무</h2>${icon('chat')}</div><div class="card-body"><p class="muted" style="font-size:12px;line-height:1.9;margin-bottom:16px">점검 결과부터 작은 요청까지.<br>우리 팀 채널에서 이야기해요.</p>${link(`chat/${S.branch==='seongsu'?'seongsu':'gangnam'}`,`팀 채팅 열기 ${icon('arrow')}`,'btn', 'style="width:100%"')}</div></section></aside></div><div class="bottom-note"><span>OpenStudy · 좋은 공간을 함께 만드는 우리 팀</span><span>샘플 데이터 기준 · 2026. 10. 17.</span></div></div>`;
  }
  function recentReports() {
    const channels=visibleChannels().filter(c=>S.branch==='all'||c.branch==='all'||c.branch===S.branch);
    const reports=S.messages.filter(m=>channels.some(c=>c.id===m.channel)&&(m.taskId||m.replies.length)).slice(-2).reverse();
    return `<section class="card"><div class="card-header"><h2>최근 업무 공유</h2>${link('chat/'+(S.branch==='seongsu'?'seongsu':'gangnam'),`채팅 열기 ${icon('chevron')}`,'text-link')}</div><div class="card-body">${reports.map(m=>{
      const last=m.replies.at(-1)||m,c=channels.find(c=>c.id===m.channel);
      return link('chat/'+m.channel,`<span class="flex" style="align-items:flex-start">${avatar(last.author)}<span class="grow"><b>${person(last.author).name} <span class="muted" style="font-size:10px;font-weight:400"># ${c.name}</span></b><span class="report-text">${esc(last.text)}</span><small>${m.taskId?esc(S.tasks.find(t=>t.id===m.taskId)?.title)+' · ':''}${esc(last.time)}${m.replies.length?' · 답글 '+m.replies.length+'개':''}</small></span>${icon('chevron')}</span>`,'notice-preview');
    }).join('')||empty('아직 공유된 업무가 없어요','운영 채널에서 오늘의 업무를 공유해 보세요.')}</div></section>`;
  }
  function stat(label,value,unit,i,foot){return `<div class="stat-card"><div class="stat-label"><span>${label}</span>${icon(i)}</div><div class="stat-value mono">${value}<small>${unit}</small></div><div class="stat-foot">${foot}</div></div>`;}
  function searchInput(page,placeholder='검색어를 입력해 주세요') {
    return `<div class="search-field">${icon('search')}<input type="search" class="filter-input" data-filter-page="${page}" data-filter="q" aria-label="${placeholder}" placeholder="${placeholder}" value="${esc(filter(page).q)}"></div>`;
  }
  function selectFilter(page,key,label,values) {
    return `<select class="filter-select" data-filter-page="${page}" data-filter="${key}" aria-label="${label}">${option('',label,filter(page)[key])}${values.map(v=>Array.isArray(v)?option(v[0],v[1],filter(page)[key]):option(v,v,filter(page)[key])).join('')}</select>`;
  }
  function matches(row,page,fields) {
    const f=filter(page),q=f.q.toLowerCase();
    return (!q||fields.some(k=>String(row[k]||'').toLowerCase().includes(q)))&&(!f.status||row.status===f.status)&&(!f.assignee||row.assignee===f.assignee)&&(!f.date||row.date===f.date)&&(!f.due||(f.due==='today'?row.due===D.today:row.due>D.today));
  }
  function table(heads,rows,emptyText) {
    if(!rows.length)return empty(emptyText);
    return `<div class="table-scroll"><table><thead><tr>${heads.map(h=>`<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(c=>`<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  function summary(items) {return `<div class="summary-grid">${items.map(([label,n,i])=>`<div class="summary-item"><div><p>${label}</p><b class="mono">${n}</b></div>${icon(i)}</div>`).join('')}</div>`;}
  function tasksPage() {
    const tasks=scoped(S.tasks),rows=tasks.filter(t=>(S.taskTab!=='mine'||t.assignee===me().id)&&matches(t,'tasks',['title','category']));
    return `<div class="page">${heading('작은 할 일, 함께 완성해요','담당자와 기한을 정하고, 진행 상황을 팀과 공유하세요.',act('new-task',`${icon('plus')} 업무 등록`,'','btn primary'))}${summary([['진행할 업무',tasks.filter(t=>t.status==='할 일').length,'tasks'],['진행 중',tasks.filter(t=>t.status==='진행 중').length,'clock'],['완료한 업무',tasks.filter(t=>t.status==='완료').length,'check']])}<section class="card"><div class="tabs" role="tablist" aria-label="업무 범위" style="padding-top:18px">${['all','mine'].map(v=>act('task-tab',v==='all'?'전체 업무':'내 업무',`role="tab" aria-selected="${S.taskTab===v}" data-value="${v}"`,`tab ${S.taskTab===v?'active':''}`)).join('')}</div><div class="toolbar">${searchInput('tasks','업무 제목, 분류 검색')}${selectFilter('tasks','status','모든 상태',['할 일','진행 중','완료'])}${selectFilter('tasks','assignee','모든 담당자',branchStaff().map(p=>[p.id,p.name]))}${selectFilter('tasks','due','모든 기한',[['today','오늘까지'],['future','예정 업무']])}${act('reset-filters',icon('filter'),'data-page="tasks" aria-label="업무 필터 초기화"','icon-btn')}</div>${table(['업무','지점','담당자','상태','우선순위','기한'],rows.map(t=>[`${act('task-detail',esc(t.title),`data-id="${t.id}"`,'cell-title')}<small>${esc(t.category)}</small>`,branchName(t.branch),`<span class="table-person">${avatar(t.assignee)}${person(t.assignee).name}</span>`,badge(t.status),badge(t.priority),`<span class="mono">${fmtDate(t.due)}</span>`]))}<div class="list-summary"><span>총 ${rows.length}개 업무</span><span>업무를 선택해 상세 내용을 확인하세요</span></div></section></div>`;
  }
  function membersPage() {
    const all=scoped(S.members),rows=all.filter(m=>matches(m,'members',['name','phone','pass']));
    return `<div class="page">${heading('회원·이용권','회원의 이용 상태와 만료 예정 이용권을 확인하세요.',act('demo-hint',`${icon('plus')} 회원 등록`,'data-message="회원 등록과 결제는 실제 서비스 연동 후 사용할 수 있어요."','btn'))}${summary([['전체 회원',all.length,'members'],['이용 중',all.filter(m=>m.status==='이용 중').length,'seats'],['만료 예정',all.filter(m=>m.status==='만료 예정').length,'clock']])}<section class="card"><div class="toolbar">${searchInput('members','회원 이름, 연락처, 이용권 검색')}${selectFilter('members','status','모든 이용 상태',['이용 중','만료 예정','만료'])}</div>${table(['회원','지점','이용권','잔여 이용','만료일','상태'],rows.map(m=>[`${act('record-detail',esc(m.name),`data-type="members" data-id="${m.id}"`,'cell-title')}<small class="mono">${m.phone}</small>`,branchName(m.branch),esc(m.pass),m.remaining,`<span class="mono">${fmtDate(m.expires)}</span>`,badge(m.status)]))}<div class="list-summary"><span>총 ${rows.length}명</span><span>연락처는 디자인 검토용 가상 정보입니다</span></div></section></div>`;
  }
  function reservationsPage() {
    const rows=scoped(S.reservations).filter(r=>matches(r,'reservations',['member','space']));
    const f=filter('reservations');
    let cells='';
    for(let i=0;i<4;i++)cells+='<div class="cal-day blank" aria-hidden="true"></div>';
    for(let day=1;day<=31;day++){
      const date=`2026-10-${String(day).padStart(2,'0')}`,events=rows.filter(r=>r.date===date);
      cells+=`<div class="cal-day ${date===D.today?'today':''}"><span class="day-number">${day}</span>${events.map(r=>act('record-detail',`${r.time.slice(0,5)} ${esc(r.space)}<br>${esc(r.member)}${r.status==='취소'?' · 취소':''}`,`data-type="reservations" data-id="${r.id}"`,'cal-event')).join('')}</div>`;
    }
    return `<div class="page">${heading('예약 관리','좌석과 스터디룸의 예약을 한눈에 확인하세요.',act('demo-hint',`${icon('plus')} 예약 등록`,'data-message="예약 생성 및 취소는 예약 서비스 연동 후 사용할 수 있어요."','btn'))}<section class="card"><div class="card-header"><h2 class="mono">2026년 10월</h2><div class="segmented" role="group" aria-label="예약 보기 방식">${act('reservation-view',`${icon('calendar')} 캘린더`,'data-value="calendar" aria-pressed="'+(S.reservationView==='calendar')+'"',S.reservationView==='calendar'?'active':'')}${act('reservation-view',`${icon('list')} 목록`,'data-value="list" aria-pressed="'+(S.reservationView==='list')+'"',S.reservationView==='list'?'active':'')}</div></div><div class="toolbar">${searchInput('reservations','예약자, 공간 검색')}${selectFilter('reservations','status','모든 상태',['예약 확정','이용 완료','취소'])}<input class="filter-input" type="date" value="${esc(f.date)}" aria-label="예약 날짜" data-filter-page="reservations" data-filter="date">${act('reset-filters','전체 날짜','data-page="reservations"','btn quiet')}</div>${S.reservationView==='calendar'?`<div class="calendar-scroll"><div class="calendar">${['일','월','화','수','목','금','토'].map(v=>`<div class="cal-label">${v}</div>`).join('')}${cells}</div></div>${!rows.length?empty('조건에 맞는 예약이 없어요'):''}`:table(['예약자','지점','공간','예약일','시간','상태'],rows.map(r=>[act('record-detail',esc(r.member),`data-type="reservations" data-id="${r.id}"`,'cell-title'),branchName(r.branch),esc(r.space),fmtDate(r.date),r.time,badge(r.status)]))}<div class="list-summary"><span>표시 중인 예약 ${rows.length}건</span><span>날짜 또는 예약을 선택해 확인하세요</span></div></section></div>`;
  }
  function seatState(n) {return n===13?'repair':n%3===0?'free':'used';}
  function spacesPage() {
    const seatBranch=S.branch==='all'?S.seatBranch:S.branch,b=D.branches.find(v=>v.id===seatBranch),members=S.members.filter(m=>m.branch===seatBranch);
    const seat = n => {const status=seatState(n),label=status==='repair'?'점검 중':status==='used'?'이용 중':'이용 가능';return act('seat-detail',`${S.seatZone}-${String(n).padStart(2,'0')}`,`data-number="${n}" data-branch="${seatBranch}" aria-label="${S.seatZone}-${String(n).padStart(2,'0')} ${label}"`,`seat ${status}`);};
    return `<div class="page">${heading('좋은 집중을 위한 공간','좌석 현황과 사물함 배정을 확인하세요.',`${S.branch==='all'?`<select id="seat-branch" class="filter-select" aria-label="좌석 지점">${D.branches.map(v=>option(v.id,v.name,seatBranch)).join('')}</select>`:''}`)}${summary([['전체 좌석',b.seats,'seats'],['이용 중',b.used,'members'],['이용 가능',b.seats-b.used,'check']])}<div class="seat-layout"><section class="card"><div class="card-header"><h2>${b.name} 좌석 배치</h2><div class="segmented" role="group" aria-label="좌석 구역">${['A','B'].map(v=>act('seat-zone',`${v==='A'?'집중존 A':'오픈존 B'}`,`data-value="${v}" aria-pressed="${S.seatZone===v}"`,S.seatZone===v?'active':'')).join('')}</div></div><div class="seat-scroll"><div class="seat-map"><div class="seat-map-label"><span>WINDOW SIDE</span><span>${S.seatZone==='A'?'조용히 집중하는 공간':'자유롭게 공부하는 공간'}</span></div><div class="seats">${Array.from({length:16},(_,i)=>seat(i+1)).join('')}</div><div class="seat-corridor">이 동 통 로</div><div class="seats">${Array.from({length:16},(_,i)=>seat(i+17)).join('')}</div><div class="seat-corridor">라 운 지 & 스 터 디 룸</div><div class="room-row">${['A','B'].map(v=>act('room-detail',`${icon('members')} 스터디룸 ${v}<small>${v==='A'?'4인실 · 14:00 예약':'2인실 · 16:00 예약'}</small>`,`data-room="${v}" data-branch="${seatBranch}"`,'room-tile')).join('')}</div></div></div><div class="seat-legend"><span><i></i> 이용 가능</span><span><i class="used"></i> 이용 중</span><span><i class="repair"></i> 점검 중</span></div><div class="card-footer">배치도는 각 구역 대표 좌석 32석을 표시한 디자인 예시입니다.</div></section><section class="card"><div class="card-header"><h2>사물함 배정</h2>${icon('lock')}</div><div class="card-body">${Array.from({length:6},(_,i)=>{const m=members[i];return `<div class="locker-item"><span class="locker-number mono">${String(i+1).padStart(2,'0')}</span><div class="grow"><b>${m?esc(m.name):'배정 가능'}</b><small>${m?fmtDate(m.expires)+'까지':'비어 있는 사물함'}</small></div>${badge(m?'이용 중':'공실',m?'green':'gray')}</div>`;}).join('')}</div><div class="card-footer">${b.name} · 샘플 사물함 6개</div></section></div></div>`;
  }
  function operationsPage(type) {
    const isFacility=type==='facilities',all=scoped(S[type]),rows=all.filter(r=>matches(r,type,['title','category','member']));
    return `<div class="page">${heading(isFacility?'작은 점검이 만드는 좋은 공간':'고객의 이야기에 귀 기울여요',isFacility?'청소부터 시설 이상까지, 점검과 처리 현황을 함께 확인하세요.':'회원 문의를 확인하고 담당자와 처리 결과를 기록하세요.',act('demo-hint',`${icon('plus')} ${isFacility?'점검 등록':'문의 등록'}`,`data-message="${isFacility?'추가 점검 접수':'문의 직접 접수'}는 실제 서비스 연동 후 사용할 수 있어요. 업무 등록에서 처리할 일을 추가할 수 있습니다."`,'btn'))}${summary([['대기 중',all.filter(r=>r.status==='할 일').length,isFacility?'facility':'inquiry'],['처리 중',all.filter(r=>r.status==='진행 중').length,'clock'],['처리 완료',all.filter(r=>r.status==='완료').length,'check']])}<section class="card"><div class="toolbar">${searchInput(type,isFacility?'점검 제목, 분류 검색':'문의 제목, 회원 검색')}${selectFilter(type,'status','모든 상태',['할 일','진행 중','완료'])}${selectFilter(type,'assignee','모든 담당자',branchStaff().map(p=>[p.id,p.name]))}</div>${table([isFacility?'점검 내용':'문의 내용','지점','분류','담당자','상태'],rows.map(r=>[`${act('record-detail',esc(r.title),`data-type="${type}" data-id="${r.id}"`,'cell-title')}<small>${isFacility?'정기 운영 체크':esc(r.member)+' 회원'}</small>`,branchName(r.branch),r.category,`<span class="table-person">${avatar(r.assignee)}${person(r.assignee).name}</span>`,badge(r.status)]))}<div class="list-summary"><span>총 ${rows.length}건</span><span>상세에서 담당자와 처리 상태를 변경할 수 있어요</span></div></section></div>`;
  }
  function noticesPage() {
    const f=filter('notices'),rows=scoped(S.notices).filter(n=>!f.q||[n.title,n.body].some(v=>v.toLowerCase().includes(f.q.toLowerCase()))).sort((a,b)=>Number(b.pinned)-Number(a.pinned)||b.id-a.id);
    return `<div class="page">${heading('함께 알아두면 좋은 소식','중요한 운영 소식과 우리 팀의 가이드를 모았어요.',act('new-notice',`${icon('plus')} 공지 작성`,'','btn primary'))}<div class="toolbar" style="padding:0 0 20px">${searchInput('notices','공지 제목, 내용 검색')}<span class="spacer"></span><span class="small muted">${rows.length}개의 소식</span></div><div class="notice-grid">${rows.map(n=>`<button class="card notice-card" data-action="notice-detail" data-id="${n.id}"><div class="between"><span class="pill ${n.pinned?'':'gray'}">${n.pinned?icon('pin')+' 중요 공지':esc(n.category)}</span><span class="small muted">${branchName(n.branch)}</span></div><h2>${esc(n.title)}</h2><p>${esc(n.body)}</p><div class="between"><span class="flex">${avatar(n.author)} ${person(n.author).name}</span><span class="mono">${fmtDate(n.date)}</span></div></button>`).join('')}</div>${!rows.length?empty():''}</div>`;
  }
  function attendancePage() {
    const staff=branchStaff();
    return `<div class="page">${heading('우리 팀의 하루를 맞춰요','근무 일정을 확인하고 교대에 필요한 내용을 준비하세요.',act('demo-hint',`${icon('calendar')} 근무표 편집`,'data-message="근무표 편집은 실제 근태 서비스 연동 후 사용할 수 있어요."','btn'))}<div class="attendance-grid"><section class="card clock"><div><div class="eyebrow">MY ATTENDANCE</div><div class="clock-time mono">${S.clockedIn?'09:00':'--:--'}</div><span class="small muted">${S.clockedIn?'출근 상태를 체험하고 있어요':'오늘의 출근을 기록해 보세요'}</span></div>${act('clock-toggle',`${icon('clock')} ${S.clockedIn?'퇴근하기':'출근하기'}`,'','btn primary')}</section><section class="card"><div class="card-header"><h2>오늘의 근무자 <span class="number">${staff.length}</span></h2><span class="small muted mono">10월 17일 토요일</span></div><div class="card-body" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:0 15px">${staff.map(p=>`<div class="shift-person">${avatar(p.id,'online')}<div><b>${p.name} <span class="muted" style="font-weight:400">${p.role}</span></b><small class="mono">${branchName(p.branch)} · ${p.shift}</small></div></div>`).join('')}</div></section></div><section class="card"><div class="card-header"><h2>주간 근무표</h2><span class="small muted mono">2026. 10. 12. – 10. 18.</span></div>${table(['직원','월 12','화 13','수 14','목 15','금 16','토 17','일 18'],staff.map(p=>[`<span class="table-person">${avatar(p.id)} ${p.name}</span>`,...Array.from({length:7},(_,i)=>i===2||i===6?'<span class="shift-off">휴무</span>':`<span class="shift-block mono">${p.shift.replaceAll(' ','')}</span>`)]))}<div class="card-footer">${icon('info')} 주간 일정 및 출퇴근 버튼은 화면 체험용이며 실제 근태를 기록하지 않습니다.</div></section><section class="card" style="margin-top:20px"><div class="card-header"><h2>내 근태 기록</h2></div>${table(['날짜','출근','퇴근','근무 시간','상태'],[[`2026.10.17`,S.clockedIn?'09:00':'—','—',S.clockedIn?'근무 중':'—',badge(S.clockedIn?'출근':'미출근',S.clockedIn?'green':'gray')],['2026.10.16','09:00','18:00','8시간',badge('정상','green')],['2026.10.15','09:00','18:00','8시간',badge('정상','green')]])}</section></div>`;
  }
  function employeesPage() {
    const rows=branchStaff().filter(p=>!filter('employees').q||[p.name,p.role,p.email].some(v=>v.toLowerCase().includes(filter('employees').q.toLowerCase())));
    return `<div class="page">${heading('함께 공간을 만드는 사람들','지점별 동료와 역할을 확인하세요.',act('demo-hint',`${icon('plus')} 직원 초대`,'data-message="직원 초대와 권한 변경은 실제 계정 서비스 연동 후 사용할 수 있어요."','btn primary'))}<section class="card"><div class="toolbar">${searchInput('employees','직원 이름, 역할, 이메일 검색')}</div>${table(['직원','이메일','소속 지점','역할','상태'],rows.map(p=>[act('employee-detail',`<span class="table-person">${avatar(p.id)}${p.name}</span>`,`data-person="${p.id}"`,'cell-title'),p.email,branchName(p.branch),badge(p.role,p.role==='매니저'?'blue':'gray'),badge('활성','green')]))}<div class="list-summary"><span>총 ${rows.length}명</span><span>사장님 전용 메뉴</span></div></section><div style="margin-top:20px">${tip('역할에 따른 화면 차이를 검토하는 목업입니다. 실제 권한 체계와 직원 초대 정책은 PRD 이후 확정합니다.')}</div></div>`;
  }
  function settingsPage() {
    const p=me();
    return `<div class="page">${heading('나에게 맞는 워크스페이스','편안한 색상과 필요한 알림으로 업무 공간을 꾸며 보세요.')}<div class="settings-layout"><nav class="settings-nav" aria-label="설정 항목"><a href="#appearance" data-action="settings-anchor" data-target="appearance">화면 테마</a><a href="#my-profile" data-action="settings-anchor" data-target="my-profile">내 프로필</a><a href="#notification-settings" data-action="settings-anchor" data-target="notification-settings">알림 설정</a>${S.role==='owner'?'<a href="#branch-settings" data-action="settings-anchor" data-target="branch-settings">지점 설정</a>':''}</nav><div><section class="card settings-card" id="appearance"><h2>화면 테마</h2><p>우리 공간에 어울리는 분위기를 찾아보세요. 선택한 테마는 이 브라우저에 저장돼요.</p>${themes()}<div class="form-help" style="margin-top:17px">현재 테마: ${themeNames[theme]} · 로그인부터 채팅까지 동일하게 적용됩니다.</div></section><section class="card settings-card" id="my-profile"><h2>내 프로필</h2><p>팀원에게 표시되는 내 정보입니다.</p><div class="flex">${avatar(p.id,'large')}<div><b>${p.name}</b><p class="small muted">${p.email}</p></div></div><div class="setting-row"><div><b>역할과 소속</b><p>${S.role==='owner'?'사장님 · 전체 지점 운영':'직원 · 강남점 운영팀'}</p></div>${act('profile','역할 비교','','btn')}</div></section><section class="card settings-card" id="notification-settings"><h2>알림 설정</h2><p>알림 설정 화면을 체험해 보세요. 실제 알림은 발송하지 않습니다.</p>${[['task','업무 알림','배정된 업무와 상태 변경 소식'],['chat','채팅 알림','채널의 새 메시지와 답글'],['notice','중요 공지','운영에 필요한 팀 소식']].map(([id,title,sub])=>`<div class="setting-row"><div><b>${title}</b><p>${sub}</p></div>${act('notification-toggle','',`data-value="${id}" role="switch" aria-label="${title}" aria-checked="${S.notifications[id]}"`,'switch')}</div>`).join('')}</section>${S.role==='owner'?`<section class="card settings-card" id="branch-settings"><h2>지점 설정</h2><p>현재 운영 중인 공간입니다. 운영 정보는 샘플 데이터로 제공됩니다.</p>${D.branches.map(b=>`<div class="setting-row"><div><b>${b.name}</b><p>24시간 운영 · 전체 ${b.seats}석</p></div>${badge('운영 중','green')}</div>`).join('')}</section>`:''}${tip('테마만 브라우저에 저장됩니다. 업무, 대화, 역할 및 기타 설정은 새로고침하면 초기 상태로 돌아갑니다.')}</div></div></div>`;
  }
  function channelInfo() {
    if(S.channel.startsWith('dm-')){const p=person(S.channel.slice(3));return {name:p.name,description:`${p.role} · ${branchName(p.branch)} · 다이렉트 메시지`,dm:true,person:p};}
    return D.channels.find(c=>c.id===S.channel)||D.channels[1];
  }
  function taskAttachment(id) {
    const t=S.tasks.find(v=>v.id===id);if(!t)return '';
    return act('task-detail',`<div class="eyebrow">${icon('tasks')} 연결된 업무</div><h3>${esc(t.title)}</h3><div class="between"><span>${person(t.assignee).name} · ${fmtDate(t.due)}까지</span>${badge(t.status)}</div>`,`data-id="${id}"`,'task-attachment');
  }
  function messageHTML(m,thread=false) {
    const p=person(m.author);
    return `<article class="message">${avatar(p.id)}<div class="message-body"><div class="message-meta"><b>${p.name}</b>${p.id==='owner'?'<span class="role-tag">사장님</span>':''}<small class="mono">${esc(m.time)}</small></div><div class="message-text">${esc(m.text)}</div>${m.taskId?taskAttachment(m.taskId):''}${!thread?`<div class="message-actions">${act('thread',`${icon('chat')} ${m.replies.length?`답글 ${m.replies.length}개`:'답글 달기'}`,`data-id="${m.id}"`,'reply-btn')}</div>`:''}</div></article>`;
  }
  function composer(thread=false) {
    const c=channelInfo();
    const draftKey=thread?'reply-'+S.panel?.id:S.channel;
    return `<form id="${thread?'thread-form':'message-form'}" class="compose-wrap"><div class="composer"><label for="${thread?'reply-input':'message-input'}" class="sr-only">${thread?'스레드 답글':'메시지'}</label><textarea id="${thread?'reply-input':'message-input'}" name="message" data-draft="${esc(draftKey)}" placeholder="${thread?'이 대화에 답글 남기기':(c.dm?c.name+'님에게':'#'+c.name+'에')+' 메시지 보내기'}" required maxlength="2000">${esc(S.drafts[draftKey]||'')}</textarea><div class="compose-tools"><div class="flex" style="gap:2px">${act('demo-hint',icon('clip'),'aria-label="파일 첨부" data-message="파일 첨부는 실제 채팅 서비스 연동 후 사용할 수 있어요."','icon-btn')}${act('emoji',icon('smile'),`aria-label="이모지 추가" data-target="${thread?'reply-input':'message-input'}"`,'icon-btn')}${!thread?act('attach-task',icon('tasks'),'aria-label="업무 카드 첨부"','icon-btn'):''}</div><button class="btn primary" type="submit" aria-label="${thread?'답글 보내기':'메시지 보내기'}">보내기 ${icon('send')}</button></div></div><div class="compose-help"><span>Enter로 전송 · Shift + Enter로 줄바꿈</span><span>우리 팀만 볼 수 있는 공간이에요</span></div></form>`;
  }
  function chatPage() {
    const c=channelInfo(),messages=S.messages.filter(m=>m.channel===S.channel),members=c.dm?[me(),c.person]:D.people.filter(p=>!c.branch||c.branch==='all'||p.branch===c.branch||p.id==='owner');
    return `<header class="chat-header"><div><h1>${act('toggle-nav',icon('back'),'aria-label="채널 목록 열기"','icon-btn chat-channel-back')}${c.dm?avatar(c.person.id):icon('hash')}${esc(c.name)}</h1><p>${esc(c.description)}</p></div><div class="flex"><div class="members-stack">${members.slice(0,3).map(p=>avatar(p.id)).join('')}<small>${members.length}명</small></div>${act('channel-info',icon('info'),'aria-label="채널 정보 및 참여자"','icon-btn')}</div></header>${!c.dm?`<div class="chat-pin">${icon('pin')}<span>교대 전 미완료 업무와 특이 사항을 공유해 주세요.</span></div>`:''}<div class="messages" role="log" aria-label="${esc(c.name)} 대화"><section class="channel-intro"><div class="intro-icon">${icon(c.dm?'chat':'hash')}</div><h2>${c.dm?`${esc(c.name)}님과의 대화`:`${esc(c.name)}에 오신 것을 환영해요`}</h2><p>${c.dm?'업무에 필요한 이야기를 편하게 남겨 주세요.':esc(c.description)+'입니다.'}</p></section><div class="date-divider">2026년 10월 17일 토요일</div>${messages.length?messages.map(m=>messageHTML(m)).join(''):empty('첫 이야기를 남겨 보세요','업무 이야기부터 작은 아이디어까지, 함께 나눠요.')}</div>${composer()}`;
  }
  const pages={home:dashboard,tasks:tasksPage,members:membersPage,reservations:reservationsPage,spaces:spacesPage,facilities:()=>operationsPage('facilities'),inquiries:()=>operationsPage('inquiries'),notices:noticesPage,attendance:attendancePage,employees:employeesPage,settings:settingsPage,chat:chatPage};
  function render() {
    if(!S.authenticated){login();return;}
    if(S.route==='employees'&&S.role!=='owner')S.route='home';
    shell((pages[S.route]||dashboard)());
    document.title=`${titles[S.route]||'대시보드'} · OpenStudy`;
  }
  function route() {
    const parts=location.hash.replace(/^#\/?/,'').split('/');
    if(parts[0]==='main')return;
    const page=parts[0]||'home';
    if(page==='login')S.authenticated=false;
    S.route=pages[page]?page:'home';
    if(S.route==='employees'&&S.role==='staff'){S.route='home';history.replaceState(null,'','#/home');}
    if(S.route==='chat'){
      const requested=parts[1]||'gangnam';
      const dmIds=D.people.filter(p=>p.id!==me().id&&(S.role==='owner'||p.branch==='gangnam'||p.id==='owner')).map(p=>`dm-${p.id}`);
      S.channel=visibleChannels().some(c=>c.id===requested)||dmIds.includes(requested)?requested:'gangnam';
      S.unread[S.channel]=0;
    }
    S.navOpen=false;closePanel();render();
  }
  function goto(path) {if(location.hash===`#/${path}`){S.navOpen=false;render();}else location.hash=`/${path}`;}
  function toast(message) {
    clearTimeout(toast.timer);
    document.getElementById('toasts').innerHTML=`<div class="toast">${icon('check')}<span>${esc(message)}</span></div>`;
    toast.timer=setTimeout(()=>document.getElementById('toasts').replaceChildren(),3500);
  }
  let returnFocus=null;
  function openPanel(panel) {
    if(!dialog.open)returnFocus=document.activeElement;
    S.panel=panel;renderPanel();if(!dialog.open)dialog.showModal();
  }
  function closePanel() {S.panel=null;if(dialog.open)dialog.close();}
  function panelFrame(title,body,footer='',center=false,customCompose='') {
    dialog.className=center?'center-modal':'detail-panel';
    dialog.innerHTML=`<div class="dialog-inner"><header class="dialog-header"><h2 id="detail-title">${title}</h2>${act('close-panel',icon('close'),'aria-label="닫기"','icon-btn')}</header><div class="dialog-body">${body}</div>${customCompose||''}${footer?`<footer class="dialog-footer">${footer}</footer>`:''}</div>`;
  }
  function taskDetail(id) {
    const t=S.tasks.find(t=>t.id===id);if(!t)return;
    const canAssign=S.role==='owner';
    panelFrame('업무 상세',`<div class="between"><span class="eyebrow">TASK · ${String(t.id).padStart(3,'0')}</span>${badge(t.priority)}</div><h3 class="detail-title">${esc(t.title)}</h3><p class="detail-description">${esc(t.desc)}</p><div class="detail-properties"><div class="property"><span>상태</span><select data-task-edit="status" data-id="${t.id}" aria-label="업무 상태">${statusOptions(t.status)}</select></div><div class="property"><span>담당자</span>${canAssign?`<select data-task-edit="assignee" data-id="${t.id}" aria-label="업무 담당자">${personOptions(t.assignee,t.branch)}</select>`:`<span class="table-person">${avatar(t.assignee)} ${person(t.assignee).name}</span>`}</div><div class="property"><span>지점</span><b>${branchName(t.branch)}</b></div><div class="property"><span>기한</span><span class="mono">${fmtDate(t.due)}</span></div><div class="property"><span>분류</span><span>${esc(t.category)}</span></div></div><h4 class="detail-section-label">체크리스트 <span class="muted">${t.checks.filter(c=>c.done).length}/${t.checks.length}</span></h4><div class="checklist">${t.checks.map((c,i)=>`<label class="check-label ${c.done?'checked':''}"><input type="checkbox" data-check-task="${t.id}" data-index="${i}" ${c.done?'checked':''}><span>${esc(c.text)}</span></label>`).join('')}</div><h4 class="detail-section-label">업무 기록</h4><div class="detail-activity"><b>${person(t.assignee).name}</b>님이 담당하고 있어요.<br>${t.status==='완료'?'업무가 완료되었습니다.':'진행 상황을 변경하고 운영 채널에 공유해 주세요.'}</div>`,`${act('share-task',`${icon('chat')} 운영 채널에 공유`,`data-id="${t.id}"`,'btn')}${act('quick-complete',t.status==='완료'?'다시 열기':`${icon('check')} 완료하기`,`data-id="${t.id}"`,'btn primary')}`);
  }
  function newTaskPanel() {
    const b=S.branch==='all'?'gangnam':S.branch;
    panelFrame('새로운 업무 등록',`<form id="task-form"><div class="field"><label for="task-title">업무 제목 <span class="muted">*</span></label><input id="task-title" name="title" placeholder="예: 스터디룸 냉방 점검" required maxlength="100" autofocus></div><div class="field"><label for="task-desc">업무 내용</label><textarea id="task-desc" name="desc" placeholder="팀원이 알아야 할 내용을 남겨 주세요." maxlength="2000"></textarea></div><div class="form-row"><div class="field"><label for="task-branch">지점</label><select id="task-branch" name="branch">${D.branches.filter(v=>S.role==='owner'||v.id==='gangnam').map(v=>option(v.id,v.name,b)).join('')}</select></div><div class="field"><label for="task-assignee">담당자</label><select id="task-assignee" name="assignee" ${S.role==='staff'?'disabled':''}>${S.role==='staff'?option('minji','이민지','minji'):personOptions('minji',b)}</select></div></div><div class="form-row"><div class="field"><label for="task-due">기한</label><input id="task-due" type="date" name="due" value="${D.today}" required></div><div class="field"><label for="task-priority">우선순위</label><select id="task-priority" name="priority">${['보통','높음','낮음'].map(v=>option(v,v,'보통')).join('')}</select></div></div><div class="field"><label for="task-checks">체크리스트</label><textarea id="task-checks" name="checks" placeholder="한 줄에 하나씩 입력해 주세요." style="min-height:75px" maxlength="1500"></textarea></div>${tip('등록한 업무는 홈과 업무 목록에 함께 반영됩니다. 새로고침하면 샘플 상태로 돌아갑니다.')}</form>`,`${act('close-panel','취소')}<button type="submit" form="task-form" class="btn primary">업무 등록</button>`,true);
  }
  function recordDetail(type,id) {
    const r=S[type]?.find(r=>r.id===id);if(!r)return;
    let body='',footer='';
    if(type==='members'){
      body=`${badge(r.status)}<h3 class="detail-title">${esc(r.name)} <span class="muted" style="font-size:15px">회원</span></h3><p class="detail-description mono">${r.phone}</p><div class="detail-properties">${[['소속 지점',branchName(r.branch)],['이용권',r.pass],['잔여 이용',r.remaining],['만료일',fmtDate(r.expires)],['이용 좌석',r.seat]].map(([k,v])=>`<div class="property"><span>${k}</span><b>${esc(v)}</b></div>`).join('')}</div>${tip('회원 정보와 이용권 내역은 디자인 검토를 위한 가상 데이터입니다.')}`;
      footer=act('demo-hint','이용권 관리','data-message="이용권 변경과 결제는 실제 회원 서비스 연동 후 사용할 수 있어요."','btn primary');
    }else if(type==='reservations'){
      body=`${badge(r.status)}<h3 class="detail-title">${esc(r.space)}</h3><p class="detail-description">${esc(r.member)} 회원의 예약입니다.</p><div class="detail-properties">${[['지점',branchName(r.branch)],['예약일',fmtDate(r.date)],['이용 시간',r.time],['이용 인원',r.count]].map(([k,v])=>`<div class="property"><span>${k}</span><b>${esc(v)}</b></div>`).join('')}</div>${tip('예약 상세를 확인하는 목업입니다. 실제 예약은 생성되거나 취소되지 않습니다.')}`;
      footer=act('close-panel','확인','','btn primary');
    }else{
      const inquiry=type==='inquiries';
      body=`<span class="pill">${esc(r.category)}</span><h3 class="detail-title">${esc(r.title)}</h3><p class="detail-description">${esc(r.desc)}</p><div class="detail-properties"><div class="property"><span>처리 상태</span><select data-record-edit="status" data-type="${type}" data-id="${id}" aria-label="처리 상태">${statusOptions(r.status)}</select></div><div class="property"><span>담당자</span><select data-record-edit="assignee" data-type="${type}" data-id="${id}" aria-label="처리 담당자">${personOptions(r.assignee,r.branch)}</select></div><div class="property"><span>지점</span><b>${branchName(r.branch)}</b></div>${inquiry?`<div class="property"><span>문의 회원</span><b>${esc(r.member)}</b></div>`:''}</div>${inquiry?`<form id="inquiry-form" data-id="${id}"><div class="field"><label for="inquiry-reply">답변 내용</label><textarea id="inquiry-reply" name="reply" placeholder="회원에게 안내할 내용을 작성해 주세요." required maxlength="2000">${esc(r.reply)}</textarea></div></form>${tip('답변은 목업 안에만 반영되며 실제 회원에게 전송되지 않습니다.')}`:tip('상태 변경은 시설 목록과 홈의 미처리 점검에 함께 반영됩니다.')}`;
      footer=inquiry?'<button type="submit" form="inquiry-form" class="btn primary">답변 저장</button>':act('close-panel','확인','','btn primary');
    }
    panelFrame(titles[type]+' 상세',body,footer);
  }
  function noticeDetail(id) {
    const n=S.notices.find(n=>n.id===id);if(!n)return;
    panelFrame('팀 공지',`<div class="between">${badge(n.pinned?'중요 공지':n.category,n.pinned?'orange':'gray')}<span class="small muted">${branchName(n.branch)}</span></div><h3 class="detail-title">${esc(n.title)}</h3><div class="flex" style="margin:20px 0">${avatar(n.author)}<div><b class="small">${person(n.author).name}</b><p class="muted small mono">${fmtDate(n.date)}</p></div></div><p class="detail-description" style="color:var(--ink)">${esc(n.body)}</p>`,`${act('pin-notice',`${icon('pin')} ${n.pinned?'중요 공지 해제':'중요 공지로 고정'}`,`data-id="${id}"`,'btn')}${act('close-panel','확인','','btn primary')}`);
  }
  function newNoticePanel() {
    panelFrame('팀에게 전하는 새 소식',`<form id="notice-form"><div class="field"><label for="notice-title">공지 제목</label><input id="notice-title" name="title" required maxlength="100" placeholder="어떤 소식을 전할까요?" autofocus></div><div class="field"><label for="notice-branch">공개 대상</label><select id="notice-branch" name="branch">${S.role==='owner'?option('all','전체 지점','all'):''}${D.branches.filter(v=>S.role==='owner'||v.id==='gangnam').map(v=>option(v.id,v.name,S.branch)).join('')}</select></div><div class="field"><label for="notice-body">내용</label><textarea id="notice-body" name="body" required maxlength="4000" style="min-height:180px" placeholder="동료가 알아야 할 내용을 남겨 주세요."></textarea></div><label class="check-label"><input type="checkbox" name="pinned"> 중요 공지로 고정</label></form>`,`${act('close-panel','취소')}<button type="submit" form="notice-form" class="btn primary">공지 등록</button>`,true);
  }
  function threadPanel(id) {
    const m=S.messages.find(m=>m.id===id);if(!m)return;
    panelFrame('스레드',`<div class="thread-parent">${messageHTML(m,true)}</div><h4 class="detail-section-label">답글 ${m.replies.length}개</h4><div class="thread-replies">${m.replies.map(r=>messageHTML(r,true)).join('')||'<p class="small muted">처리 결과나 확인한 내용을 답글로 남겨 주세요.</p>'}</div>`,'',false,composer(true));
  }
  function renderPanel() {
    const p=S.panel;if(!p)return;
    if(p.type==='task')return taskDetail(p.id);
    if(p.type==='new-task')return newTaskPanel();
    if(p.type==='record')return recordDetail(p.recordType,p.id);
    if(p.type==='notice')return noticeDetail(p.id);
    if(p.type==='new-notice')return newNoticePanel();
    if(p.type==='thread')return threadPanel(p.id);
    if(p.type==='profile')return panelFrame('내 워크스페이스',`<div class="flex">${avatar(me().id,'large')}<div><h3>${me().name}</h3><p class="small muted">${me().email}</p></div></div><h4 class="detail-section-label">역할별 화면 비교</h4><p class="small muted">역할을 바꿔도 등록한 업무와 대화는 유지됩니다.</p><div class="profile-role-options">${[['owner','사장님','전체 지점 · 업무 배정 · 직원 관리'],['staff','직원','강남점 · 내 업무 · 인수인계 채팅']].map(([role,title,sub])=>act('switch-role',`${icon(role==='owner'?'branch':'members')}<span class="grow"><strong>${title}</strong><small>${sub}</small></span>${S.role===role?icon('check'):''}`,`data-role="${role}" aria-pressed="${S.role===role}"`,`profile-role ${S.role===role?'active':''}`)).join('')}</div>${tip('역할 전환은 디자인 비교용입니다. 실제 서비스의 권한 정책을 의미하지 않습니다.')}`,`${act('logout',`${icon('logout')} 로그아웃`,'','btn danger')}`,true);
    if(p.type==='notifications')return panelFrame('새로운 소식',`<p class="small muted">샘플 알림 · 현재 지점 기준</p>${scoped(S.tasks).filter(t=>t.status!=='완료').slice(0,3).map(t=>act('task-detail',`<span class="icon-btn">${icon('tasks')}</span><span><b>${esc(t.title)}</b><p>${person(t.assignee).name} 담당 · ${branchName(t.branch)} · ${fmtDate(t.due)}까지</p></span>`,`data-id="${t.id}"`,'notification-item')).join('')}${scoped(S.notices).slice(0,1).map(n=>act('notice-detail',`<span class="icon-btn">${icon('notice')}</span><span><b>${esc(n.title)}</b><p>새로운 팀 공지가 있어요.</p></span>`,`data-id="${n.id}"`,'notification-item')).join('')}`);
    if(p.type==='channel-info'){
      const c=channelInfo(),members=c.dm?[me(),c.person]:D.people.filter(v=>c.branch==='all'||v.branch===c.branch||v.id==='owner');
      return panelFrame(c.dm?'대화 정보':'채널 정보',`<span class="pill">${c.dm?'DIRECT MESSAGE':'TEAM CHANNEL'}</span><h3 class="detail-title">${c.dm?'':'# '}${esc(c.name)}</h3><p class="detail-description">${esc(c.description)}</p><h4 class="detail-section-label">함께하는 동료 ${members.length}명</h4>${members.map(v=>`<div class="shift-person">${avatar(v.id,'online')}<div><b>${v.name}</b><small>${v.role} · ${branchName(v.branch)}</small></div></div>`).join('')}`);
    }
    if(p.type==='attach-task')return panelFrame('공유할 업무 선택',`<p class="small muted" style="margin-bottom:15px">현재 채팅에 연결된 업무 카드를 보냅니다.</p>${scoped(S.tasks).map(t=>act('share-task',`<span class="grow"><b>${esc(t.title)}</b><small style="display:block;margin-top:5px">${branchName(t.branch)} · ${person(t.assignee).name}</small></span>${badge(t.status)}`,`data-id="${t.id}" data-current-channel="true"`,'notification-item')).join('')||empty('공유할 업무가 없어요','먼저 업무 관리에서 업무를 등록해 주세요.')}`);
    if(p.type==='help')return panelFrame('OpenStudy 목업 둘러보기',`<h3 class="detail-title">좋은 공간을 함께 만드는 흐름</h3><p class="detail-description">1. 업무 관리에서 새 업무를 등록합니다.\n2. 업무 상세에서 운영 채널에 공유합니다.\n3. 사용자 메뉴에서 직원 역할로 전환합니다.\n4. 업무 카드 아래 스레드에 처리 결과를 남깁니다.\n5. 업무를 완료하면 홈과 채팅 카드에 반영됩니다.</p><h4 class="detail-section-label">테마 비교</h4>${themes()}<div style="margin-top:20px">${tip('테마를 제외한 변경 사항은 새로고침하면 초기화됩니다. 실제 인증, 결제, 메시지 발송은 수행하지 않습니다.')}</div>`,act('close-panel','둘러보기','','btn primary'),true);
    if(p.type==='employee'){
      const v=person(p.id);return panelFrame('직원 상세',`<div class="flex">${avatar(v.id,'large')}<div><h3 class="detail-title" style="margin:0">${v.name}</h3><span class="muted small">${v.email}</span></div></div><div class="detail-properties" style="margin-top:25px">${[['역할',v.role],['소속 지점',branchName(v.branch)],['근무 시간',v.shift]].map(([k,v])=>`<div class="property"><span>${k}</span><b>${v}</b></div>`).join('')}</div>${tip('실제 권한 변경과 직원 초대는 계정 서비스 연동 후 사용할 수 있습니다.')}`);
    }
    if(p.type==='seat'){
      const state=seatState(p.number),status=state==='repair'?'점검 중':state==='used'?'이용 중':'이용 가능';
      return panelFrame('좌석 상세',`${badge(status,state==='repair'?'red':state==='used'?'green':'gray')}<h3 class="detail-title">${S.seatZone}-${String(p.number).padStart(2,'0')} 좌석</h3><p class="detail-description">${branchName(p.branch)} · ${S.seatZone==='A'?'집중존':'오픈존'}</p><div class="detail-properties"><div class="property"><span>상태</span><b>${status}</b></div><div class="property"><span>좌석 유형</span><b>자유석 · 개인 콘센트</b></div></div>${tip('대표 좌석의 배치와 상태를 확인하는 디자인 예시입니다. 실제 출입 및 좌석 이용 기록과 연결되어 있지 않습니다.')}`);
    }
    if(p.type==='room')return panelFrame('스터디룸 상세',`<span class="pill">예약 가능 공간</span><h3 class="detail-title">스터디룸 ${p.room}</h3><p class="detail-description">${branchName(p.branch)} · ${p.room==='A'?'4인':'2인'} 스터디룸\n화이트보드 · 개인 콘센트 · 냉난방</p>${tip('예약 관리에서 오늘의 예약과 상세 시간을 확인할 수 있어요.')}`,act('goto-reservations','예약 확인','','btn primary'));
  }
  function refreshWithPanel() {
    const p=S.panel,active=document.activeElement,scroll=dialog.querySelector('.dialog-body')?.scrollTop||0;
    const main=document.querySelector('main'),mainScroll=main?.scrollTop||0;
    const controls=[...dialog.querySelectorAll('input[name],textarea[name]')].map(el=>({name:el.name,value:el.value,checked:el.checked}));
    const focusKey=active?.id?`#${active.id}`:active?.dataset.taskEdit?`[data-task-edit="${active.dataset.taskEdit}"]`:active?.dataset.recordEdit?`[data-record-edit="${active.dataset.recordEdit}"]`:active?.dataset.checkTask?`[data-check-task="${active.dataset.checkTask}"][data-index="${active.dataset.index}"]`:active?.dataset.action?`[data-action="${active.dataset.action}"]`:null;
    render();if(document.querySelector('main'))document.querySelector('main').scrollTop=mainScroll;
    if(p){
      S.panel=p;renderPanel();
      for(const c of controls){const el=dialog.querySelector(`[name="${c.name}"]`);if(el){el.value=c.value;if(el.type==='checkbox')el.checked=c.checked;}}
      if(focusKey)dialog.querySelector(focusKey)?.focus({preventScroll:true});
      const body=dialog.querySelector('.dialog-body');if(body)body.scrollTop=scroll;
    }
  }
  function loginAs(role) {
    S.authenticated=true;S.role=role;S.branch=role==='owner'?'all':'gangnam';S.taskTab=role==='staff'?'mine':'all';S.homeTab=role==='staff'?'mine':'today';
    const desired=S.route==='employees'&&role==='staff'?'home':S.route;
    goto(desired==='chat'?`chat/${S.channel}`:desired);render();toast(`${me().name}님, 좋은 하루 보내세요!`);
  }
  function shareTask(id,currentChannel=false) {
    const t=S.tasks.find(t=>t.id===id);if(!t)return;
    const channel=currentChannel?S.channel:t.branch;
    S.messages.push({id:Math.max(0,...S.messages.map(m=>m.id))+1,channel,author:me().id,time:getTime(),text:'함께 확인할 업무를 공유했어요. 진행 상황과 처리 결과를 남겨 주세요.',taskId:t.id,replies:[]});
    closePanel();goto(`chat/${channel}`);render();toast('채팅에 업무 카드를 공유했어요.');
  }
  const actions = {
    'theme':el=>{
      const t=el.dataset.themeValue;if(!themeNames[t])return;
      theme=t;document.documentElement.dataset.theme=t;
      try{localStorage.setItem('openstudy-theme',t);}catch{toast('브라우저 저장이 제한되어 현재 창에서만 테마가 유지돼요.');}
      // Preserve form drafts, focus, scroll positions, and open panels while recoloring.
      document.querySelectorAll('[data-theme-value]').forEach(btn=>{const active=btn.dataset.themeValue===t;btn.classList.toggle('active',active);btn.setAttribute('aria-pressed',active);const mark=btn.querySelector('.selected-mark');if(mark)mark.textContent=active?'✓':'';});
      const help=document.querySelector('#appearance .form-help');if(help)help.textContent=`현재 테마: ${themeNames[t]} · 로그인부터 채팅까지 동일하게 적용됩니다.`;
    },
    'demo-login':el=>loginAs(el.dataset.role),
    'password-toggle':el=>{const input=document.getElementById('password');input.type=input.type==='password'?'text':'password';el.setAttribute('aria-pressed',input.type==='text');el.setAttribute('aria-label',input.type==='text'?'비밀번호 숨기기':'비밀번호 표시');},
    'forgot':()=>toast('비밀번호 재설정은 실제 계정 서비스 연동 후 사용할 수 있어요.'),
    'demo-hint':el=>toast(el.dataset.message||'실제 서비스 연동 후 사용할 수 있어요.'),
    'toggle-nav':()=>{S.navOpen=!S.navOpen;render();},'close-nav':()=>{S.navOpen=false;render();},
    'profile':()=>openPanel({type:'profile'}),'notifications':()=>openPanel({type:'notifications'}),'help':()=>openPanel({type:'help'}),
    'close-panel':closePanel,
    'logout':()=>{S.authenticated=false;closePanel();goto('login');login();},
    'switch-role':el=>{
      S.role=el.dataset.role;S.branch=S.role==='staff'?'gangnam':'all';S.taskTab=S.role==='staff'?'mine':'all';S.homeTab=S.role==='staff'?'mine':'today';
      if(S.route==='employees'&&S.role==='staff'){S.route='home';history.replaceState(null,'','#/home');}
      if(S.route==='chat'&&((!visibleChannels().some(c=>c.id===S.channel)&&!S.channel.startsWith('dm-'))||S.channel===`dm-${me().id}`||(S.role==='staff'&&['dm-yujin','dm-doyun'].includes(S.channel)))){S.channel='gangnam';history.replaceState(null,'','#/chat/gangnam');}
      closePanel();render();toast(`${S.role==='owner'?'사장님':'직원'} 화면으로 전환했어요.`);
    },
    'home-tab':el=>{S.homeTab=el.dataset.value;render();},'task-tab':el=>{S.taskTab=el.dataset.value;render();},
    'task-detail':el=>openPanel({type:'task',id:Number(el.dataset.id)}),'new-task':()=>openPanel({type:'new-task'}),
    'quick-complete':el=>{const t=S.tasks.find(t=>t.id===Number(el.dataset.id));if(!t)return;t.status=t.status==='완료'?'할 일':'완료';t.checks.forEach(c=>c.done=t.status==='완료');refreshWithPanel();toast(t.status==='완료'?'업무를 완료했어요. 수고하셨습니다!':'업무를 다시 열었어요.');},
    'share-task':el=>shareTask(Number(el.dataset.id),Boolean(el.dataset.currentChannel)),
    'reservation-view':el=>{S.reservationView=el.dataset.value;render();},'seat-zone':el=>{S.seatZone=el.dataset.value;render();},
    'seat-detail':el=>openPanel({type:'seat',number:Number(el.dataset.number),branch:el.dataset.branch}),
    'room-detail':el=>openPanel({type:'room',room:el.dataset.room,branch:el.dataset.branch}),
    'record-detail':el=>openPanel({type:'record',recordType:el.dataset.type,id:Number(el.dataset.id)}),
    'notice-detail':el=>openPanel({type:'notice',id:Number(el.dataset.id)}),'new-notice':()=>openPanel({type:'new-notice'}),
    'pin-notice':el=>{const n=S.notices.find(n=>n.id===Number(el.dataset.id));n.pinned=!n.pinned;refreshWithPanel();toast(n.pinned?'중요 공지로 고정했어요.':'중요 공지를 해제했어요.');},
    'clock-toggle':()=>{S.clockedIn=!S.clockedIn;render();toast(S.clockedIn?'데모 출근 상태로 변경했어요.':'데모 퇴근 상태로 변경했어요.');},
    'notification-toggle':el=>{const k=el.dataset.value;S.notifications[k]=!S.notifications[k];el.setAttribute('aria-checked',String(S.notifications[k]));toast('알림 설정 예시를 변경했어요.');},
    'employee-detail':el=>openPanel({type:'employee',id:el.dataset.person}),
    'thread':el=>openPanel({type:'thread',id:Number(el.dataset.id)}),
    'channel-info':()=>openPanel({type:'channel-info'}),'attach-task':()=>openPanel({type:'attach-task'}),
    'emoji':el=>{const input=document.getElementById(el.dataset.target);input.setRangeText(' 🌿 ',input.selectionStart,input.selectionEnd,'end');S.drafts[input.dataset.draft]=input.value;input.focus();},
    'reset-filters':el=>{delete S.filters[el.dataset.page];render();},
    'goto-reservations':()=>{closePanel();goto('reservations');},
    'settings-anchor':el=>document.getElementById(el.dataset.target)?.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'})
  };
  document.addEventListener('click',event=>{
    const el=event.target.closest('[data-action]');
    if(el){event.preventDefault();actions[el.dataset.action]?.(el);}
    const nav=event.target.closest('.nav-link,.rail-item');
    if(nav?.getAttribute('href')){
      S.navOpen=false;
      document.querySelector('.workspace')?.classList.remove('nav-open');
      document.querySelector('.mobile-menu')?.setAttribute('aria-expanded','false');
    }
  });
  document.addEventListener('change',event=>{
    const el=event.target;
    if(el.id==='branch-select'){
      S.branch=S.role==='owner'?el.value:'gangnam';S.filters={};render();return;
    }
    if(el.id==='seat-branch'){S.seatBranch=el.value;render();return;}
    if(el.id==='task-branch'){document.getElementById('task-assignee').innerHTML=personOptions(null,el.value);return;}
    if(el.dataset.filter){
      // Search fields already render on input; rendering again on blur causes reentrant DOM replacement.
      if(el.dataset.filter!=='q'){filter(el.dataset.filterPage)[el.dataset.filter]=el.value;render();}
      return;
    }
    if(el.dataset.taskEdit){const t=S.tasks.find(t=>t.id===Number(el.dataset.id));t[el.dataset.taskEdit]=el.value;if(el.dataset.taskEdit==='status'&&el.value==='완료')t.checks.forEach(c=>c.done=true);refreshWithPanel();toast('업무를 업데이트했어요.');return;}
    if(el.dataset.checkTask){const t=S.tasks.find(t=>t.id===Number(el.dataset.checkTask));t.checks[Number(el.dataset.index)].done=el.checked;if(!el.checked&&t.status==='완료')t.status='진행 중';refreshWithPanel();return;}
    if(el.dataset.recordEdit){const r=S[el.dataset.type].find(r=>r.id===Number(el.dataset.id));r[el.dataset.recordEdit]=el.value;refreshWithPanel();toast('처리 정보를 변경했어요.');}
  });
  document.addEventListener('input',event=>{
    const el=event.target;
    if(el.dataset.draft){S.drafts[el.dataset.draft]=el.value;return;}
    if(el.dataset.filter!=='q')return;
    const page=el.dataset.filterPage,pos=el.selectionStart;
    filter(page).q=el.value;render();
    const input=document.querySelector(`[data-filter-page="${page}"][data-filter="q"]`);input?.focus();input?.setSelectionRange(pos,pos);
  });
  document.addEventListener('submit',event=>{
    const form=event.target;event.preventDefault();const data=new FormData(form);
    if(form.id==='login-form'){
      const email=String(data.get('email')||'').trim(),pw=String(data.get('password')||'');
      if(!email||!pw||!document.getElementById('email').validity.valid){const error=document.getElementById('login-error');error.hidden=false;error.textContent=!email||!pw?'이메일과 비밀번호를 모두 입력해 주세요.':'올바른 이메일 형식을 입력해 주세요.';document.getElementById(!email||!document.getElementById('email').validity.valid?'email':'password').focus();return;}
      loginAs('owner');return;
    }
    if(form.id==='global-search'){filter('tasks').q=String(data.get('q')||'').trim();S.taskTab='all';goto('tasks');render();return;}
    if(form.id==='task-form'){
      const title=String(data.get('title')||'').trim();if(!title){form.elements.title.setCustomValidity('업무 제목을 입력해 주세요.');form.elements.title.reportValidity();form.elements.title.addEventListener('input',()=>form.elements.title.setCustomValidity(''),{once:true});return;}
      const b=S.role==='staff'?'gangnam':String(data.get('branch'));
      const checks=String(data.get('checks')||'').split('\n').map(v=>v.trim()).filter(Boolean).map(text=>({text,done:false}));
      const t={id:Math.max(0,...S.tasks.map(t=>t.id))+1,title,desc:String(data.get('desc')||'').trim(),branch:b,assignee:S.role==='staff'?'minji':String(data.get('assignee')),status:'할 일',priority:String(data.get('priority')),due:String(data.get('due')),category:'일반 업무',checks:checks.length?checks:[{text:'처리 결과를 팀에 공유하기',done:false}]};
      S.tasks.unshift(t);S.filters.tasks={q:'',status:'',assignee:'',due:'',date:''};S.taskTab=S.role==='staff'?'mine':'all';closePanel();render();openPanel({type:'task',id:t.id});toast('새로운 업무를 등록했어요.');return;
    }
    if(form.id==='message-form'||form.id==='thread-form'){
      const text=String(data.get('message')||'').trim();if(!text){form.querySelector('textarea').focus();return;}
      if(form.id==='thread-form'){
        const m=S.messages.find(m=>m.id===S.panel?.id);if(!m)return;
        m.replies.push({author:me().id,time:getTime(),text});S.drafts['reply-'+m.id]='';form.reset();form.querySelector('textarea').value='';refreshWithPanel();document.getElementById('reply-input')?.focus();
        const body=dialog.querySelector('.dialog-body');if(body)body.scrollTop=body.scrollHeight;
      }else{
        S.messages.push({id:Math.max(0,...S.messages.map(m=>m.id))+1,channel:S.channel,author:me().id,time:getTime(),text,replies:[]});S.drafts[S.channel]='';render();document.getElementById('message-input')?.focus();
      }return;
    }
    if(form.id==='notice-form'){
      const title=String(data.get('title')||'').trim(),body=String(data.get('body')||'').trim();
      if(!title||!body){toast('제목과 내용을 입력해 주세요.');return;}
      const n={id:Math.max(...S.notices.map(n=>n.id))+1,title,body,branch:S.role==='staff'?'gangnam':String(data.get('branch')),pinned:data.has('pinned'),category:'팀 소식',date:D.today,author:me().id};
      S.notices.unshift(n);closePanel();render();openPanel({type:'notice',id:n.id});toast('팀 공지를 등록했어요.');return;
    }
    if(form.id==='inquiry-form'){
      const r=S.inquiries.find(r=>r.id===Number(form.dataset.id));r.reply=String(data.get('reply')||'').trim();if(!r.reply){toast('답변 내용을 입력해 주세요.');return;}refreshWithPanel();toast('답변을 목업에 저장했어요. 실제로 전송되지 않습니다.');
    }
  });
  document.addEventListener('keydown',event=>{
    const tag=event.target.tagName;
    if(event.key==='/'&&!['INPUT','TEXTAREA','SELECT'].includes(tag)&&!dialog.open){const search=document.querySelector('#global-search input');if(search&&getComputedStyle(search.closest('form')).display!=='none'){event.preventDefault();search.focus();}}
    if(event.key==='Escape'&&S.navOpen){S.navOpen=false;render();}
    if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing&&['message-input','reply-input'].includes(event.target.id)){event.preventDefault();event.target.closest('form').requestSubmit();}
  });
  dialog.addEventListener('keydown',event=>{
    if(event.key!=='Tab')return;
    const controls=[...dialog.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled):not([type="hidden"]),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')].filter(el=>el.getClientRects().length);
    const first=controls[0],last=controls.at(-1);
    if(!first)return;
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
    else if(!event.shiftKey&&(document.activeElement===last||!dialog.contains(document.activeElement))){event.preventDefault();first.focus();}
  });
  dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)closePanel();}});
  dialog.addEventListener('close',()=>{
    // A queued close event may belong to the preceding dialog when creation opens a detail immediately.
    if(dialog.open)return;
    S.panel=null;dialog.replaceChildren();
    if(returnFocus?.isConnected)returnFocus.focus();else document.querySelector('main')?.focus();
  });
  window.addEventListener('hashchange',route);
  route();
})();
