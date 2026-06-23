const API = 'https://cats-mining-backend.onrender.com';
const BOT_WALLET = 'UQBl_vId6Bx45nhqVFa2OLuA1upxZxNXvTkH8zLEo_jbkrd1';
const BOT_USERNAME = 'MiningCatsBot';
const tg = window.Telegram && window.Telegram.WebApp;
let userData = null;
let pendingInterval = null;
let tonConnectUI = null;
let currentBuyMiner = null;
let currentBuyMemo = null;

// ============ PROFESSIONAL SVG ICONS LIBRARY ============
// All icons use same stroke-width:2, viewBox:0 0 24 24, currentColor
const ICON = {
  // Money & Crypto
  coin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9 8h4.5a2.5 2.5 0 010 5H10a2.5 2.5 0 000 5h5"/><path d="M12 5v3M12 16v3"/></svg>',
  diamond: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12l4 6-10 13L2 9z"/><path d="M11 3L8 9l4 13 4-13-3-6"/><path d="M2 9h20"/></svg>',
  wallet: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="14" rx="2"/><path d="M16 14a2 2 0 010-4h6v4z"/></svg>',
  // Mining
  pickaxe: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3l14 4v3l-14-4z" fill="currentColor" fill-opacity="0.25"/><path d="M5 3l14 4v3l-14-4z"/><path d="M9 6l-7 13 2 2 11-12"/><circle cx="3" cy="20" r="1.5" fill="currentColor"/></svg>`,
  // People
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 016-6h4a6 6 0 016 6v1"/></svg>',
  users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5"/><path d="M2 21v-1a5 5 0 015-5h4a5 5 0 015 5v1"/><circle cx="17" cy="9" r="2.5"/><path d="M22 19v-.5a3.5 3.5 0 00-3-3.46"/></svg>',
  // Rewards
  gift: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 010-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 000-5C13 2 12 7 12 7z"/></svg>',
  // Communication
  megaphone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 11-5.8-1.6"/></svg>',
  send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>',
  // Actions
  withdraw: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="M5 12l7-7 7 7"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>',
  link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 007.5.5l3-3a5 5 0 00-7-7l-1.5 1.5"/><path d="M14 11a5 5 0 00-7.5-.5l-3 3a5 5 0 007 7l1.5-1.5"/></svg>',
  share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.6" y1="13.5" x2="15.4" y2="17.5"/><line x1="15.4" y1="6.5" x2="8.6" y2="10.5"/></svg>',
  // Status
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="8 12 11 15 16 9"/></svg>',
  warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.41 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>',
  cross: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="9" y1="9" x2="15" y2="15"/><line x1="15" y1="9" x2="9" y2="15"/></svg>',
  // Settings
  bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 01-3.4 0"/></svg>',
  cat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5l-3-3v6l3-3 3 3V2z" fill="currentColor"/><path d="M5 9c0-2 2-4 7-4s7 2 7 4v6a4 4 0 01-4 4H9a4 4 0 01-4-4V9z"/><circle cx="9" cy="13" r="0.8" fill="currentColor"/><circle cx="15" cy="13" r="0.8" fill="currentColor"/><path d="M11 16h2"/></svg>',
  // Arrows
  arrowRight: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="13 6 19 12 13 18"/></svg>',
  arrowUp: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="6 11 12 5 18 11"/></svg>'
};

// Helper: render inline icon with sizing
function ic(name, size) {
  size = size || 14;
  return `<span class="ic" style="width:${size}px;height:${size}px">${ICON[name]||''}</span>`;
}

// ============ TON CONNECT ============
try {
  tonConnectUI = new TON_CONNECT_UI.TonConnectUI({
    manifestUrl: 'https://cats-mining.vercel.app/tonconnect-manifest.json',
    buttonRootId: null
  });
  tonConnectUI.onStatusChange(w => updateWalletUI(w));
} catch(e) { console.error('TON Connect init error:', e); }

function updateWalletUI(w) {
  const btn = document.getElementById('wallet-card-btn');
  const txt = document.getElementById('wallet-card-btn-text');
  const addrBox = document.getElementById('wallet-card-addr');
  const addrTxt = document.getElementById('wallet-addr-text');
  if (w) {
    const a = w.account.address;
    txt.textContent = 'Disconnect';
    btn.classList.add('connected');
    addrTxt.textContent = a.slice(0,8) + '...' + a.slice(-6);
    addrBox.style.display = 'flex';

    // Save wallet to backend (for task verification + anti-fraud)
    if (userData && userData.telegramId) {
      fetch(API+'/api/user/wallet', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({ telegramId: userData.telegramId, walletAddress: a })
      }).then(r=>r.json()).then(d=>{
        if (d.success) {
          userData.walletAddress = a;
          console.log('[WALLET] saved');
        } else if (d.error === 'WALLET_ALREADY_USED') {
          toast('⚠ This wallet is already linked to another account');
        }
      }).catch(()=>{});
    }
  } else {
    txt.textContent = 'Connect';
    btn.classList.remove('connected');
    addrBox.style.display = 'none';
  }
}

