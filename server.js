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

// Referral milestone rewards (free miner at X valid referrals)
const MILESTONES = [
  { id: 'ref_15',  refs: 15,  minerId: 'miner_1', name: 'Whiskers' },
  { id: 'ref_30',  refs: 30,  minerId: 'miner_2', name: 'Mittens'  },
  { id: 'ref_50',  refs: 50,  minerId: 'miner_3', name: 'Shadow'   },
  { id: 'ref_100', refs: 100, minerId: 'miner_5', name: 'Tiger'    },
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
  validReferrals: { type: [String], default: [] },                    // Refs that joined payout channel
  referredBy: { type: String, default: null },
  referralLocked: { type: Boolean, default: false },
  referralState: { type: String, enum: ['none', 'pending', 'valid'], default: 'none' },
  refCommission: { type: Number, default: 0 },
  completedTasks: { type: [String], default: [] },
  walletAddress: { type: String, default: null },
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
  status: { type: String, enum: ['pending', 'valid', 'verified', 'rejected', 'paid'], default: 'pending' },
  reason: String,
  commission: { type: Number, default: 0 },
  depositAmount: Number,
  createdAt: { type: Date, default: Date.now },
  verifiedAt: Date
});
referralLogSchema.index({ referrerId: 1, referredId: 1 }, { unique: true });
const ReferralLog = mongoose.model('CatsMiningReferralLog', referralLogSchema);

// Admin audit log
const adminLogSchema = new mongoose.Schema({
  action: { type: String, required: true, index: true },
  targetId: { type: String, index: true },
  details: mongoose.Schema.Types.Mixed,
  ipAddress: String,
  createdAt: { type: Date, default: Date.now, index: true, expires: 86400 * 90 } // 90 days
});
const AdminLog = mongoose.model('CatsMiningAdminLog', adminLogSchema);

// Milestone claims (free miner rewards from referrals)
const milestoneClaimSchema = new mongoose.Schema({
  telegramId: { type: String, index: true },
  milestoneId: String,  // e.g. "ref_15"
  minerId: String,
  claimedAt: { type: Date, default: Date.now }
});
milestoneClaimSchema.index({ telegramId: 1, milestoneId: 1 }, { unique: true });
const MilestoneClaim = mongoose.model('CatsMiningMilestoneClaim', milestoneClaimSchema);

// Helper to log admin actions
async function logAdmin(action, targetId, details, req) {
  try {
    const ip = req?.headers?.['x-forwarded-for']?.split(',')[0] || req?.ip || '';
    await AdminLog.create({ action, targetId: targetId?.toString(), details, ipAddress: ip });
  } catch(e) { console.error('[ADMIN-LOG]', e.message); }
}

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
  description: String,
  icon: String,
  reward: Number,
  rewardMin: Number,   // optional random range
  rewardMax: Number,
  rewardLabel: String, // Display label like "0.005-0.1"
  link: String,
  type: { type: String, default: 'channel' },
  category: { type: String, default: 'partner' },  // 'daily' | 'partner'
  isVerifiedChannel: { type: Boolean, default: false },  // ONLY true for News/Payout where bot is admin
  isDaily: { type: Boolean, default: false },           // Repeatable every 24h
  requireMiner: { type: Boolean, default: false },
  requireDeposit: { type: Boolean, default: false },
  requireDepositToday: { type: Boolean, default: false }, // Must have deposit/purchase TODAY
  requireReferrals: { type: Number, default: 0 },
  requireWallet: { type: Boolean, default: false },
  position: { type: Number, default: 99 },
  enabled: { type: Boolean, default: true }
});
const Task = mongoose.model('CatsMiningTask', taskSchema);

