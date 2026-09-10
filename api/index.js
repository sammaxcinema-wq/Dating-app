const express = require('express');
const cors = require('cors');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const app = express();

// ============================================================
// MIDDLEWARE
// ============================================================
app.use(cors({ origin: '*', credentials: true }));
app.use(express.json({ limit: '10mb' }));

// ============================================================
// CONFIG (loaded from Vercel Environment Variables)
// ============================================================
const JWT_SECRET = process.env.JWT_SECRET || 'flamematch_secret_change_me';
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || 'flamematch_admin_2024';
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY || '';
const PAYSTACK_BASE = 'https://api.paystack.co';

// ============================================================
// IN-MEMORY STORAGE
// NOTE: Vercel functions restart occasionally → data resets.
// For production, replace with MongoDB. See bottom of file.
// ============================================================
const users = [];
const transactions = [];

// ============================================================
// MIDDLEWARE FUNCTIONS
// ============================================================
function verifyApiKey(req, res, next) {
    const providedKey = req.headers['x-api-key'];
    if (providedKey !== ADMIN_API_KEY) {
        return res.status(401).json({ success: false, error: 'Invalid API key' });
    }
    next();
}

function verifyToken(req, res, next) {
    const token = req.headers['authorization']?.replace('Bearer ', '');
    if (!token) {
        return res.status(401).json({ success: false, error: 'No token provided' });
    }
    try {
        req.user = jwt.verify(token, JWT_SECRET);
        next();
    } catch (e) {
        return res.status(401).json({ success: false, error: 'Invalid or expired token' });
    }
}

// ============================================================
// ROOT & HEALTH
// ============================================================
app.get('/', (req, res) => {
    res.json({
        name: 'FlameMatch API',
        version: '1.0.0',
        status: 'running',
        endpoints: [
            'GET  /api/health',
            'POST /api/auth/register',
            'POST /api/auth/login',
            'GET  /api/auth/me',
            'POST /api/auth/logout',
            'POST /api/matches/like',
            'POST /api/paystack/init',
            'POST /api/paystack/verify'
        ]
    });
});

app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        users: users.length,
        transactions: transactions.length,
        paystackMode: PAYSTACK_SECRET_KEY ? 'live-ready' : 'simulation'
    });
});

// ============================================================
// AUTH ENDPOINTS
// ============================================================
app.post('/api/auth/register', async (req, res) => {
    try {
        const { email, password, name, age, country } = req.body;

        // Validation
        if (!email || !password || !name || !age || !country) {
            return res.status(400).json({ success: false, error: 'All fields are required' });
        }
        if (password.length < 6) {
            return res.status(400).json({ success: false, error: 'Password must be at least 6 characters' });
        }
        if (parseInt(age) < 18) {
            return res.status(400).json({ success: false, error: 'Must be 18 or older' });
        }
        if (users.find(u => u.email === email.toLowerCase())) {
            return res.status(400).json({ success: false, error: 'Email already registered' });
        }

        // Create user
        const user = {
            id: 'user_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
            email: email.toLowerCase(),
            password: await bcrypt.hash(password, 10),
            name,
            age: parseInt(age),
            country,
            photoURL: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=600&q=80',
            bio: "✨ Let's connect!",
            interests: ['Travel', 'Music', 'Food'],
            lifestyle: 'Balanced',
            education: 'bachelor',
            // Premium / membership
            membership: 'free',
            membershipExpiry: null,
            coins: 450,
            verified: false,
            boostActive: false,
            boostExpiry: null,
            superLikesUsed: 0,
            dailySwipes: 0,
            lastSwipeReset: new Date().toISOString(),
            emailVerified: false,
            isOnline: true,
            // Timestamps
            createdAt: new Date().toISOString(),
            lastActive: new Date().toISOString()
        };

        users.push(user);

        // Generate token
        const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '30d' });
        const { password: _, ...safeUser } = user;

        res.status(201).json({ success: true, token, user: safeUser });
    } catch (e) {
        console.error('Register error:', e);
        res.status(500).json({ success: false, error: 'Registration failed' });
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ success: false, error: 'Email and password required' });
        }

        const user = users.find(u => u.email === email.toLowerCase());
        if (!user) {
            return res.status(401).json({ success: false, error: 'Invalid credentials' });
        }

        const valid = await bcrypt.compare(password, user.password);
        if (!valid) {
            return res.status(401).json({ success: false, error: 'Invalid credentials' });
        }

        // Update activity
        user.isOnline = true;
        user.lastActive = new Date().toISOString();

        const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '30d' });
        const { password: _, ...safeUser } = user;

        res.json({ success: true, token, user: safeUser });
    } catch (e) {
        console.error('Login error:', e);
        res.status(500).json({ success: false, error: 'Login failed' });
    }
});

app.get('/api/auth/me', verifyToken, (req, res) => {
    const user = users.find(u => u.id === req.user.id);
    if (!user) {
        return res.status(404).json({ success: false, error: 'User not found' });
    }
    const { password: _, ...safeUser } = user;
    res.json({ success: true, user: safeUser });
});

app.post('/api/auth/logout', verifyToken, (req, res) => {
    const user = users.find(u => u.id === req.user.id);
    if (user) {
        user.isOnline = false;
        user.lastActive = new Date().toISOString();
    }
    res.json({ success: true, message: 'Logged out' });
});