async function connectWallet() {
  if (!tonConnectUI) { toast('⚠ TON Connect not available'); return; }
  try {
    if (tonConnectUI.connected) {
      if (confirm('Disconnect wallet?')) await tonConnectUI.disconnect();
    } else {
      await tonConnectUI.openModal();
    }
  } catch(e) {}
}

function copyWalletAddr() {
  if (!tonConnectUI || !tonConnectUI.connected) return;
  copyText(tonConnectUI.account.address);
}

// ============ INIT ============
document.addEventListener('DOMContentLoaded', async () => {
  if (tg) { tg.ready(); tg.expand(); tg.setHeaderColor('#080810'); tg.setBackgroundColor('#080810'); }
  const saved = localStorage.getItem('cm_lang');
  if (saved && LANGS[saved]) currentLang = saved;
  renderAll();

  if (tg && tg.initDataUnsafe && tg.initDataUnsafe.user) {
    await registerUser();
    return;
  }
  if (tg && tg.initData) {
    try {
      const params = new URLSearchParams(tg.initData);
      const userStr = params.get('user');
      if (userStr) {
        const u = JSON.parse(userStr);
        await registerWithId(u.id.toString(), u.first_name||'', u.username||'', u.photo_url||'', '');
        return;
      }
    } catch(e) {}
  }
  const testId = new URLSearchParams(window.location.search).get('id');
  if (testId) { await registerWithId(testId,'Test','','',''); return; }
  toast('⚠ Open from @'+BOT_USERNAME);
});

async function registerUser() {
  const u = tg.initDataUnsafe.user;
  let refBy = '';
  if (tg.initDataUnsafe.start_param && tg.initDataUnsafe.start_param.startsWith('ref_'))
    refBy = tg.initDataUnsafe.start_param.replace('ref_','');
  await registerWithId(u.id.toString(), u.first_name||'', u.username||'', u.photo_url||'', refBy);
}