// Daily task completions (resets every 24h)
const dailyClaimSchema = new mongoose.Schema({
  telegramId: { type: String, index: true },
  taskId: String,
  claimedAt: { type: Date, default: Date.now, index: true }
});
const DailyClaim = mongoose.model('CatsMiningDailyClaim', dailyClaimSchema);

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
    const tgId = (req.query.telegramId || '').toString();
    const tasks = await Task.find({ enabled: true }).sort({ position: 1 });

    // For daily tasks, check user's cooldown status
    if (tgId) {
      const dailyTaskIds = tasks.filter(t => t.isDaily).map(t => t.taskId);
      if (dailyTaskIds.length > 0) {
        const recentClaims = await DailyClaim.find({
          telegramId: tgId,
          taskId: { $in: dailyTaskIds },
          claimedAt: { $gte: new Date(Date.now() - 24*60*60*1000) }
        });
        const claimMap = {};
        for (const c of recentClaims) {
          claimMap[c.taskId] = new Date(c.claimedAt.getTime() + 24*60*60*1000);
        }
        const tasksWithStatus = tasks.map(t => {
          const obj = t.toObject();
          if (t.isDaily && claimMap[t.taskId]) {
            obj.onCooldown = true;
            obj.nextClaim = claimMap[t.taskId];
          } else {
            obj.onCooldown = false;
          }
          return obj;
        });
        return res.json({ success: true, tasks: tasksWithStatus });
      }
    }

    res.json({ success: true, tasks });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Save user wallet address (from TON Connect)
