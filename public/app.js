const API = 'https://cats-mining-backend.onrender.com';
const BOT_WALLET = 'UQBl_vId6Bx45nhqVFa2OLuA1upxZxNXvTkH8zLEo_jbkrd1';
const BOT_USERNAME = 'MiningCatsBot';
const tg = window.Telegram && window.Telegram.WebApp;
let userData = null;
let pendingInterval = null;
let tonConnectUI = null;

// ============ TON CONNECT ============
try {
  tonConnectUI = new TON_CONNECT_UI.TonConnectUI({
    manifestUrl: 'https://cats-mining.vercel.app/tonconnect-manifest.json',
    buttonRootId: null
  });
  tonConnectUI.onStatusChange(w => {
    const btn = document.getElementById('wallet-btn');
    const txt = document.getElementById('wallet-text');
    if (w) {
      txt.textContent = '✅ Wallet';
      btn.classList.add('connected');
    } else {
      txt.textContent = 'Connect';
      btn.classList.remove('connected');
    }
  });
} catch(e) {}

async function connectWallet() {
  if (!tonConnectUI) return;
  try {
    if (tonConnectUI.connected) {
      if (confirm('Disconnect wallet?')) await tonConnectUI.disconnect();
    } else {
      await tonConnectUI.openModal();
    }
  } catch(e) {}
}

// ============ INIT ============
document.addEventListener('DOMContentLoaded', async () => {
  if (tg) { tg.ready(); tg.expand(); tg.setHeaderColor('#0a0a10'); tg.setBackgroundColor('#0a0a10'); }
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

// ============ PENDING COUNTER ============
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
      document.getElementById('pending-value').innerHTML = d.pending.toFixed(4)+' <span class="pending-ton">TON</span>';
      document.getElementById('stat-profit').textContent = d.dailyProfit.toFixed(3);
      document.getElementById('stat-miners').textContent = d.activeCount;
    }
  } catch(e) {}
}

// ============ NAVIGATION ============
function goPage(name, el) {
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  document.getElementById('page-'+name).classList.add('active');
  if (el) el.classList.add('active');
  if (name==='tasks') loadTasks();
  if (name==='friends') loadReferrals();
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
  const L = LANGS[currentLang];
  document.getElementById('lang-btn').textContent = L.flag;
  document.getElementById('app-sub').textContent = T('appSub');
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
  document.getElementById('withdraw-btn').textContent = T('withdraw');
  document.getElementById('lang-title').textContent = T('language');
  document.getElementById('ps-balance-label').textContent = T('balance');
  document.getElementById('ps-invested-label').textContent = T('totalInvested');
  document.getElementById('ps-earned-label').textContent = T('totalEarned');
  document.getElementById('ps-withdrawn-label').textContent = T('totalWithdrawn');
  document.getElementById('ps-joined-label').textContent = T('joinedDate');
  document.documentElement.dir = currentLang==='ar'?'rtl':'ltr';
  renderMiners();
  updateStats();
}

// ============ RENDER MINERS ============
function renderMiners() {
  const list = document.getElementById('miners-list');
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

// ============ BUY MINER — 3 PAYMENT METHODS ============
async function buyMiner(minerId) {
  if (!userData) { toast('⚠️ Open from Telegram!'); return; }
  const miner = MINERS.find(m=>m.id===minerId);
  if (!miner) return;

  try {
    const r = await fetch(API+'/api/miners/buy',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({telegramId:userData.telegramId,minerId})});
    const d = await r.json();
    if (d.success && d.type==='free') {
      toast('🐱 '+miner.name+' activated! Earning starts in 24h');
      await refreshUser();
      return;
    }
    if (d.success && d.type==='deposit_required') {
      showBuyModal(miner, d.memo);
      return;
    }
    if (d.error) toast('⚠️ '+(d.error||'Error'));
  } catch(e) { toast('⚠️ Connection error'); }
}

