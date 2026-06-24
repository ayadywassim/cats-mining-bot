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

app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// Trust proxy (Render uses reverse proxy)
app.set('trust proxy', 1);

// ============ RATE LIMITING ============
const limiter = rateLimit({ windowMs: 60000, max: 100 });
app.use('/api/', limiter);

// Strict limit on write endpoints (prevent spam/abuse)
const strictLimiter = rateLimit({
  windowMs: 60000,   // 1 minute
  max: 20,            // 20 requests/min
  message: { error: 'RATE_LIMIT', message: 'Too many requests, slow down' }
});

// Very strict on critical actions
const criticalLimiter = rateLimit({
  windowMs: 60000,   // 1 minute
  max: 5,             // 5 attempts/min
  message: { error: 'RATE_LIMIT', message: 'Too many attempts, please wait' }
});

// In-memory idempotency cache (prevents double-click submissions)
const idempCache = new Map();
const IDEMP_TTL = 10000; // 10 seconds
function idempKey(userId, action) { return `${userId}:${action}`; }
function checkIdemp(userId, action) {
  const key = idempKey(userId, action);
  const now = Date.now();
  // Clean expired
  for (const [k, v] of idempCache.entries()) {
    if (now - v > IDEMP_TTL) idempCache.delete(k);
  }
  if (idempCache.has(key)) return false; // duplicate
  idempCache.set(key, now);
  return true;
}

// XSS sanitizer
function sanitize(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/[<>]/g, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+=/gi, '')
    .slice(0, 500);
}

// Strict number validator
function safeNum(val, min = 0, max = 1000000) {
  const n = parseFloat(val);
  if (isNaN(n) || !isFinite(n)) return null;
  if (n < min || n > max) return null;
  return n;
}

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
  status: { type: String, enum: ['valid', 'paid', 'rejected'], default: 'valid' },
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
  lastCollected: Date,
  fromDepositId: { type: String, default: null, sparse: true }  // Link to deposit (anti-dup)
});
// Partial unique index: prevents double-claim of FREE Kitty miner
activeMinerSchema.index(
  { telegramId: 1, minerId: 1 },
  {
    unique: true,
    partialFilterExpression: { minerId: 'miner_0' }
  }
);
// Unique sparse index on fromDepositId: prevents duplicate activation from same deposit
activeMinerSchema.index(
  { fromDepositId: 1 },
  {
    unique: true,
    partialFilterExpression: { fromDepositId: { $type: 'string' } }
  }
);
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
  createdAt: { type: Date, default: Date.now }
});
// TTL: auto-delete PENDING deposits after 2 hours (verified deposits stay forever)
depositSchema.index(
  { createdAt: 1 },
  {
    expireAfterSeconds: 2 * 60 * 60,    // 2 hours
    partialFilterExpression: { status: 'pending' }
  }
);
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

// Partner request applications
const partnerRequestSchema = new mongoose.Schema({
  telegramId: { type: String, index: true },
  username: String,
  firstName: String,
  channelLink: String,
  description: String,
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },
  reviewedAt: Date,
  reviewedBy: String,
  rejectReason: String,
  createdAt: { type: Date, default: Date.now }
});
const PartnerRequest = mongoose.model('CatsMiningPartnerRequest', partnerRequestSchema);

// Discount events
const discountEventSchema = new mongoose.Schema({
  name: { type: String, default: 'Mining Boost Event' },
  description: String,
  discountPercent: { type: Number, default: 10 },
  startsAt: { type: Date, default: Date.now },
  endsAt: { type: Date, required: true },
  enabled: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});
const DiscountEvent = mongoose.model('CatsMiningDiscountEvent', discountEventSchema);

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
  const firstName = msg.from.first_name || 'Miner';

  const welcomeMessage = `
👋 *Hey ${firstName}!*

Welcome to *Cats Mining* — the cutest way to earn real TON on the TON blockchain. 🐱⛏️

━━━━━━━━━━━━━━━━━

✨ *What awaits you:*
🎁 Free Kitty miner on signup
💎 9 unique miners — earn up to 250 TON
🔥 *-10% SALE* on all miners (limited time!)
👥 Earn 10% commission from your referrals
🏆 Free miners as referral milestones

━━━━━━━━━━━━━━━━━

Tap below to start mining now 👇
`.trim();

  await bot.sendMessage(chatId, welcomeMessage, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '🚀 Start Mining', web_app: { url: miniAppUrl } }]
      ]
    }
    }
  );
});