async function registerWithId(telegramId, firstName, username, photoUrl, refBy) {
  try {
    const r = await fetch(API+'/api/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({telegramId,firstName,username,photoUrl,refBy})});
    const d = await r.json();
    if (d.success) { userData=d.user; renderAll(); startPendingCounter(); }
    else toast('⚠ '+(d.error||'Error'));
  } catch(e) { toast('⚠ Connection error'); }
}

async function refreshUser() {
  if (!userData) return;
  try {
    const r = await fetch(API+'/api/user/'+userData.telegramId);
    const d = await r.json();
    if (d.success) { userData=d.user; updateStats(); renderMiners(); }
  } catch(e) {}
}

// ============ PENDING ============
function startPendingCounter() {
  if (pendingInterval) clearInterval(pendingInterval);
  updatePending();
  // Slower interval (5s instead of 3s) reduces server load
  pendingInterval = setInterval(() => {
    // Skip updates when document is hidden (saves battery + API calls)
    if (document.hidden) return;
    updatePending();
  }, 5000);
}

async function updatePending() {
  if (!userData) return;
  try {
    const r = await fetch(API+'/api/miners/pending/'+userData.telegramId);
    const d = await r.json();
    if (d.success) {
      const pndEl = document.getElementById('pending-value');
      const profEl = document.getElementById('stat-profit');
      const minEl = document.getElementById('stat-miners');
      const hdrMin = document.getElementById('hdr-miners');
      if (pndEl) pndEl.innerHTML = d.pending.toFixed(4)+' <span class="pnd-ton">TON</span>';
      if (profEl) profEl.textContent = d.dailyProfit.toFixed(3);
      if (minEl) minEl.textContent = d.activeCount;
      if (hdrMin) hdrMin.textContent = d.activeCount;
    }
  } catch(e) {}
}

// ============ NAV ============
function goPage(name, el) {
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nav-i').forEach(n=>n.classList.remove('active'));
  document.getElementById('page-'+name).classList.add('active');
  // Find nav item by data-page
  const navItem = document.querySelector('.nav-i[data-page="'+name+'"]');
  if (navItem) navItem.classList.add('active');
  else if (el) el.classList.add('active');
  if (name==='tasks') loadTasks();
  if (name==='friends') loadReferrals();
  window.scrollTo(0,0);
}

function toggleLangMenu() {
  const m = document.getElementById('lang-menu');
  m.style.display = m.style.display==='none'?'block':'none';
}
document.addEventListener('click', e => {
  if (!e.target.closest('.lang-btn') && !e.target.closest('.lang-menu'))
    document.getElementById('lang-menu').style.display='none';
});

// ============ RENDER ALL ============
function renderAll() {
  if (typeof LANGS === 'undefined') return;
  const L = LANGS[currentLang];
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  const setHTML = (id, val) => { const el = document.getElementById(id); if (el) el.innerHTML = val; };

  set('lang-btn', L.flag);
  set('app-sub', T('appSub'));
  set('stat-profit-label', T('profitDay'));
  set('stat-miners-label', T('activeMiners'));
  set('pending-label', T('pending'));
  set('pending-status', T('accumulating'));
  set('collect-btn', T('collect'));
  set('miners-title', T('allMiners'));
  set('miners-levels', T('levels'));
  set('tasks-title', T('tasksList'));
  set('friends-title', T('inviteTitle'));
  set('friends-sub', T('inviteSub'));
  set('ref-label', T('inviteLink'));
  setHTML('btn-share', ic('share',13)+' '+T('share'));
  setHTML('btn-send', ic('send',13)+' '+T('sendChat'));
  set('ref-count-label', T('totalRefs'));
  set('ref-commission-label', T('commission'));
  set('nav-miners', T('miners'));
  set('nav-tasks', T('tasks'));
  set('nav-friends', T('friends'));
  set('nav-profile', T('profile'));
  setHTML('withdraw-btn', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="M5 12l7-7 7 7"/></svg> '+T('withdraw'));
  set('lang-title', T('language'));
  set('ps-invested-label', T('totalInvested'));
  set('ps-earned-label', T('totalEarned'));
  set('ps-withdrawn-label', T('totalWithdrawn'));
  set('ps-joined-label', T('joinedDate'));
  document.documentElement.dir = currentLang==='ar'?'rtl':'ltr';
  renderMiners();
  updateStats();
}

// ============ MINERS ============
function renderMiners() {
  const list = document.getElementById('miners-list');
  if (!list) return;
  const ownedIds = [];
  if (userData && userData.activeMiners) userData.activeMiners.forEach(am=>ownedIds.push(am.minerId));

  list.innerHTML = MINERS.map(m => {
    const owned = ownedIds.includes(m.id);
    const isFree = m.price===0;
    let cardClass = 'miner-card';
    if (m.level===7) cardClass+=' premium';
    else if (m.level===8) cardClass+=' legendary';
    else if (isFree) cardClass+=' free-card';

    let badge = '';
    if (owned) {
      const am = userData.activeMiners.find(a=>a.minerId===m.id);
      if (am && am.startsEarningAt && new Date()<new Date(am.startsEarningAt)) {
        const h = Math.ceil((new Date(am.startsEarningAt)-new Date())/3600000);
        badge = '<div class="miner-badge warmup"><img class="cat-badge warmup" src="images/cat-icon.png"> '+h+'h</div>';
      } else {
        badge = '<div class="miner-badge badge-active"><img class="cat-badge" src="images/cat-icon.png"> '+T('active')+'</div>';
      }
    }

    let btnClass = 'buy-btn';
    let btnText = '<img class="cat-btn" src="images/cat-icon.png"> '+T('buyFor')+' '+m.price+' TON';
    if (isFree && !owned) { btnClass+=' free'; btnText=ic('check',12)+' '+T('claimNow'); }
    else if (m.level===7 && !owned) btnClass+=' premium';
    else if (m.level===8 && !owned) btnClass+=' legendary';
    if (owned) { btnClass+=' disabled'; btnText=ic('check',12)+' '+T('owned'); }

    return '<div class="'+cardClass+'"><div class="miner-top"><div class="miner-img"><img src="images/miner-'+m.level+'.png" alt="'+m.name+'" onerror="this.onerror=null;this.parentElement.innerHTML=\'<span style=font-size:32px>'+m.emoji+'</span>\'"></div><div class="miner-info"><div class="miner-name">'+m.name+'<span class="lv">Lv.'+m.level+'</span></div><div class="miner-sub">'+(isFree?T('free'):T('payback')+' ~'+m.payback+T('days'))+'</div></div>'+badge+'</div><div class="miner-stats"><div class="miner-stat"><div class="miner-stat-label">'+T('daily')+'</div><div class="miner-stat-value gold">'+m.daily+'</div></div><div class="miner-stat"><div class="miner-stat-label">'+T('contract')+'</div><div class="miner-stat-value">'+m.days+T('days')+'</div></div><div class="miner-stat"><div class="miner-stat-label">'+T('total')+'</div><div class="miner-stat-value green">'+m.total+'</div></div></div><button class="'+btnClass+'" '+(owned?'disabled':'onclick="buyMiner(\''+m.id+'\')"')+'>'+btnText+'</button></div>';
  }).join('');
}

// ============ BUY MINER ============
async function buyMiner(minerId) {
  if (!userData) { toast('⚠ Open from Telegram!'); return; }
  const miner = MINERS.find(m=>m.id===minerId);
  if (!miner) return;

  try {
    const r = await fetch(API+'/api/miners/buy',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({telegramId:userData.telegramId,minerId})});
    const d = await r.json();
    if (d.success && d.type==='free') {
      toast(miner.name+' activated! Starts earning in 24h');
      await refreshUser();
      return;
    }
    if (d.success && d.type==='deposit_required') {
      currentBuyMiner = miner;
      currentBuyMemo = d.memo;
      showBuyModal(miner, d.memo);
      return;
    }
    if (d.error) toast('⚠ '+(d.error||'Error'));
  } catch(e) { toast('⚠ Connection error'); }
}

function showBuyModal(miner, memo) {
  const modal = document.getElementById('buy-modal');
  const content = document.getElementById('buy-content');
  const balance = userData ? (userData.balance||0) : 0;
  const hasBalance = balance >= miner.price;
  const connected = tonConnectUI && tonConnectUI.connected;

  content.innerHTML = `
    <div class="buy-hero">
      <img src="images/miner-${miner.level}.png" onerror="this.style.display='none'">
      <div class="buy-name">${miner.name} <span class="lv">Lv.${miner.level}</span></div>
      <div class="buy-sub">${miner.days}-day contract · Payback ~${miner.payback}d</div>
    </div>

    <div class="buy-stats">
      <div class="buy-stat">
        <div class="buy-stat-lbl">DAILY</div>
        <div class="buy-stat-val gold">${miner.daily}</div>
      </div>
      <div class="buy-stat">
        <div class="buy-stat-lbl">TOTAL</div>
        <div class="buy-stat-val green">${miner.total}</div>
      </div>
      <div class="buy-stat">
        <div class="buy-stat-lbl">PRICE</div>
        <div class="buy-stat-val">${miner.price}</div>
      </div>
    </div>

    <div class="buy-section-lbl">Choose payment method</div>

    <button class="buy-option blue" onclick="payOption1()">
      <div class="buy-opt-left">
        <div class="buy-opt-icon blue">
          <svg viewBox="0 0 24 24"><rect x="2" y="6" width="20" height="14" rx="2"/><path d="M16 14a2 2 0 010-4h6v4z"/></svg>
        </div>
        <div>
          <div class="buy-opt-title">${connected?'Pay with Wallet':'Connect & Pay'}</div>
          <div class="buy-opt-sub">${connected?'TON Connect · Instant':'Tonkeeper, TonHub, OpenMask'}</div>
        </div>
      </div>
      <div class="buy-opt-right">
        <div class="buy-opt-price">${miner.price} TON</div>
        <div class="buy-opt-arrow">→</div>
      </div>
    </button>

    <button class="buy-option green ${hasBalance?'':'disabled'}" ${hasBalance?'onclick="payOption2()"':''}>
      <div class="buy-opt-left">
        <div class="buy-opt-icon green">
          <svg viewBox="0 0 24 24"><path d="M21 12V7H5a2 2 0 010-4h14v4"/><path d="M3 5v14a2 2 0 002 2h16v-5"/><circle cx="17" cy="14" r="2"/></svg>
        </div>
        <div>
          <div class="buy-opt-title">Use Bot Balance</div>
          <div class="buy-opt-sub">${hasBalance?'Balance: '+balance.toFixed(2)+' TON':'Insufficient: '+balance.toFixed(2)+' TON'}</div>
        </div>
      </div>
      <div class="buy-opt-right">
        <div class="buy-opt-price">${miner.price} TON</div>
        <div class="buy-opt-arrow">→</div>
      </div>
    </button>

    <button class="buy-option amber" onclick="payOption3()">
      <div class="buy-opt-left">
        <div class="buy-opt-icon amber">
          <svg viewBox="0 0 24 24"><rect x="3" y="8" width="18" height="13" rx="2"/><path d="M8 8V5a4 4 0 018 0v3"/><circle cx="12" cy="14" r="2"/></svg>
        </div>
        <div>
          <div class="buy-opt-title">Manual Deposit</div>
          <div class="buy-opt-sub">Send TON manually</div>
        </div>
      </div>
      <div class="buy-opt-right">
        <div class="buy-opt-price">${miner.price} TON</div>
        <div class="buy-opt-arrow">→</div>
      </div>
    </button>

    <div class="buy-info"><img class="cat-btn" src="images/cat-icon.png" style="filter:brightness(0) saturate(100%) invert(72%) sepia(89%) saturate(1234%) hue-rotate(353deg)"> Miner starts earning 24h after verification</div>
  `;
  modal.style.display = 'flex';
}

// ============ OPTION 1: TON Connect ============
async function payOption1() {
  if (!currentBuyMiner || !currentBuyMemo) return;
  const amount = currentBuyMiner.price;
  const memo = currentBuyMemo;

  if (!tonConnectUI) { toast('⚠ Wallet not available'); return; }

  if (!tonConnectUI.connected) {
    try {
      await tonConnectUI.openModal();
      const check = setInterval(async()=>{
        if (tonConnectUI.connected) {
          clearInterval(check);
          await sendWalletPayment(amount, memo);
        }
      },1000);
      setTimeout(()=>clearInterval(check),60000);
    } catch(e) {}
    return;
  }
  await sendWalletPayment(amount, memo);
}

// ============ TON COMMENT PAYLOAD BUILDER ============
// Builds a valid BOC (Bag of Cells) for a text comment
// This is the format wallets like Tonkeeper expect
function buildTonCommentBOC(text) {
  try {
    const textBytes = new TextEncoder().encode(text);
    const dataLen = 4 + textBytes.length; // 4 byte op code + text
    if (dataLen > 123) return null;

    // Build cell data: 4 zero bytes (op code) + UTF-8 text
    const cellData = new Uint8Array(dataLen);
    cellData.set(textBytes, 4);

    // BOC header + single cell descriptor
    // Format: magic(4) flags+offSize(1) cells(1) roots(1) absent(1) totalSize(1) rootIdx(1) refs(1) bits(1) data
    const boc = new Uint8Array([
      0xB5, 0xEE, 0x9C, 0x72,           // BOC magic
      0x01,                              // has_idx=0, has_crc=0, has_cache_bits=0, flags=0, size_bytes=1
      0x01,                              // off_bytes
      0x01,                              // cells_num
      0x01,                              // roots_num
      0x00,                              // absent_num
      dataLen + 2,                       // tot_cells_size
      0x00,                              // root_list[0]
      0x00,                              // refs descriptor (0 refs, not exotic)
      dataLen * 2,                       // bits descriptor (data bits / 4)
      ...cellData                        // cell data
    ]);

    // Base64 encode
    let bin = '';
    for (let i = 0; i < boc.length; i++) bin += String.fromCharCode(boc[i]);
    return btoa(bin);
  } catch(e) {
    console.error('[PAYMENT] BOC build failed:', e);
    return null;
  }
}

async function sendWalletPayment(amount, memo) {
  try {
    console.log('[PAYMENT] ════════ TON Connect payment ════════');
    console.log('[PAYMENT] Amount:', amount, 'TON');
    console.log('[PAYMENT] Memo:', memo);
    console.log('[PAYMENT] To:', BOT_WALLET);

    const amountNano = Math.round(amount * 1e9).toString();
    console.log('[PAYMENT] Nano:', amountNano);

    // Build payload with proper BOC format
    const payload = buildTonCommentBOC(memo);
    console.log('[PAYMENT] Payload BOC:', payload ? 'YES ('+payload.length+' chars)' : 'NO');

    const message = {
      address: BOT_WALLET,
      amount: amountNano
    };
    if (payload) message.payload = payload;

    const tx = {
      validUntil: Math.floor(Date.now()/1000) + 600,
      messages: [message]
    };

    console.log('[PAYMENT] Sending transaction...');
    const result = await tonConnectUI.sendTransaction(tx);
    console.log('[PAYMENT] ✅ Transaction sent!');

    document.getElementById('buy-modal').style.display='none';
    showSentPage(currentBuyMiner);
    setTimeout(()=>refreshUser(), 10000);
  } catch(e) {
    console.error('[PAYMENT] ❌ Error:', e);
    if (e.message && (e.message.includes('cancel')||e.message.includes('reject')||e.message.includes('declined'))) {
      toast('✕ Payment cancelled');
    } else {
      toast('⚠ '+(e.message||'Payment failed'));
    }
  }
}

// ============ OPTION 2: Bot Balance ============
async function payOption2() {
  if (!currentBuyMiner) return;
  if (!confirm('Use '+currentBuyMiner.price+' TON from your balance?')) return;

  try {
    const r = await fetch(API+'/api/miners/buy-balance',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({telegramId:userData.telegramId,minerId:currentBuyMiner.id})
    });
    const d = await r.json();
    if (d.success) {
      toast('✓ '+currentBuyMiner.name+' activated! Starts in 24h');
      document.getElementById('buy-modal').style.display='none';
      await refreshUser();
    } else {
      toast('⚠ '+(d.error||'Error'));
    }
  } catch(e) { toast('⚠ '+e.message); }
}

