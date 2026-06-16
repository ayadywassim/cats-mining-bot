const API = ''; // SET TO BACKEND URL e.g. https://cats-mining-backend.onrender.com
const tg = window.Telegram && window.Telegram.WebApp;
let userData = null;
let pendingInterval = null;

// ============ INIT ============
document.addEventListener('DOMContentLoaded', async () => {
  if (tg) { tg.ready(); tg.expand(); tg.setHeaderColor('#0d0d12'); tg.setBackgroundColor('#0d0d12'); }
  const saved = localStorage.getItem('cm_lang');
  if (saved && LANGS[saved]) currentLang = saved;
  renderAll();
  await registerUser();
});

// ============ REGISTER & FETCH USER ============
async function registerUser() {
  try {
    let telegramId = '0', firstName = 'Player', username = '', photoUrl = '', refBy = '';
    if (tg && tg.initDataUnsafe && tg.initDataUnsafe.user) {
      const u = tg.initDataUnsafe.user;
      telegramId = u.id.toString();
      firstName = u.first_name || '';
      username = u.username || '';
      photoUrl = u.photo_url || '';
    }
    if (tg && tg.initDataUnsafe && tg.initDataUnsafe.start_param) {
      const sp = tg.initDataUnsafe.start_param;
      if (sp.startsWith('ref_')) refBy = sp.replace('ref_', '');
    }
    if (telegramId === '0') { renderAll(); return; }

    const r = await fetch(API + '/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ telegramId, firstName, username, photoUrl, refBy })
    });
    const d = await r.json();
    if (d.success) {
      userData = d.user;
      renderAll();
      startPendingCounter();
    }
  } catch (e) { console.error('Register error:', e); }
}

async function refreshUser() {
  if (!userData) return;
  try {
    const r = await fetch(API + '/api/user/' + userData.telegramId);
    const d = await r.json();
    if (d.success) { userData = d.user; updateStats(); renderMiners(); }
  } catch (e) {}
}

// ============ REAL-TIME PENDING COUNTER ============
function startPendingCounter() {
  if (pendingInterval) clearInterval(pendingInterval);
  updatePending();
  pendingInterval = setInterval(updatePending, 3000);
}

async function updatePending() {
  if (!userData) return;
  try {
    const r = await fetch(API + '/api/miners/pending/' + userData.telegramId);
    const d = await r.json();
    if (d.success) {
      document.getElementById('pending-value').innerHTML = d.pending.toFixed(4) + ' <span class="pending-ton">TON</span>';
      document.getElementById('stat-profit').textContent = d.dailyProfit.toFixed(3);
      document.getElementById('stat-miners').textContent = d.activeCount;
    }
  } catch (e) {}
}

// ============ NAVIGATION ============
function goPage(name, el) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  if (el) el.classList.add('active');
  if (name === 'tasks') loadTasks();
  if (name === 'friends') loadReferrals();
}

