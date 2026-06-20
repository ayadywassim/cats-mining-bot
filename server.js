require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const TelegramBot = require('node-telegram-bot-api');
const rateLimit = require('express-rate-limit');
const path = require('path');
const app = express();

// CORS - allow frontend to call backend
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, x-admin-key');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.json());
app.use(express.static('public'));

// Trust proxy (Render uses reverse proxy)
app.set('trust proxy', 1);

// Rate limit
const limiter = rateLimit({ windowMs: 60000, max: 100 });
app.use('/api/', limiter);

// ============ MINERS CONFIG ============
const MINERS_CONFIG = [
  { id: 'miner_0', name: 'Kitty',    level: 0, price: 0,   daily: 0.001, days: 60, total: 0.06  },
  { id: 'miner_1', name: 'Whiskers', level: 1, price: 0.5, daily: 0.014, days: 60, total: 0.9   },
  { id: 'miner_2', name: 'Mittens',  level: 2, price: 1,   daily: 0.033, days: 60, total: 2.0   },
  { id: 'miner_3', name: 'Shadow',   level: 3, price: 3,   daily: 0.103, days: 60, total: 6.2   },
  { id: 'miner_4', name: 'Luna',     level: 4, price: 7,   daily: 0.25,  days: 60, total: 15    },
  { id: 'miner_5', name: 'Tiger',    level: 5, price: 15,  daily: 0.555, days: 60, total: 33    },
  { id: 'miner_6', name: 'Leo',      level: 6, price: 30,  daily: 1.15,  days: 60, total: 69    },
  { id: 'miner_7', name: 'Panther',  level: 7, price: 50,  daily: 2.0,   days: 60, total: 120   },
  { id: 'miner_8', name: 'Raja',     level: 8, price: 100, daily: 4.16,  days: 60, total: 250   },
];

// ============ MONGODB ============
mongoose.connect(process.env.MONGO_URI).then(() => console.log('✅ MongoDB connected')).catch(e => console.error('❌ MongoDB:', e.message));

const userSchema = new mongoose.Schema({
  telegramId: { type: String, unique: true, index: true },
  firstName: String,
  username: String,
  photoUrl: String,
  balance: { type: Number, default: 0 },
  pending: { type: Number, default: 0 },
  totalInvested: { type: Number, default: 0 },
  totalEarned: { type: Number, default: 0 },
  totalWithdrawn: { type: Number, default: 0 },
  totalDeposited: { type: Number, default: 0 },
  referrals: { type: [String], default: [] },
  referredBy: { type: String, default: null },
  referralLocked: { type: Boolean, default: false },  // Once set, can't change
  refCommission: { type: Number, default: 0 },
  completedTasks: { type: [String], default: [] },
  banned: { type: Boolean, default: false },
  withdrawBypass: { type: Boolean, default: false },
  lastDaily: Date,
  ipAddress: String,                                  // For fraud detection
  registrationFingerprint: String,                    // photoUrl + username pattern
  createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('CatsMiningUser', userSchema);

// Referral audit log
const referralLogSchema = new mongoose.Schema({
  referrerId: String,
  referredId: String,
  status: { type: String, enum: ['pending', 'verified', 'rejected', 'paid'], default: 'pending' },
  reason: String,
  commission: { type: Number, default: 0 },
  depositAmount: Number,
  createdAt: { type: Date, default: Date.now },
  verifiedAt: Date
});
referralLogSchema.index({ referrerId: 1, referredId: 1 }, { unique: true });
const ReferralLog = mongoose.model('CatsMiningReferralLog', referralLogSchema);

const activeMinerSchema = new mongoose.Schema({
  telegramId: { type: String, index: true },
  minerId: String,
  minerName: String,
  level: Number,
  price: Number,
  daily: Number,
  totalReturn: Number,
  startedAt: { type: Date, default: Date.now },
  startsEarningAt: Date,
  expiresAt: Date,
  status: { type: String, default: 'active', enum: ['active', 'expired'] },
  totalCollected: { type: Number, default: 0 },
  lastCollected: Date
});
const ActiveMiner = mongoose.model('CatsMiningMiner', activeMinerSchema);

const depositSchema = new mongoose.Schema({
  telegramId: String,
  amount: Number,                                                    // Base price (e.g. 0.5)
  uniqueAmount: Number,                                              // Exact amount with unique decimal (e.g. 0.500009)
  txHash: { type: String, unique: true, sparse: true },
  minerId: String,
  memo: String,
  status: { type: String, default: 'pending', enum: ['pending', 'verified', 'failed'] },
  matchMethod: String,                                               // MEMO | UNIQUE_AMOUNT | EXACT_AMOUNT | DEPOSIT_ID | BALANCE
  verifiedAt: Date,
  createdAt: { type: Date, default: Date.now, expires: 86400 * 7 }   // auto-delete pending after 7 days
});
const Deposit = mongoose.model('CatsMiningDeposit', depositSchema);

const withdrawalSchema = new mongoose.Schema({
  telegramId: String,
  amount: Number,
  fee: Number,
  netAmount: Number,
  walletAddress: String,
  status: { type: String, default: 'pending', enum: ['pending', 'approved', 'rejected'] },
  txHash: String,
  createdAt: { type: Date, default: Date.now }
});
const Withdrawal = mongoose.model('CatsMiningWithdrawal', withdrawalSchema);

const taskSchema = new mongoose.Schema({
  taskId: { type: String, unique: true },
  title: String,
  icon: String,
  reward: Number,
  link: String,
  type: { type: String, default: 'channel' },
  requireMiner: { type: Boolean, default: false },
  requireDeposit: { type: Boolean, default: false },
  requireReferrals: { type: Number, default: 0 },
  enabled: { type: Boolean, default: true }
});
const Task = mongoose.model('CatsMiningTask', taskSchema);

// ============ BOT ============
const bot = new TelegramBot(process.env.BOT_TOKEN);
bot.setWebHook(`${process.env.WEBHOOK_URL}/webhook`);

app.post('/webhook', (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

bot.onText(/\/start(?:[\s_](.+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const tgId = msg.from.id.toString();
  const refParam = match[1];

  let user = await User.findOne({ telegramId: tgId });
  if (!user) {
    user = new User({
      telegramId: tgId,
      firstName: msg.from.first_name || '',
      username: msg.from.username || ''
    });

    if (refParam && refParam.startsWith('ref_')) {
      const referrerId = refParam.replace('ref_', '');
      if (referrerId !== tgId) {
        user.referredBy = referrerId;
        await User.findOneAndUpdate(
          { telegramId: referrerId },
          { $addToSet: { referrals: tgId } }
        );
      }
    }
    await user.save();
  } else if (!user.referredBy && refParam && refParam.startsWith('ref_')) {
    const referrerId = refParam.replace('ref_', '');
    if (referrerId !== tgId) {
      user.referredBy = referrerId;
      await user.save();
      await User.findOneAndUpdate(
        { telegramId: referrerId },
        { $addToSet: { referrals: tgId } }
      );
    }
  }

  const miniAppUrl = process.env.MINI_APP_URL || 'https://cats-mining.vercel.app';
  await bot.sendMessage(chatId,
    `🐱⛏️ *Welcome to Cats Mining!*\n\nBuy miners, earn TON daily!\nStart with a FREE Kitty miner!`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '⛏️ Start Mining', web_app: { url: miniAppUrl } }],
          [{ text: '📢 News', url: `https://t.me/${(process.env.NEWS_CHANNEL || '').replace('@','')}` }],
          [{ text: '💸 Payouts', url: `https://t.me/${(process.env.PROOF_CHANNEL || '').replace('@','')}` }]
        ]
      }
    }
  );
});