function showBuyModal(miner, memo) {
  const modal = document.getElementById('withdraw-modal');
  const content = document.getElementById('withdraw-content');
  const connected = tonConnectUI && tonConnectUI.connected;

  content.innerHTML = `
    <div style="text-align:center;margin-bottom:14px">
      <img src="images/miner-${miner.level}.png" style="width:80px;height:80px;border-radius:16px;box-shadow:0 4px 20px rgba(0,0,0,.5)" onerror="this.style.display='none'">
    </div>
    <div style="text-align:center;font-size:18px;font-weight:700;margin-bottom:2px">${miner.name} <span style="color:var(--dim);font-size:14px">Lv.${miner.level}</span></div>
    <div style="text-align:center;font-size:12px;color:var(--dim);margin-bottom:14px">${miner.days}-day contract · Payback ~${miner.payback}d</div>

    <div style="display:flex;gap:6px;margin-bottom:18px">
      <div style="flex:1;background:var(--card);border-radius:10px;padding:10px;text-align:center">
        <div style="font-size:9px;color:var(--dim);text-transform:uppercase">DAILY</div>
        <div style="font-size:15px;font-weight:700;color:var(--gold-light);margin-top:2px">${miner.daily}</div>
      </div>
      <div style="flex:1;background:var(--card);border-radius:10px;padding:10px;text-align:center">
        <div style="font-size:9px;color:var(--dim);text-transform:uppercase">TOTAL</div>
        <div style="font-size:15px;font-weight:700;color:var(--green);margin-top:2px">${miner.total}</div>
      </div>
      <div style="flex:1;background:var(--card);border-radius:10px;padding:10px;text-align:center">
        <div style="font-size:9px;color:var(--dim);text-transform:uppercase">PRICE</div>
        <div style="font-size:15px;font-weight:700;margin-top:2px">${miner.price}</div>
      </div>
    </div>

    <div style="font-size:12px;font-weight:700;color:var(--dim);margin-bottom:10px;text-transform:uppercase;letter-spacing:.5px">Choose Payment Method</div>

    <!-- METHOD 1: TON Connect Wallet -->
    ${connected ? `
    <div class="pay-option" onclick="payWithWallet(${miner.price},'${memo}')">
      <div class="pay-opt-left">
        <div class="pay-opt-icon" style="background:linear-gradient(135deg,#0098EA,#0066BB)">💎</div>
        <div><div class="pay-opt-title">Pay with Wallet</div><div class="pay-opt-sub">Connected ✅</div></div>
      </div>
      <div class="pay-opt-price">${miner.price} TON →</div>
    </div>` : `
    <div class="pay-option" onclick="connectAndPay(${miner.price},'${memo}')">
      <div class="pay-opt-left">
        <div class="pay-opt-icon" style="background:linear-gradient(135deg,#0098EA,#0066BB)">🔗</div>
        <div><div class="pay-opt-title">Connect Wallet & Pay</div><div class="pay-opt-sub">Tonkeeper, TonHub, MyTonWallet</div></div>
      </div>
      <div class="pay-opt-price">${miner.price} TON →</div>
    </div>`}

    <!-- METHOD 2: Manual Deposit -->
    <div class="pay-option" onclick="showManualPage('${memo}',${miner.price},'${miner.name}')">
      <div class="pay-opt-left">
        <div class="pay-opt-icon" style="background:linear-gradient(135deg,#f5a623,#e88520)">📋</div>
        <div><div class="pay-opt-title">Manual Deposit</div><div class="pay-opt-sub">Copy address + memo</div></div>
      </div>
      <div class="pay-opt-price">${miner.price} TON →</div>
    </div>

    <div style="text-align:center;margin-top:12px;font-size:11px;color:var(--dimmer)">⛏️ Miner starts earning 24h after verification</div>
  `;
  modal.style.display = 'flex';
}

// ============ PAYMENT METHOD 1: TON CONNECT ============
async function connectAndPay(amount, memo) {
  if (!tonConnectUI) return;
  try {
    await tonConnectUI.openModal();
    const check = setInterval(async()=>{
      if (tonConnectUI.connected) { clearInterval(check); await payWithWallet(amount,memo); }
    },1000);
    setTimeout(()=>clearInterval(check),60000);
  } catch(e) {}
}

async function payWithWallet(amount, memo) {
  if (!tonConnectUI || !tonConnectUI.connected) { toast('⚠️ Connect wallet first'); return; }
  try {
    // Add tiny unique decimal for transaction identification
    const uniqueAmount = amount + (parseInt(memo.replace('CM','')) % 1000) / 1000000;
    
    await tonConnectUI.sendTransaction({
      validUntil: Math.floor(Date.now()/1000)+600,
      messages: [{
        address: BOT_WALLET,
        amount: Math.round(uniqueAmount * 1e9).toString()
      }]
    });
    toast('✅ Payment sent! Verifying...');
    document.getElementById('withdraw-modal').style.display='none';
    setTimeout(()=>refreshUser(),10000);
  } catch(e) {
    if (e.message && (e.message.includes('cancel')||e.message.includes('reject'))) toast('❌ Cancelled');
    else toast('⚠️ '+(e.message||'Payment failed'));
  }
}

