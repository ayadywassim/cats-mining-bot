const API = 'https://cats-mining-backend.onrender.com';
const BOT_WALLET = 'UQBl_vId6Bx45nhqVFa2OLuA1upxZxNXvTkH8zLEo_jbkrd1';
const BOT_USERNAME = 'MiningCatsBot';
const tg = window.Telegram && window.Telegram.WebApp;
let userData = null;
let pendingInterval = null;
let tonConnectUI = null;
let currentBuyMiner = null;
let currentBuyMemo = null;

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
  } else {
    txt.textContent = 'Connect';
    btn.classList.remove('connected');
    addrBox.style.display = 'none';
  }
}

async function connectWallet() {
  if (!tonConnectUI) { toast('⚠️ TON Connect not available'); return; }
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
  toast('⚠️ Open from @'+BOT_USERNAME);
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
    else toast('⚠️ '+(d.error||'Error'));
  } catch(e) { toast('⚠️ Connection error'); }
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
  pendingInterval = setInterval(updatePending, 3000);
}

async function updatePending() {
  if (!userData) return;
  try {
    const r = await fetch(API+'/api/miners/pending/'+userData.telegramId);
    const d = await r.json();
    if (d.success) {
      document.getElementById('pending-value').innerHTML = d.pending.toFixed(4)+' <span class="pnd-ton">TON</span>';
      document.getElementById('stat-profit').textContent = d.dailyProfit.toFixed(3);
      document.getElementById('stat-miners').textContent = d.activeCount;
      document.getElementById('hdr-miners').textContent = d.activeCount;
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
  document.getElementById('lang-btn').textContent = L.flag;
  if (document.getElementById('app-sub')) document.getElementById('app-sub').textContent = T('appSub');
  document.getElementById('stat-profit-label').textContent = T('profitDay');
  document.getElementById('stat-miners-label').textContent = T('activeMiners');
  document.getElementById('pending-label').textContent = T('pending');
  document.getElementById('pending-status').textContent = T('accumulating');
  document.getElementById('collect-btn').textContent = T('collect');
  document.getElementById('miners-title').textContent = T('allMiners');
  document.getElementById('miners-levels').textContent = T('levels');
  document.getElementById('tasks-title').textContent = T('tasksList');
  document.getElementById('friends-title').textContent = T('inviteTitle');
  document.getElementById('friends-sub').textContent = T('inviteSub');
  document.getElementById('ref-label').textContent = T('inviteLink');
  document.getElementById('btn-share').textContent = '↗ '+T('share');
  document.getElementById('btn-send').textContent = '✈ '+T('sendChat');
  document.getElementById('ref-count-label').textContent = T('totalRefs');
  document.getElementById('ref-commission-label').textContent = T('commission');
  document.getElementById('nav-miners').textContent = T('miners');
  document.getElementById('nav-tasks').textContent = T('tasks');
  document.getElementById('nav-friends').textContent = T('friends');
  document.getElementById('nav-profile').textContent = T('profile');
  if (document.getElementById('withdraw-btn')) document.getElementById('withdraw-btn').innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="M5 12l7-7 7 7"/></svg> '+T('withdraw');
  document.getElementById('lang-title').textContent = T('language');
  document.getElementById('ps-invested-label').textContent = T('totalInvested');
  document.getElementById('ps-earned-label').textContent = T('totalEarned');
  document.getElementById('ps-withdrawn-label').textContent = T('totalWithdrawn');
  document.getElementById('ps-joined-label').textContent = T('joinedDate');
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
        badge = '<div class="miner-badge warmup">⏳ '+h+'h</div>';
      } else {
        badge = '<div class="miner-badge badge-active">⛏️ '+T('active')+'</div>';
      }
    }

    let btnClass = 'buy-btn';
    let btnText = '⛏️ '+T('buyFor')+' '+m.price+' TON';
    if (isFree && !owned) { btnClass+=' free'; btnText='✅ '+T('claimNow'); }
    else if (m.level===7 && !owned) btnClass+=' premium';
    else if (m.level===8 && !owned) btnClass+=' legendary';
    if (owned) { btnClass+=' disabled'; btnText='✅ '+T('owned'); }

    return '<div class="'+cardClass+'"><div class="miner-top"><div class="miner-img"><img src="images/miner-'+m.level+'.png" alt="'+m.name+'" onerror="this.onerror=null;this.parentElement.innerHTML=\'<span style=font-size:32px>'+m.emoji+'</span>\'"></div><div class="miner-info"><div class="miner-name">'+m.name+'<span class="lv">Lv.'+m.level+'</span></div><div class="miner-sub">'+(isFree?T('free'):T('payback')+' ~'+m.payback+T('days'))+'</div></div>'+badge+'</div><div class="miner-stats"><div class="miner-stat"><div class="miner-stat-label">'+T('daily')+'</div><div class="miner-stat-value gold">'+m.daily+'</div></div><div class="miner-stat"><div class="miner-stat-label">'+T('contract')+'</div><div class="miner-stat-value">'+m.days+T('days')+'</div></div><div class="miner-stat"><div class="miner-stat-label">'+T('total')+'</div><div class="miner-stat-value green">'+m.total+'</div></div></div><button class="'+btnClass+'" '+(owned?'disabled':'onclick="buyMiner(\''+m.id+'\')"')+'>'+btnText+'</button></div>';
  }).join('');
}