// ============ OPTION 3: Manual Deposit Page ============
function payOption3() {
  if (!currentBuyMiner || !currentBuyMemo) return;
  document.getElementById('buy-modal').style.display='none';

  document.getElementById('manual-amt-val').textContent = currentBuyMiner.price+' TON';
  document.getElementById('manual-addr-val').textContent = BOT_WALLET;
  document.getElementById('manual-memo-val').textContent = currentBuyMemo;
  document.getElementById('manual-warn-amt').textContent = currentBuyMiner.price;

  goPage('manual', null);
}

function confirmManualPayment() {
  showSentPage(currentBuyMiner);
}

function showSentPage(miner) {
  const card = document.getElementById('sent-miner-card');
  card.innerHTML = `
    <img src="images/miner-${miner.level}.png" onerror="this.style.display='none'">
    <div class="info">
      <div class="name">${miner.name} <span style="color:var(--blue-l);font-size:11px;font-weight:700">Lv.${miner.level}</span></div>
      <div class="price">${miner.price} TON</div>
    </div>
  `;
  goPage('sent', null);
}

// ============ COLLECT ============
async function collectEarnings() {
  if (!userData) return;
  try {
    const r = await fetch(API+'/api/miners/collect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({telegramId:userData.telegramId})});
    const d = await r.json();
    if (d.success) { toast('+ +'+d.collected.toFixed(4)+' TON'); userData.balance=d.newBalance; updateStats(); }
    else toast('⚠ '+(d.error||'Nothing to collect'));
  } catch(e) { toast('⚠ Error'); }
}

// ============ TASKS (with premium icons) ============
const TASK_ICONS = {
  't_daily': { color: 'green', svg: '<path d="M20 12v10H4V12"/><path d="M2 7h20v5H2z"/><path d="M12 22V7"/><path d="M12 7H7.5a2.5 2.5 0 010-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 000-5C13 2 12 7 12 7z"/>' },
  't_news': { color: 'blue', svg: '<path d="M3 11l18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 11-5.8-1.6"/>' },
  't_payouts': { color: 'amber', svg: '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v16"/>' },
  't_miner': { color: 'amber', svg: '<path d="M14 4l6 6-9.5 9.5a2.5 2.5 0 01-3.5-3.5L16 7"/><circle cx="18" cy="6" r="1.5" fill="currentColor"/>' },
  't_invite': { color: 'purple', svg: '<circle cx="9" cy="8" r="3.5"/><path d="M2 21v-1a5 5 0 015-5h4a5 5 0 015 5v1"/><circle cx="17" cy="9" r="2.5"/><path d="M22 19v-.5a3.5 3.5 0 00-3-3.46"/>' },
  't_wallet': { color: 'blue', svg: '<rect x="2" y="6" width="20" height="14" rx="2"/><path d="M16 14a2 2 0 010-4h6v4z"/>' }
};

function getTaskIcon(taskId) {
  if (TASK_ICONS[taskId]) return TASK_ICONS[taskId];
  if (taskId.includes('daily')) return TASK_ICONS.t_daily;
  if (taskId.includes('news')||taskId.includes('channel')) return TASK_ICONS.t_news;
  if (taskId.includes('miner')) return TASK_ICONS.t_miner;
  if (taskId.includes('invite')||taskId.includes('ref')) return TASK_ICONS.t_invite;
  if (taskId.includes('wallet')) return TASK_ICONS.t_wallet;
  return TASK_ICONS.t_news;
}

let currentTaskTab = 'daily';

function switchTaskTab(tab, el) {
  currentTaskTab = tab;
  document.querySelectorAll('.tt-btn').forEach(b => b.classList.remove('active'));
  if (el) el.classList.add('active');
  loadTasks();
}

async function loadTasks() {
  try {
    const r = await fetch(API+'/api/tasks?telegramId='+(userData?.telegramId||''));
    const d = await r.json();
    console.log('[TASKS] Got from API:', d);
    if (!d.success) return;
    console.log('[TASKS] Current tab:', currentTaskTab);
    console.log('[TASKS] Tasks:', (d.tasks||[]).map(t => ({id: t.taskId, isDaily: t.isDaily, category: t.category})));

    const svgAttrs = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';

    const renderTask = (t) => {
      const ico = getTaskIcon(t.taskId);
      const rewardDisplay = t.rewardLabel ? '+ '+t.rewardLabel+' TON' : '+ '+(t.reward||0)+' TON';

      let btn;
      if (t.isDaily) {
        if (t.onCooldown && t.nextClaim) {
          const diff = new Date(t.nextClaim) - Date.now();
          const hh = Math.max(0, Math.floor(diff/3600000));
          const mm = Math.max(0, Math.floor((diff%3600000)/60000));
          btn = `<div class="task-btn done">${ic('clock',12)} ${hh}h ${mm}m</div>`;
        } else {
          btn = `<button class="task-btn claim" onclick="doTask('${t.taskId}','${t.link||''}',${t.reward||0})">Claim</button>`;
        }
      } else {
        const done = userData?.completedTasks?.includes(t.taskId);
        if (done) {
          btn = `<div class="task-btn done">${ic('check',12)} Done</div>`;
        } else {
          btn = `<button class="task-btn go" onclick="doTask('${t.taskId}','${t.link||''}',${t.reward||0})">Go</button>`;
        }
      }

      return `<div class="task-card">
        <div class="task-icon ${ico.color}"><svg ${svgAttrs}>${ico.svg}</svg></div>
        <div class="task-info">
          <div class="task-name">${t.title}</div>
          <div class="task-reward">${rewardDisplay}</div>
        </div>
        ${btn}
      </div>`;
    };

    const allTasks = (d.tasks || []).sort((a,b)=>(a.position||99)-(b.position||99));
    const daily = allTasks.filter(t => t.category === 'daily' || t.isDaily);
    const channels = allTasks.filter(t => t.category !== 'daily' && !t.isDaily);

    // Update channels count badge
    const badge = document.getElementById('channels-count');
    if (badge) {
      const uncompletedChannels = channels.filter(t => !userData?.completedTasks?.includes(t.taskId)).length;
      badge.textContent = uncompletedChannels;
      badge.style.display = uncompletedChannels > 0 ? 'inline-flex' : 'none';
    }

    let html = '';

    if (currentTaskTab === 'daily') {
      // Daily bonus info card
      html += `<div class="daily-bonus-card">
        <div class="db-ico">✨</div>
        <div class="db-text">Complete daily tasks and earn TON bonuses every 24 hours. Come back daily!</div>
      </div>`;

      if (daily.length > 0) {
        html += daily.map(renderTask).join('');
      } else {
        html += '<div style="text-align:center;color:var(--dm);padding:30px;font-size:13px">No daily tasks available</div>';
      }
    } else {
      // Channels tab
      if (channels.length > 0) {
        html += channels.map(renderTask).join('');
      } else {
        html += '<div style="text-align:center;color:var(--dm);padding:30px;font-size:13px">No channel tasks available</div>';
      }
    }

    document.getElementById('tasks-list').innerHTML = html;
  } catch(e) { console.error('[TASKS]', e); }
}

async function doTask(taskId, link, reward) {
  if (!userData) return;
  // Open link if present
  if (link && link!=='null' && link!=='#' && link!=='') {
    window.open(link, '_blank');
  }

  // Find the task data to know if it's daily or one-time
  let tDaily = false;
  try {
    const r = await fetch(API+'/api/tasks?telegramId='+userData.telegramId);
    const d = await r.json();
    const t = (d.tasks||[]).find(x => x.taskId === taskId);
    if (t) tDaily = t.isDaily || t.category === 'daily';
  } catch(e) {}

  if (tDaily) {
    // Daily task: claim immediately, no 15s wait
    await claimTask(taskId);
    return;
  }

  // One-time task with link: 15s countdown
  if (link && link!=='null' && link!=='#' && link!=='') {
    const btn = document.querySelector('[onclick*="\''+taskId+'\'"]');
    if (btn) {
      btn.disabled = true;
      let sec = 15;
      btn.className = 'task-btn done';
      btn.innerHTML = ic('clock',12)+' '+sec+'s';
      const timer = setInterval(() => {
        sec--;
        btn.innerHTML = ic('clock',12)+' '+sec+'s';
        if (sec <= 0) {
          clearInterval(timer);
          btn.className = 'task-btn claim';
          btn.textContent = T('taskClaim');
          btn.disabled = false;
          btn.onclick = () => claimTask(taskId);
        }
      }, 1000);
    }
  } else {
    // No link, no daily: just claim
    await claimTask(taskId);
  }
}

async function claimTask(taskId) {
  try {
    const r = await fetch(API+'/api/tasks/complete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({telegramId:userData.telegramId,taskId})});
    const d = await r.json();
    if (d.success) {
      toast('✓ +'+d.reward.toFixed(4)+' TON');
      userData.balance = d.newBalance;
      if (!d.daily && userData.completedTasks) userData.completedTasks.push(taskId);
      updateStats();
      loadTasks();
    } else if (d.error === 'NOT_MEMBER') {
      toast('⚠ Please join the channel first');
    } else if (d.error === 'COOLDOWN') {
      const diff = new Date(d.nextClaim) - Date.now();
      const hh = Math.max(0, Math.floor(diff/3600000));
      const mm = Math.max(0, Math.floor((diff%3600000)/60000));
      toast('⏱ Come back in '+hh+'h '+mm+'m');
      loadTasks();
    } else if (d.error === 'NO_MINER_TODAY') {
      toast('⚠ Buy a new miner today to claim this');
    } else if (d.error === 'NO_MINER') {
      toast('⚠ You need a paid miner first');
    } else {
      toast('⚠ '+(d.message || d.error || 'Error'));
    }
  } catch(e) { toast('⚠ Network error'); }
}

async function claimDaily() {
  if (!userData) return;
  try {
    const r = await fetch(API+'/api/daily-claim',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({telegramId:userData.telegramId})});
    const d = await r.json();
    if (d.success) { toast('+ +'+d.reward.toFixed(4)+' TON'); userData.balance=d.newBalance; userData.lastDaily=new Date().toISOString(); updateStats(); loadTasks(); }
    else if (d.error==='TOO_EARLY') { const diff=new Date(d.nextClaim)-Date.now(); const h=Math.floor(diff/3600000); const m=Math.floor((diff%3600000)/60000); toast('⏱ '+h+'h '+m+'m'); }
  } catch(e) { toast('⚠ Error'); }
}

// ============ FRIENDS ============
async function loadReferrals() {
  if (!userData) return;
  try {
    const r = await fetch(API+'/api/referrals/'+userData.telegramId);
    const d = await r.json();
    if (!d.success) return;
    document.getElementById('ref-count').textContent = d.total;
    document.getElementById('ref-commission').textContent = d.commission.toFixed(2);
    if (d.referrals.length>0) {
      document.getElementById('ref-list').innerHTML = d.referrals.map(ref=>{
        const ico = TASK_ICONS.t_invite;
        return `<div class="task-card"><div class="task-icon purple"><svg viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none" stroke="currentColor">${ico.svg}</svg></div><div class="task-info"><div class="task-name">${ref.firstName||'User'}</div><div class="task-reward">${ref.isPaid?ic('checkSimple',11)+' Paid':ic('clock',11)+' Free'}</div></div></div>`;
      }).join('');
    }
  } catch(e) {}
}

// ============ WITHDRAW ============
function openWithdraw() {
  const modal = document.getElementById('withdraw-modal');
  const content = document.getElementById('withdraw-content');
  content.innerHTML = `
    <div class="modal-title">${T('withdraw')}</div>
    <div class="modal-row"><div class="modal-label">${T('balance')}: <span style="color:var(--amber-l)">${(userData?userData.balance:0).toFixed(2)} TON</span></div></div>
    <div class="modal-row"><div class="modal-label">${T('amount')}</div><input class="modal-input" type="number" id="w-amount" placeholder="1.5" min="1.5" step="0.1"></div>
    <div class="modal-row"><div class="modal-label">${T('walletAddress')}</div><input class="modal-input" type="text" id="w-wallet" placeholder="UQ..."></div>
    <div class="modal-fee">${T('fee')}: 5% · Min: 1.5 TON</div>
    <div id="w-preview" style="font-size:12px;color:var(--dm);margin-bottom:12px"></div>
    <button class="modal-btn" onclick="submitWithdraw()">${T('submit')}</button>`;
  document.getElementById('w-amount').addEventListener('input',function(){const a=parseFloat(this.value)||0;const fee=a*0.05;document.getElementById('w-preview').textContent=a>0?T('youReceive')+': '+(a-fee).toFixed(4)+' TON ('+T('fee')+': '+fee.toFixed(4)+')':'';});
  modal.style.display='flex';
}

async function submitWithdraw() {
  if (!userData) return;
  const amount=parseFloat(document.getElementById('w-amount').value);
  const wallet=document.getElementById('w-wallet').value.trim();
  if (!amount||amount<1.5){toast('⚠ Min 1.5 TON');return;}
  if (!wallet||wallet.length<20){toast('⚠ Invalid wallet');return;}
  try {
    const r = await fetch(API+'/api/withdrawals/request',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({telegramId:userData.telegramId,amount,walletAddress:wallet})});
    const d = await r.json();
    if (d.success) { toast('✓ '+T('withdrawSubmitted')); document.getElementById('withdraw-modal').style.display='none'; refreshUser(); }
    else {
      if (d.error==='DEPOSIT_REQUIRED') toast('⊘ '+T('depositRequired'));
      else if (d.error==='REFS_REQUIRED') toast('⊘ '+T('refsRequired')+' ('+(d.current||0)+'/2)');
      else if (d.error==='INSUFFICIENT') toast('⚠ '+T('insufficientBalance'));
      else if (d.error==='MIN_AMOUNT') toast('⚠ Min 1.5 TON');
      else if (d.error==='PENDING_EXISTS') toast('⚠ You have a pending withdrawal');
      else toast('⚠ '+(d.message||d.error));
    }
  } catch(e) { toast('⚠ Error'); }
}