// ============ PAYMENT METHOD 2: MANUAL DEPOSIT ============
function showManualPage(memo, amount, minerName) {
  const content = document.getElementById('withdraw-content');
  content.innerHTML = `
    <div style="text-align:center;margin-bottom:18px">
      <div style="width:56px;height:56px;border-radius:14px;background:linear-gradient(135deg,#f5a623,#e88520);margin:0 auto 10px;display:flex;align-items:center;justify-content:center;font-size:28px">📋</div>
      <div style="font-size:18px;font-weight:700">Manual Deposit</div>
      <div style="font-size:13px;color:var(--dim);margin-top:4px">Send exactly <span style="color:var(--gold-light);font-weight:700">${amount} TON</span> for ${minerName}</div>
    </div>

    <div style="margin-bottom:16px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <span style="font-size:11px;color:var(--dim);text-transform:uppercase;letter-spacing:.5px">Wallet Address</span>
        <span onclick="copyText('${BOT_WALLET}')" style="font-size:12px;color:var(--gold);cursor:pointer;font-weight:600">📋 Copy</span>
      </div>
      <div onclick="copyText('${BOT_WALLET}')" style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:14px;font-size:11px;word-break:break-all;color:var(--text);cursor:pointer;line-height:1.5">${BOT_WALLET}</div>
    </div>

    <div style="margin-bottom:16px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <span style="font-size:11px;color:var(--dim);text-transform:uppercase;letter-spacing:.5px">Memo (Required!)</span>
        <span onclick="copyText('${memo}')" style="font-size:12px;color:var(--gold);cursor:pointer;font-weight:600">📋 Copy</span>
      </div>
      <div onclick="copyText('${memo}')" style="background:linear-gradient(135deg,rgba(245,166,35,.1),var(--card));border:1px solid var(--gold-dim);border-radius:12px;padding:14px;font-size:20px;font-weight:700;color:var(--gold-light);text-align:center;letter-spacing:3px;cursor:pointer">${memo}</div>
    </div>

    <div style="margin-bottom:16px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <span style="font-size:11px;color:var(--dim);text-transform:uppercase;letter-spacing:.5px">Amount</span>
        <span onclick="copyText('${amount}')" style="font-size:12px;color:var(--gold);cursor:pointer;font-weight:600">📋 Copy</span>
      </div>
      <div onclick="copyText('${amount}')" style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:14px;font-size:20px;font-weight:700;text-align:center;cursor:pointer">${amount} TON</div>
    </div>

    <div style="background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.15);border-radius:12px;padding:12px;margin-bottom:16px;text-align:center">
      <span style="font-size:12px;color:#ef4444">⚠️ Without correct memo, payment cannot be verified!</span>
    </div>

    <button class="modal-btn" onclick="document.getElementById('withdraw-modal').style.display='none'">✅ I've sent ${amount} TON</button>
    <div onclick="document.getElementById('withdraw-modal').style.display='none'" style="text-align:center;margin-top:10px;font-size:13px;color:var(--dim);cursor:pointer">Cancel</div>
  `;
}

function copyText(text) {
  navigator.clipboard.writeText(text);
  toast('📋 Copied!');
}

