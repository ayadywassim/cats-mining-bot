const API = ''; // Will be set to backend URL
const tg = window.Telegram && window.Telegram.WebApp;
let userData = null;

// ============ INIT ============
document.addEventListener('DOMContentLoaded', () => {
  if (tg) { tg.ready(); tg.expand(); }
  const saved = localStorage.getItem('cm_lang');
  if (saved && LANGS[saved]) currentLang = saved;
  renderAll();
});

// ============ NAVIGATION ============
function goPage(name, el) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  if (el) el.classList.add('active');
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
  renderMiners();
  renderTasks();
  updateStats();
}

// ============ RENDER MINERS ============
function renderMiners() {
  const list = document.getElementById('miners-list');
  list.innerHTML = MINERS.map(m => {
    const owned = userData && userData.ownedMiners && userData.ownedMiners.includes(m.id);
    const isFree = m.price === 0;
    let cardClass = 'miner-card';
    if (m.level === 7) cardClass += ' premium';
    else if (m.level === 8) cardClass += ' legendary';
    else if (isFree) cardClass += ' free-card';

    let badge = '';
    if (owned) badge = `<div class="miner-badge badge-active">${T('active')}</div>`;
    else if (!isFree) badge = `<div class="badge-count">👥 ${Math.floor(Math.random()*3000+500)}</div>`;

    let btnClass = 'buy-btn';
    let btnText = `⛏️ ${T('buyFor')} ${m.price} TON`;
    if (isFree) { btnClass += ' free'; btnText = `✅ ${T('claimNow')}`; }
    else if (m.level === 7) btnClass += ' premium';
    else if (m.level === 8) btnClass += ' legendary';
    if (owned) { btnClass += ' disabled'; btnText = `✅ ${T('owned')}`; }

    return `<div class="${cardClass}">
      <div class="miner-top">
        <div class="miner-emoji">${m.emoji}</div>
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

// ============ RENDER TASKS ============
function renderTasks() {
  const tasks = [
    { id: 't_news', icon: '📢', name: 'Join News Channel', reward: 0.02, link: '#' },
    { id: 't_payouts', icon: '💸', name: 'Join Payouts Channel', reward: 0.02, link: '#' },
    { id: 't_daily', icon: '🎁', name: T('dailyReward'), reward: 0.01, link: null },
  ];
  document.getElementById('tasks-list').innerHTML = tasks.map(t => {
    const done = userData && userData.completedTasks && userData.completedTasks.includes(t.id);
    return `<div class="task-card">
      <div class="task-icon">${t.icon}</div>
      <div class="task-info">
        <div class="task-name">${t.name}</div>
        <div class="task-reward">+${t.reward} TON</div>
      </div>
      ${done
        ? `<div class="task-btn done">${T('taskDone')}</div>`
        : `<button class="task-btn go" onclick="doTask('${t.id}','${t.link}',${t.reward})">${T('taskGo')}</button>`
      }
    </div>`;
  }).join('');
}

// ============ UPDATE STATS ============
function updateStats() {
  let dailyProfit = 0;
  let activeCount = 0;
  if (userData && userData.activeMiners) {
    userData.activeMiners.forEach(am => {
      const m = MINERS.find(mn => mn.id === am.minerId);
      if (m) { dailyProfit += m.daily; activeCount++; }
    });
  }
  document.getElementById('stat-profit').textContent = dailyProfit.toFixed(3);
  document.getElementById('stat-miners').textContent = activeCount;

  if (userData) {
    document.getElementById('balance-display').textContent = (userData.balance || 0).toFixed(2) + ' TON';
    document.getElementById('pending-value').innerHTML = (userData.pending || 0).toFixed(4) + ' <span class="pending-ton">TON</span>';
    document.getElementById('ref-count').textContent = (userData.referrals || []).length;
    document.getElementById('ref-commission').textContent = (userData.refCommission || 0).toFixed(2);
    document.getElementById('ref-link').value = `https://t.me/CatsMiningBot?start=ref_${userData.telegramId}`;
    document.getElementById('profile-name').textContent = userData.firstName || 'Player';
    document.getElementById('profile-id').textContent = 'ID: ' + userData.telegramId;
    document.getElementById('ps-balance').textContent = (userData.balance || 0).toFixed(2) + ' TON';
    document.getElementById('ps-invested').textContent = (userData.totalInvested || 0).toFixed(2) + ' TON';
    document.getElementById('ps-earned').textContent = (userData.totalEarned || 0).toFixed(2) + ' TON';
    document.getElementById('ps-withdrawn').textContent = (userData.totalWithdrawn || 0).toFixed(2) + ' TON';
    document.getElementById('ps-joined').textContent = userData.createdAt ? new Date(userData.createdAt).toLocaleDateString() : '---';
  }
}

// ============ ACTIONS ============
async function buyMiner(minerId) {
  const miner = MINERS.find(m => m.id === minerId);
  if (!miner) return;
  if (miner.price === 0) {
    toast(`🐱 ${T('success')}! ${miner.name} ${T('active')}!`);
    return;
  }
  toast(`⛏️ ${T('buyFor')} ${miner.price} TON — ${miner.name}`);
}

async function collectEarnings() {
  toast(`💰 ${T('collect')}!`);
}

async function doTask(taskId, link, reward) {
  if (link && link !== 'null' && link !== '#') window.open(link, '_blank');
  toast(`✅ +${reward} TON`);
}

function openWithdraw() {
  const modal = document.getElementById('withdraw-modal');
  const content = document.getElementById('withdraw-content');
  content.innerHTML = `
    <div class="modal-title">${T('withdraw')}</div>
    <div class="modal-row">
      <div class="modal-label">${T('balance')}: ${(userData ? userData.balance : 0).toFixed(2)} TON</div>
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
  const amtInput = document.getElementById('w-amount');
  if (amtInput) amtInput.addEventListener('input', function() {
    const a = parseFloat(this.value) || 0;
    const fee = a * 0.05;
    document.getElementById('w-preview').textContent = a > 0 ? `${T('youReceive')}: ${(a - fee).toFixed(4)} TON (${T('fee')}: ${fee.toFixed(4)})` : '';
  });
  modal.style.display = 'flex';
}

async function submitWithdraw() {
  const amount = parseFloat(document.getElementById('w-amount').value);
  const wallet = document.getElementById('w-wallet').value.trim();
  if (!amount || amount < 1.5) { toast('⚠️ Min 1.5 TON'); return; }
  if (!wallet || wallet.length < 20) { toast('⚠️ Invalid wallet'); return; }
  toast(T('withdrawSubmitted'));
  document.getElementById('withdraw-modal').style.display = 'none';
}

function copyRefLink() {
  const input = document.getElementById('ref-link');
  input.select();
  document.execCommand('copy');
  toast(T('copied'));
}

function shareRef() {
  const link = document.getElementById('ref-link').value;
  if (tg) tg.openTelegramLink('https://t.me/share/url?url=' + encodeURIComponent(link) + '&text=' + encodeURIComponent('Join Cats Mining! ⛏️🐱'));
}

function sendRefChat() {
  const link = document.getElementById('ref-link').value;
  if (tg) tg.switchInlineQuery('Join Cats Mining! ⛏️🐱 ' + link, ['users']);
}

// ============ TOAST ============
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

// ============ REFRESH ============
async function refreshUser() {
  // Will fetch from API when backend is ready
}