// ============ STATS ============
function updateStats() {
  if (!userData) return;
  document.getElementById('balance-display').textContent = (userData.balance||0).toFixed(2);
  document.getElementById('ref-link').value = 'https://t.me/'+BOT_USERNAME+'?start=ref_'+userData.telegramId;
  document.getElementById('profile-name').textContent = userData.firstName||'Player';
  document.getElementById('profile-id').textContent = 'ID: '+userData.telegramId;
  if (userData.photoUrl) document.getElementById('profile-avatar').innerHTML='<img src="'+userData.photoUrl+'" onerror="this.style.display=\'none\'">';
  else document.getElementById('profile-avatar').innerHTML = ic('user', 56);

  // Set stat icons
  const profIco = document.getElementById('stat-ico-profit');
  const minersIco = document.getElementById('stat-ico-miners');
  if (profIco && !profIco.innerHTML) profIco.innerHTML = ic('trending', 22);
  if (minersIco && !minersIco.innerHTML) {
    minersIco.innerHTML = `<img class="stat-cat" src="images/cat-icon.png" alt="">`;
  }
  document.getElementById('wallet-card-balance').textContent = (userData.balance||0).toFixed(4)+' TON';
  document.getElementById('wallet-card-usd').textContent = '≈ $'+((userData.balance||0)*5).toFixed(2);
  document.getElementById('ps-invested').textContent = (userData.totalInvested||0).toFixed(2)+' TON';
  document.getElementById('ps-earned').textContent = (userData.totalEarned||0).toFixed(2)+' TON';
  document.getElementById('ps-withdrawn').textContent = (userData.totalWithdrawn||0).toFixed(2)+' TON';
  if (document.getElementById('ps-refs')) document.getElementById('ps-refs').textContent = (userData.referrals||[]).length;
  document.getElementById('ps-joined').textContent = userData.createdAt?new Date(userData.createdAt).toLocaleDateString():'---';
}

// ============ HELPERS ============
function copyRefLink() { navigator.clipboard.writeText(document.getElementById('ref-link').value); toast(T('copied')); }
function shareRef() { const l=document.getElementById('ref-link').value; if(tg) tg.openTelegramLink('https://t.me/share/url?url='+encodeURIComponent(l)+'&text='+encodeURIComponent('⛏️🐱 Join Cats Mining!')); }
function sendRefChat() { const l=document.getElementById('ref-link').value; if(tg) tg.switchInlineQuery('⛏️🐱 '+l,['users']); }
function copyText(text) { navigator.clipboard.writeText(text); toast('Copied — Copied!'); }

function toast(msg) {
  const t=document.getElementById('toast');
  t.textContent=msg;
  t.classList.remove('show');
  void t.offsetWidth;
  t.classList.add('show');
  clearTimeout(window._tt);
  window._tt=setTimeout(()=>t.classList.remove('show'),2500);
}