// ============ COLLECT EARNINGS ============
async function collectEarnings() {
  if (!userData) return;
  try {
    const r = await fetch(API+'/api/miners/collect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({telegramId:userData.telegramId})});
    const d = await r.json();
    if (d.success) { toast('💰 +'+d.collected.toFixed(4)+' TON'); userData.balance=d.newBalance; updateStats(); }
    else toast('⚠️ '+(d.error||'Nothing to collect'));
  } catch(e) { toast('⚠️ Error'); }
}

// ============ TASKS ============
async function loadTasks() {
  try {
    const r = await fetch(API+'/api/tasks');
    const d = await r.json();
    if (!d.success) return;

    const canDaily = !userData||!userData.lastDaily||(Date.now()-new Date(userData.lastDaily).getTime())>=86400000;
    let html = `<div class="task-card"><div class="task-icon">🎁</div><div class="task-info"><div class="task-name">${T('dailyReward')}</div><div class="task-reward">+0.005~0.015 TON</div></div>${canDaily?'<button class="task-btn claim" onclick="claimDaily()">'+T('claimDaily')+'</button>':'<div class="task-btn done">'+T('taskDone')+'</div>'}</div>`;

    html += d.tasks.map(t=>{
      const done = userData&&userData.completedTasks&&userData.completedTasks.includes(t.taskId);
      return '<div class="task-card"><div class="task-icon">'+t.icon+'</div><div class="task-info"><div class="task-name">'+t.title+'</div><div class="task-reward">+'+t.reward+' TON</div></div>'+(done?'<div class="task-btn done">'+T('taskDone')+'</div>':'<button class="task-btn go" onclick="doTask(\''+t.taskId+'\',\''+( t.link||'')+'\','+t.reward+')">'+T('taskGo')+'</button>')+'</div>';
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
      document.getElementById('ref-list').innerHTML = d.referrals.map(ref=>'<div class="task-card"><div class="task-icon">👤</div><div class="task-info"><div class="task-name">'+(ref.firstName||'User')+'</div><div class="task-reward">'+(ref.isPaid?'✅ Paid':'⏳ Free')+'</div></div></div>').join('');
    }
  } catch(e) {}
}

// ============ WITHDRAW ============
function openWithdraw() {
  const modal = document.getElementById('withdraw-modal');
  const content = document.getElementById('withdraw-content');
  content.innerHTML = `
    <div class="modal-title">${T('withdraw')}</div>
    <div class="modal-row"><div class="modal-label">${T('balance')}: <span style="color:var(--gold-light)">${(userData?userData.balance:0).toFixed(2)} TON</span></div></div>
    <div class="modal-row"><div class="modal-label">${T('amount')}</div><input class="modal-input" type="number" id="w-amount" placeholder="1.5" min="1.5" step="0.1"></div>
    <div class="modal-row"><div class="modal-label">${T('walletAddress')}</div><input class="modal-input" type="text" id="w-wallet" placeholder="UQ..."></div>
    <div class="modal-fee">${T('fee')}: 5% · ${T('minWithdraw')}</div>
    <div id="w-preview" style="font-size:12px;color:var(--dim);margin-bottom:12px"></div>
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
      else if (d.error==='REFS_REQUIRED') toast('🔒 '+T('refsRequired')+' ('+( d.current||0)+'/2)');
      else if (d.error==='INSUFFICIENT') toast('⚠️ '+T('insufficientBalance'));
      else if (d.error==='MIN_BALANCE') toast('⚠️ '+T('minWithdraw'));
      else toast('⚠️ '+(d.message||d.error));
    }
  } catch(e) { toast('⚠️ Error'); }
}

// ============ STATS ============
function updateStats() {
  if (!userData) return;
  document.getElementById('balance-display').textContent = (userData.balance||0).toFixed(2)+' TON';
  document.getElementById('ref-link').value = 'https://t.me/'+BOT_USERNAME+'?start=ref_'+userData.telegramId;
  document.getElementById('profile-name').textContent = userData.firstName||'Player';
  document.getElementById('profile-id').textContent = 'ID: '+userData.telegramId;
  if (userData.photoUrl) document.getElementById('profile-avatar').innerHTML='<img src="'+userData.photoUrl+'" style="width:72px;height:72px;border-radius:50%;border:2px solid var(--gold)">';
  document.getElementById('ps-balance').textContent = (userData.balance||0).toFixed(2)+' TON';
  document.getElementById('ps-invested').textContent = (userData.totalInvested||0).toFixed(2)+' TON';
  document.getElementById('ps-earned').textContent = (userData.totalEarned||0).toFixed(2)+' TON';
  document.getElementById('ps-withdrawn').textContent = (userData.totalWithdrawn||0).toFixed(2)+' TON';
  document.getElementById('ps-joined').textContent = userData.createdAt?new Date(userData.createdAt).toLocaleDateString():'---';
}

// ============ HELPERS ============
function copyRefLink() { navigator.clipboard.writeText(document.getElementById('ref-link').value); toast(T('copied')); }
function shareRef() { const l=document.getElementById('ref-link').value; if(tg) tg.openTelegramLink('https://t.me/share/url?url='+encodeURIComponent(l)+'&text='+encodeURIComponent('⛏️🐱 Join Cats Mining!')); }
function sendRefChat() { const l=document.getElementById('ref-link').value; if(tg) tg.switchInlineQuery('⛏️🐱 '+l,['users']); }

function toast(msg) {
  const t=document.getElementById('toast');
  t.textContent=msg;
  t.classList.remove('show');
  void t.offsetWidth;
  t.classList.add('show');
  clearTimeout(window._tt);
  window._tt=setTimeout(()=>t.classList.remove('show'),2500);
}