// ============ API: REGISTER ============
app.post('/api/register', strictLimiter, async (req, res) => {
  try {
    const { telegramId, firstName, username, photoUrl, refBy } = req.body;
    if (!telegramId) return res.status(400).json({ error: 'INVALID' });
    const tgId = telegramId.toString();
    const ipAddress = req.headers['x-forwarded-for']?.split(',')[0] || req.ip || '';

    // Sanitize inputs (XSS protection)
    const safeFirstName = sanitize(firstName || '');
    const safeUsername = sanitize(username || '');
    const safePhotoUrl = (photoUrl && /^https?:\/\//.test(photoUrl)) ? photoUrl : '';

    // ATOMIC UPSERT: insert if not exists, else just update name/username
    const isNew = !(await User.findOne({ telegramId: tgId }).select('_id').lean());

    let user;
    if (isNew) {
      // Try to create — handle race condition via duplicate key
      try {
        user = await User.create({
          telegramId: tgId,
          firstName: safeFirstName,
          username: safeUsername,
          photoUrl: safePhotoUrl,
          ipAddress
        });
        console.log(`[USER] New: ${tgId} (${safeFirstName})`);
      } catch(err) {
        // E11000 = duplicate key (race condition) → another request already created
        if (err.code === 11000) {
          user = await User.findOne({ telegramId: tgId });
        } else {
          throw err;
        }
      }
    } else {
      // Update existing user info atomically
      user = await User.findOneAndUpdate(
        { telegramId: tgId },
        {
          $set: {
            ...(safeFirstName && { firstName: safeFirstName }),
            ...(safeUsername && { username: safeUsername }),
            ...(safePhotoUrl && { photoUrl: safePhotoUrl })
          }
        },
        { new: true }
      );
    }

    if (!user) return res.status(500).json({ error: 'FAILED_TO_CREATE' });

    // ─── SECURE REFERRAL VALIDATION ───
    // Only set if not already locked and not self-referral
    if (refBy && refBy.toString() !== tgId && !user.referralLocked && !user.referredBy) {
      const refByStr = refBy.toString();
      const referrer = await User.findOne({ telegramId: refByStr });

      if (!referrer) {
        console.log(`[REFERRAL] ❌ REJECT: referrer ${refByStr} not found`);
      } else if (referrer.banned) {
        console.log(`[REFERRAL] ❌ REJECT: referrer ${refByStr} is banned`);
      } else if (referrer.referrals.includes(tgId)) {
        console.log(`[REFERRAL] ❌ REJECT: duplicate referral`);
      } else {
        // IP fraud detection (same IP = suspicious)
        let suspicious = false;
        if (ipAddress && referrer.ipAddress === ipAddress) {
          suspicious = true;
          console.log(`[REFERRAL] ⚠️ Same IP detected: ${ipAddress}`);
        }

        // ATOMIC: Lock referral (only if still not locked) — prevents race
        const locked = await User.findOneAndUpdate(
          { telegramId: tgId, referralLocked: { $ne: true }, referredBy: null },
          { $set: { referredBy: refByStr, referralLocked: true } },
          { new: true }
        );

        if (locked) {
          // Atomic add to referrer's referrals array (no duplicates due to $addToSet)
          await User.findOneAndUpdate(
            { telegramId: refByStr },
            { $addToSet: { referrals: tgId } }
          );

          // Create audit log (unique index prevents duplicates)
          await ReferralLog.create({
            referrerId: refByStr,
            referredId: tgId,
            status: 'valid',
            reason: suspicious ? 'same_ip_flagged_auto_valid' : 'auto_valid_on_signup',
            verifiedAt: new Date()
          }).catch(e => {
            // Duplicate log = referral was already created (race condition)
            if (e.code !== 11000) console.log('[REFERRAL] Log error:', e.message);
          });

          // Check milestones immediately (ref is valid now)
          try { await checkMilestones(refByStr); } catch(e) {}

          user = locked;  // Use updated user with referredBy
          console.log(`[REFERRAL] ✅ Linked + VALIDATED: ${tgId} → invited by ${refByStr}${suspicious?' [FLAGGED]':''}`);
        }
      }
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
app.post('/api/miners/buy', strictLimiter, async (req, res) => {
  try {
    const { telegramId, minerId } = req.body;
    const user = await User.findOne({ telegramId: telegramId.toString() });
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.banned) return res.status(403).json({ error: 'ACCOUNT_BANNED' });

    const minerConfig = MINERS_CONFIG.find(m => m.id === minerId);
    if (!minerConfig) return res.status(400).json({ error: 'Invalid miner' });

    // Free miner (Kitty) — ATOMIC with idempotency
    if (minerConfig.price === 0) {
      const tgId = telegramId.toString();

      // Idempotency check
      if (!checkIdemp(tgId, 'free-miner:' + minerId)) {
        return res.status(429).json({ error: 'DUPLICATE_REQUEST', message: 'Please wait' });
      }

      // Atomic check: createIndex (telegramId + minerId) prevents duplicates
      const now = new Date();
      const startsEarning = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      try {
        const miner = await ActiveMiner.create({
          telegramId: tgId,
          minerId: minerConfig.id,
          minerName: minerConfig.name,
          level: minerConfig.level,
          price: 0,
          daily: minerConfig.daily,
          totalReturn: minerConfig.total,
          startsEarningAt: startsEarning,
          expiresAt: new Date(startsEarning.getTime() + minerConfig.days * 24 * 60 * 60 * 1000)
        });
        console.log(`[MINER] ${tgId} claimed free Kitty`);
        return res.json({ success: true, miner, type: 'free' });
      } catch (err) {
        // Check after error: was it a duplicate?
        const existing = await ActiveMiner.findOne({ telegramId: tgId, minerId: 'miner_0' });
        if (existing) {
          return res.status(400).json({ error: 'ALREADY_CLAIMED', message: 'Free miner already claimed' });
        }
        throw err;
      }
    }

    // Paid miner — apply discount if active event
    const tgId = telegramId.toString();
    const discount = await getActiveDiscount();
    const finalPrice = applyDiscount(minerConfig.price, discount);

    // ─── AUTO-CLEANUP: Delete old pending deposits for this user+miner ───
    // Prevents the user from accumulating dozens of pendings
    // (only deletes truly old ones - over 30 minutes - to avoid breaking active payments)
    const oldPendings = await Deposit.deleteMany({
      telegramId: tgId,
      status: 'pending',
      createdAt: { $lt: new Date(Date.now() - 30 * 60 * 1000) }  // older than 30 min
    });
    if (oldPendings.deletedCount > 0) {
      console.log(`[CLEANUP] Removed ${oldPendings.deletedCount} stale pending deposits for ${tgId}`);
    }

    const depositId = Math.random().toString(36).substring(2, 8).toUpperCase();
    const memo = `CM${tgId}_${depositId}`;

    const deposit = new Deposit({
      telegramId: tgId,
      amount: finalPrice,
      uniqueAmount: finalPrice,
      minerId: minerConfig.id,
      memo: memo
    });
    await deposit.save();

    console.log(`[PAYMENT] Created deposit: user=${tgId} miner=${minerConfig.id} amount=${finalPrice} (orig=${minerConfig.price}, discount=${discount}%) memo=${memo}`);

    res.json({
      success: true,
      type: 'deposit_required',
      walletAddress: process.env.BOT_WALLET,
      amount: finalPrice,
      originalPrice: minerConfig.price,
      discount,
      uniqueAmount: finalPrice,
      memo: memo,
      depositId: deposit._id.toString()
    });
  } catch (error) {
    console.error('[PAYMENT] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ============ API: BUY MINER WITH BOT BALANCE ============
app.post('/api/miners/buy-balance', criticalLimiter, async (req, res) => {
  try {
    const { telegramId, minerId } = req.body;
    if (!telegramId || !minerId) return res.status(400).json({ error: 'INVALID' });
    const tgId = telegramId.toString();

    // Idempotency
    if (!checkIdemp(tgId, 'buy-balance:' + minerId)) {
      return res.status(429).json({ error: 'DUPLICATE_REQUEST' });
    }

    const minerConfig = MINERS_CONFIG.find(m => m.id === minerId);
    if (!minerConfig) return res.status(404).json({ error: 'MINER_NOT_FOUND' });
    if (minerConfig.price === 0) return res.status(400).json({ error: 'FREE_MINER_USE_BUY' });

    // Apply event discount
    const discount = await getActiveDiscount();
    const finalPrice = applyDiscount(minerConfig.price, discount);

    // Atomic: deduct balance only if sufficient
    const updated = await User.findOneAndUpdate(
      { telegramId: tgId, balance: { $gte: finalPrice }, banned: false },
      { $inc: { balance: -finalPrice, totalInvested: finalPrice } },
      { new: true }
    );
    if (!updated) return res.status(400).json({ error: 'INSUFFICIENT_BALANCE' });

    // Record as verified deposit FIRST (counts for withdrawal eligibility + miner link)
    const memo = 'CM' + tgId + '_BAL_' + Date.now();
    const deposit = await Deposit.create({
      telegramId: tgId,
      minerId: minerConfig.id,
      amount: finalPrice,
      memo,
      status: 'verified',
      txHash: 'BALANCE_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      verifiedAt: new Date()
    });

    // Activate miner with 24h delay (LINK to deposit to prevent duplicates)
    const activateAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    let miner;
    try {
      miner = await ActiveMiner.create({
        telegramId: tgId,
        minerId: minerConfig.id,
        minerName: minerConfig.name,
        level: minerConfig.level,
        price: finalPrice,
        daily: minerConfig.daily,
        totalReturn: minerConfig.total,
        startsEarningAt: activateAt,
        expiresAt: new Date(activateAt.getTime() + minerConfig.days * 24 * 60 * 60 * 1000),
        fromDepositId: deposit._id.toString()
      });
    } catch(err) {
      if (err.code === 11000) {
        // Duplicate fromDepositId — race condition, refund
        await User.findOneAndUpdate(
          { telegramId: tgId },
          { $inc: { balance: finalPrice, totalInvested: -finalPrice } }
        );
        await Deposit.deleteOne({ _id: deposit._id });
        return res.status(429).json({ error: 'DUPLICATE_REQUEST', message: 'Already processing' });
      }
      throw err;
    }

    console.log(`[MINER] ${tgId} bought ${minerConfig.name} with balance (${finalPrice} TON, discount=${discount}%)`);

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
app.post('/api/miners/collect', strictLimiter, async (req, res) => {
  try {
    const { telegramId } = req.body;
    if (!telegramId) return res.status(400).json({ error: 'INVALID' });
    const tgId = telegramId.toString();

    // Idempotency: block rapid double-clicks (within 10 sec)
    if (!checkIdemp(tgId, 'collect')) {
      return res.status(429).json({ error: 'DUPLICATE_REQUEST', message: 'Please wait before collecting again' });
    }

    const user = await User.findOne({ telegramId: tgId });
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.banned) return res.status(403).json({ error: 'ACCOUNT_BANNED' });

    const miners = await ActiveMiner.find({ telegramId: tgId, status: 'active' });
    let totalCollect = 0;
    const now = new Date();

    for (const miner of miners) {
      // Check if expired
      if (now >= miner.expiresAt) {
        await ActiveMiner.findByIdAndUpdate(miner._id, { status: 'expired' });
        continue;
      }

      // Check if still in 24h warmup
      if (miner.startsEarningAt && now < miner.startsEarningAt) {
        continue;
      }

      // Calculate earnings since last collect (or since startsEarningAt)
      const earnStart = miner.startsEarningAt || miner.startedAt;
      const prevLastCollect = miner.lastCollected || earnStart;
      const effectiveStart = prevLastCollect < earnStart ? earnStart : prevLastCollect;
      const hoursSince = (now - effectiveStart) / (1000 * 60 * 60);
      const earned = (miner.daily / 24) * hoursSince;

      if (earned <= 0.0001) continue;

      // ──── BULLETPROOF ATOMIC UPDATE ────
      // Use exact match on lastCollected (even if null) → only ONE request can succeed
      // Even with multiple concurrent calls, MongoDB ensures only ONE update goes through
      const filter = {
        _id: miner._id,
        status: 'active'
      };
      // Match the exact lastCollected value we read (or null if first-ever collect)
      if (miner.lastCollected) {
        filter.lastCollected = miner.lastCollected;
      } else {
        filter.lastCollected = { $in: [null, undefined] };
      }

      const updateResult = await ActiveMiner.findOneAndUpdate(
        filter,
        {
          $set: { lastCollected: now },
          $inc: { totalCollected: earned }
        },
        { new: true }
      );

      // updateResult is null = another concurrent request already collected this miner
      // We silently skip (no double-pay)
      if (updateResult) {
        totalCollect += earned;
      } else {
        console.log(`[COLLECT] ⚠️ Race detected for miner ${miner._id}, skipping`);
      }
    }

    // Atomic balance update only for what actually collected
    if (totalCollect > 0) {
      await User.findOneAndUpdate(
        { telegramId: tgId },
        { $inc: { balance: totalCollect, totalEarned: totalCollect } }
      );
      console.log(`[COLLECT] ✅ ${tgId} collected ${totalCollect.toFixed(6)} TON`);
    }

    const updatedUser = await User.findOne({ telegramId: tgId });
    res.json({ success: true, collected: totalCollect, newBalance: updatedUser.balance });
  } catch (error) {
    console.error('[COLLECT] Error:', error.message);
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
app.post('/api/withdrawals/request', criticalLimiter, async (req, res) => {
  try {
    const { telegramId, amount, walletAddress } = req.body;
    if (!telegramId) return res.status(400).json({ error: 'INVALID' });
    const tgId = telegramId.toString();
    const amt = safeNum(amount, 0.01, 1000);

    // Strict validation
    if (!amt) return res.status(400).json({ error: 'INVALID_AMOUNT' });
    const wallet = sanitize(walletAddress);
    if (!wallet || wallet.length < 20 || wallet.length > 100) return res.status(400).json({ error: 'INVALID_WALLET' });

    // Idempotency: prevent rapid double-submit
    if (!checkIdemp(tgId, 'withdraw')) {
      return res.status(429).json({ error: 'DUPLICATE_REQUEST', message: 'Please wait before submitting again' });
    }

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
      telegramId: tgId, amount: amt, fee, netAmount, walletAddress: wallet, status: 'pending'
    });
    await withdrawal.save();

    console.log(`[WITHDRAW] User ${tgId} requested ${amt} TON to ${wallet.slice(0,10)}...`);

    // Notify admin
    const adminId = process.env.ADMIN_IDS;
    if (adminId) {
      try {
        await bot.sendMessage(adminId,
          `💸 *Withdrawal Request*\n👤 ${user.firstName} (@${user.username||'?'})\n🆔 \`${tgId}\`\n💰 ${amt} TON\n📤 Net: ${netAmount.toFixed(4)} TON\n📬 \`${wallet}\``,
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

// ============ API: PARTNER REQUESTS ============
app.post('/api/partner/apply', criticalLimiter, async (req, res) => {
  try {
    const { telegramId, channelLink, description } = req.body;
    if (!telegramId || !channelLink) return res.status(400).json({ error: 'INVALID' });
    const tgId = telegramId.toString();

    // Idempotency
    if (!checkIdemp(tgId, 'partner-apply')) {
      return res.status(429).json({ error: 'DUPLICATE_REQUEST' });
    }

    // Sanitize
    const link = sanitize(channelLink);
    const desc = sanitize(description || '');

    if (!link.match(/^https?:\/\/(t\.me|telegram\.me)\/[a-zA-Z0-9_+]+$/)) {
      return res.status(400).json({ error: 'INVALID_LINK', message: 'Please provide a valid t.me link' });
    }

    const user = await User.findOne({ telegramId: tgId });
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.banned) return res.status(403).json({ error: 'ACCOUNT_BANNED' });

    // Check if already has pending or recent rejected request (limit 1 per week)
    const existing = await PartnerRequest.findOne({
      telegramId: tgId,
      $or: [
        { status: 'pending' },
        { status: 'rejected', createdAt: { $gte: new Date(Date.now() - 7*24*60*60*1000) } }
      ]
    });
    if (existing) {
      const msg = existing.status === 'pending' ? 'You already have a pending request' : 'You can re-apply 7 days after rejection';
      return res.status(400).json({ error: 'EXISTS', message: msg });
    }

    // Check duplicate channel
    const dupChannel = await PartnerRequest.findOne({ channelLink: link, status: { $in: ['pending', 'approved'] } });
    if (dupChannel) return res.status(400).json({ error: 'CHANNEL_TAKEN', message: 'This channel was already submitted' });

    const request = new PartnerRequest({
      telegramId: tgId,
      username: user.username,
      firstName: user.firstName,
      channelLink: link,
      description: desc,
      status: 'pending'
    });
    await request.save();

    // Notify admin
    const adminId = process.env.ADMIN_IDS;
    if (adminId) {
      try {
        await bot.sendMessage(adminId,
          `🤝 *New Partner Request*\n👤 ${user.firstName} (@${user.username||'?'})\n🆔 \`${tgId}\`\n📢 ${link}`,
          { parse_mode: 'Markdown' }
        );
      } catch(e) {}
    }

    console.log(`[PARTNER] ${tgId} applied for partnership with ${link}`);
    res.json({ success: true, message: 'Partnership request submitted!' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get user's partner request status
app.get('/api/partner/status/:telegramId', async (req, res) => {
  try {
    const tgId = req.params.telegramId.toString();
    const request = await PartnerRequest.findOne({ telegramId: tgId }).sort({ createdAt: -1 });
    res.json({ success: true, request });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ API: DISCOUNT EVENTS ============
app.get('/api/event/current', async (req, res) => {
  try {
    const now = new Date();
    const event = await DiscountEvent.findOne({
      enabled: true,
      startsAt: { $lte: now },
      endsAt: { $gt: now }
    }).sort({ createdAt: -1 });
    res.json({ success: true, event });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Helper: get active discount % (0 if none)
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
app.post('/api/user/wallet', strictLimiter, async (req, res) => {
  try {
    const { telegramId, walletAddress } = req.body;
    if (!telegramId || !walletAddress) return res.status(400).json({ error: 'INVALID' });
    const tgId = telegramId.toString();

    // Sanitize + validate wallet format
    const wallet = String(walletAddress).trim();
    if (wallet.length > 80 || wallet.length < 40) {
      return res.status(400).json({ error: 'INVALID_FORMAT', message: 'Invalid wallet address' });
    }
    // Strip any unsafe chars
    const safeWallet = wallet.replace(/[<>"';\s]/g, '');
    // TON wallet must be alphanumeric + : - _ only
    if (!/^[a-zA-Z0-9:_-]+$/.test(safeWallet)) {
      return res.status(400).json({ error: 'INVALID_FORMAT' });
    }

    // ATOMIC check + update with conditional filter
    // Only update if wallet is NOT used by another user
    const existing = await User.findOne({ walletAddress: safeWallet, telegramId: { $ne: tgId } });
    if (existing) {
      console.log(`[SECURITY] ⚠️ Wallet ${safeWallet.slice(0,12)} already used by ${existing.telegramId}, blocked for ${tgId}`);
      return res.status(400).json({ error: 'WALLET_ALREADY_USED', message: 'This wallet is linked to another account' });
    }

    // Update with race protection: only set if no one else grabbed it in the meantime
    const updated = await User.findOneAndUpdate(
      { telegramId: tgId },
      { walletAddress: safeWallet },
      { new: true }
    );

    // Double-check: was the wallet stolen by another user between check and update?
    const dupCheck = await User.countDocuments({ walletAddress: safeWallet });
    if (dupCheck > 1) {
      // Rollback our wallet — another user got there first
      await User.findOneAndUpdate({ telegramId: tgId }, { walletAddress: null });
      return res.status(400).json({ error: 'WALLET_ALREADY_USED', message: 'Race condition - wallet taken' });
    }

    console.log(`[WALLET] ${tgId} connected wallet ${safeWallet.slice(0,12)}...`);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/tasks/complete', strictLimiter, async (req, res) => {
  try {
    const { telegramId, taskId } = req.body;
    if (!telegramId || !taskId) return res.status(400).json({ error: 'INVALID' });
    const tgId = telegramId.toString();
    const safeTaskId = sanitize(taskId);

    // Idempotency: prevent rapid double-click
    if (!checkIdemp(tgId, 'task:' + safeTaskId)) {
      return res.status(429).json({ error: 'DUPLICATE_REQUEST' });
    }

    const user = await User.findOne({ telegramId: tgId });
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.banned) return res.status(403).json({ error: 'ACCOUNT_BANNED' });

    const task = await Task.findOne({ taskId: safeTaskId, enabled: true });
    if (!task) return res.status(404).json({ error: 'TASK_NOT_FOUND' });

    // ─── DAILY TASK CHECK (repeatable) ───
    if (task.isDaily) {
      // Check if claimed in last 24h
      const last = await DailyClaim.findOne({
        telegramId: tgId,
        safeTaskId,
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
      if (user.completedTasks.includes(safeTaskId)) {
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
    if (safeTaskId === 't_miner' || (task.requireMiner && !task.requireDepositToday)) {
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
        console.log(`[TASK] ❌ ${tgId} no PAID miner for ${safeTaskId}`);
        return res.status(400).json({ error: 'NO_MINER', message: 'You must buy a paid miner first (Kitty does not count)' });
      }
      console.log(`[TASK] ✅ ${tgId} has paid miner verification`);
    }

    // Task: Deposit — verify at least one verified deposit
    if (safeTaskId.includes('deposit') || (task.requireDeposit)) {
      const hasDeposit = await Deposit.findOne({ telegramId: tgId, status: 'verified' });
      if (!hasDeposit) {
        return res.status(400).json({ error: 'NO_DEPOSIT', message: 'You must make a deposit first' });
      }
    }

    // Task: Referral — verify actual paid referrals
    if (safeTaskId.includes('invite') || safeTaskId.includes('ref') || (task.requireReferrals)) {
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
    if (task.requireWallet || safeTaskId === 't_wallet') {
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
      await DailyClaim.create({ telegramId: tgId, taskId: safeTaskId });
      const updated = await User.findOneAndUpdate(
        { telegramId: tgId },
        { $inc: { balance: finalReward, totalEarned: finalReward } },
        { new: true }
      );
      console.log(`[TASK-DAILY] ✅ ${tgId} claimed ${taskId} +${finalReward} TON`);

      // ─── REFERRAL ACTIVATION (ROBUST) ───
      // If user has a referrer AND this is daily reward → validate referral (or create if missing)
      if (updated && updated.referredBy && safeTaskId === 't_daily_reward') {
        try {
          // Upsert: find OR create + update if status is still 'pending'
          let refLog = await ReferralLog.findOne({
            referrerId: updated.referredBy,
            referredId: tgId
          });

          if (!refLog) {
            // No log exists (old user pre-ReferralLog) → create it directly as valid
            refLog = await ReferralLog.create({
              referrerId: updated.referredBy,
              referredId: tgId,
              status: 'valid',
              reason: 'claimed_daily_reward',
              verifiedAt: new Date()
            }).catch(async (e) => {
              if (e.code === 11000) {
                // Race condition - log was created between findOne and create
                return await ReferralLog.findOne({ referrerId: updated.referredBy, referredId: tgId });
              }
              throw e;
            });
            console.log(`[REFERRAL] ✅ Created+validated log for ${tgId} → ${updated.referredBy}`);
          } else if (refLog.status === 'pending') {
            refLog.status = 'valid';
            refLog.reason = 'claimed_daily_reward';
            refLog.verifiedAt = new Date();
            await refLog.save();
            console.log(`[REFERRAL] ✅ ${tgId} validated for ${updated.referredBy} (claimed daily)`);
          } else {
            console.log(`[REFERRAL] ℹ️ ${tgId} already ${refLog.status} for ${updated.referredBy}`);
          }

          // Check milestones for referrer (only if newly validated)
          if (refLog && (refLog.status === 'valid' || refLog.status === 'paid')) {
            try { await checkMilestones(updated.referredBy); } catch(e) {}
          }

          // Notify referrer (only on first validation)
          if (refLog && refLog.reason === 'claimed_daily_reward') {
            try {
              await bot.sendMessage(updated.referredBy,
                `🎉 *New Valid Referral!*\n\n@${updated.username||updated.firstName||'user'} just claimed their first daily reward.\n\n✅ Counts toward your milestones!`,
                { parse_mode: 'Markdown' }
              );
            } catch(e) {}
          }
        } catch(refErr) {
          console.error('[REFERRAL] Validation error:', refErr.message);
        }
      }

      return res.json({ success: true, reward: finalReward, newBalance: updated.balance, daily: true });
    }

    // One-time task — ATOMIC + idempotent (cannot be claimed twice even if click rapid)
    const updated = await User.findOneAndUpdate(
      { telegramId: tgId, completedTasks: { $ne: safeTaskId } },
      { $push: { completedTasks: safeTaskId }, $inc: { balance: finalReward, totalEarned: finalReward } },
      { new: true }
    );
    if (!updated) return res.status(400).json({ error: 'ALREADY_COMPLETED' });

    console.log(`[TASK] ✅ ${tgId} completed ${safeTaskId} +${finalReward} TON`);
    res.json({ success: true, reward: finalReward, newBalance: updated.balance });
  } catch (error) {
    console.error('[TASK] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ============ API: DAILY REWARD ============
app.post('/api/daily-claim', strictLimiter, async (req, res) => {
  try {
    const { telegramId } = req.body;
    if (!telegramId) return res.status(400).json({ error: 'INVALID' });
    const tgId = telegramId.toString();

    // Idempotency
    if (!checkIdemp(tgId, 'daily-claim')) {
      return res.status(429).json({ error: 'DUPLICATE_REQUEST', message: 'Please wait' });
    }

    const user = await User.findOne({ telegramId: tgId });
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.banned) return res.status(403).json({ error: 'ACCOUNT_BANNED' });

    const now = new Date();
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // Check cooldown BEFORE atomic update
    if (user.lastDaily && user.lastDaily > dayAgo) {
      const next = new Date(user.lastDaily.getTime() + 24 * 60 * 60 * 1000);
      return res.status(400).json({ error: 'TOO_EARLY', nextClaim: next });
    }

    const reward = +(0.005 + Math.random() * 0.01).toFixed(4);

    // ATOMIC: only update if lastDaily is still the same (or null) → prevents race
    const updateFilter = { telegramId: tgId };
    if (user.lastDaily) {
      updateFilter.lastDaily = user.lastDaily;
    } else {
      updateFilter.lastDaily = { $in: [null, undefined] };
    }

    const updated = await User.findOneAndUpdate(
      updateFilter,
      {
        $set: { lastDaily: now },
        $inc: { balance: reward, totalEarned: reward }
      },
      { new: true }
    );

    if (!updated) {
      // Another request beat us → already claimed
      return res.status(400).json({ error: 'ALREADY_CLAIMED', message: 'Daily already claimed' });
    }

    console.log(`[DAILY] ✅ ${tgId} claimed ${reward} TON`);

    // ─── REFERRAL ACTIVATION (ROBUST) ───
    if (updated.referredBy) {
      try {
        let refLog = await ReferralLog.findOne({
          referrerId: updated.referredBy,
          referredId: tgId
        });

        if (!refLog) {
          refLog = await ReferralLog.create({
            referrerId: updated.referredBy,
            referredId: tgId,
            status: 'valid',
            reason: 'claimed_daily_reward',
            verifiedAt: new Date()
          }).catch(async (e) => {
            if (e.code === 11000) {
              return await ReferralLog.findOne({ referrerId: updated.referredBy, referredId: tgId });
            }
            throw e;
          });
          console.log(`[REFERRAL] ✅ Created+validated log for ${tgId} → ${updated.referredBy}`);
        } else if (refLog.status === 'pending') {
          refLog.status = 'valid';
          refLog.reason = 'claimed_daily_reward';
          refLog.verifiedAt = new Date();
          await refLog.save();
          console.log(`[REFERRAL] ✅ ${tgId} validated for ${updated.referredBy} (claimed daily)`);
        }

        if (refLog && (refLog.status === 'valid' || refLog.status === 'paid')) {
          try { await checkMilestones(updated.referredBy); } catch(e) {}
        }

        if (refLog && refLog.reason === 'claimed_daily_reward') {
          try {
            await bot.sendMessage(updated.referredBy,
              `🎉 *New Valid Referral!*\n\n@${updated.username||updated.firstName||'user'} just claimed their first daily reward.\n\n✅ Counts toward your milestones!`,
              { parse_mode: 'Markdown' }
            );
          } catch(e) {}
        }
      } catch(refErr) {
        console.error('[REFERRAL] Validation error:', refErr.message);
      }
    }

    res.json({ success: true, reward, newBalance: updated.balance });
  } catch (error) {
    console.error('[DAILY]', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ API: REFERRALS ============
app.get('/api/referrals/:telegramId', async (req, res) => {
  try {
    const tgId = req.params.telegramId;
    const user = await User.findOne({ telegramId: tgId });
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Get all referral logs for this user
    const logs = await ReferralLog.find({ referrerId: tgId });
    const logMap = {};
    for (const log of logs) {
      logMap[log.referredId] = log;
    }

    const refs = [];
    let validCount = 0;
    let pendingCount = 0;

    for (const refId of user.referrals) {
      const refUser = await User.findOne({ telegramId: refId });
      if (!refUser) continue;

      const log = logMap[refId];
      const status = log ? log.status : 'pending';
      const isValid = status === 'valid' || status === 'paid';

      if (isValid) validCount++;
      else pendingCount++;

      refs.push({
        telegramId: refUser.telegramId,
        firstName: refUser.firstName,
        totalDeposited: refUser.totalDeposited,
        isPaid: refUser.totalDeposited >= 0.5,
        status,           // 'pending' | 'valid' | 'paid'
        isValid,
        joinedAt: refUser.createdAt,
        validatedAt: log?.verifiedAt
      });
    }

    // Sort: valid first, then by date (newest first)
    refs.sort((a, b) => {
      if (a.isValid !== b.isValid) return b.isValid - a.isValid;
      return new Date(b.joinedAt) - new Date(a.joinedAt);
    });

    res.json({
      success: true,
      referrals: refs,
      total: refs.length,
      validCount,
      pendingCount,
      commission: user.refCommission
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ DEPOSIT VERIFICATION (CRON) ============
// Get current discount % (0 if no event)
async function getActiveDiscount() {
  const now = new Date();
  const event = await DiscountEvent.findOne({
    enabled: true,
    startsAt: { $lte: now },
    endsAt: { $gt: now }
  });
  return event ? event.discountPercent : 0;
}

// Apply discount to price
function applyDiscount(price, discountPercent) {
  if (!discountPercent || discountPercent <= 0) return price;
  return +(price * (1 - discountPercent / 100)).toFixed(6);
}

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

      // ─── VERIFY THE DEPOSIT (ATOMIC LOCK) ───
      try {
        // ATOMIC: only verify if still pending (locks the deposit)
        // If another process already verified, this returns null → skip
        const locked = await Deposit.findOneAndUpdate(
          { _id: matchedDep._id, status: 'pending' },
          {
            $set: {
              status: 'verified',
              txHash,
              matchMethod,
              verifiedAt: new Date()
            }
          },
          { new: true }
        );

        if (!locked) {
          console.log(`[VERIFY] ⚠️ Deposit ${matchedDep._id} already verified by another process, skipping`);
          continue;
        }

        // Also check if this txHash was already used (extra safety)
        const txDupCheck = await Deposit.countDocuments({ txHash, status: 'verified' });
        if (txDupCheck > 1) {
          // This txHash is already linked to another verified deposit → rollback
          await Deposit.findOneAndUpdate(
            { _id: locked._id },
            { $set: { status: 'pending', txHash: null, verifiedAt: null } }
          );
          console.log(`[VERIFY] ⚠️ txHash ${txHash} already used elsewhere, rolled back`);
          continue;
        }

        matchedDep.status = 'verified';
        matchedDep.txHash = txHash;
        matchedDep.matchMethod = matchMethod;
        matchedDep.verifiedAt = new Date();

        console.log(`[VERIFY] ✅ Deposit verified: user=${matchedDep.telegramId} method=${matchMethod}`);

        // Activate miner
        const minerConfig = MINERS_CONFIG.find(m => m.id === matchedDep.minerId);
        if (!minerConfig) {
          console.log(`[MINER] ❌ Miner config not found: ${matchedDep.minerId}`);
          continue;
        }

        // ATOMIC: ensure no duplicate miner from same deposit
        // Use deposit _id as link to prevent duplicate activation
        const existingMinerFromDeposit = await ActiveMiner.findOne({
          telegramId: matchedDep.telegramId,
          fromDepositId: matchedDep._id.toString()
        });
        if (existingMinerFromDeposit) {
          console.log(`[MINER] ⚠️ Already activated from deposit ${matchedDep._id}, skipping`);
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
          expiresAt: new Date(activateAt.getTime() + minerConfig.days * 24 * 60 * 60 * 1000),
          fromDepositId: matchedDep._id.toString()  // Link miner to deposit
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

// Upload broadcast image - saves to disk + returns public URL
const fs = require('fs');
app.post('/api/admin/upload-image', adminAuth, async (req, res) => {
  try {
    const { image, ext } = req.body;
    if (!image) return res.status(400).json({ error: 'NO_IMAGE' });

    // Validate ext
    const safeExt = ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes((ext || '').toLowerCase())
      ? ext.toLowerCase()
      : 'png';

    // Decode base64
    const buffer = Buffer.from(image, 'base64');
    if (buffer.length > 5 * 1024 * 1024) {
      return res.status(400).json({ error: 'TOO_LARGE' });
    }

    // Create uploads directory if doesn't exist
    const uploadsDir = path.join(__dirname, 'public', 'images', 'uploads');
    try {
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }
    } catch(e) { /* may fail on read-only fs */ }

    // Generate unique filename
    const filename = `bc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${safeExt}`;
    const filepath = path.join(uploadsDir, filename);

    try {
      fs.writeFileSync(filepath, buffer);
    } catch(writeErr) {
      // If can't write to disk (Render filesystem ephemeral), fall back to base64 data URL
      console.warn('[UPLOAD] Cannot write to disk:', writeErr.message);
      // Return base64 data URL — works for preview but Telegram won't accept it
      // Better: tell user to use imgur
      return res.status(500).json({
        error: 'Filesystem write failed. Please use imgur.com and paste URL manually.',
        hint: 'Render free tier has ephemeral filesystem.'
      });
    }

    // Public URL (served by Vercel from /public/images/uploads/)
    // BUT: since backend is Render and frontend is Vercel, we need to use Render URL
    const publicUrl = `https://cats-mining-backend.onrender.com/images/uploads/${filename}`;

    console.log(`[UPLOAD] Image saved: ${filename} (${buffer.length} bytes)`);
    res.json({ success: true, url: publicUrl, filename });
  } catch (error) {
    console.error('[UPLOAD]', error);
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
    } catch(e) { console.error('[WITHDRAW] User notify failed:', e.message); }

    // ─── POST PROOF TO PAYOUT CHANNEL ───
    const proofChannel = process.env.PROOF_CHANNEL;
    if (proofChannel) {
      try {
        const masked = '****' + wd.telegramId.slice(-4);
        const txLink = txHash && txHash !== 'manual'
          ? `\n🔗 [View Transaction](https://tonviewer.com/transaction/${txHash})`
          : '';

        const proofMessage =
          `✅ *Withdrawal Paid*\n\n` +
          `👤 User: \`${masked}\`\n` +
          `💰 Amount: *${wd.netAmount.toFixed(4)} TON*\n` +
          `📅 ${new Date().toLocaleString('en-US', { hour12: false })}` +
          txLink;

        await bot.sendMessage(proofChannel, proofMessage, {
          parse_mode: 'Markdown',
          disable_web_page_preview: false,
          reply_markup: {
            inline_keyboard: [
              [{ text: '🚀 Start Mining', url: 'https://t.me/MiningCatsBot' }]
            ]
          }
        });
        console.log(`[PROOF] ✅ Posted to ${proofChannel} for ${wd.telegramId}`);
      } catch (e) {
        console.error('[PROOF] ❌ Failed to post to', proofChannel, ':', e.message);
        console.error('[PROOF] Make sure bot is ADMIN in', proofChannel, 'with "Post Messages" permission');
      }
    } else {
      console.warn('[PROOF] PROOF_CHANNEL env var not set!');
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

// ============ ADMIN: PARTNER REQUESTS ============
app.get('/api/admin/partner-requests', adminAuth, async (req, res) => {
  try {
    const status = req.query.status;
    const query = status ? { status } : {};
    const requests = await PartnerRequest.find(query).sort({ createdAt: -1 }).limit(200);
    res.json({ success: true, requests });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/partner-requests/approve', adminAuth, async (req, res) => {
  try {
    const { requestId, taskTitle, taskReward, taskLink, taskIcon, taskDescription } = req.body;
    const request = await PartnerRequest.findById(requestId);
    if (!request) return res.status(404).json({ error: 'NOT_FOUND' });
    if (request.status !== 'pending') return res.status(400).json({ error: 'ALREADY_PROCESSED' });

    // Create the partner task (using sanitize for safety)
    const title = sanitize(taskTitle || 'Partner Task');
    const reward = safeNum(taskReward, 0.0001, 10);
    if (!reward) return res.status(400).json({ error: 'INVALID_REWARD' });
    const link = sanitize(taskLink || request.channelLink);
    const icon = sanitize(taskIcon || '🤝').slice(0, 4);
    const desc = sanitize(taskDescription || 'Visit partner channel');

    const taskId = 't_partner_' + request._id.toString().slice(-6);
    const partnerTask = new Task({
      taskId,
      title,
      description: desc,
      icon,
      reward,
      link,
      type: 'channel',
      category: 'partner',
      isVerifiedChannel: false,  // NO verification for partners
      position: 99
    });
    await partnerTask.save();

    request.status = 'approved';
    request.reviewedAt = new Date();
    await request.save();

    await logAdmin('APPROVE_PARTNER', request.telegramId, { taskId, title, reward }, req);

    try {
      await bot.sendMessage(request.telegramId,
        `🎉 *Partnership Approved!*\n\nYour channel ${request.channelLink} is now a Cats Mining partner!\n\n📋 Task: ${title}\n💰 Reward: ${reward} TON`,
        { parse_mode: 'Markdown' }
      );
    } catch(e) {}

    res.json({ success: true, taskId });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/partner-requests/reject', adminAuth, async (req, res) => {
  try {
    const { requestId, reason } = req.body;
    const request = await PartnerRequest.findById(requestId);
    if (!request) return res.status(404).json({ error: 'NOT_FOUND' });
    if (request.status !== 'pending') return res.status(400).json({ error: 'ALREADY_PROCESSED' });
    request.status = 'rejected';
    request.reviewedAt = new Date();
    request.rejectReason = sanitize(reason || 'Not approved');
    await request.save();

    await logAdmin('REJECT_PARTNER', request.telegramId, { requestId, reason }, req);

    try {
      await bot.sendMessage(request.telegramId,
        `❌ *Partnership Rejected*\n\nUnfortunately your request was not approved.\n\nReason: ${request.rejectReason}`,
        { parse_mode: 'Markdown' }
      );
    } catch(e) {}

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ ADMIN: DISCOUNT EVENTS ============
app.get('/api/admin/events', adminAuth, async (req, res) => {
  try {
    const events = await DiscountEvent.find().sort({ createdAt: -1 }).limit(20);
    res.json({ success: true, events });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/event/create', adminAuth, async (req, res) => {
  try {
    const { name, description, discountPercent, durationDays } = req.body;
    const pct = safeNum(discountPercent, 1, 50);
    const days = safeNum(durationDays, 1, 30);
    if (!pct || !days) return res.status(400).json({ error: 'INVALID' });

    // Disable previous active events
    await DiscountEvent.updateMany({ enabled: true }, { enabled: false });

    const now = new Date();
    const event = new DiscountEvent({
      name: sanitize(name || 'Mining Boost Event'),
      description: sanitize(description || `-${pct}% on all miners for ${days} days`),
      discountPercent: pct,
      startsAt: now,
      endsAt: new Date(now.getTime() + days * 24 * 60 * 60 * 1000),
      enabled: true
    });
    await event.save();

    await logAdmin('CREATE_EVENT', 'system', { name: event.name, pct, days }, req);
    res.json({ success: true, event });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/event/end', adminAuth, async (req, res) => {
  try {
    await DiscountEvent.updateMany({ enabled: true }, { enabled: false });
    await logAdmin('END_EVENT', 'system', {}, req);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ ADMIN: DUPLICATE MINERS CLEANUP ============
app.get('/api/admin/check-duplicates', adminAuth, async (req, res) => {
  try {
    // Find users with duplicate (telegramId + minerId) ActiveMiners
    const dupes = await ActiveMiner.aggregate([
      {
        $group: {
          _id: { telegramId: '$telegramId', minerId: '$minerId' },
          count: { $sum: 1 },
          docs: { $push: { _id: '$_id', createdAt: '$startedAt', totalCollected: '$totalCollected', price: '$price' } }
        }
      },
      { $match: { count: { $gt: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 100 }
    ]);

    let totalDupes = 0;
    let totalExtraMiners = 0;
    dupes.forEach(d => {
      totalDupes++;
      totalExtraMiners += (d.count - 1);
    });

    res.json({
      success: true,
      duplicateGroups: dupes.length,
      totalExtraMiners,
      details: dupes.slice(0, 20).map(d => ({
        telegramId: d._id.telegramId,
        minerId: d._id.minerId,
        count: d.count,
        oldest: new Date(Math.min(...d.docs.map(x => new Date(x.createdAt).getTime())))
      }))
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Clean duplicates — keeps OLDEST miner per (telegramId, minerId)
// Validate ALL pending referrals immediately + create missing logs as valid
// Use this once to fix all old data
app.post('/api/admin/validate-pending-refs', adminAuth, async (req, res) => {
  try {
    let validated = 0;
    let created = 0;
    const milestoneRefIds = new Set();

    // 1. Convert ALL pending logs to valid (no conditions - pending is removed from the system)
    const pendingLogs = await ReferralLog.find({ status: 'pending' });
    for (const log of pendingLogs) {
      log.status = 'valid';
      log.reason = 'auto_validated_pending_removed';
      log.verifiedAt = new Date();
      await log.save();
      validated++;
      milestoneRefIds.add(log.referrerId);
    }

    // 2. Create missing valid logs for users who have referredBy but no log
    const usersWithRefs = await User.find({ referredBy: { $ne: null } });
    for (const user of usersWithRefs) {
      const existingLog = await ReferralLog.findOne({
        referrerId: user.referredBy,
        referredId: user.telegramId
      });

      if (!existingLog) {
        try {
          await ReferralLog.create({
            referrerId: user.referredBy,
            referredId: user.telegramId,
            status: 'valid',
            reason: 'auto_validated_on_signup_retroactive',
            verifiedAt: new Date()
          });
          created++;
          validated++;
          milestoneRefIds.add(user.referredBy);
        } catch(e) {
          // Already exists (race) - skip
        }
      }
    }

    // Check milestones for ALL affected referrers
    for (const refId of milestoneRefIds) {
      try { await checkMilestones(refId); } catch(e) {}
    }

    await logAdmin('REMOVE_PENDING_REFS', 'system', { validated, created }, req);
    res.json({
      success: true,
      validated,
      logsCreated: created,
      milestonesChecked: milestoneRefIds.size,
      message: `Validated ${validated} refs (${created} were missing logs)`
    });
  } catch (error) {
    console.error('[VALIDATE-REFS]', error);
    res.status(500).json({ error: error.message });
  }
});

// Cleanup OLD pending deposits (older than X hours - never matched)
app.post('/api/admin/cleanup-pending-deposits', adminAuth, async (req, res) => {
  try {
    const { telegramId, hoursOld } = req.body;
    const cutoff = new Date(Date.now() - (hoursOld || 1) * 60 * 60 * 1000);

    const filter = { status: 'pending', createdAt: { $lt: cutoff } };
    if (telegramId) filter.telegramId = telegramId.toString();

    const result = await Deposit.deleteMany(filter);
    await logAdmin('CLEANUP_PENDING_DEPOSITS', telegramId || 'all', {
      hoursOld: hoursOld || 1,
      deleted: result.deletedCount
    }, req);

    res.json({
      success: true,
      deleted: result.deletedCount,
      message: `Deleted ${result.deletedCount} pending deposits older than ${hoursOld||1}h`
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Cleanup DUPLICATE pending deposits (keep newest only per user)
app.post('/api/admin/cleanup-duplicate-pending', adminAuth, async (req, res) => {
  try {
    const users = await Deposit.distinct('telegramId', { status: 'pending' });
    let deleted = 0;

    for (const tgId of users) {
      const pendings = await Deposit.find({ telegramId: tgId, status: 'pending' })
        .sort({ createdAt: -1 });

      if (pendings.length > 1) {
        const toDelete = pendings.slice(1).map(p => p._id);
        const result = await Deposit.deleteMany({ _id: { $in: toDelete } });
        deleted += result.deletedCount;
      }
    }

    await logAdmin('CLEANUP_DUPLICATE_PENDING', 'system', { deleted }, req);
    res.json({ success: true, deleted, message: `Cleaned ${deleted} duplicate pendings, kept newest per user` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/admin/clean-duplicates', adminAuth, async (req, res) => {
  try {
    const { dryRun } = req.body;  // if true, just report

    const dupes = await ActiveMiner.aggregate([
      {
        $group: {
          _id: { telegramId: '$telegramId', minerId: '$minerId' },
          count: { $sum: 1 },
          docs: { $push: { _id: '$_id', startedAt: '$startedAt', totalCollected: '$totalCollected' } }
        }
      },
      { $match: { count: { $gt: 1 } } }
    ]);

    let removed = 0;
    let kept = 0;
    const toDelete = [];

    for (const dup of dupes) {
      // Sort by oldest first (keep oldest)
      const sorted = dup.docs.sort((a,b) => new Date(a.startedAt) - new Date(b.startedAt));
      kept++;
      // Mark all except the oldest for deletion
      for (let i = 1; i < sorted.length; i++) {
        toDelete.push(sorted[i]._id);
        removed++;
      }
    }

    if (!dryRun && toDelete.length > 0) {
      await ActiveMiner.deleteMany({ _id: { $in: toDelete } });
      await logAdmin('CLEAN_DUPLICATES', 'system', { removed, kept }, req);
    }

    res.json({
      success: true,
      duplicateGroups: dupes.length,
      kept,
      removed,
      dryRun: !!dryRun,
      message: dryRun ? `Found ${removed} extras (dry run, nothing deleted)` : `Cleaned ${removed} duplicate miners`
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
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

  // Auto-convert any remaining pending refs to valid (pending system removed)
  ReferralLog.updateMany(
    { status: 'pending' },
    { $set: { status: 'valid', reason: 'auto_migrated_pending_removed', verifiedAt: new Date() } }
  ).then(result => {
    if (result.modifiedCount > 0) {
      console.log(`[MIGRATION] ✅ Converted ${result.modifiedCount} pending refs to valid`);
    }
  }).catch(e => console.error('[MIGRATION]', e.message));
});