app.post('/api/user/wallet', async (req, res) => {
  try {
    const { telegramId, walletAddress } = req.body;
    if (!telegramId || !walletAddress) return res.status(400).json({ error: 'INVALID' });
    const tgId = telegramId.toString();

    // Check if wallet already used by another account (anti-fraud)
    const existing = await User.findOne({ walletAddress, telegramId: { $ne: tgId } });
    if (existing) {
      console.log(`[SECURITY] ⚠️ Wallet ${walletAddress.slice(0,12)} already used by ${existing.telegramId}, blocked for ${tgId}`);
      return res.status(400).json({ error: 'WALLET_ALREADY_USED', message: 'This wallet is linked to another account' });
    }

    await User.findOneAndUpdate({ telegramId: tgId }, { walletAddress });
    console.log(`[WALLET] ${tgId} connected wallet ${walletAddress.slice(0,12)}...`);
    res.json({ success: true });
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

    const task = await Task.findOne({ taskId, enabled: true });
    if (!task) return res.status(404).json({ error: 'TASK_NOT_FOUND' });

    // ─── DAILY TASK CHECK (repeatable) ───
    if (task.isDaily) {
      // Check if claimed in last 24h
      const last = await DailyClaim.findOne({
        telegramId: tgId,
        taskId,
        claimedAt: { $gte: new Date(Date.now() - 24*60*60*1000) }
      });
      if (last) {
        const nextClaim = new Date(last.claimedAt.getTime() + 24*60*60*1000);
        return res.status(400).json({
          error: 'COOLDOWN',
          nextClaim,
          message: 'Come back in 24 hours'
        });
      }
    } else {
      // Non-daily: check completedTasks
      if (user.completedTasks.includes(taskId)) {
        return res.status(400).json({ error: 'ALREADY_COMPLETED' });
      }
    }

    // ─── SERVER-SIDE TASK VALIDATION ───

    // Task: Buy Miner TODAY — must have purchased a paid miner today
    if (task.requireDepositToday) {
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      const todayMiner = await ActiveMiner.findOne({
        telegramId: tgId,
        price: { $gt: 0 },
        createdAt: { $gte: startOfToday }
      });
      if (!todayMiner) {
        return res.status(400).json({
          error: 'NO_MINER_TODAY',
          message: 'You must purchase a new miner today to claim this reward'
        });
      }
      console.log(`[TASK] ✅ ${tgId} purchased ${todayMiner.minerName} today`);
    }

    // Task: Buy First Miner — verify user owns at least 1 PAID miner (not free Kitty)
    if (taskId === 't_miner' || (task.requireMiner && !task.requireDepositToday)) {
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

    // Task: Wallet — verify user has connected wallet
    if (task.requireWallet || taskId === 't_wallet') {
      if (!user.walletAddress) {
        return res.status(400).json({ error: 'NO_WALLET', message: 'Please connect your TON wallet first' });
      }
    }

    // Task: Channel join — ONLY verify if isVerifiedChannel flag is set
    // (News & Payout channels where bot is admin)
    if (task.isVerifiedChannel && task.link && task.link.includes('t.me/')) {
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

          // If this is PAYOUT_CHANNEL → activate the referral (PENDING → VALID)
          const payoutChan = (process.env.PROOF_CHANNEL || '').replace('@', '').toLowerCase();
          const taskChan = match[1].replace('+', '').toLowerCase();
          if (payoutChan && taskChan === payoutChan && user.referredBy) {
            const refLog = await ReferralLog.findOne({
              referrerId: user.referredBy,
              referredId: tgId
            });
            if (refLog && refLog.status === 'pending') {
              refLog.status = 'valid';
              refLog.reason = 'joined_payout_channel';
              refLog.verifiedAt = new Date();
              await refLog.save();
              console.log(`[REFERRAL] ✅ ${tgId} VALIDATED for referrer ${user.referredBy}`);

              // Check milestones for referrer
              checkMilestones(user.referredBy).catch(()=>{});
            }
          }
        } catch(e) {
          console.log(`[TASK] ⚠️ Cannot verify ${channel}: ${e.message}`);
          return res.status(400).json({ error: 'VERIFY_FAILED', message: 'Cannot verify membership — please make sure you joined' });
        }
      }
    }
    // Partner tasks: NO membership verification, user just clicks link and claims

    // ATOMIC reward delivery
    // Pick reward: if range defined, pick random; else use fixed
    let finalReward = task.reward;
    if (task.rewardMin && task.rewardMax && task.rewardMax > task.rewardMin) {
      finalReward = +(task.rewardMin + Math.random() * (task.rewardMax - task.rewardMin)).toFixed(4);
    }

    if (task.isDaily) {
      // Daily task: record claim, no completedTasks push (can repeat)
      await DailyClaim.create({ telegramId: tgId, taskId });
      const updated = await User.findOneAndUpdate(
        { telegramId: tgId },
        { $inc: { balance: finalReward, totalEarned: finalReward } },
        { new: true }
      );
      console.log(`[TASK-DAILY] ✅ ${tgId} claimed ${taskId} +${finalReward} TON`);

      // ─── REFERRAL ACTIVATION ───
      // If user has a referrer AND this is daily reward + first claim → validate referral
      if (updated && updated.referredBy && taskId === 't_daily_reward') {
        const refLog = await ReferralLog.findOne({
          referrerId: updated.referredBy,
          referredId: tgId,
          status: 'pending'
        });
        if (refLog) {
          refLog.status = 'valid';
          refLog.reason = 'claimed_daily_reward';
          refLog.verifiedAt = new Date();
          await refLog.save();
          console.log(`[REFERRAL] ✅ ${tgId} validated for ${updated.referredBy} (claimed daily)`);

          // Check milestones for referrer
          try { await checkMilestones(updated.referredBy); } catch(e) {}

          // Notify referrer
          try {
            await bot.sendMessage(updated.referredBy,
              `🎉 *New Valid Referral!*\n\n@${updated.username||updated.firstName||'user'} just claimed their first daily reward.\n\n✅ Counts toward your milestones!`,
              { parse_mode: 'Markdown' }
            );
          } catch(e) {}
        }
      }

      return res.json({ success: true, reward: finalReward, newBalance: updated.balance, daily: true });
    }

    // One-time task
    const updated = await User.findOneAndUpdate(
      { telegramId: tgId, completedTasks: { $ne: taskId } },
      { $push: { completedTasks: taskId }, $inc: { balance: finalReward, totalEarned: finalReward } },
      { new: true }
    );
    if (!updated) return res.status(400).json({ error: 'ALREADY_COMPLETED' });

    console.log(`[TASK] ✅ ${tgId} completed ${taskId} +${finalReward} TON`);
    res.json({ success: true, reward: finalReward, newBalance: updated.balance });
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
// ============ MILESTONE REWARDS ============
async function checkMilestones(telegramId) {
  try {
    const tgId = telegramId.toString();
    const user = await User.findOne({ telegramId: tgId });
    if (!user) return;

    // Count VALID referrals: status is valid OR paid in ReferralLog
    const validCount = await ReferralLog.countDocuments({
      referrerId: tgId,
      status: { $in: ['valid', 'paid'] }
    });

    console.log(`[MILESTONE] ${tgId} has ${validCount} VALID refs`);

    // Check each milestone
    for (const ms of MILESTONES) {
      if (validCount < ms.refs) continue;

      // Already claimed?
      const claimed = await MilestoneClaim.findOne({ telegramId: tgId, milestoneId: ms.id });
      if (claimed) continue;

      // Award the miner
      const minerConfig = MINERS_CONFIG.find(m => m.id === ms.minerId);
      if (!minerConfig) continue;

      try {
        await MilestoneClaim.create({ telegramId: tgId, milestoneId: ms.id, minerId: ms.minerId });

        const activateAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
        await ActiveMiner.create({
          telegramId: tgId,
          minerId: minerConfig.id,
          minerName: minerConfig.name,
          level: minerConfig.level,
          price: 0,
          daily: minerConfig.daily,
          totalReturn: minerConfig.total,
          startsEarningAt: activateAt,
          expiresAt: new Date(activateAt.getTime() + minerConfig.days * 24 * 60 * 60 * 1000)
        });

        console.log(`[MILESTONE] ✅ ${tgId} earned ${ms.name} for ${ms.refs} VALID refs!`);

        try {
          await bot.sendMessage(tgId,
            `🎁 *Milestone Reward!*\n\nYou reached *${ms.refs} valid referrals*!\n\n🎉 Free *${ms.name}* (Lv.${minerConfig.level}) activated!\n💰 Daily: ${minerConfig.daily} TON\n⏳ Starts earning in 24h`,
            { parse_mode: 'Markdown' }
          );
        } catch(e) {}
      } catch(e) {
        console.log(`[MILESTONE] ⏭️ ${tgId} already claimed ${ms.id}`);
      }
    }
  } catch(error) {
    console.error('[MILESTONE]', error.message);
  }
}

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

            // Check milestones for referrer
            await checkMilestones(user.referredBy);
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
  const newsCh = (process.env.NEWS_CHANNEL || '').replace('@','');
  const payoutCh = (process.env.PROOF_CHANNEL || '').replace('@','');
  await Task.insertMany([
    // ─── DAILY TASKS (repeatable every 24h) ───
    { taskId: 't_daily_reward', title: 'Daily Reward', description: 'Claim your daily bonus', icon: '🎁', rewardMin: 0.005, rewardMax: 0.006, rewardLabel: '0.005-0.1', type: 'daily', category: 'daily', isDaily: true, position: 1 },
    { taskId: 't_buy_today', title: 'Buy Miner Today', description: 'Purchase a new miner today', icon: '⛏️', rewardMin: 0.005, rewardMax: 0.006, rewardLabel: '0.005-0.1', type: 'daily', category: 'daily', isDaily: true, requireDepositToday: true, position: 2 },

    // ─── CHANNELS (one-time, verified) ───
    { taskId: 't_news', title: 'Join News Channel', description: 'Stay updated with latest news', icon: '📢', reward: 0.001, link: `https://t.me/${newsCh}`, type: 'channel', category: 'partner', isVerifiedChannel: true, position: 1 },
    { taskId: 't_payouts', title: 'Join Payout Channel', description: 'See proof of payments', icon: '💸', reward: 0.001, link: `https://t.me/${payoutCh}`, type: 'channel', category: 'partner', isVerifiedChannel: true, position: 2 }
  ]);
  console.log('✅ Tasks seeded: 2 daily + 2 channels');
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
    const validRefs = await ReferralLog.countDocuments({ status: { $in: ['valid', 'paid'] } });
    const pendingRefs = await ReferralLog.countDocuments({ status: 'pending' });
    const totalDepAgg = await Deposit.aggregate([{ $match: { status: 'verified' } }, { $group: { _id: null, total: { $sum: '$amount' } } }]);
    const totalWdAgg = await Withdrawal.aggregate([{ $match: { status: 'approved' } }, { $group: { _id: null, total: { $sum: '$netAmount' } } }]);
    const totalEarnAgg = await User.aggregate([{ $group: { _id: null, total: { $sum: '$totalEarned' } } }]);
    res.json({
      success: true,
      totalUsers, activeMiners, pendingW, pendingD, verifiedD, bannedUsers,
      validRefs, pendingRefs,
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
    await logAdmin(banned ? 'BAN_PLAYER' : 'UNBAN_PLAYER', telegramId, { banned }, req);
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
    await logAdmin('EDIT_BALANCE', telegramId, { amount, newBalance: user.balance }, req);
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
    await logAdmin('GIVE_MINER', telegramId, { minerId, minerName: minerConfig.name }, req);
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
    await logAdmin('GIVE_MINER_ALL', 'ALL', { minerId, count }, req);
    res.json({ success: true, count });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/bypass', adminAuth, async (req, res) => {
  try {
    const { telegramId, bypass } = req.body;
    await User.findOneAndUpdate({ telegramId: telegramId.toString() }, { withdrawBypass: bypass !== false });
    await logAdmin('BYPASS_WITHDRAW', telegramId, { bypass: bypass !== false }, req);
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

app.post('/api/admin/approve-withdrawal-old-removed', adminAuth, async (req, res) => {
  res.status(410).json({ error: 'use /api/admin/approve-withdrawal' });
});
app.post('/api/admin/reject-withdrawal-old-removed', adminAuth, async (req, res) => {
  res.status(410).json({ error: 'use /api/admin/reject-withdrawal' });
});

app.post('/api/admin/reject-withdrawal-old-removed-v2', adminAuth, async (req, res) => {
  res.status(410).json({ error: 'use /api/admin/reject-withdrawal' });
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

    await logAdmin('MANUAL_DEPOSIT', tgId, { amount: amt, minerId }, req);
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
    const { title, description, icon, reward, link, type, category, requireMiner, requireDeposit, isVerifiedChannel } = req.body;
    const taskId = 't_' + Math.random().toString(36).substring(2, 8);
    await Task.create({
      taskId,
      title,
      description: description || '',
      icon: icon || '📋',
      reward: parseFloat(reward) || 0.01,
      link: link || '',
      type: type || 'channel',
      category: category || 'partner',
      isVerifiedChannel: !!isVerifiedChannel,  // ONLY admins can set this true (for News/Payout)
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
    await logAdmin('APPROVE_WITHDRAWAL', wd.telegramId, { withdrawalId, amount: wd.amount, netAmount: wd.netAmount, txHash }, req);
    try {
      await bot.sendMessage(wd.telegramId, `✅ Withdrawal approved!\n\n💰 Amount: ${wd.netAmount} TON\n📍 To: \`${wd.walletAddress}\`\n🔗 TX: ${txHash || 'manual'}`, { parse_mode: 'Markdown' });
    } catch(e) {}
    // Post proof
    const proofChannel = process.env.PROOF_CHANNEL;
    if (proofChannel && txHash && txHash !== 'manual') {
      try {
        const masked = '****' + wd.telegramId.slice(-4);
        await bot.sendMessage(proofChannel,
          `✅ *Withdrawal Paid*\n👤 User: ${masked}\n💰 ${wd.netAmount.toFixed(4)} TON\n🔗 [View TX](https://tonviewer.com/transaction/${txHash})`,
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
    await logAdmin('REJECT_WITHDRAWAL', wd.telegramId, { withdrawalId, amount: wd.amount }, req);
    try {
      await bot.sendMessage(wd.telegramId, `❌ Withdrawal rejected. ${wd.amount} TON refunded to your balance.`);
    } catch(e) {}
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Player details with miners
app.get('/api/admin/player/:id', adminAuth, async (req, res) => {
  try {
    const tgId = req.params.id;
    const user = await User.findOne({ telegramId: tgId });
    if (!user) return res.status(404).json({ error: 'NOT_FOUND' });

    const miners = await ActiveMiner.find({ telegramId: tgId }).sort({ createdAt: 1 });
    const deposits = await Deposit.find({ telegramId: tgId }).sort({ createdAt: -1 });
    const withdrawals = await Withdrawal.find({ telegramId: tgId }).sort({ createdAt: -1 });

    // Referrals breakdown from ReferralLog
    const allRefs = await ReferralLog.find({ referrerId: tgId }).sort({ createdAt: -1 });
    const validRefs = allRefs.filter(r => ['valid', 'paid'].includes(r.status)).length;
    const pendingRefs = allRefs.filter(r => r.status === 'pending').length;

    // Get referred user names
    const refList = await Promise.all(allRefs.slice(0, 50).map(async r => {
      const u = await User.findOne({ telegramId: r.referredId });
      return {
        referredId: r.referredId,
        firstName: u?.firstName || '-',
        username: u?.username || '',
        status: r.status,
        commission: r.commission || 0,
        createdAt: r.createdAt
      };
    }));

    // Claimed milestones
    const claimed = await MilestoneClaim.find({ telegramId: tgId });

    res.json({
      success: true,
      user: user.toObject(),
      miners,
      deposits,
      withdrawals,
      validRefs,
      pendingRefs,
      referralList: refList,
      claimedMilestones: claimed.map(c => c.milestoneId)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Admin audit logs
app.get('/api/admin/logs', adminAuth, async (req, res) => {
  try {
    const action = req.query.action;
    const search = req.query.search;
    const query = {};
    if (action) query.action = action;
    if (search) query.targetId = { $regex: search, $options: 'i' };
    const logs = await AdminLog.find(query).sort({ createdAt: -1 }).limit(200);
    res.json({ success: true, logs });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Referral leaderboard (top referrers by VALID refs)
app.get('/api/admin/leaderboard', adminAuth, async (req, res) => {
  try {
    // Aggregate ReferralLog: count valid/paid per referrer
    const agg = await ReferralLog.aggregate([
      { $match: { status: { $in: ['valid', 'paid'] } } },
      { $group: { _id: '$referrerId', validCount: { $sum: 1 }, totalCommission: { $sum: '$commission' }, totalDeposits: { $sum: '$depositAmount' } } },
      { $sort: { validCount: -1 } },
      { $limit: 50 }
    ]);

    const board = await Promise.all(agg.map(async row => {
      const u = await User.findOne({ telegramId: row._id });
      if (!u || u.banned) return null;
      const totalRefs = (u.referrals || []).length;
      return {
        telegramId: u.telegramId,
        firstName: u.firstName,
        username: u.username,
        totalRefs,
        validRefs: row.validCount,
        pendingRefs: totalRefs - row.validCount,
        totalDeposits: row.totalDeposits || 0,
        commission: row.totalCommission || u.refCommission || 0
      };
    }));

    res.json({ success: true, leaderboard: board.filter(Boolean) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Security: detect suspicious users
app.get('/api/admin/security', adminAuth, async (req, res) => {
  try {
    const suspicious = [];

    // Same IP — users sharing IP with their referrer
    const usersWithRef = await User.find({ referredBy: { $ne: null }, ipAddress: { $ne: '' } }).limit(500);
    const ipMap = {};
    for (const u of usersWithRef) {
      if (!u.ipAddress) continue;
      if (!ipMap[u.ipAddress]) ipMap[u.ipAddress] = [];
      ipMap[u.ipAddress].push(u.telegramId);
    }
    for (const ip in ipMap) {
      if (ipMap[ip].length > 1) {
        suspicious.push({
          type: 'SAME_IP',
          ipAddress: ip,
          users: ipMap[ip],
          severity: ipMap[ip].length > 3 ? 'high' : 'medium'
        });
      }
    }

    // Same wallet address — multiple users withdrawing to same wallet
    const wdAgg = await Withdrawal.aggregate([
      { $group: { _id: '$walletAddress', users: { $addToSet: '$telegramId' }, count: { $sum: 1 } } },
      { $match: { 'users.1': { $exists: true } } },
      { $limit: 50 }
    ]);
    for (const w of wdAgg) {
      suspicious.push({
        type: 'SAME_WALLET',
        wallet: w._id,
        users: w.users,
        count: w.count,
        severity: 'high'
      });
    }

    // Excessive referrals without deposits
    const refFarmers = await User.find({ 'referrals.10': { $exists: true } }).limit(100);
    for (const u of refFarmers) {
      let validRefs = 0;
      for (const refId of u.referrals || []) {
        const dep = await Deposit.findOne({ telegramId: refId.toString(), status: 'verified', amount: { $gte: 0.5 } });
        if (dep) validRefs++;
      }
      const ratio = validRefs / u.referrals.length;
      if (u.referrals.length >= 20 && ratio < 0.05) {
        suspicious.push({
          type: 'REF_FARMING',
          userId: u.telegramId,
          firstName: u.firstName,
          totalRefs: u.referrals.length,
          validRefs,
          ratio: ratio.toFixed(2),
          severity: 'medium'
        });
      }
    }

    res.json({ success: true, suspicious });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Milestone settings (read/write)
app.get('/api/admin/milestones', adminAuth, async (req, res) => {
  res.json({ success: true, milestones: MILESTONES });
});

app.post('/api/admin/reseed-tasks', adminAuth, async (req, res) => {
  try {
    await Task.deleteMany({});
    const newsCh = (process.env.NEWS_CHANNEL || '').replace('@','');
    const payoutCh = (process.env.PROOF_CHANNEL || '').replace('@','');
    await Task.insertMany([
      // ── DAILY (repeatable) ──
      {
        taskId: 't_daily_reward', title: 'Daily Reward', description: 'Claim your daily bonus',
        icon: '🎁', rewardMin: 0.005, rewardMax: 0.006, rewardLabel: '0.005-0.1',
        type: 'daily', category: 'daily', isDaily: true, position: 1
      },
      {
        taskId: 't_buy_today', title: 'Buy Miner Today', description: 'Purchase a new miner today',
        icon: '⛏️', rewardMin: 0.005, rewardMax: 0.006, rewardLabel: '0.005-0.1',
        type: 'daily', category: 'daily', isDaily: true, requireDepositToday: true, position: 2
      },
      // ── CHANNELS (one-time, verified) ──
      {
        taskId: 't_news', title: 'Join News Channel', description: 'Stay updated with latest news',
        icon: '📢', reward: 0.001, link: `https://t.me/${newsCh}`,
        type: 'channel', category: 'partner', isVerifiedChannel: true, position: 1
      },
      {
        taskId: 't_payouts', title: 'Join Payout Channel', description: 'See proof of payments',
        icon: '💸', reward: 0.001, link: `https://t.me/${payoutCh}`,
        type: 'channel', category: 'partner', isVerifiedChannel: true, position: 2
      }
    ]);
    res.json({ success: true, message: 'Tasks reseeded: 2 daily + 2 channels' });
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