// ============ BUY MINER ============
async function buyMiner(minerId) {
  if (!userData) { toast('⚠️ Open from Telegram!'); return; }
  const miner = MINERS.find(m=>m.id===minerId);
  if (!miner) return;

  try {
    const r = await fetch(API+'/api/miners/buy',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({telegramId:userData.telegramId,minerId})});
    const d = await r.json();
    if (d.success && d.type==='free') {
      toast('🐱 '+miner.name+' activated! Starts earning in 24h');
      await refreshUser();
      return;
    }
    if (d.success && d.type==='deposit_required') {
      currentBuyMiner = miner;
      currentBuyMemo = d.memo;
      showBuyModal(miner, d.memo);
      return;
    }
    if (d.error) toast('⚠️ '+(d.error||'Error'));
  } catch(e) { toast('⚠️ Connection error'); }
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

    <div class="buy-info"><span class="ico">⛏️</span> Miner starts earning 24h after verification</div>
  `;
  modal.style.display = 'flex';
}

// ============ OPTION 1: TON Connect ============
async function payOption1() {
  if (!currentBuyMiner || !currentBuyMemo) return;
  const amount = currentBuyMiner.price;
  const memo = currentBuyMemo;

  if (!tonConnectUI) { toast('⚠️ Wallet not available'); return; }

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
    console.log('[PAYMENT] ════════ Starting TON Connect payment ════════');
    console.log('[PAYMENT] Amount:', amount, 'TON');
    console.log('[PAYMENT] Memo:', memo);
    console.log('[PAYMENT] To:', BOT_WALLET);

    const lastDigits = parseInt(userData.telegramId.slice(-4)) || 0;
    const uniqueAmount = +(amount + (lastDigits / 1000000)).toFixed(6);
    const amountNano = Math.round(uniqueAmount * 1e9).toString();

    console.log('[PAYMENT] Unique amount:', uniqueAmount, 'TON');
    console.log('[PAYMENT] Nano:', amountNano);

    // Build payload with proper BOC format
    const payload = buildTonCommentBOC(memo);
    console.log('[PAYMENT] Payload built:', payload ? 'YES ('+payload.length+' chars)' : 'NO (fallback to amount only)');

    const message = {
      address: BOT_WALLET,
      amount: amountNano
    };

    // Add payload only if successfully built
    if (payload) {
      message.payload = payload;
    }

    const tx = {
      validUntil: Math.floor(Date.now()/1000) + 600,
      messages: [message]
    };

    console.log('[PAYMENT] Sending transaction...');
    const result = await tonConnectUI.sendTransaction(tx);
    console.log('[PAYMENT] ✅ Transaction sent!');
    console.log('[PAYMENT] BOC:', result.boc ? result.boc.slice(0,40)+'...' : 'no boc');

    document.getElementById('buy-modal').style.display='none';
    showSentPage(currentBuyMiner);
    setTimeout(()=>refreshUser(), 10000);
  } catch(e) {
    console.error('[PAYMENT] ❌ Error:', e);
    if (e.message && (e.message.includes('cancel')||e.message.includes('reject')||e.message.includes('declined'))) {
      toast('❌ Payment cancelled');
    } else {
      toast('⚠️ '+(e.message||'Payment failed'));
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
      toast('✅ '+currentBuyMiner.name+' activated! Starts in 24h');
      document.getElementById('buy-modal').style.display='none';
      await refreshUser();
    } else {
      toast('⚠️ '+(d.error||'Error'));
    }
  } catch(e) { toast('⚠️ '+e.message); }
}

// ============ OPTION 3: Manual Deposit Page ============
function payOption3() {
  if (!currentBuyMiner || !currentBuyMemo) return;
  document.getElementById('buy-modal').style.display='none';

  const lastDigits = parseInt(userData.telegramId.slice(-4)) || 0;
  const uniqueAmount = currentBuyMiner.price + (lastDigits / 1000000);

  document.getElementById('manual-amt-val').textContent = uniqueAmount.toFixed(6)+' TON';
  document.getElementById('manual-addr-val').textContent = BOT_WALLET;
  document.getElementById('manual-memo-val').textContent = currentBuyMemo;
  document.getElementById('manual-warn-amt').textContent = uniqueAmount.toFixed(6);

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
    if (d.success) { toast('💰 +'+d.collected.toFixed(4)+' TON'); userData.balance=d.newBalance; updateStats(); }
    else toast('⚠️ '+(d.error||'Nothing to collect'));
  } catch(e) { toast('⚠️ Error'); }
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

async function loadTasks() {
  try {
    const r = await fetch(API+'/api/tasks');
    const d = await r.json();
    if (!d.success) return;

    const canDaily = !userData||!userData.lastDaily||(Date.now()-new Date(userData.lastDaily).getTime())>=86400000;
    const dailyIco = TASK_ICONS.t_daily;
    let html = `<div class="task-card">
      <div class="task-icon ${dailyIco.color}"><svg viewBox="0 0 24 24">${dailyIco.svg}</svg></div>
      <div class="task-info"><div class="task-name">${T('dailyReward')}</div><div class="task-reward">+ 0.005~0.015 TON</div></div>
      ${canDaily?'<button class="task-btn claim" onclick="claimDaily()">'+T('claimDaily')+'</button>':'<div class="task-btn done">'+T('taskDone')+'</div>'}
    </div>`;

    html += d.tasks.map(t=>{
      const done = userData&&userData.completedTasks&&userData.completedTasks.includes(t.taskId);
      const ico = getTaskIcon(t.taskId);
      return `<div class="task-card">
        <div class="task-icon ${ico.color}"><svg viewBox="0 0 24 24">${ico.svg}</svg></div>
        <div class="task-info"><div class="task-name">${t.title}</div><div class="task-reward">+ ${t.reward} TON</div></div>
        ${done?'<div class="task-btn done">'+T('taskDone')+'</div>':'<button class="task-btn go" onclick="doTask(\''+t.taskId+'\',\''+(t.link||'')+'\','+t.reward+')">'+T('taskGo')+'</button>'}
      </div>`;
    }).join('');

    document.getElementById('tasks-list').innerHTML = html;
  } catch(e) {}
}

async function doTask(taskId, link, reward) {
  if (!userData) return;
  if (link && link!=='null' && link!=='#' && link!=='') window.open(link,'_blank');
  const btn = document.querySelector('[onclick*="'+taskId+'"]');
  if (btn) {
    btn.disabled=true; let sec=15;
    btn.className='task-btn done'; btn.textContent='⏳ '+sec+'s';
    const timer=setInterval(()=>{sec--;btn.textContent='⏳ '+sec+'s';if(sec<=0){clearInterval(timer);btn.className='task-btn claim';btn.textContent=T('taskClaim');btn.disabled=false;btn.onclick=()=>claimTask(taskId);}},1000);
  }
}

async function claimTask(taskId) {
  try {
    const r = await fetch(API+'/api/tasks/complete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({telegramId:userData.telegramId,taskId})});
    const d = await r.json();
    if (d.success) { toast('✅ +'+d.reward+' TON'); userData.balance=d.newBalance; userData.completedTasks.push(taskId); updateStats(); loadTasks(); }
    else if (d.error==='NOT_MEMBER') toast('⚠️ Please join the channel first');
    else toast('⚠️ '+(d.error||'Error'));
  } catch(e) { toast('⚠️ Error'); }
}

async function claimDaily() {
  if (!userData) return;
  try {
    const r = await fetch(API+'/api/daily-claim',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({telegramId:userData.telegramId})});
    const d = await r.json();
    if (d.success) { toast('🎁 +'+d.reward.toFixed(4)+' TON'); userData.balance=d.newBalance; userData.lastDaily=new Date().toISOString(); updateStats(); loadTasks(); }
    else if (d.error==='TOO_EARLY') { const diff=new Date(d.nextClaim)-Date.now(); const h=Math.floor(diff/3600000); const m=Math.floor((diff%3600000)/60000); toast('⏰ '+h+'h '+m+'m'); }
  } catch(e) { toast('⚠️ Error'); }
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
        return `<div class="task-card"><div class="task-icon purple"><svg viewBox="0 0 24 24">${ico.svg}</svg></div><div class="task-info"><div class="task-name">${ref.firstName||'User'}</div><div class="task-reward">${ref.isPaid?'✅ Paid':'⏳ Free'}</div></div></div>`;
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
  if (!amount||amount<1.5){toast('⚠️ Min 1.5 TON');return;}
  if (!wallet||wallet.length<20){toast('⚠️ Invalid wallet');return;}
  try {
    const r = await fetch(API+'/api/withdrawals/request',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({telegramId:userData.telegramId,amount,walletAddress:wallet})});
    const d = await r.json();
    if (d.success) { toast('✅ '+T('withdrawSubmitted')); document.getElementById('withdraw-modal').style.display='none'; refreshUser(); }
    else {
      if (d.error==='DEPOSIT_REQUIRED') toast('🔒 '+T('depositRequired'));
      else if (d.error==='REFS_REQUIRED') toast('🔒 '+T('refsRequired')+' ('+(d.current||0)+'/2)');
      else if (d.error==='INSUFFICIENT') toast('⚠️ '+T('insufficientBalance'));
      else if (d.error==='MIN_AMOUNT') toast('⚠️ Min 1.5 TON');
      else if (d.error==='PENDING_EXISTS') toast('⚠️ You have a pending withdrawal');
      else toast('⚠️ '+(d.message||d.error));
    }
  } catch(e) { toast('⚠️ Error'); }
}

// ============ STATS ============
function updateStats() {
  if (!userData) return;
  document.getElementById('balance-display').textContent = (userData.balance||0).toFixed(2);
  document.getElementById('ref-link').value = 'https://t.me/'+BOT_USERNAME+'?start=ref_'+userData.telegramId;
  document.getElementById('profile-name').textContent = userData.firstName||'Player';
  document.getElementById('profile-id').textContent = 'ID: '+userData.telegramId;
  if (userData.photoUrl) document.getElementById('profile-avatar').innerHTML='<img src="'+userData.photoUrl+'" onerror="this.style.display=\'none\'">';
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
function copyText(text) { navigator.clipboard.writeText(text); toast('📋 Copied!'); }

function toast(msg) {
  const t=document.getElementById('toast');
  t.textContent=msg;
  t.classList.remove('show');
  void t.offsetWidth;
  t.classList.add('show');
  clearTimeout(window._tt);
  window._tt=setTimeout(()=>t.classList.remove('show'),2500);
}