// ============ LANGUAGE ============
function toggleLangMenu() {
  const m = document.getElementById('lang-menu');
  m.style.display = m.style.display === 'none' ? 'block' : 'none';
}
document.addEventListener('click', e => {
  if (!e.target.closest('.lang-btn') && !e.target.closest('.lang-menu'))
    document.getElementById('lang-menu').style.display = 'none';
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
  document.getElementById('btn-share').textContent = '↗ ' + T('share');
  document.getElementById('btn-send').textContent = '✈ ' + T('sendChat');
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
  document.documentElement.dir = currentLang === 'ar' ? 'rtl' : 'ltr';
  renderMiners();
  updateStats();
}

// ============ RENDER MINERS (WITH IMAGES) ============
function renderMiners() {
  const list = document.getElementById('miners-list');
  const ownedIds = [];
  if (userData && userData.activeMiners) {
    userData.activeMiners.forEach(am => ownedIds.push(am.minerId));
  }

  list.innerHTML = MINERS.map(m => {
    const owned = ownedIds.includes(m.id);
    const isFree = m.price === 0;
    let cardClass = 'miner-card';
    if (m.level === 7) cardClass += ' premium';
    else if (m.level === 8) cardClass += ' legendary';
    else if (isFree) cardClass += ' free-card';

    let badge = '';
    if (owned) badge = `<div class="miner-badge badge-active">${T('active')}</div>`;

    let btnClass = 'buy-btn';
    let btnText = `⛏️ ${T('buyFor')} ${m.price} TON`;
    if (isFree && !owned) { btnClass += ' free'; btnText = `✅ ${T('claimNow')}`; }
    else if (m.level === 7 && !owned) btnClass += ' premium';
    else if (m.level === 8 && !owned) btnClass += ' legendary';
    if (owned) { btnClass += ' disabled'; btnText = `✅ ${T('owned')}`; }

    return `<div class="${cardClass}">
      <div class="miner-top">
        <div class="miner-img"><img src="images/miner-${m.level}.png" alt="${m.name}" onerror="this.onerror=null;this.style.display='none';this.parentElement.innerHTML='<span style=font-size:32px>${m.level<=6?m.emoji:'⛏️'}</span>'"></div>
        <div class="miner-info">
          <div class="miner-name">${m.name}<span class="lv">Lv.${m.level}</span></div>
          <div class="miner-sub">${isFree ? T('free') : T('payback') + ' ~' + m.payback + T('days')}</div>
        </div>
        ${badge}
      </div>
      <div class="miner-stats">
        <div class="miner-stat"><div class="miner-stat-label">${T('daily')}</div><div class="miner-stat-value gold">${m.daily}</div></div>
        <div class="miner-stat"><div class="miner-stat-label">${T('contract')}</div><div class="miner-stat-value">${m.days}${T('days')}</div></div>
        <div class="miner-stat"><div class="miner-stat-label">${T('total')}</div><div class="miner-stat-value green">${m.total}</div></div>
      </div>
      <button class="${btnClass}" ${owned ? 'disabled' : `onclick="buyMiner('${m.id}')"`}>${btnText}</button>
    </div>`;
  }).join('');
}

// ============ BUY MINER ============
async function buyMiner(minerId) {
  if (!userData) { toast('⚠️ Open from Telegram!'); return; }
  const miner = MINERS.find(m => m.id === minerId);
  if (!miner) return;

  try {
    const r = await fetch(API + '/api/miners/buy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ telegramId: userData.telegramId, minerId })
    });
    const d = await r.json();

    if (d.success && d.type === 'free') {
      toast(`🐱 ${miner.name} ${T('active')}!`);
      await refreshUser();
      return;
    }

    if (d.success && d.type === 'deposit_required') {
      showDepositModal(miner, d);
      return;
    }

    toast('⚠️ ' + (d.error || T('error')));
  } catch (e) { toast('⚠️ ' + T('error')); }
}

function showDepositModal(miner, data) {
  const modal = document.getElementById('withdraw-modal');
  const content = document.getElementById('withdraw-content');
  content.innerHTML = `
    <div class="modal-title">⛏️ ${T('buyFor')} ${miner.price} TON</div>
    <div class="modal-warn" style="text-align:left">
      <div style="margin-bottom:10px;font-size:14px;font-weight:600">${miner.name} — Lv.${miner.level}</div>
      <div style="margin-bottom:6px">💰 ${T('daily')}: <span style="color:var(--gold)">${miner.daily} TON</span></div>
      <div style="margin-bottom:6px">📅 ${T('contract')}: ${miner.days} ${T('days')}</div>
      <div>💎 ${T('total')}: <span style="color:var(--green)">${miner.total} TON</span></div>
    </div>
    <div class="modal-row">
      <div class="modal-label">Send exactly <span style="color:var(--gold);font-weight:600">${miner.price} TON</span> to:</div>
      <div class="modal-input" style="font-size:11px;word-break:break-all;cursor:pointer" onclick="copyWallet()">${data.walletAddress}</div>
    </div>
    <div class="modal-row">
      <div class="modal-label">Memo (REQUIRED):</div>
      <div class="modal-input" style="font-size:14px;font-weight:600;color:var(--gold);cursor:pointer" onclick="copyMemo('${data.memo}')">${data.memo}</div>
    </div>
    <div class="modal-fee">⚠️ Include the memo or payment won't be detected!</div>
    <button class="modal-btn" onclick="document.getElementById('withdraw-modal').style.display='none'">✅ I've sent the payment</button>`;
  modal.style.display = 'flex';
}

function copyWallet() {
  navigator.clipboard.writeText(document.querySelector('.modal-input').textContent);
  toast(T('copied'));
}
function copyMemo(memo) {
  navigator.clipboard.writeText(memo);
  toast(T('copied') + ' — ' + memo);
}

// ============ COLLECT EARNINGS ============
async function collectEarnings() {
  if (!userData) return;
  try {
    const r = await fetch(API + '/api/miners/collect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ telegramId: userData.telegramId })
    });
    const d = await r.json();
    if (d.success) {
      toast(`💰 +${d.collected.toFixed(4)} TON`);
      userData.balance = d.newBalance;
      updateStats();
    } else {
      toast('⚠️ ' + (d.error || T('error')));
    }
  } catch (e) { toast('⚠️ ' + T('error')); }
}