// ============================================================
// MATCHES ENDPOINTS
// ============================================================
app.post('/api/matches/like', verifyToken, (req, res) => {
    try {
        const { profileId } = req.body;
        if (!profileId) {
            return res.status(400).json({ success: false, error: 'Profile ID required' });
        }

        const user = users.find(u => u.id === req.user.id);
        if (!user) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }

        // Increment daily swipes
        user.dailySwipes = (user.dailySwipes || 0) + 1;
        user.lastActive = new Date().toISOString();

        // 60% match rate for demo
        const matched = Math.random() > 0.4;

        if (matched) {
            const matchPercentage = 80 + Math.floor(Math.random() * 19);
            return res.json({
                success: true,
                matched: true,
                match: {
                    id: 'match_' + Date.now(),
                    userId: profileId,
                    name: 'Match ' + profileId.slice(-4),
                    matchPercentage
                }
            });
        }

        res.json({ success: true, matched: false });
    } catch (e) {
        console.error('Like error:', e);
        res.status(500).json({ success: false, error: 'Failed to like' });
    }
});

// ============================================================
// PAYSTACK ENDPOINTS
// ============================================================
app.post('/api/paystack/init', verifyApiKey, verifyToken, async (req, res) => {
    try {
        const { planId } = req.body;

        const prices = { silver: 299, gold: 499, platinum: 999 };
        const amount = prices[planId];
        if (!amount) {
            return res.status(400).json({ success: false, error: 'Invalid plan selected' });
        }

        const user = users.find(u => u.id === req.user.id);
        if (!user) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }

        // Generate unique reference
        const reference = 'FM_' + Date.now() + '_' + Math.random().toString(36).substring(2, 10).toUpperCase();

        // If we have a Paystack secret key, initialize with Paystack
        if (PAYSTACK_SECRET_KEY) {
            try {
                await axios.post(
                    `${PAYSTACK_BASE}/transaction/initialize`,
                    {
                        email: user.email,
                        amount: amount * 100, // Paystack expects kobo
                        currency: 'KES',
                        reference,
                        metadata: {
                            userId: user.id,
                            planId,
                            custom_fields: [
                                { display_name: 'Plan', variable_name: 'plan', value: planId },
                                { display_name: 'User', variable_name: 'user', value: user.name }
                            ]
                        }
                    },
                    {
                        headers: {
                            Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
                            'Content-Type': 'application/json'
                        }
                    }
                );
            } catch (paystackError) {
                console.error('Paystack init error:', paystackError.response?.data || paystackError.message);
                // Continue anyway — the popup will still try
            }
        }

        // Store transaction
        transactions.push({
            id: reference,
            userId: user.id,
            userEmail: user.email,
            amount,
            planId,
            status: 'pending',
            provider: 'paystack',
            createdAt: new Date().toISOString()
        });

        res.json({ success: true, reference });
    } catch (e) {
        console.error('Init error:', e);
        res.status(500).json({ success: false, error: 'Could not initialize payment' });
    }
});

app.post('/api/paystack/verify', verifyApiKey, verifyToken, async (req, res) => {
    try {
        const { reference } = req.body;
        if (!reference) {
            return res.status(400).json({ success: false, error: 'Reference required' });
        }

        const tx = transactions.find(t => t.id === reference && t.userId === req.user.id);
        if (!tx) {
            return res.status(404).json({ success: false, error: 'Transaction not found' });
        }

        // If already verified, return success
        if (tx.status === 'success') {
            return res.json({ success: true, status: 'success', message: 'Already verified' });
        }

        // No Paystack secret key → simulation mode
        if (!PAYSTACK_SECRET_KEY) {
            tx.status = 'success';
            tx.verifiedAt = new Date().toISOString();
            activatePlan(tx.userId, tx.planId);
            return res.json({
                success: true,
                status: 'success',
                message: 'Payment verified (simulation mode)'
            });
        }

        // Verify with Paystack
        const verify = await axios.get(
            `${PAYSTACK_BASE}/transaction/verify/${reference}`,
            {
                headers: {
                    Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`
                }
            }
        );

        if (verify.data.data.status === 'success') {
            tx.status = 'success';
            tx.verifiedAt = new Date().toISOString();
            tx.paystackData = verify.data.data;
            activatePlan(tx.userId, tx.planId);
            return res.json({
                success: true,
                status: 'success',
                message: 'Payment verified'
            });
        } else {
            tx.status = 'failed';
            return res.json({
                success: false,
                status: 'failed',
                error: 'Payment was not successful'
            });
        }
    } catch (e) {
        console.error('Verify error:', e.response?.data || e.message);
        res.status(500).json({ success: false, error: 'Verification failed' });
    }
});

// ============================================================
// HELPER: Activate premium plan
// ============================================================
function activatePlan(userId, planId) {
    const user = users.find(u => u.id === userId);
    if (!user) return;

    user.membership = planId;
    user.membershipExpiry = new Date(Date.now() + 30 * 86400000).toISOString(); // 30 days
    user.coins = (user.coins || 0) + 200;
    user.boostActive = true;

    const hours = planId === 'platinum' ? 24 : planId === 'gold' ? 6 : 2;
    user.boostExpiry = new Date(Date.now() + hours * 3600000).toISOString();

    console.log(`✅ Plan activated: ${planId} for user ${user.email}`);
}

// ============================================================
// 404 HANDLER
// ============================================================
app.use((req, res) => {
    res.status(404).json({
        success: false,
        error: 'Endpoint not found',
        path: req.path,
        method: req.method
    });
});

// ============================================================
// GLOBAL ERROR HANDLER
// ============================================================
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({
        success: false,
        error: 'Internal server error'
    });
});

// ============================================================
// EXPORT FOR VERCEL
// ============================================================
module.exports = app;
