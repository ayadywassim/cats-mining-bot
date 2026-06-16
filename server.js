require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const TelegramBot = require('node-telegram-bot-api');
const rateLimit = require('express-rate-limit');
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.static('public'));

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
  referredBy: String,
  refCommission: { type: Number, default: 0 },
  completedTasks: { type: [String], default: [] },
  banned: { type: Boolean, default: false },
  withdrawBypass: { type: Boolean, default: false },
  lastDaily: Date,
  createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('CatsMiningUser', userSchema);

const activeMinerSchema = new mongoose.Schema({
  telegramId: { type: String, index: true },
  minerId: String,
  minerName: String,
  level: Number,
  price: Number,
  daily: Number,
  totalReturn: Number,
  startedAt: { type: Date, default: Date.now },
  expiresAt: Date,
  status: { type: String, default: 'active', enum: ['active', 'expired'] },
  totalCollected: { type: Number, default: 0 },
  lastCollected: { type: Date, default: Date.now }
});
const ActiveMiner = mongoose.model('CatsMiningMiner', activeMinerSchema);

const depositSchema = new mongoose.Schema({
  telegramId: String,
  amount: Number,
  txHash: { type: String, unique: true, sparse: true },
  minerId: String,
  memo: String,
  status: { type: String, default: 'pending', enum: ['pending', 'verified', 'failed'] },
  createdAt: { type: Date, default: Date.now }
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
    let user = await User.findOne({ telegramId: telegramId.toString() });

    if (!user) {
      user = new User({ telegramId: telegramId.toString(), firstName, username, photoUrl });
      if (refBy) {
        user.referredBy = refBy;
        await User.findOneAndUpdate({ telegramId: refBy }, { $addToSet: { referrals: telegramId.toString() } });
      }
      await user.save();
    } else {
      if (firstName) user.firstName = firstName;
      if (username) user.username = username;
      if (photoUrl) user.photoUrl = photoUrl;
      await user.save();
    }

    const activeMiners = await ActiveMiner.find({ telegramId: telegramId.toString(), status: 'active' });
    const userObj = user.toObject();
    userObj.activeMiners = activeMiners;

    res.json({ success: true, user: userObj });
  } catch (error) {
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
      return res.json({ success: true, miner, type: 'free' });
    }

    // Paid miner — create pending deposit
    const memo = 'CM' + telegramId.toString();
    const deposit = new Deposit({
      telegramId: telegramId.toString(),
      amount: minerConfig.price,
      minerId: minerConfig.id,
      memo
    });
    await deposit.save();

    res.json({
      success: true,
      type: 'deposit_required',
      walletAddress: process.env.BOT_WALLET,
      amount: minerConfig.price,
      memo,
      depositId: deposit._id
    });
  } catch (error) {
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

      // Calculate earnings since last collect
      const lastCollect = miner.lastCollected || miner.startedAt;
      const hoursSince = (now - lastCollect) / (1000 * 60 * 60);
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
    const now = new Date();

    for (const miner of miners) {
      if (now >= miner.expiresAt) continue;
      const lastCollect = miner.lastCollected || miner.startedAt;
      const hoursSince = (now - lastCollect) / (1000 * 60 * 60);
      totalPending += (miner.daily / 24) * hoursSince;
      dailyProfit += miner.daily;
    }

    res.json({ success: true, pending: totalPending, dailyProfit, activeCount: miners.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ API: WITHDRAWALS ============
app.post('/api/withdrawals/request', async (req, res) => {
  try {
    const { telegramId, amount, walletAddress } = req.body;
    const user = await User.findOne({ telegramId: telegramId.toString() });
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (user.banned) return res.status(403).json({ error: 'ACCOUNT_BANNED', message: 'Your account has been banned' });

    // CHECK 1: Must have bought at least 1 miner (verified deposit)
    if (!user.withdrawBypass) {
      const verifiedDeposit = await Deposit.findOne({
        telegramId: telegramId.toString(),
        status: 'verified',
        amount: { $gte: 0.5 }
      });
      if (!verifiedDeposit) {
        return res.status(400).json({ error: 'DEPOSIT_REQUIRED', message: 'You must buy at least 1 miner first' });
      }

      // CHECK 2: Must have 2 paid referrals
      let paidRefs = 0;
      for (const refId of user.referrals) {
        const paidDeposit = await Deposit.findOne({
          telegramId: refId.toString(),
          status: 'verified',
          amount: { $gte: 0.5 }
        });
        if (paidDeposit) {
          paidRefs++;
          if (paidRefs >= 2) break;
        }
      }
      if (paidRefs < 2) {
        return res.status(400).json({ error: 'REFS_REQUIRED', current: paidRefs, required: 2 });
      }
    }

    // CHECK 3: Amount
    if (amount < 1.5) return res.status(400).json({ error: 'MIN_AMOUNT', message: 'Minimum withdrawal 1.5 TON' });
    if (user.balance < 1.5) return res.status(400).json({ error: 'MIN_BALANCE', message: 'Minimum 1.5 TON balance' });
    if (amount > user.balance) return res.status(400).json({ error: 'INSUFFICIENT' });

    const fee = amount * 0.05;
    const netAmount = amount - fee;

    const withdrawal = new Withdrawal({
      telegramId: telegramId.toString(), amount, fee, netAmount, walletAddress
    });
    await withdrawal.save();
    await User.findOneAndUpdate({ telegramId: telegramId.toString() }, { $inc: { balance: -amount } });

    // Notify admin
    const adminId = process.env.ADMIN_IDS;
    if (adminId) {
      try {
        await bot.sendMessage(adminId,
          `💸 *Withdrawal Request*\n👤 ${user.firstName} (@${user.username})\n🆔 \`${telegramId}\`\n💰 ${amount} TON\n📤 Net: ${netAmount.toFixed(4)} TON\n📬 \`${walletAddress}\``,
          { parse_mode: 'Markdown' }
        );
      } catch (e) {}
    }

    res.json({ success: true, withdrawal });
  } catch (error) {
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
    const user = await User.findOne({ telegramId: telegramId.toString() });
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.banned) return res.status(403).json({ error: 'ACCOUNT_BANNED' });
    if (user.completedTasks.includes(taskId)) return res.status(400).json({ error: 'Already completed' });

    const task = await Task.findOne({ taskId, enabled: true });
    if (!task) return res.status(404).json({ error: 'Task not found' });

    user.completedTasks.push(taskId);
    user.balance += task.reward;
    user.totalEarned += task.reward;
    await user.save();

    res.json({ success: true, reward: task.reward, newBalance: user.balance });
  } catch (error) {
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

    const apiKey = process.env.TONCENTER_KEY;
    const wallet = process.env.BOT_WALLET;
    if (!apiKey || !wallet) return;

    const response = await fetch(`https://toncenter.com/api/v2/getTransactions?address=${wallet}&limit=50&api_key=${apiKey}`);
    const data = await response.json();
    if (!data.ok || !data.result) return;

    for (const tx of data.result) {
      const inMsg = tx.in_msg;
      if (!inMsg || !inMsg.value) continue;
      const amountTON = parseInt(inMsg.value) / 1e9;
      const memo = inMsg.message || '';
      const txHash = tx.transaction_id?.hash || '';

      for (const dep of pending) {
        if (memo.includes(dep.memo) && amountTON >= dep.amount * 0.95) {
          const existing = await Deposit.findOne({ txHash });
          if (existing && existing.status === 'verified') continue;

          dep.status = 'verified';
          dep.txHash = txHash;
          await dep.save();

          // Activate miner
          const minerConfig = MINERS_CONFIG.find(m => m.id === dep.minerId);
          if (minerConfig) {
            const miner = new ActiveMiner({
              telegramId: dep.telegramId,
              minerId: minerConfig.id,
              minerName: minerConfig.name,
              level: minerConfig.level,
              price: minerConfig.price,
              daily: minerConfig.daily,
              totalReturn: minerConfig.total,
              expiresAt: new Date(Date.now() + minerConfig.days * 24 * 60 * 60 * 1000)
            });
            await miner.save();

            await User.findOneAndUpdate(
              { telegramId: dep.telegramId },
              { $inc: { totalDeposited: amountTON, totalInvested: amountTON } }
            );

            // Referral commission (10%)
            const user = await User.findOne({ telegramId: dep.telegramId });
            if (user && user.referredBy) {
              const commission = amountTON * 0.10;
              await User.findOneAndUpdate(
                { telegramId: user.referredBy },
                { $inc: { balance: commission, refCommission: commission, totalEarned: commission } }
              );
            }

            // Notify user
            try {
              await bot.sendMessage(dep.telegramId,
                `✅ *Miner Activated!*\n\n⛏️ ${minerConfig.name} (Lv.${minerConfig.level})\n💰 Earns ${minerConfig.daily} TON/day\n📅 Contract: ${minerConfig.days} days\n💎 Total return: ${minerConfig.total} TON`,
                { parse_mode: 'Markdown' }
              );
            } catch (e) {}
          }
        }
      }
    }
  } catch (e) {
    console.error('Deposit check error:', e.message);
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
    { taskId: 't_miner', title: 'Buy your first miner', icon: '⛏️', reward: 0.05, type: 'action' }
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
    const users = await User.countDocuments();
    const activeMiners = await ActiveMiner.countDocuments({ status: 'active' });
    const pendingW = await Withdrawal.countDocuments({ status: 'pending' });
    const pendingD = await Deposit.countDocuments({ status: 'pending' });
    const verifiedD = await Deposit.countDocuments({ status: 'verified' });
    const totalDeposited = await Deposit.aggregate([{ $match: { status: 'verified' } }, { $group: { _id: null, total: { $sum: '$amount' } } }]);
    res.json({ success: true, users, activeMiners, pendingW, pendingD, verifiedD, totalDeposited: totalDeposited[0]?.total || 0 });
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
    const { message } = req.body;
    const users = await User.find({});
    let sent = 0, failed = 0;
    for (const u of users) {
      try {
        await bot.sendMessage(u.telegramId, message, { parse_mode: 'Markdown' });
        sent++;
      } catch (e) { failed++; }
    }
    res.json({ success: true, sent, failed });
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