// ============ TASKS (FROM BACKEND) ============
async function loadTasks() {
  try {
    const r = await fetch(API + '/api/tasks');
    const d = await r.json();
    if (!d.success) return;
    
    const tasksHtml = d.tasks.map(t => {
      const done = userData && userData.completedTasks && userData.completedTasks.includes(t.taskId);
      return `<div class="task-card">
        <div class="task-icon">${t.icon}</div>
        <div class="task-info">
          <div class="task-name">${t.title}</div>
          <div class="task-reward">+${t.reward} TON</div>
        </div>
        ${done
          ? `<div class="task-btn done">${T('taskDone')}</div>`
          : `<button class="task-btn go" onclick="doTask('${t.taskId}','${t.link || ''}',${t.reward})">${T('taskGo')}</button>`
        }
      </div>`;
    }).join('');

    // Daily reward
    const canDaily = !userData || !userData.lastDaily || (Date.now() - new Date(userData.lastDaily).getTime()) >= 86400000;
    const dailyHtml = `<div class="task-card">
      <div class="task-icon">🎁</div>
      <div class="task-info">
        <div class="task-name">${T('dailyReward')}</div>
        <div class="task-reward">+0.005~0.015 TON</div>
      </div>
      ${canDaily
        ? `<button class="task-btn claim" onclick="claimDaily()">${T('claimDaily')}</button>`
        : `<div class="task-btn done">${T('taskDone')}</div>`
      }
    </div>`;

    document.getElementById('tasks-list').innerHTML = dailyHtml + tasksHtml;
  } catch (e) {}
}

async function doTask(taskId, link, reward) {
  if (!userData) return;
  if (link && link !== 'null' && link !== '#' && link !== '') {
    window.open(link, '_blank');
    await new Promise(r => setTimeout(r, 3000));
  }
  try {
    const r = await fetch(API + '/api/tasks/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ telegramId: userData.telegramId, taskId })
    });
    const d = await r.json();
    if (d.success) {
      toast(`✅ +${d.reward} TON`);
      userData.balance = d.newBalance;
      userData.completedTasks.push(taskId);
      updateStats();
      loadTasks();
    } else toast('⚠️ ' + (d.error || T('error')));
  } catch (e) { toast('⚠️ ' + T('error')); }
}

async function claimDaily() {
  if (!userData) return;
  try {
    const r = await fetch(API + '/api/daily-claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ telegramId: userData.telegramId })
    });
    const d = await r.json();
    if (d.success) {
      toast(`🎁 +${d.reward.toFixed(4)} TON`);
      userData.balance = d.newBalance;
      userData.lastDaily = new Date().toISOString();
      updateStats();
      loadTasks();
    } else if (d.error === 'TOO_EARLY') {
      toast(`⏰ ${T('nextClaim')} ${formatTimeLeft(d.nextClaim)}`);
    }
  } catch (e) { toast('⚠️ ' + T('error')); }
}

function formatTimeLeft(dateStr) {
  const diff = new Date(dateStr) - Date.now();
  if (diff <= 0) return '0' + T('minutes');
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  return h + T('hours') + ' ' + m + T('minutes');
}

// ============ REFERRALS ============
async function loadReferrals() {
  if (!userData) return;
  try {
    const r = await fetch(API + '/api/referrals/' + userData.telegramId);
    const d = await r.json();
    if (!d.success) return;
    document.getElementById('ref-count').textContent = d.total;
    document.getElementById('ref-commission').textContent = d.commission.toFixed(2);

    if (d.referrals.length > 0) {
      document.getElementById('ref-list').innerHTML = d.referrals.map(ref =>
        `<div class="task-card">
          <div class="task-icon">👤</div>
          <div class="task-info">
            <div class="task-name">${ref.firstName || 'User'}</div>
            <div class="task-reward">${ref.isPaid ? '✅ Paid' : '⏳ Free'}</div>
          </div>
        </div>`
      ).join('');
    }
  } catch (e) {}
}