// ============ API: REGISTER ============
app.post('/api/register', async (req, res) => {
  try {
    const { telegramId, firstName, username, photoUrl, refBy } = req.body;
    const tgId = telegramId.toString();
    let user = await User.findOne({ telegramId: tgId });

    if (!user) {
      user = new User({ telegramId: tgId, firstName, username, photoUrl });
      const ipAddress = req.headers['x-forwarded-for']?.split(',')[0] || req.ip || '';
      user.ipAddress = ipAddress;

      // ─── SECURE REFERRAL VALIDATION ───
      if (refBy && refBy.toString() !== tgId) {
        const refByStr = refBy.toString();

        // Check 1: Referrer must exist
        const referrer = await User.findOne({ telegramId: refByStr });
        if (!referrer) {
          console.log(`[REFERRAL] ❌ REJECT: referrer ${refByStr} not found`);
        } else if (referrer.banned) {
          console.log(`[REFERRAL] ❌ REJECT: referrer ${refByStr} is banned`);
        } else if (referrer.referrals.includes(tgId)) {
          console.log(`[REFERRAL] ❌ REJECT: duplicate referral`);
        } else {
          // Check 2: IP/fingerprint fraud (same IP = suspicious)
          let suspicious = false;
          if (ipAddress && referrer.ipAddress === ipAddress) {
            suspicious = true;
            console.log(`[REFERRAL] ⚠️ Same IP detected: ${ipAddress}`);
          }

          // Set referral (locked permanently)
          user.referredBy = refByStr;
          user.referralLocked = true;

          await User.findOneAndUpdate(
            { telegramId: refByStr },
            { $addToSet: { referrals: tgId } }
          );

          // Create audit log
          await ReferralLog.create({
            referrerId: refByStr,
            referredId: tgId,
            status: suspicious ? 'pending' : 'pending',
            reason: suspicious ? 'same_ip_flagged' : 'awaiting_deposit'
          }).catch(e => console.log('[REFERRAL] Log exists or error:', e.message));

          console.log(`[REFERRAL] ✅ Linked: ${tgId} → invited by ${refByStr}${suspicious?' [FLAGGED]':''}`);
        }
      }
      await user.save();
      console.log(`[USER] New: ${tgId} (${firstName})`);
    } else {
      // ─── EXISTING USER ───
      // Referral is locked once set — no auto-fix for security
      // Only allow if referredBy is null AND referralLocked is false (first time grab)
      if (refBy && refBy.toString() !== tgId && !user.referredBy && !user.referralLocked) {
        const refByStr = refBy.toString();
        const referrer = await User.findOne({ telegramId: refByStr });
        if (referrer && !referrer.banned && !referrer.referrals.includes(tgId)) {
          user.referredBy = refByStr;
          user.referralLocked = true;
          await User.findOneAndUpdate(
            { telegramId: refByStr },
            { $addToSet: { referrals: tgId } }
          );
          await ReferralLog.create({
            referrerId: refByStr,
            referredId: tgId,
            status: 'pending',
            reason: 'late_credit'
          }).catch(()=>{});
          console.log(`[REFERRAL] ✅ Late credit: ${tgId} → ${refByStr}`);
        }
      }
      if (firstName) user.firstName = firstName;
      if (username) user.username = username;
      if (photoUrl) user.photoUrl = photoUrl;
      await user.save();
    }

    const activeMiners = await ActiveMiner.find({ telegramId: tgId, status: 'active' });
    const userObj = user.toObject();
    userObj.activeMiners = activeMiners;

    res.json({ success: true, user: userObj });
  } catch (error) {
    console.error('[REGISTER] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ============ API: USER DATA ============
app.get('/api/user/:telegramId', async (req, res) => {
  try {
    const user = await User.findOne({ telegramId: req.params.telegramId });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const activeMiners = await ActiveMiner.find({ telegramId: req.params.telegramId, status: 'active' });
    const userObj = user.toObject();
    userObj.activeMiners = activeMiners;

    res.json({ success: true, user: userObj });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ API: BUY MINER ============
app.post('/api/miners/buy', async (req, res) => {
  try {
    const { telegramId, minerId } = req.body;
    const user = await User.findOne({ telegramId: telegramId.toString() });
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.banned) return res.status(403).json({ error: 'ACCOUNT_BANNED' });

    const minerConfig = MINERS_CONFIG.find(m => m.id === minerId);
    if (!minerConfig) return res.status(400).json({ error: 'Invalid miner' });

    // Free miner (Kitty)
    if (minerConfig.price === 0) {
      const existing = await ActiveMiner.findOne({ telegramId: telegramId.toString(), minerId: 'miner_0' });
      if (existing) return res.status(400).json({ error: 'Already claimed free miner' });

      const now = new Date();
      const startsEarning = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      const miner = new ActiveMiner({
        telegramId: telegramId.toString(),
        minerId: minerConfig.id,
        minerName: minerConfig.name,
        level: minerConfig.level,
        price: 0,
        daily: minerConfig.daily,
        totalReturn: minerConfig.total,
        startsEarningAt: startsEarning,
        expiresAt: new Date(startsEarning.getTime() + minerConfig.days * 24 * 60 * 60 * 1000)
      });
      await miner.save();
      return res.json({ success: true, miner, type: 'free' });
    }

    // Paid miner — create pending deposit
    const tgId = telegramId.toString();
    const depositId = Math.random().toString(36).substring(2, 8).toUpperCase();
    const memo = `CM${tgId}_${depositId}`;

    const deposit = new Deposit({
      telegramId: tgId,
      amount: minerConfig.price,
      uniqueAmount: minerConfig.price,
      minerId: minerConfig.id,
      memo: memo
    });
    await deposit.save();

    console.log(`[PAYMENT] Created deposit: user=${tgId} miner=${minerConfig.id} amount=${minerConfig.price} memo=${memo}`);

    res.json({
      success: true,
      type: 'deposit_required',
      walletAddress: process.env.BOT_WALLET,
      amount: minerConfig.price,
      uniqueAmount: minerConfig.price,
      memo: memo,
      depositId: deposit._id.toString()
    });
  } catch (error) {
    console.error('[PAYMENT] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ============ API: BUY MINER WITH BOT BALANCE ============
app.post('/api/miners/buy-balance', async (req, res) => {
  try {
    const { telegramId, minerId } = req.body;
    const tgId = telegramId.toString();
    const minerConfig = MINERS_CONFIG.find(m => m.id === minerId);
    if (!minerConfig) return res.status(404).json({ error: 'MINER_NOT_FOUND' });
    if (minerConfig.price === 0) return res.status(400).json({ error: 'FREE_MINER_USE_BUY' });

    // Atomic: deduct balance only if sufficient
    const updated = await User.findOneAndUpdate(
      { telegramId: tgId, balance: { $gte: minerConfig.price }, banned: false },
      { $inc: { balance: -minerConfig.price, totalInvested: minerConfig.price } },
      { new: true }
    );
    if (!updated) return res.status(400).json({ error: 'INSUFFICIENT_BALANCE' });

    // Activate miner with 24h delay
    const activateAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const miner = new ActiveMiner({
      telegramId: tgId,
      minerId: minerConfig.id,
      minerName: minerConfig.name,
      level: minerConfig.level,
      price: minerConfig.price,
      daily: minerConfig.daily,
      totalReturn: minerConfig.total,
      startsEarningAt: activateAt,
      expiresAt: new Date(activateAt.getTime() + minerConfig.days * 24 * 60 * 60 * 1000)
    });
    await miner.save();

    console.log(`[MINER] ${tgId} bought ${minerConfig.name} with balance (${minerConfig.price} TON)`);

    // Record as verified deposit (counts for withdrawal eligibility)
    const memo = 'CM' + tgId + '_BAL_' + Date.now();
    const deposit = new Deposit({
      telegramId: tgId,
      minerId: minerConfig.id,
      amount: minerConfig.price,
      memo,
      status: 'verified',
      txHash: 'BALANCE_' + Date.now(),
      verifiedAt: new Date()
    });
    await deposit.save();

    // Referral commission — only if not paid yet (prevent duplicate)
    if (updated.referredBy) {
      const existingLog = await ReferralLog.findOne({
        referrerId: updated.referredBy,
        referredId: tgId,
        status: 'paid'
      });
      if (!existingLog) {
        const commission = minerConfig.price * 0.10;
        await User.findOneAndUpdate(
          { telegramId: updated.referredBy },
          { $inc: { balance: commission, refCommission: commission, totalEarned: commission } }
        );
        await ReferralLog.findOneAndUpdate(
          { referrerId: updated.referredBy, referredId: tgId },
          { status: 'paid', commission, depositAmount: minerConfig.price, verifiedAt: new Date() },
          { upsert: true }
        );
        console.log(`[REFERRAL] +${commission} TON to ${updated.referredBy} (balance buy)`);
      } else {
        console.log(`[REFERRAL] ⏭️ Already paid for ${tgId} → ${updated.referredBy}`);
      }
    }

    res.json({ success: true, type: 'balance', miner });
  } catch (error) {
    console.error('[BUY-BALANCE]', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ============ API: COLLECT EARNINGS ============
app.post('/api/miners/collect', async (req, res) => {
  try {
    const { telegramId } = req.body;
    const user = await User.findOne({ telegramId: telegramId.toString() });
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.banned) return res.status(403).json({ error: 'ACCOUNT_BANNED' });

    const miners = await ActiveMiner.find({ telegramId: telegramId.toString(), status: 'active' });
    let totalCollect = 0;
    const now = new Date();

    for (const miner of miners) {
      // Check if expired
      if (now >= miner.expiresAt) {
        miner.status = 'expired';
        await miner.save();
        continue;
      }

      // Check if still in 24h warmup
      if (miner.startsEarningAt && now < miner.startsEarningAt) {
        continue;
      }

      // Calculate earnings since last collect (or since startsEarningAt)
      const earnStart = miner.startsEarningAt || miner.startedAt;
      const lastCollect = miner.lastCollected || earnStart;
      const effectiveStart = lastCollect < earnStart ? earnStart : lastCollect;
      const hoursSince = (now - effectiveStart) / (1000 * 60 * 60);
      const earned = (miner.daily / 24) * hoursSince;

      if (earned > 0.0001) {
        totalCollect += earned;
        miner.totalCollected += earned;
        miner.lastCollected = now;
        await miner.save();
      }
    }

    if (totalCollect > 0) {
      await User.findOneAndUpdate(
        { telegramId: telegramId.toString() },
        { $inc: { balance: totalCollect, totalEarned: totalCollect } }
      );
    }

    const updatedUser = await User.findOne({ telegramId: telegramId.toString() });
    res.json({ success: true, collected: totalCollect, newBalance: updatedUser.balance });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ API: PENDING EARNINGS ============
app.get('/api/miners/pending/:telegramId', async (req, res) => {
  try {
    const miners = await ActiveMiner.find({ telegramId: req.params.telegramId, status: 'active' });
    let totalPending = 0;
    let dailyProfit = 0;
    let activeCount = 0;
    const now = new Date();

    for (const miner of miners) {
      if (now >= miner.expiresAt) continue;
      
      // Check if still in 24h warmup
      if (miner.startsEarningAt && now < miner.startsEarningAt) {
        activeCount++;
        continue;
      }

      const earnStart = miner.startsEarningAt || miner.startedAt;
      const lastCollect = miner.lastCollected || earnStart;
      const effectiveStart = lastCollect < earnStart ? earnStart : lastCollect;
      const hoursSince = (now - effectiveStart) / (1000 * 60 * 60);
      totalPending += (miner.daily / 24) * hoursSince;
      dailyProfit += miner.daily;
      activeCount++;
    }

    res.json({ success: true, pending: totalPending, dailyProfit, activeCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ API: WITHDRAWALS ============
app.post('/api/withdrawals/request', async (req, res) => {
  try {
    const { telegramId, amount, walletAddress } = req.body;
    const tgId = telegramId.toString();
    const amt = parseFloat(amount);

    // Validate inputs
    if (!tgId || !amt || amt <= 0) return res.status(400).json({ error: 'INVALID_INPUT' });
    if (!walletAddress || walletAddress.length < 20) return res.status(400).json({ error: 'INVALID_WALLET' });

    const user = await User.findOne({ telegramId: tgId });
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.banned) return res.status(403).json({ error: 'ACCOUNT_BANNED' });

    // Prevent double withdrawal (check pending requests)
    const pending = await Withdrawal.findOne({ telegramId: tgId, status: 'pending' });
    if (pending) return res.status(400).json({ error: 'PENDING_EXISTS', message: 'You have a pending withdrawal' });

    // CHECK: Amount limits only
    if (amt < 1.5) return res.status(400).json({ error: 'MIN_AMOUNT' });
    if (amt > 1000) return res.status(400).json({ error: 'MAX_AMOUNT' });

    const fee = amt * 0.05;
    const netAmount = amt - fee;

    // ATOMIC: deduct balance only if sufficient
    const updated = await User.findOneAndUpdate(
      { telegramId: tgId, balance: { $gte: amt }, banned: false },
      { $inc: { balance: -amt } },
      { new: true }
    );
    if (!updated) return res.status(400).json({ error: 'INSUFFICIENT' });

    // Create withdrawal record
    const withdrawal = new Withdrawal({
      telegramId: tgId, amount: amt, fee, netAmount, walletAddress, status: 'pending'
    });
    await withdrawal.save();

    console.log(`[WITHDRAW] User ${tgId} requested ${amt} TON to ${walletAddress.slice(0,10)}...`);

    // Notify admin
    const adminId = process.env.ADMIN_IDS;
    if (adminId) {
      try {
        await bot.sendMessage(adminId,
          `💸 *Withdrawal Request*\n👤 ${user.firstName} (@${user.username||'?'})\n🆔 \`${tgId}\`\n💰 ${amt} TON\n📤 Net: ${netAmount.toFixed(4)} TON\n📬 \`${walletAddress}\``,
          { parse_mode: 'Markdown' }
        );
      } catch (e) {}
    }

    res.json({ success: true, withdrawal });
  } catch (error) {
    console.error('[WITHDRAW] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ============ API: TASKS ============
app.get('/api/tasks', async (req, res) => {
  try {
    const tasks = await Task.find({ enabled: true });
    res.json({ success: true, tasks });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/tasks/complete', async (req, res) => {
  try {
    const { telegramId, taskId } = req.body;
    const tgId = telegramId.toString();
    const user = await User.findOne({ telegramId: tgId });
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.banned) return res.status(403).json({ error: 'ACCOUNT_BANNED' });
    if (user.completedTasks.includes(taskId)) return res.status(400).json({ error: 'ALREADY_COMPLETED' });

    const task = await Task.findOne({ taskId, enabled: true });
    if (!task) return res.status(404).json({ error: 'TASK_NOT_FOUND' });

    // ─── SERVER-SIDE TASK VALIDATION ───

    // Task: Buy First Miner — verify user owns at least 1 PAID miner (not free Kitty)
    if (taskId === 't_miner' || taskId.includes('miner') || (task.requireMiner)) {
      // Must have a verified PAID deposit, OR an active miner with price > 0
      const hasVerifiedDeposit = await Deposit.findOne({
        telegramId: tgId,
        status: 'verified',
        amount: { $gte: 0.5 }   // free miner has price 0, so this excludes it
      });
      const hasPaidMiner = await ActiveMiner.findOne({
        telegramId: tgId,
        price: { $gt: 0 }
      });
      if (!hasVerifiedDeposit && !hasPaidMiner) {
        console.log(`[TASK] ❌ ${tgId} no PAID miner for ${taskId}`);
        return res.status(400).json({ error: 'NO_MINER', message: 'You must buy a paid miner first (Kitty does not count)' });
      }
      console.log(`[TASK] ✅ ${tgId} has paid miner verification`);
    }

    // Task: Deposit — verify at least one verified deposit
    if (taskId.includes('deposit') || (task.requireDeposit)) {
      const hasDeposit = await Deposit.findOne({ telegramId: tgId, status: 'verified' });
      if (!hasDeposit) {
        return res.status(400).json({ error: 'NO_DEPOSIT', message: 'You must make a deposit first' });
      }
    }

    // Task: Referral — verify actual paid referrals
    if (taskId.includes('invite') || taskId.includes('ref') || (task.requireReferrals)) {
      const required = task.requireReferrals || 1;
      let paidRefs = 0;
      for (const refId of user.referrals) {
        const dep = await Deposit.findOne({ telegramId: refId, status: 'verified' });
        if (dep) { paidRefs++; if (paidRefs >= required) break; }
      }
      if (paidRefs < required) {
        return res.status(400).json({ error: 'NOT_ENOUGH_REFS', current: paidRefs, required, message: `Need ${required} paid referrals` });
      }
    }

    // Task: Wallet — verify wallet connected (we trust this via frontend signal but flag missing)
    if (taskId.includes('wallet')) {
      // No backend check available — must rely on frontend confirmation
      // Optionally: require user to send wallet address in body
    }

    // Task: Channel join — verify via Telegram API
    if (task.link && task.link.includes('t.me/')) {
      const match = task.link.match(/t\.me\/([+a-zA-Z0-9_]+)/);
      if (match) {
        const channel = '@' + match[1].replace('+', '');
        try {
          const member = await bot.getChatMember(channel, tgId);
          const isMember = ['member', 'administrator', 'creator'].includes(member.status);
          if (!isMember) {
            console.log(`[TASK] ❌ ${tgId} not member of ${channel}, status=${member.status}`);
            return res.status(400).json({ error: 'NOT_MEMBER', message: 'Please join the channel first' });
          }
          console.log(`[TASK] ✅ ${tgId} verified as member of ${channel}`);
        } catch(e) {
          console.log(`[TASK] ⚠️ Cannot verify ${channel}: ${e.message}`);
          // If bot is not admin in channel, fail closed (require user to ask admin)
          return res.status(400).json({ error: 'VERIFY_FAILED', message: 'Cannot verify membership — bot may not be admin in channel' });
        }
      }
    }

    // ATOMIC reward delivery
    const updated = await User.findOneAndUpdate(
      { telegramId: tgId, completedTasks: { $ne: taskId } },
      { $push: { completedTasks: taskId }, $inc: { balance: task.reward, totalEarned: task.reward } },
      { new: true }
    );
    if (!updated) return res.status(400).json({ error: 'ALREADY_COMPLETED' });

    console.log(`[TASK] ✅ ${tgId} completed ${taskId} +${task.reward} TON`);
    res.json({ success: true, reward: task.reward, newBalance: updated.balance });
  } catch (error) {
    console.error('[TASK] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ============ API: DAILY REWARD ============
app.post('/api/daily-claim', async (req, res) => {
  try {
    const { telegramId } = req.body;
    const user = await User.findOne({ telegramId: telegramId.toString() });
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.banned) return res.status(403).json({ error: 'ACCOUNT_BANNED' });

    const now = new Date();
    if (user.lastDaily && (now - user.lastDaily) < 24 * 60 * 60 * 1000) {
      const next = new Date(user.lastDaily.getTime() + 24 * 60 * 60 * 1000);
      return res.status(400).json({ error: 'TOO_EARLY', nextClaim: next });
    }

    const reward = 0.005 + Math.random() * 0.01;
    user.balance += reward;
    user.totalEarned += reward;
    user.lastDaily = now;
    await user.save();

    res.json({ success: true, reward, newBalance: user.balance });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ API: REFERRALS ============
app.get('/api/referrals/:telegramId', async (req, res) => {
  try {
    const user = await User.findOne({ telegramId: req.params.telegramId });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const refs = [];
    for (const refId of user.referrals) {
      const refUser = await User.findOne({ telegramId: refId });
      if (refUser) {
        refs.push({
          telegramId: refUser.telegramId,
          firstName: refUser.firstName,
          totalDeposited: refUser.totalDeposited,
          isPaid: refUser.totalDeposited >= 0.5
        });
      }
    }

    res.json({ success: true, referrals: refs, total: refs.length, commission: user.refCommission });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ DEPOSIT VERIFICATION (CRON) ============
async function verifyDeposits() {
  try {
    const pending = await Deposit.find({ status: 'pending' });
    if (!pending.length) return;

    console.log(`\n[VERIFY] ════════ Starting verification ════════`);
    console.log(`[VERIFY] Pending deposits: ${pending.length}`);

    const apiKey = process.env.TONCENTER_KEY;
    const wallet = process.env.BOT_WALLET;
    if (!apiKey) { console.log('[VERIFY] ❌ TONCENTER_KEY missing'); return; }
    if (!wallet) { console.log('[VERIFY] ❌ BOT_WALLET missing'); return; }

    console.log(`[TON] Wallet: ${wallet.slice(0,8)}...${wallet.slice(-6)}`);

    // Fetch transactions with retries
    let txData = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const response = await fetch(`https://toncenter.com/api/v2/getTransactions?address=${wallet}&limit=50&api_key=${apiKey}`);
        const data = await response.json();
        if (data.ok && data.result) { txData = data.result; break; }
        console.log(`[TON] ⚠️ Attempt ${attempt}: ${data.error || 'no result'}`);
        await new Promise(r => setTimeout(r, 2000));
      } catch(e) {
        console.log(`[TON] ❌ Attempt ${attempt} failed: ${e.message}`);
      }
    }

    if (!txData) {
      console.log('[VERIFY] ❌ Could not fetch transactions after 3 attempts');
      return;
    }

    console.log(`[TON] Got ${txData.length} transactions`);

    for (const tx of txData) {
      const inMsg = tx.in_msg;
      if (!inMsg || !inMsg.value) continue;
      if (parseInt(inMsg.value) === 0) continue;  // skip outgoing

      const amountNano = parseInt(inMsg.value);
      const amountTON = amountNano / 1e9;
      if (amountTON < 0.05) continue;  // skip dust

      const txHash = tx.transaction_id?.hash || '';
      const fromAddr = inMsg.source || 'unknown';

      // Parse memo from in_msg.message OR msg_data.text
      let memo = '';
      if (inMsg.message) {
        memo = inMsg.message.trim();
      } else if (inMsg.msg_data && inMsg.msg_data.text) {
        // Decode base64 if needed
        try {
          memo = Buffer.from(inMsg.msg_data.text, 'base64').toString('utf-8');
          // Remove 4-byte op code prefix if present (0x00000000 for plain text comment)
          if (memo.charCodeAt(0) === 0) memo = memo.substring(4);
          memo = memo.replace(/\0/g, '').trim();
        } catch(e) {}
      }

      console.log(`\n[TX] ────────────────────────────`);
      console.log(`[TX] Amount: ${amountTON} TON (${amountNano} nano)`);
      console.log(`[TX] Memo: "${memo}"`);
      console.log(`[TX] From: ${fromAddr.slice(0,8)}...${fromAddr.slice(-6)}`);
      console.log(`[TX] Hash: ${txHash.slice(0,12)}...`);

      // Skip if already processed
      const txProcessed = await Deposit.findOne({ txHash, status: 'verified' });
      if (txProcessed) {
        console.log(`[TX] ⏭️ Already processed`);
        continue;
      }

      let matchedDep = null;
      let matchMethod = '';

      // ╔══════════════════════════════════════════════╗
      // ║  MATCHING PRIORITY                            ║
      // ║  1. MEMO match (most reliable)                ║
      // ║  2. UNIQUE_AMOUNT match (TON Connect)         ║
      // ║  3. EXACT_AMOUNT match (fallback)             ║
      // ╚══════════════════════════════════════════════╝

      // ─── PRIORITY 1: MEMO MATCH ───
      if (memo && memo.length > 2) {
        for (const dep of pending) {
          if (!dep.memo) continue;
          // Match if memo contains the deposit memo string
          if (memo.includes(dep.memo) || memo.includes(dep.memo.replace('_', ''))) {
            // Verify amount is at least 90% of expected
            if (amountTON >= dep.amount * 0.90) {
              matchedDep = dep;
              matchMethod = 'MEMO';
              console.log(`[MATCH] ✅ MEMO match: deposit ${dep._id}`);
              break;
            } else {
              console.log(`[MATCH] ⚠️ MEMO matched but amount too low: ${amountTON} < ${dep.amount}`);
            }
          }
        }
      }

      // ─── PRIORITY 2: UNIQUE AMOUNT MATCH ───
      if (!matchedDep) {
        for (const dep of pending) {
          if (!dep.uniqueAmount) continue;
          const diff = Math.abs(amountTON - dep.uniqueAmount);
          if (diff < 0.0001) {  // within 0.0001 TON
            matchedDep = dep;
            matchMethod = 'UNIQUE_AMOUNT';
            console.log(`[MATCH] ✅ UNIQUE_AMOUNT match: ${amountTON} ≈ ${dep.uniqueAmount}`);
            break;
          }
        }
      }

      // ─── PRIORITY 3: EXACT AMOUNT MATCH (most recent first) ───
      // Only works if no race condition (one pending per amount)
      if (!matchedDep) {
        // Group pending by amount — only match if unique
        const sorted = [...pending].sort((a, b) => b.createdAt - a.createdAt);
        for (const dep of sorted) {
          if (amountTON >= dep.amount * 0.99 && amountTON <= dep.amount * 1.05) {
            // Check: is this the only pending with this amount?
            const sameAmount = pending.filter(p => 
              p.amount === dep.amount && p._id.toString() !== dep._id.toString()
            );
            if (sameAmount.length === 0) {
              matchedDep = dep;
              matchMethod = 'EXACT_AMOUNT';
              console.log(`[MATCH] ✅ EXACT_AMOUNT match: ${amountTON} ≈ ${dep.amount}`);
              break;
            } else {
              console.log(`[MATCH] ⚠️ Amount ${dep.amount} matches multiple deposits - requires memo`);
            }
          }
        }
      }

      if (!matchedDep) {
        console.log(`[MATCH] ❌ NO MATCH for ${amountTON} TON, memo="${memo}"`);
        console.log(`[MATCH] Pending deposits:`);
        for (const dep of pending) {
          console.log(`[MATCH]   - user=${dep.telegramId} amount=${dep.amount} unique=${dep.uniqueAmount} memo=${dep.memo}`);
        }
        continue;
      }

      // ─── VERIFY THE DEPOSIT ───
      try {
        matchedDep.status = 'verified';
        matchedDep.txHash = txHash;
        matchedDep.matchMethod = matchMethod;
        matchedDep.verifiedAt = new Date();
        await matchedDep.save();

        console.log(`[VERIFY] ✅ Deposit verified: user=${matchedDep.telegramId} method=${matchMethod}`);

        // Activate miner
        const minerConfig = MINERS_CONFIG.find(m => m.id === matchedDep.minerId);
        if (!minerConfig) {
          console.log(`[MINER] ❌ Miner config not found: ${matchedDep.minerId}`);
          continue;
        }

        const activateAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
        const miner = new ActiveMiner({
          telegramId: matchedDep.telegramId,
          minerId: minerConfig.id,
          minerName: minerConfig.name,
          level: minerConfig.level,
          price: minerConfig.price,
          daily: minerConfig.daily,
          totalReturn: minerConfig.total,
          startsEarningAt: activateAt,
          expiresAt: new Date(activateAt.getTime() + minerConfig.days * 24 * 60 * 60 * 1000)
        });
        await miner.save();

        console.log(`[MINER] ✅ Activated ${minerConfig.name} for ${matchedDep.telegramId}`);

        // Update user stats
        await User.findOneAndUpdate(
          { telegramId: matchedDep.telegramId },
          { $inc: { totalDeposited: amountTON, totalInvested: amountTON } }
        );

        // Referral commission — prevent duplicate via audit log
        const user = await User.findOne({ telegramId: matchedDep.telegramId });
        if (user && user.referredBy) {
          const existingLog = await ReferralLog.findOne({
            referrerId: user.referredBy,
            referredId: matchedDep.telegramId,
            status: 'paid'
          });
          if (!existingLog) {
            const commission = amountTON * 0.10;
            await User.findOneAndUpdate(
              { telegramId: user.referredBy },
              { $inc: { balance: commission, refCommission: commission, totalEarned: commission } }
            );
            await ReferralLog.findOneAndUpdate(
              { referrerId: user.referredBy, referredId: matchedDep.telegramId },
              { status: 'paid', commission, depositAmount: amountTON, verifiedAt: new Date() },
              { upsert: true }
            );
            console.log(`[REFERRAL] +${commission.toFixed(4)} TON to ${user.referredBy} (verified deposit)`);
          } else {
            console.log(`[REFERRAL] ⏭️ Already paid for ${matchedDep.telegramId}`);
          }
        }

        // Notify user via bot
        try {
          await bot.sendMessage(matchedDep.telegramId,
            `✅ *Payment Verified!*\n\n⛏️ ${minerConfig.name} (Lv.${minerConfig.level})\n💰 Daily: ${minerConfig.daily} TON\n⏳ Starts earning in 24h\n📅 Contract: ${minerConfig.days} days\n💎 Total return: ${minerConfig.total} TON\n\n_Match: ${matchMethod}_`,
            { parse_mode: 'Markdown' }
          );
        } catch(e) { console.log('[BOT] Notify failed:', e.message); }
      } catch (e) {
        console.log(`[VERIFY] ❌ Failed to save: ${e.message}`);
        // Reset to pending if save fails
        if (matchedDep) {
          matchedDep.status = 'pending';
          await matchedDep.save().catch(()=>{});
        }
      }
    }

    console.log(`[VERIFY] ════════ Verification complete ════════\n`);
  } catch (error) {
    console.error('[VERIFY] ❌ Fatal error:', error.message);
  }
}


// ============ EXPIRE MINERS (CRON) ============
async function expireMiners() {
  try {
    await ActiveMiner.updateMany(
      { status: 'active', expiresAt: { $lte: new Date() } },
      { $set: { status: 'expired' } }
    );
  } catch (e) {}
}

// ============ SEED TASKS ============
async function seedTasks() {
  const count = await Task.countDocuments();
  if (count > 0) return;
  await Task.insertMany([
    { taskId: 't_news', title: 'Join News Channel', icon: '📢', reward: 0.02, link: `https://t.me/${(process.env.NEWS_CHANNEL || '').replace('@','')}`, type: 'channel' },
    { taskId: 't_payouts', title: 'Join Payouts Channel', icon: '💸', reward: 0.02, link: `https://t.me/${(process.env.PROOF_CHANNEL || '').replace('@','')}`, type: 'channel' },
    { taskId: 't_miner', title: 'Buy your first miner', icon: '⛏️', reward: 0.05, type: 'action', requireMiner: true, requireDeposit: true }
  ]);
  console.log('✅ Tasks seeded');
}

// ============ ADMIN AUTH ============
function adminAuth(req, res, next) {
  const key = req.headers['x-admin-key'] || req.query.key;
  if (key !== process.env.ADMIN_KEY) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// ============ ADMIN ENDPOINTS ============
app.get('/api/admin/stats', adminAuth, async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const activeMiners = await ActiveMiner.countDocuments({ status: 'active' });
    const pendingW = await Withdrawal.countDocuments({ status: 'pending' });
    const pendingD = await Deposit.countDocuments({ status: 'pending' });
    const verifiedD = await Deposit.countDocuments({ status: 'verified' });
    const bannedUsers = await User.countDocuments({ banned: true });
    const totalDepAgg = await Deposit.aggregate([{ $match: { status: 'verified' } }, { $group: { _id: null, total: { $sum: '$amount' } } }]);
    const totalWdAgg = await Withdrawal.aggregate([{ $match: { status: 'approved' } }, { $group: { _id: null, total: { $sum: '$netAmount' } } }]);
    const totalEarnAgg = await User.aggregate([{ $group: { _id: null, total: { $sum: '$totalEarned' } } }]);
    res.json({
      success: true,
      totalUsers, activeMiners, pendingW, pendingD, verifiedD, bannedUsers,
      totalDeposited: totalDepAgg[0]?.total || 0,
      totalWithdrawn: totalWdAgg[0]?.total || 0,
      totalEarned: totalEarnAgg[0]?.total || 0
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/admin/players', adminAuth, async (req, res) => {
  try {
    const search = req.query.search || '';
    const page = parseInt(req.query.page) || 1;
    const limit = 50;
    const skip = (page - 1) * limit;
    const sort = req.query.sort || 'date';

    const query = search ? {
      $or: [
        { telegramId: { $regex: search, $options: 'i' } },
        { firstName: { $regex: search, $options: 'i' } },
        { username: { $regex: search, $options: 'i' } }
      ]
    } : {};

    let sortObj = { createdAt: -1 };
    if (sort === 'deposit') sortObj = { totalDeposited: -1 };
    if (sort === 'balance') sortObj = { balance: -1 };
    if (sort === 'refs') sortObj = { 'referrals': -1 };

    const total = await User.countDocuments(query);
    const players = await User.find(query).sort(sortObj).skip(skip).limit(limit);

    const playersWithMiners = await Promise.all(players.map(async p => {
      const activeCount = await ActiveMiner.countDocuments({ telegramId: p.telegramId, status: 'active' });
      return { ...p.toObject(), activeMiners: activeCount };
    }));

    res.json({ success: true, players: playersWithMiners, total, page, totalPages: Math.ceil(total / limit) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/ban-player', adminAuth, async (req, res) => {
  try {
    const { telegramId, banned } = req.body;
    await User.findOneAndUpdate({ telegramId: telegramId.toString() }, { banned });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/edit-balance', adminAuth, async (req, res) => {
  try {
    const { telegramId, amount } = req.body;
    const user = await User.findOneAndUpdate({ telegramId: telegramId.toString() }, { $inc: { balance: amount } }, { new: true });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ success: true, newBalance: user.balance });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/give-miner', adminAuth, async (req, res) => {
  try {
    const { telegramId, minerId } = req.body;
    const minerConfig = MINERS_CONFIG.find(m => m.id === minerId);
    if (!minerConfig) return res.status(400).json({ error: 'Invalid miner' });

    const miner = new ActiveMiner({
      telegramId: telegramId.toString(),
      minerId: minerConfig.id,
      minerName: minerConfig.name,
      level: minerConfig.level,
      price: 0,
      daily: minerConfig.daily,
      totalReturn: minerConfig.total,
      expiresAt: new Date(Date.now() + minerConfig.days * 24 * 60 * 60 * 1000)
    });
    await miner.save();
    res.json({ success: true, miner });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/give-miner-all', adminAuth, async (req, res) => {
  try {
    const { minerId } = req.body;
    const minerConfig = MINERS_CONFIG.find(m => m.id === minerId);
    if (!minerConfig) return res.status(400).json({ error: 'Invalid miner' });

    const users = await User.find({});
    let count = 0;
    for (const user of users) {
      const miner = new ActiveMiner({
        telegramId: user.telegramId,
        minerId: minerConfig.id,
        minerName: minerConfig.name,
        level: minerConfig.level,
        price: 0,
        daily: minerConfig.daily,
        totalReturn: minerConfig.total,
        expiresAt: new Date(Date.now() + minerConfig.days * 24 * 60 * 60 * 1000)
      });
      await miner.save();
      count++;
    }
    res.json({ success: true, count });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/bypass', adminAuth, async (req, res) => {
  try {
    const { telegramId } = req.body;
    await User.findOneAndUpdate({ telegramId: telegramId.toString() }, { withdrawBypass: true });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/admin/withdrawals', adminAuth, async (req, res) => {
  try {
    const status = req.query.status || 'pending';
    const withdrawals = await Withdrawal.find({ status }).sort({ createdAt: -1 }).limit(50);
    res.json({ success: true, withdrawals });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/approve-withdrawal', adminAuth, async (req, res) => {
  try {
    const { withdrawalId, txHash } = req.body;
    const w = await Withdrawal.findByIdAndUpdate(withdrawalId, { status: 'approved', txHash }, { new: true });
    if (!w) return res.status(404).json({ error: 'Not found' });

    await User.findOneAndUpdate({ telegramId: w.telegramId }, { $inc: { totalWithdrawn: w.amount } });

    // Post proof
    const proofChannel = process.env.PROOF_CHANNEL;
    if (proofChannel) {
      try {
        const masked = '****' + w.telegramId.slice(-4);
        await bot.sendMessage(proofChannel,
          `✅ *Withdrawal Paid*\n👤 User: ${masked}\n💰 ${w.netAmount.toFixed(4)} TON\n🔗 [View TX](https://tonviewer.com/transaction/${txHash})`,
          { parse_mode: 'Markdown' }
        );
      } catch (e) {}
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/reject-withdrawal', adminAuth, async (req, res) => {
  try {
    const { withdrawalId } = req.body;
    const w = await Withdrawal.findById(withdrawalId);
    if (!w) return res.status(404).json({ error: 'Not found' });
    await User.findOneAndUpdate({ telegramId: w.telegramId }, { $inc: { balance: w.amount } });
    await Withdrawal.findByIdAndDelete(withdrawalId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/broadcast', adminAuth, async (req, res) => {
  try {
    const { message, imageUrl, buttonText, buttonUrl } = req.body;
    if (!message) return res.status(400).json({ error: 'EMPTY_MESSAGE' });
    const users = await User.find({ banned: { $ne: true } });
    let sent = 0, failed = 0;

    const replyMarkup = (buttonText && buttonUrl) ? {
      inline_keyboard: [[{ text: buttonText, url: buttonUrl }]]
    } : undefined;

    for (const u of users) {
      try {
        if (imageUrl) {
          await bot.sendPhoto(u.telegramId, imageUrl, {
            caption: message,
            parse_mode: 'HTML',
            reply_markup: replyMarkup
          });
        } else {
          await bot.sendMessage(u.telegramId, message, {
            parse_mode: 'HTML',
            reply_markup: replyMarkup
          });
        }
        sent++;
      } catch (e) { failed++; }
      // Telegram rate limit: 30 msgs/sec — sleep 50ms = max 20/sec
      await new Promise(r => setTimeout(r, 50));
    }
    console.log(`[BROADCAST] sent=${sent} failed=${failed}`);
    res.json({ success: true, sent, failed });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Manual deposit credit (admin manually verifies & activates)
app.post('/api/admin/manual-deposit', adminAuth, async (req, res) => {
  try {
    const { telegramId, amount, minerId } = req.body;
    const tgId = telegramId.toString();
    const amt = parseFloat(amount);
    if (!tgId || !amt || amt <= 0) return res.status(400).json({ error: 'INVALID_INPUT' });

    const user = await User.findOne({ telegramId: tgId });
    if (!user) return res.status(404).json({ error: 'USER_NOT_FOUND' });

    const deposit = new Deposit({
      telegramId: tgId,
      amount: amt,
      minerId: minerId || 'manual',
      memo: 'ADMIN_MANUAL_' + Date.now(),
      status: 'verified',
      matchMethod: 'ADMIN_MANUAL',
      txHash: 'MANUAL_' + Date.now(),
      verifiedAt: new Date()
    });
    await deposit.save();

    await User.findOneAndUpdate(
      { telegramId: tgId },
      { $inc: { totalDeposited: amt, totalInvested: amt } }
    );

    // Activate miner if minerId provided
    if (minerId && minerId !== 'manual') {
      const minerConfig = MINERS_CONFIG.find(m => m.id === minerId);
      if (minerConfig) {
        const activateAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
        await ActiveMiner.create({
          telegramId: tgId,
          minerId: minerConfig.id,
          minerName: minerConfig.name,
          level: minerConfig.level,
          price: minerConfig.price,
          daily: minerConfig.daily,
          totalReturn: minerConfig.total,
          startsEarningAt: activateAt,
          expiresAt: new Date(activateAt.getTime() + minerConfig.days * 24 * 60 * 60 * 1000)
        });
      }
    }

    try {
      await bot.sendMessage(tgId, `✅ Deposit of ${amt} TON credited by admin!`, { parse_mode: 'Markdown' });
    } catch(e) {}

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Deposits list
app.get('/api/admin/deposits', adminAuth, async (req, res) => {
  try {
    const status = req.query.status;
    const query = status ? { status } : {};
    const deposits = await Deposit.find(query).sort({ createdAt: -1 }).limit(200);
    res.json({ success: true, deposits });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Referrals audit log
app.get('/api/admin/referrals', adminAuth, async (req, res) => {
  try {
    const status = req.query.status;
    const query = status ? { status } : {};
    const refs = await ReferralLog.find(query).sort({ createdAt: -1 }).limit(200);
    res.json({ success: true, referrals: refs });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Tasks management
app.get('/api/admin/tasks', adminAuth, async (req, res) => {
  try {
    const tasks = await Task.find({}).sort({ createdAt: 1 });
    res.json({ success: true, tasks });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/tasks/create', adminAuth, async (req, res) => {
  try {
    const { title, icon, reward, link, type, requireMiner, requireDeposit } = req.body;
    const taskId = 't_' + Math.random().toString(36).substring(2, 8);
    await Task.create({
      taskId,
      title,
      icon: icon || '📋',
      reward: parseFloat(reward) || 0.01,
      link: link || '',
      type: type || 'channel',
      requireMiner: !!requireMiner,
      requireDeposit: !!requireDeposit,
      enabled: true
    });
    res.json({ success: true, taskId });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/tasks/toggle', adminAuth, async (req, res) => {
  try {
    const { taskId } = req.body;
    const task = await Task.findOne({ taskId });
    if (!task) return res.status(404).json({ error: 'NOT_FOUND' });
    task.enabled = !task.enabled;
    await task.save();
    res.json({ success: true, enabled: task.enabled });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/tasks/delete', adminAuth, async (req, res) => {
  try {
    const { taskId } = req.body;
    await Task.deleteOne({ taskId });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Withdraw approve/reject
app.post('/api/admin/approve-withdrawal', adminAuth, async (req, res) => {
  try {
    const { withdrawalId, txHash } = req.body;
    const wd = await Withdrawal.findById(withdrawalId);
    if (!wd) return res.status(404).json({ error: 'NOT_FOUND' });
    if (wd.status !== 'pending') return res.status(400).json({ error: 'ALREADY_PROCESSED' });
    wd.status = 'approved';
    wd.txHash = txHash || 'manual';
    await wd.save();
    await User.findOneAndUpdate(
      { telegramId: wd.telegramId },
      { $inc: { totalWithdrawn: wd.netAmount } }
    );
    try {
      await bot.sendMessage(wd.telegramId, `✅ Withdrawal approved!\n\n💰 Amount: ${wd.netAmount} TON\n📍 To: \`${wd.walletAddress}\`\n🔗 TX: ${txHash || 'manual'}`, { parse_mode: 'Markdown' });
    } catch(e) {}
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/reject-withdrawal', adminAuth, async (req, res) => {
  try {
    const { withdrawalId } = req.body;
    const wd = await Withdrawal.findById(withdrawalId);
    if (!wd) return res.status(404).json({ error: 'NOT_FOUND' });
    if (wd.status !== 'pending') return res.status(400).json({ error: 'ALREADY_PROCESSED' });
    wd.status = 'rejected';
    await wd.save();
    // Refund balance
    await User.findOneAndUpdate(
      { telegramId: wd.telegramId },
      { $inc: { balance: wd.amount } }
    );
    try {
      await bot.sendMessage(wd.telegramId, `❌ Withdrawal rejected. ${wd.amount} TON refunded to your balance.`);
    } catch(e) {}
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/reseed-tasks', adminAuth, async (req, res) => {
  try {
    await Task.deleteMany({});
    await Task.insertMany([
      { taskId: 't_news', title: 'Join News Channel', icon: '📢', reward: 0.02, link: `https://t.me/${(process.env.NEWS_CHANNEL || '').replace('@','')}`, type: 'channel' },
      { taskId: 't_payouts', title: 'Join Payouts Channel', icon: '💸', reward: 0.02, link: `https://t.me/${(process.env.PROOF_CHANNEL || '').replace('@','')}`, type: 'channel' },
      { taskId: 't_miner', title: 'Buy your first miner', icon: '⛏️', reward: 0.05, type: 'action', requireMiner: true, requireDeposit: true }
    ]);
    res.json({ success: true, message: 'Tasks reseeded' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ HEALTH ============
app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// ============ CRON INTERVALS ============
setInterval(verifyDeposits, 2 * 60 * 1000);
setInterval(expireMiners, 10 * 60 * 1000);
setInterval(() => fetch(process.env.WEBHOOK_URL + '/health').catch(() => {}), 5 * 60 * 1000);

// ============ START ============
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🐱⛏️ Cats Mining running on port ${PORT}`);
  seedTasks();
  verifyDeposits();
});