// ============ WITHDRAW (BACKEND HANDLES ALL) ============
function openWithdraw() {
  const modal = document.getElementById('withdraw-modal');
  const content = document.getElementById('withdraw-content');
  content.innerHTML = `
    <div class="modal-title">${T('withdraw')}</div>
    <div class="modal-row">
      <div class="modal-label">${T('balance')}: <span style="color:var(--gold)">${(userData ? userData.balance : 0).toFixed(2)} TON</span></div>
    </div>
    <div class="modal-row">
      <div class="modal-label">${T('amount')}</div>
      <input class="modal-input" type="number" id="w-amount" placeholder="1.5" min="1.5" step="0.1">
    </div>
    <div class="modal-row">
      <div class="modal-label">${T('walletAddress')}</div>
      <input class="modal-input" type="text" id="w-wallet" placeholder="UQ...">
    </div>
    <div class="modal-fee">${T('fee')}: 5% · ${T('minWithdraw')}</div>
    <div id="w-preview" style="font-size:12px;color:var(--dim);margin-bottom:12px"></div>
    <button class="modal-btn" onclick="submitWithdraw()">${T('submit')}</button>`;
  document.getElementById('w-amount').addEventListener('input', function() {
    const a = parseFloat(this.value) || 0;
    const fee = a * 0.05;
    document.getElementById('w-preview').textContent = a > 0 ? `${T('youReceive')}: ${(a - fee).toFixed(4)} TON (${T('fee')}: ${fee.toFixed(4)})` : '';
  });
  modal.style.display = 'flex';
}

async function submitWithdraw() {
  if (!userData) return;
  const amount = parseFloat(document.getElementById('w-amount').value);
  const wallet = document.getElementById('w-wallet').value.trim();
  if (!amount || amount < 1.5) { toast('⚠️ Min 1.5 TON'); return; }
  if (!wallet || wallet.length < 20) { toast('⚠️ Invalid wallet'); return; }

  try {
    const r = await fetch(API + '/api/withdrawals/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ telegramId: userData.telegramId, amount, walletAddress: wallet })
    });
    const d = await r.json();
    if (d.success) {
      toast('✅ ' + T('withdrawSubmitted'));
      document.getElementById('withdraw-modal').style.display = 'none';
      refreshUser();
    } else {
      if (d.error === 'DEPOSIT_REQUIRED') toast('🔒 ' + T('depositRequired'));
      else if (d.error === 'REFS_REQUIRED') toast(`🔒 ${T('refsRequired')} (${d.current || 0}/2)`);
      else if (d.error === 'INSUFFICIENT') toast('⚠️ ' + T('insufficientBalance'));
      else if (d.error === 'MIN_BALANCE') toast('⚠️ ' + T('minWithdraw'));
      else if (d.error === 'ACCOUNT_BANNED') toast('🚫 Account banned');
      else toast('⚠️ ' + (d.message || d.error));
    }
  } catch (e) { toast('⚠️ ' + T('error')); }
}

// ============ UPDATE STATS ============
function updateStats() {
  if (userData) {
    document.getElementById('balance-display').textContent = (userData.balance || 0).toFixed(2) + ' TON';
    document.getElementById('ref-link').value = `https://t.me/CatsMiningBot?start=ref_${userData.telegramId}`;
    document.getElementById('profile-name').textContent = userData.firstName || 'Player';
    document.getElementById('profile-id').textContent = 'ID: ' + userData.telegramId;
    document.getElementById('profile-avatar').textContent = userData.photoUrl ? '' : '🐱';
    if (userData.photoUrl) document.getElementById('profile-avatar').innerHTML = `<img src="${userData.photoUrl}" style="width:56px;height:56px;border-radius:50%">`;
    document.getElementById('ps-balance').textContent = (userData.balance || 0).toFixed(2) + ' TON';
    document.getElementById('ps-invested').textContent = (userData.totalInvested || 0).toFixed(2) + ' TON';
    document.getElementById('ps-earned').textContent = (userData.totalEarned || 0).toFixed(2) + ' TON';
    document.getElementById('ps-withdrawn').textContent = (userData.totalWithdrawn || 0).toFixed(2) + ' TON';
    document.getElementById('ps-joined').textContent = userData.createdAt ? new Date(userData.createdAt).toLocaleDateString() : '---';
  }
}

// ============ HELPERS ============
function copyRefLink() {
  const input = document.getElementById('ref-link');
  navigator.clipboard.writeText(input.value);
  toast(T('copied'));
}

function shareRef() {
  const link = document.getElementById('ref-link').value;
  if (tg) tg.openTelegramLink('https://t.me/share/url?url=' + encodeURIComponent(link) + '&text=' + encodeURIComponent('⛏️🐱 Join Cats Mining and earn TON daily!'));
}

function sendRefChat() {
  const link = document.getElementById('ref-link').value;
  if (tg) tg.switchInlineQuery('⛏️🐱 Join Cats Mining! ' + link, ['users']);
}

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}