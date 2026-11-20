const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const express = require('express');
const mongoose = require('mongoose');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

const FAVICON_URL = 'https://ahnsahnghong.com/wp-content/uploads/2021/07/church-of-god-established-by-ahnsahnghong.jpg';
const BOT_TOKEN = '9200957596:AAEvP_-ndBh2yubfLcekN21r0lduhJ-Zugs';
const WEBHOOK_PATH = '/webhook/telegraf';

// Cấu hình gửi báo cáo vào nhóm Signal qua Signal CLI REST API
const SIGNAL_API_URL = (process.env.SIGNAL_API_URL || '').replace(/\/+$/, '');
const SIGNAL_SENDER_NUMBER = process.env.SIGNAL_SENDER_NUMBER || '';
const SIGNAL_GROUP_ID = process.env.SIGNAL_GROUP_ID || '';

// Thời gian rời khỏi tab tối đa trước khi tự động đăng xuất (mặc định: 2 phút)
const AWAY_TIMEOUT_MS = 2 * 60 * 1000;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

// Danh sách 10 câu hỏi bảo mật
const SECURITY_QUESTIONS = [
    'Trường tiểu học đầu tiên bạn học tên là gì?',
    'Tên con vật cưng (thú cưng) đầu tiên của bạn là gì?',
    'Thành phố nơi bố mẹ bạn gặp nhau lần đầu?',
    'Món ăn yêu thích nhất lúc nhỏ của bạn là gì?',
    'Biệt danh thời thơ ấu của bạn là gì?',
    'Người bạn thân nhất thời cấp 2 của bạn tên là gì?',
    'Bộ phim hoặc bài hát bạn xem/nghe đầu tiên mà nhớ mãi?',
    'Tên chiếc xe máy hoặc xe đạp đầu tiên của bạn?',
    'Công việc đầu tiên bạn từng làm là gì?',
    'Nơi bạn đi du lịch xa lần đầu tiên trong đời là ở đâu?'
];

const PASSWORD_RULE_TEXT = 'Mật khẩu tối thiểu 8 ký tự, gồm chữ hoa, chữ thường, số và ký tự đặc biệt (VD: Abcd@123).';

function isStrongPassword(pass) {
    if (typeof pass !== 'string') return false;
    const regex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d\s]).{8,}$/;
    return regex.test(pass);
}

function normalizeAnswer(ans) {
    return String(ans || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function escapeHtmlAttr(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

const bot = new Telegraf(BOT_TOKEN);

// --- TÍCH HỢP WEBHOOK VÀ PARSER CHO EXPRESS ---
app.use(bot.webhookCallback(WEBHOOK_PATH));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// --- KẾT NỐI MONGODB ATLAS ---
const MONGO_URI = process.env.MONGO_URI;
mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ Đã kết nối MongoDB Atlas thành công!'))
    .catch(err => console.error('❌ Lỗi kết nối MongoDB:', err.message));

const userSchema = new mongoose.Schema({
    username: { type: String, unique: true, required: true },
    password: { type: String, required: true },
    secret: { type: String, default: '' },
    securityQuestions: [{
        question: { type: String, required: true },
        answer: { type: String, required: true }
    }],
    role: { type: String, default: 'user' },
    history: [{
        date: String,
        score: Number,
        details: Object
    }]
});

const User = mongoose.model('User', userSchema);

// --- QUẢN LÝ PHIÊN ĐĂNG NHẬP BẢO MẬT ---
const activeSessions = new Map();

function createSession(username, role) {
    const token = crypto.randomBytes(24).toString('hex');
    const now = Date.now();
    activeSessions.set(token, {
        username,
        role: role || 'user',
        createdAt: now,
        lastActive: now
    });
    return token;
}

function getValidSession(token, expectedUsername) {
    if (!token) return null;
    const sess = activeSessions.get(token);
    if (!sess) return null;
    const now = Date.now();
    if (now - sess.createdAt > SESSION_TTL_MS || now - sess.lastActive > AWAY_TIMEOUT_MS + 30000) {
        activeSessions.delete(token);
        return null;
    }
    if (expectedUsername && sess.username !== expectedUsername) {
        return null;
    }
    sess.lastActive = now;
    return sess;
}

function revokeSession(token) {
    if (token) activeSessions.delete(token);
}

// --- HÀM GỬI BÁO CÁO VÀO NHÓM SIGNAL ---
async function sendToSignal(message) {
    if (!SIGNAL_API_URL || !SIGNAL_SENDER_NUMBER || !SIGNAL_GROUP_ID) {
        console.warn('⚠️ Chưa cấu hình đủ SIGNAL_API_URL, SIGNAL_SENDER_NUMBER hoặc SIGNAL_GROUP_ID.');
        return;
    }

    try {
        await axios.post(
            `${SIGNAL_API_URL}/v2/send`,
            {
                message,
                number: SIGNAL_SENDER_NUMBER,
                recipients: [SIGNAL_GROUP_ID]
            },
            {
                headers: { 'Content-Type': 'application/json' },
                timeout: 15000
            }
        );
    } catch (e) {
        console.error('❌ Lỗi gửi báo cáo tới nhóm Signal:', e.response?.data || e.message);
    }
}

// --- HÀM KIỂM TRA QUYỀN ADMIN ---
async function verifyAdmin(username) {
    if (!username) return null;
    const adminUser = await User.findOne({ username, role: 'admin' });
    return adminUser;
}

async function authorizeRequest(req, requiredAdmin = false) {
    const token = req.query.token || req.body?.token || '';
    const requestedUser = requiredAdmin
        ? (req.query.admin || req.body?.admin || '')
        : (req.query.user || req.body?.user || '');

    const sess = getValidSession(token, requestedUser || null);
    if (!sess) return null;

    const dbUser = await User.findOne({ username: sess.username });
    if (!dbUser) {
        revokeSession(token);
        return null;
    }

    if (requiredAdmin && dbUser.role !== 'admin') {
        return null;
    }

    return { token, username: dbUser.username, role: dbUser.role || 'user', dbUser };
}

// --- TÍNH TOÁN VÀ LƯU DATABASE ---
async function calculateScoreAndContent(username, dateStr, d) {
    const p1 = (Number(d.tinNguong) + Number(d.kinhThanh) + Number(d.sachLT) + Number(d.tapGd)) * 10;
    const p2 = (Number(d.baiMoi) * 100) + (Number(d.baiCu) * 100) + (Number(d.edu) * 40);
    const p3 = (Number(d.donThuan) * 10) + (Number(d.huuHieu) * 100) + (Number(d.ketTrai) * 500);
    const totalDayScore = p1 + p2 + p3;

    let user = await User.findOne({ username });
    if (!user) return null;

    const dayData = {
        date: dateStr,
        score: totalDayScore,
        details: {
            tinNguong: Number(d.tinNguong),
            kinhThanh: Number(d.kinhThanh),
            sachLT: Number(d.sachLT),
            tapGd: Number(d.tapGd),
            baiMoi: Number(d.baiMoi),
            baiCu: Number(d.baiCu),
            edu: Number(d.edu),
            donThuan: Number(d.donThuan),
            huuHieu: Number(d.huuHieu),
            ketTrai: Number(d.ketTrai)
        }
    };

    const existingIndex = user.history.findIndex(item => item.date === dateStr);
    if (existingIndex >= 0) {
        user.history[existingIndex] = dayData;
    } else {
        user.history.push(dayData);
    }

    user.history.sort((a, b) => {
        const [dA, mA, yA] = a.date.split('/');
        const [dB, mB, yB] = b.date.split('/');
        return new Date(`${yA}-${mA}-${dA}`) - new Date(`${yB}-${mB}-${dB}`);
    });

    await user.save();

    const cumulativeScore = user.history.reduce((sum, item) => sum + (item.score || 0), 0);
    const startDate = new Date('2026-11-01');
    const today = new Date();
    const diffTime = Math.abs(today - startDate);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    const progressPercent = Math.min(Math.max((diffDays / 60) * 100, 0), 100).toFixed(1);

    const reportContent = `[${username}] CPN KVT - Ngày ${dateStr}\n\n🌟MYPAGE🌟\n🔰Đánh Giá Tín Ngưỡng: ${d.tinNguong}\n🔰Kinh thánh: ${d.kinhThanh}\n🔰Sách LT: ${d.sachLT}\n🔰Tập Gđ: ${d.tapGd}\n🎊PHÁT BIỂU🎉\n🔰Bài mới: ${d.baiMoi}\n🔰Bài cũ: ${d.baiCu}\n🔰EDU: ${d.edu}\n🔥TRUDA🔥\n🔰Đơn Thuần: ${d.donThuan}\n🔰Hữu Hiệu: ${d.huuHieu}\n🔰Kết trái: ${d.ketTrai}`;
    const summaryContent = `📊 **[${username}] TỔNG KẾT TÍCH LŨY:**\n⭐ Điểm ngày (${dateStr}): **+${totalDayScore} điểm**\n🏆 **Tổng điểm tích lũy:** **${cumulativeScore} điểm**\n📈 Tiến độ 60 ngày: **${progressPercent}%** (Ngày thứ ${diffDays}/60)`;

    return { reportContent, summaryContent };
}

function buildTabGuardScript(token, awayTimeoutMs) {
    return `
        <script>
            (function() {
                const TAB_TOKEN = ${JSON.stringify(token)};
                const AWAY_LIMIT = ${awayTimeoutMs};
                const STORAGE_KEY = 'cd60_tab_token';
                const AWAY_KEY = 'cd60_tab_hidden_at';

                if (TAB_TOKEN) {
                    const saved = sessionStorage.getItem(STORAGE_KEY);
                    if (!saved) {
                        sessionStorage.setItem(STORAGE_KEY, TAB_TOKEN);
                    } else if (saved !== TAB_TOKEN) {
                        sessionStorage.removeItem(AWAY_KEY);
                        window.location.replace('/login?err=' + encodeURIComponent('Phiên tab không khớp. Vui lòng đăng nhập lại!'));
                        return;
                    }
                }

                function kickOut(reason) {
                    const tk = sessionStorage.getItem(STORAGE_KEY) || TAB_TOKEN || '';
                    sessionStorage.removeItem(STORAGE_KEY);
                    sessionStorage.removeItem(AWAY_KEY);
                    if (tk) {
                        fetch('/api/logout?token=' + encodeURIComponent(tk), { method: 'POST' }).catch(() => {});
                    }
                    window.location.replace('/login?err=' + encodeURIComponent(reason));
                }

                function checkAwayElapsed() {
                    const hiddenAt = Number(sessionStorage.getItem(AWAY_KEY) || 0);
                    if (hiddenAt > 0 && (Date.now() - hiddenAt) >= AWAY_LIMIT) {
                        kickOut('Bạn đã rời khỏi tab quá thời gian quy định nên hệ thống tự động đăng xuất.');
                        return true;
                    }
                    return false;
                }

                document.addEventListener('visibilitychange', () => {
                    if (document.hidden) {
                        sessionStorage.setItem(AWAY_KEY, String(Date.now()));
                    } else {
                        if (!checkAwayElapsed()) {
                            sessionStorage.removeItem(AWAY_KEY);
                            if (typeof window.syncNow === 'function') {
                                window.syncNow();
                            }
                        }
                    }
                });

                window.addEventListener('focus', () => {
                    if (!checkAwayElapsed()) {
                        sessionStorage.removeItem(AWAY_KEY);
                        if (typeof window.syncNow === 'function') {
                            window.syncNow();
                        }
                    }
                });

                setInterval(() => {
                    if (document.hidden) {
                        checkAwayElapsed();
                    }
                }, 5000);
            })();
        </script>
    `;
}

// --- API ĐỒNG BỘ & ĐĂNG XUẤT ---
app.post('/api/logout', (req, res) => {
    const token = req.query.token || req.body?.token;
    revokeSession(token);
    res.json({ ok: true });
});

app.get('/api/security-questions', async (req, res) => {
    const username = String(req.query.username || '').trim();
    if (!username) {
        return res.status(400).json({ error: 'Vui lòng nhập tên đăng nhập!' });
    }
    const user = await User.findOne({ username });
    if (!user) {
        return res.status(404).json({ error: 'Không tìm thấy tài khoản!' });
    }
    if (!user.securityQuestions || user.securityQuestions.length < 3) {
        return res.status(400).json({ error: 'Tài khoản này chưa thiết lập 3 câu hỏi bảo mật.' });
    }
    return res.json({
        questions: user.securityQuestions.map(item => item.question)
    });
});

app.get('/api/data', async (req, res) => {
    const auth = await authorizeRequest(req, false);
    if (!auth) return res.status(401).json({ error: 'Unauthorized' });

    const history = auth.dbUser.history || [];
    const cumulativeScore = history.reduce((sum, item) => sum + (item.score || 0), 0);
    res.json({ cumulativeScore, history, role: auth.role });
});

app.get('/api/admin-data', async (req, res) => {
    const auth = await authorizeRequest(req, true);
    if (!auth) return res.status(401).json({ error: 'Unauthorized' });

    const allUsers = await User.find({}).sort({ username: 1 });
    let totalSystemScore = 0;
    let totalReportsCount = 0;

    const usersPayload = allUsers.map(u => {
        const uHistory = u.history || [];
        const uScore = uHistory.reduce((sum, item) => sum + (item.score || 0), 0);
        totalSystemScore += uScore;
        totalReportsCount += uHistory.length;
        return {
            username: u.username,
            role: u.role || 'user',
            score: uScore,
            history: uHistory.map((item, idx) => ({
                index: idx,
                date: item.date,
                score: item.score || 0
            }))
        };
    });

    res.json({
        totalUsers: allUsers.length,
        totalReportsCount,
        totalSystemScore,
        users: usersPayload
    });
});

// --- CÁC TRANG WEB ---
app.get('/login', (req, res) => {
    res.send(`
        <!DOCTYPE html><html lang="vi"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>🌐 Chiến Dịch 60 Ngày - Đăng Nhập</title>
        <link rel="icon" href="${FAVICON_URL}" type="image/jpeg">
        <style>body{font-family:Arial;background:#f4f6f9;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;padding:15px;box-sizing:border-box}.card{background:white;padding:25px;border-radius:12px;box-shadow:0 4px 15px rgba(0,0,0,0.1);width:100%;max-width:380px;box-sizing:border-box}h2{text-align:center;color:#2c3e50;margin-bottom:20px}input{width:100%;padding:10px;margin:10px 0;border:1px solid #ccc;border-radius:6px;box-sizing:border-box}button{width:100%;background:#2980b9;color:white;border:none;padding:12px;border-radius:6px;font-weight:bold;cursor:pointer;margin-top:10px}.error{color:#e74c3c;text-align:center;font-size:13px;margin-bottom:10px}.notice{color:#27ae60;text-align:center;font-size:13px;margin-bottom:10px}</style></head>
        <body><div class="card"><h2>🔐 Đăng Nhập</h2>${req.query.msg ? `<div class="notice">${req.query.msg}</div>` : ''}${req.query.err ? `<div class="error">${req.query.err}</div>` : ''}
        <form action="/auth-login" method="POST"><input type="text" name="username" placeholder="Tên đăng nhập" required><input type="password" name="password" placeholder="Mật khẩu" required><button type="submit">Đăng Nhập</button></form>
        <div style="display:flex;justify-content:space-between;margin-top:15px;font-size:13px;"><a href="/register">Đăng ký</a><a href="/forgot">Quên mật khẩu?</a></div></div>
        <script>sessionStorage.removeItem('cd60_tab_token'); sessionStorage.removeItem('cd60_tab_hidden_at');</script>
        </body></html>
    `);
});

app.post('/auth-login', async (req, res) => {
    const { username, password } = req.body;
    const user = await User.findOne({ username, password });
    if (!user) return res.redirect('/login?err=Sai+tên+đăng+nhập+hoặc+mật+khẩu!');
    const token = createSession(user.username, user.role || 'user');
    if (user.role === 'admin') {
        return res.redirect(`/admin?admin=${encodeURIComponent(user.username)}&token=${encodeURIComponent(token)}`);
    }
    return res.redirect(`/?user=${encodeURIComponent(user.username)}&token=${encodeURIComponent(token)}`);
});

app.get('/logout', (req, res) => {
    revokeSession(req.query.token);
    res.redirect('/login');
});

app.get('/register', (req, res) => {
    const questionsJson = JSON.stringify(SECURITY_QUESTIONS);
    res.send(`
        <!DOCTYPE html><html lang="vi"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>🌐 Chiến Dịch 60 Ngày - Đăng Ký</title>
        <link rel="icon" href="${FAVICON_URL}" type="image/jpeg">
        <style>
            body{font-family:Arial,sans-serif;background:#f4f6f9;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;padding:15px;box-sizing:border-box}
            .card{background:white;padding:24px;border-radius:12px;box-shadow:0 4px 15px rgba(0,0,0,0.1);width:100%;max-width:440px;box-sizing:border-box}
            h2{text-align:center;color:#2c3e50;margin-top:0;margin-bottom:16px}
            input,select{width:100%;padding:10px;margin:6px 0;border:1px solid #cbd5e0;border-radius:6px;box-sizing:border-box;font-size:14px;background:white}
            .hint{font-size:12px;color:#4a5568;background:#f8fafc;border-left:3px solid #2980b9;padding:6px 10px;border-radius:4px;margin:4px 0 10px 0;line-height:1.4}
            .q-box{background:#f8f9fa;border:1px solid #e2e8f0;border-radius:8px;padding:10px;margin-top:10px}
            .q-title{font-size:13px;font-weight:bold;color:#2d3748;margin-bottom:4px}
            button{width:100%;background:#27ae60;color:white;border:none;padding:12px;border-radius:6px;font-weight:bold;cursor:pointer;margin-top:14px;font-size:15px}
            .error{color:#e74c3c;text-align:center;font-size:13px;margin-bottom:10px;font-weight:bold}
        </style></head>
        <body><div class="card"><h2>📝 Đăng Ký</h2>${req.query.err ? `<div class="error">${decodeURIComponent(req.query.err)}</div>` : ''}
        <form id="regForm" action="/auth-register" method="POST">
            <input type="text" name="username" placeholder="Tên đăng nhập" required>
            <input type="password" id="regPassword" name="password" placeholder="Mật khẩu" required>
            <div class="hint">🔒 ${PASSWORD_RULE_TEXT}</div>

            <div class="q-box">
                <div class="q-title">Câu hỏi bảo mật 1</div>
                <select id="q1" name="q1" required onchange="refreshQuestionSelects()"></select>
                <input type="text" name="a1" placeholder="Câu trả lời cho câu hỏi 1" required>
            </div>

            <div class="q-box">
                <div class="q-title">Câu hỏi bảo mật 2</div>
                <select id="q2" name="q2" required onchange="refreshQuestionSelects()"></select>
                <input type="text" name="a2" placeholder="Câu trả lời cho câu hỏi 2" required>
            </div>

            <div class="q-box">
                <div class="q-title">Câu hỏi bảo mật 3</div>
                <select id="q3" name="q3" required onchange="refreshQuestionSelects()"></select>
                <input type="text" name="a3" placeholder="Câu trả lời cho câu hỏi 3" required>
            </div>

            <button type="submit">Đăng Ký</button>
        </form>
        <a href="/login" style="display:block;text-align:center;margin-top:15px;color:#2980b9;text-decoration:none;font-size:13px;">Đã có tài khoản? Đăng nhập</a></div>

        <script>
            const ALL_QUESTIONS = ${questionsJson};
            const selects = [document.getElementById('q1'), document.getElementById('q2'), document.getElementById('q3')];

            function initSelects() {
                selects.forEach((sel, idx) => {
                    sel.innerHTML = '<option value="">-- Chọn câu hỏi bảo mật ' + (idx + 1) + ' --</option>' +
                        ALL_QUESTIONS.map(q => '<option value="' + q.replace(/"/g, '&quot;') + '">' + q + '</option>').join('');
                });
                if (ALL_QUESTIONS.length >= 3) {
                    selects[0].value = ALL_QUESTIONS[0];
                    selects[1].value = ALL_QUESTIONS[1];
                    selects[2].value = ALL_QUESTIONS[2];
                }
                refreshQuestionSelects();
            }

            function refreshQuestionSelects() {
                const chosen = selects.map(s => s.value);
                selects.forEach((sel, idx) => {
                    const currentVal = sel.value;
                    Array.from(sel.options).forEach(opt => {
                        if (!opt.value) return;
                        const usedElsewhere = chosen.some((val, otherIdx) => otherIdx !== idx && val === opt.value);
                        opt.disabled = usedElsewhere && opt.value !== currentVal;
                    });
                });
            }

            document.getElementById('regForm').addEventListener('submit', function(e) {
                const pw = document.getElementById('regPassword').value;
                const strongRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[^A-Za-z\\d\\s]).{8,}$/;
                if (!strongRegex.test(pw)) {
                    e.preventDefault();
                    alert('${PASSWORD_RULE_TEXT}');
                    return;
                }
                const vals = selects.map(s => s.value).filter(Boolean);
                if (vals.length < 3 || new Set(vals).size < 3) {
                    e.preventDefault();
                    alert('Vui lòng chọn 3 câu hỏi bảo mật khác nhau!');
                }
            });

            initSelects();
        </script>
        </body></html>
    `);
});

app.post('/auth-register', async (req, res) => {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    const { q1, a1, q2, a2, q3, a3 } = req.body;

    if (!username || !password) {
        return res.redirect('/register?err=' + encodeURIComponent('Vui lòng nhập đầy đủ tên đăng nhập và mật khẩu!'));
    }

    if (!isStrongPassword(password)) {
        return res.redirect('/register?err=' + encodeURIComponent(PASSWORD_RULE_TEXT));
    }

    const chosenQuestions = [q1, q2, q3].map(q => String(q || '').trim());
    const chosenAnswers = [a1, a2, a3].map(a => String(a || '').trim());

    if (
        chosenQuestions.some(q => !SECURITY_QUESTIONS.includes(q)) ||
        new Set(chosenQuestions).size < 3 ||
        chosenAnswers.some(a => !a)
    ) {
        return res.redirect('/register?err=' + encodeURIComponent('Vui lòng chọn 3 câu hỏi bảo mật khác nhau và nhập đủ 3 câu trả lời!'));
    }

    try {
        const existing = await User.findOne({ username });
        if (existing) return res.redirect('/register?err=' + encodeURIComponent('Tên đăng nhập đã tồn tại!'));

        const secPayload = chosenQuestions.map((q, idx) => ({
            question: q,
            answer: normalizeAnswer(chosenAnswers[idx])
        }));

        await User.create({
            username,
            password,
            secret: '',
            securityQuestions: secPayload,
            role: 'user',
            history: []
        });
        res.redirect('/login?msg=' + encodeURIComponent('Đăng ký thành công! Hãy đăng nhập.'));
    } catch (e) {
        res.redirect('/register?err=' + encodeURIComponent('Lỗi đăng ký tài khoản!'));
    }
});

app.get('/forgot', (req, res) => {
    res.send(`
        <!DOCTYPE html><html lang="vi"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>🌐 Chiến Dịch 60 Ngày - Khôi Phục</title>
        <link rel="icon" href="${FAVICON_URL}" type="image/jpeg">
        <style>
            body{font-family:Arial,sans-serif;background:#f4f6f9;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;padding:15px;box-sizing:border-box}
            .card{background:white;padding:24px;border-radius:12px;box-shadow:0 4px 15px rgba(0,0,0,0.1);width:100%;max-width:440px;box-sizing:border-box}
            h2{text-align:center;color:#2c3e50;margin-top:0;margin-bottom:16px}
            input{width:100%;padding:10px;margin:6px 0;border:1px solid #cbd5e0;border-radius:6px;box-sizing:border-box;font-size:14px}
            .row-inline{display:flex;gap:8px;align-items:center}
            .btn-load{width:auto;background:#2980b9;color:white;border:none;padding:10px 12px;border-radius:6px;font-weight:bold;cursor:pointer;white-space:nowrap;margin:6px 0}
            .q-item{background:#f8f9fa;border:1px solid #e2e8f0;border-radius:8px;padding:10px;margin-top:10px}
            .q-label{font-size:13px;font-weight:bold;color:#2d3748;margin-bottom:4px;line-height:1.4}
            .hint{font-size:12px;color:#4a5568;background:#f8fafc;border-left:3px solid #e67e22;padding:6px 10px;border-radius:4px;margin:4px 0 10px 0;line-height:1.4}
            button[type="submit"]{width:100%;background:#e67e22;color:white;border:none;padding:12px;border-radius:6px;font-weight:bold;cursor:pointer;margin-top:12px;font-size:15px}
            .error{color:#e74c3c;text-align:center;font-size:13px;margin-bottom:10px;font-weight:bold}
        </style></head>
        <body><div class="card"><h2>🔑 Khôi Phục Mật Khẩu</h2>${req.query.err ? `<div class="error">${decodeURIComponent(req.query.err)}</div>` : ''}
        <form id="forgotForm" action="/auth-forgot" method="POST">
            <div class="row-inline">
                <input type="text" id="fgUsername" name="username" placeholder="Tên đăng nhập" required style="flex:1;margin:6px 0;">
                <button type="button" class="btn-load" onclick="loadSecurityQuestions()">Tải câu hỏi</button>
            </div>
            <div id="fgStatus" style="font-size:12px;color:#4a5568;margin-bottom:6px;"></div>

            <div id="questionsContainer">
                <div class="q-item">
                    <div class="q-label">Câu hỏi 1 (nhập tên đăng nhập và bấm "Tải câu hỏi")</div>
                    <input type="text" name="a1" placeholder="Câu trả lời 1" required>
                </div>
                <div class="q-item">
                    <div class="q-label">Câu hỏi 2</div>
                    <input type="text" name="a2" placeholder="Câu trả lời 2" required>
                </div>
                <div class="q-item">
                    <div class="q-label">Câu hỏi 3</div>
                    <input type="text" name="a3" placeholder="Câu trả lời 3" required>
                </div>
            </div>

            <input type="password" id="fgNewPass" name="newPassword" placeholder="Mật khẩu mới" required style="margin-top:12px;">
            <div class="hint">🔒 ${PASSWORD_RULE_TEXT}</div>
            <button type="submit">Đổi Mật Khẩu</button>
        </form>
        <a href="/login" style="display:block;text-align:center;margin-top:15px;color:#2980b9;text-decoration:none;font-size:13px;">Quay lại</a></div>

        <script>
            async function loadSecurityQuestions() {
                const uname = document.getElementById('fgUsername').value.trim();
                const statusEl = document.getElementById('fgStatus');
                const container = document.getElementById('questionsContainer');
                if (!uname) {
                    statusEl.innerHTML = '<span style="color:#c0392b;">Vui lòng nhập tên đăng nhập trước.</span>';
                    return;
                }
                statusEl.innerHTML = 'Đang tải 3 câu hỏi bảo mật...';
                try {
                    const res = await fetch('/api/security-questions?username=' + encodeURIComponent(uname));
                    const data = await res.json();
                    if (!res.ok || !data.questions) {
                        statusEl.innerHTML = '<span style="color:#c0392b;">' + (data.error || 'Không tải được câu hỏi.') + '</span>';
                        return;
                    }
                    statusEl.innerHTML = '<span style="color:#27ae60;">✅ Đã tải 3 câu hỏi của tài khoản <b>' + uname + '</b>.</span>';
                    container.innerHTML = data.questions.map((q, idx) => \`
                        <div class="q-item">
                            <div class="q-label">Câu \${idx + 1}: \${q}</div>
                            <input type="text" name="a\${idx + 1}" placeholder="Nhập câu trả lời \${idx + 1}" required>
                        </div>
                    \`).join('');
                } catch (e) {
                    statusEl.innerHTML = '<span style="color:#c0392b;">Lỗi kết nối máy chủ.</span>';
                }
            }

            document.getElementById('forgotForm').addEventListener('submit', function(e) {
                const pw = document.getElementById('fgNewPass').value;
                const strongRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[^A-Za-z\\d\\s]).{8,}$/;
                if (!strongRegex.test(pw)) {
                    e.preventDefault();
                    alert('${PASSWORD_RULE_TEXT}');
                }
            });
        </script>
        </body></html>
    `);
});

app.post('/auth-forgot', async (req, res) => {
    const username = String(req.body.username || '').trim();
    const newPassword = String(req.body.newPassword || '');
    const answers = [
        normalizeAnswer(req.body.a1),
        normalizeAnswer(req.body.a2),
        normalizeAnswer(req.body.a3)
    ];

    if (!isStrongPassword(newPassword)) {
        return res.redirect('/forgot?err=' + encodeURIComponent(PASSWORD_RULE_TEXT));
    }

    const user = await User.findOne({ username });
    if (!user || !user.securityQuestions || user.securityQuestions.length < 3) {
        return res.redirect('/forgot?err=' + encodeURIComponent('Tài khoản không tồn tại hoặc chưa cài đặt 3 câu hỏi bảo mật!'));
    }

    const isAllMatched =
        answers[0] &&
        answers[1] &&
        answers[2] &&
        normalizeAnswer(user.securityQuestions[0].answer) === answers[0] &&
        normalizeAnswer(user.securityQuestions[1].answer) === answers[1] &&
        normalizeAnswer(user.securityQuestions[2].answer) === answers[2];

    if (!isAllMatched) {
        return res.redirect('/forgot?err=' + encodeURIComponent('Câu trả lời cho 3 câu hỏi bảo mật chưa chính xác!'));
    }

    user.password = newPassword;
    await user.save();
    return res.redirect('/login?msg=' + encodeURIComponent('Đổi mật khẩu thành công!'));
});

// --- TRANG ADMIN QUẢN TRỊ TẤT CẢ TÀI KHOẢN & BÁO CÁO ---
app.get('/admin', async (req, res) => {
    const auth = await authorizeRequest(req, true);
    if (!auth) return res.redirect('/login?err=Phiên+đăng+nhập+hết+hạn+hoặc+không+có+quyền+Admin!');

    const adminName = auth.username;
    const token = auth.token;
    const allUsers = await User.find({}).sort({ username: 1 });
    const now = new Date();
    const defaultDateStr = now.toISOString().split('T')[0];

    const userOptions = allUsers
        .map(u => `<option value="${escapeHtmlAttr(u.username)}">${escapeHtmlAttr(u.username)} (${u.role === 'admin' ? 'Admin' : 'Thành viên'})</option>`)
        .join('');

    const serializedUsersJson = JSON.stringify(
        allUsers.map(u => ({
            username: u.username,
            role: u.role || 'user',
            score: (u.history || []).reduce((sum, item) => sum + (item.score || 0), 0),
            history: (u.history || []).map((item, idx) => ({
                index: idx,
                date: item.date,
                score: item.score || 0
            }))
        }))
    );

    let totalSystemScore = 0;
    let totalReportsCount = 0;
    allUsers.forEach(u => {
        const uHistory = u.history || [];
        totalSystemScore += uHistory.reduce((sum, item) => sum + (item.score || 0), 0);
        totalReportsCount += uHistory.length;
    });

    const statusBanner = req.query.msg
        ? `<div style="background:#e8f8f5;border:1px solid #a3e4d7;color:#1e8449;padding:10px 12px;border-radius:8px;margin-bottom:15px;font-size:13px;font-weight:bold;text-align:center;">${decodeURIComponent(req.query.msg)}</div>`
        : req.query.err
            ? `<div style="background:#fdedec;border:1px solid #f5b7b1;color:#c0392b;padding:10px 12px;border-radius:8px;margin-bottom:15px;font-size:13px;font-weight:bold;text-align:center;">${decodeURIComponent(req.query.err)}</div>`
            : '';

    res.send(`
        <!DOCTYPE html><html lang="vi"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>🌐 Chiến Dịch 60 Ngày - Bảng Điều Khiển Admin</title>
        <link rel="icon" href="${FAVICON_URL}" type="image/jpeg">
        <style>
            body{font-family:Arial,sans-serif;background:#f4f6f9;margin:0;padding:12px}
            .container{max-width:720px;margin:0 auto;background:white;padding:16px;border-radius:12px;box-shadow:0 4px 10px rgba(0,0,0,0.1);box-sizing:border-box}
            h2,h3{text-align:center;color:#2c3e50;margin-top:8px}
            .top-bar{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:14px;font-size:13px;background:#ecf0f1;padding:10px;border-radius:8px}
            .stats-box{background:#eaf2f8;border:1px solid #aed6f1;padding:12px;border-radius:8px;text-align:center;margin-bottom:16px;font-size:14px}
            .section-title{background:#2c3e50;color:white;padding:9px 12px;border-radius:6px;margin-top:22px;font-size:14px;font-weight:bold}
            .form-group{margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;gap:10px}
            label{font-size:14px;color:#333;flex:1.4}
            input[type="number"],input[type="date"],select{padding:7px 8px;border:1px solid #ccc;border-radius:6px;font-size:14px;flex:1;min-width:0;box-sizing:border-box;text-align:center;background:white}
            .submit-btn{width:100%;background:#27ae60;color:white;border:none;padding:12px;border-radius:6px;font-size:15px;font-weight:bold;margin-top:14px;cursor:pointer}

            .filter-card{background:#f8f9fa;border:1px solid #e2e8f0;border-radius:8px;padding:12px;margin-top:12px;box-sizing:border-box}
            .filter-grid{display:flex;gap:10px;flex-wrap:wrap}
            .filter-item{flex:1;min-width:200px;position:relative}
            .filter-item label{display:block;font-size:13px;font-weight:bold;margin-bottom:5px;color:#4a5568}
            .filter-input{width:100%;padding:8px 10px;border:1px solid #cbd5e0;border-radius:6px;font-size:14px;box-sizing:border-box;background:white}

            .search-dropdown{display:none;position:absolute;top:calc(100% + 2px);left:0;right:0;background:white;border:1px solid #90cdf4;border-radius:6px;box-shadow:0 8px 18px rgba(0,0,0,0.14);max-height:190px;overflow-y:auto;z-index:40}
            .search-dropdown-item{padding:8px 10px;font-size:13px;cursor:pointer;border-bottom:1px solid #f1f5f9;display:flex;justify-content:space-between;align-items:center}
            .search-dropdown-item:last-child{border-bottom:none}
            .search-dropdown-item:hover{background:#ebf8ff}

            .live-results-box{margin-top:12px;background:white;border:1px solid #dbe2ea;border-radius:8px;padding:10px;box-sizing:border-box}
            .live-user-chip{display:inline-block;padding:5px 10px;margin:3px 4px 3px 0;border-radius:999px;font-size:12px;background:#edf2f7;color:#2d3748;cursor:pointer;border:1px solid #cbd5e0}
            .live-user-chip.active{background:#2980b9;color:white;border-color:#2980b9;font-weight:bold}
            .btn-reset{background:#718096;color:white;border:none;padding:7px 12px;border-radius:6px;font-size:13px;cursor:pointer;font-weight:bold}

            .responsive-table{width:100%;border-collapse:collapse;font-size:13px}
            .responsive-table th,.responsive-table td{padding:8px 6px;border-bottom:1px solid #eee;text-align:center;vertical-align:middle}
            .responsive-table th{background:#f1f5f9;color:#2d3748;font-size:12px}
            .action-group{display:inline-flex;gap:5px;flex-wrap:wrap;justify-content:center}
            .btn-edit{background:#f39c12;color:white;padding:4px 9px;text-decoration:none;border-radius:4px;font-size:12px;font-weight:bold;white-space:nowrap;display:inline-block}
            .btn-del{background:#e74c3c;color:white;padding:4px 9px;text-decoration:none;border-radius:4px;font-size:12px;font-weight:bold;white-space:nowrap;display:inline-block}

            .acc-row-card{border:1px solid #dce4ec;border-radius:10px;padding:12px;margin-top:10px;background:#fafbfd;box-sizing:border-box}
            .acc-header{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px}
            .acc-meta{font-size:13px;font-weight:bold;color:#2980b9;white-space:nowrap}
            .acc-tools{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;background:#f1f5f9;padding:8px;border-radius:7px;margin-top:8px}
            .pw-form{display:flex;align-items:center;gap:6px;flex:1;min-width:200px;margin:0}
            .pw-input{padding:6px 8px;border:1px solid #cbd5e0;border-radius:5px;font-size:12px;flex:1;min-width:95px;box-sizing:border-box;background:white}
            .btn-pw{background:#2980b9;color:white;border:none;padding:6px 10px;border-radius:5px;font-size:12px;font-weight:bold;cursor:pointer;white-space:nowrap}
            .btn-del-acc{background:#c0392b;color:white;padding:6px 10px;text-decoration:none;border-radius:5px;font-size:12px;font-weight:bold;white-space:nowrap;display:inline-block}
            .btn-toggle-rep{background:#34495e;color:white;border:none;padding:5px 10px;border-radius:5px;font-size:12px;font-weight:bold;cursor:pointer;white-space:nowrap}
            .acc-reports-panel{display:none;margin-top:10px;background:white;border:1px solid #e2e8f0;border-radius:8px;padding:8px;overflow-x:auto}
            .acc-reports-panel.open{display:block}

            @media (max-width: 480px) {
                .container{padding:12px}
                .form-group{flex-direction:column;align-items:stretch;gap:4px}
                input[type="number"],input[type="date"],select{width:100%;flex:none}
                .responsive-table{font-size:12px}
                .responsive-table th,.responsive-table td{padding:7px 4px}
                .btn-edit,.btn-del{padding:4px 7px;font-size:11px}
            }
        </style></head>
        <body>
            <div class="container">
                <div class="top-bar">
                    <span>🛡️ Admin: <b>${adminName}</b></span>
                    <div>
                        <a href="/?user=${encodeURIComponent(adminName)}&token=${encodeURIComponent(token)}" style="color:#2980b9;text-decoration:none;font-weight:bold;margin-right:12px;">Trang Cá Nhân</a>
                        <a href="/logout?token=${encodeURIComponent(token)}" style="color:#c0392b;text-decoration:none;font-weight:bold;">Đăng xuất</a>
                    </div>
                </div>
                <h2>🛠️ Quản Trị Toàn Hệ Thống</h2>
                ${statusBanner}
                <div class="stats-box">
                    👥 Tài khoản: <b id="adm-total-users">${allUsers.length}</b> | 📋 Tổng báo cáo: <b id="adm-total-reports">${totalReportsCount}</b><br>
                    🏆 Tổng điểm toàn hệ thống: <b id="adm-total-score" style="color:#27ae60;font-size:18px;">${totalSystemScore} điểm</b>
                </div>

                <div class="filter-card">
                    <div style="font-size:14px;font-weight:bold;color:#2d3748;margin-bottom:8px;">🔍 BỘ LỌC VÀ TÌM KIẾM BÁO CÁO</div>
                    <div class="filter-grid">
                        <div class="filter-item" id="searchDropdownBox">
                            <label>🔎 Tìm tên tài khoản (bấm để xổ danh sách):</label>
                            <input type="text" id="searchUser" class="filter-input" placeholder="Gõ hoặc chọn tài khoản..." autocomplete="off" onfocus="showUserDropdown()">
                            <div id="userDropdownMenu" class="search-dropdown"></div>
                        </div>
                        <div class="filter-item">
                            <label>📅 Lọc theo ngày báo cáo (để trống = mọi ngày):</label>
                            <input type="date" id="filterDate" class="filter-input">
                        </div>
                    </div>
                    <div style="display:flex;align-items:center;flex-wrap:wrap;gap:10px;margin-top:10px;">
                        <button type="button" class="btn-reset" onclick="resetFilters()">🔄 Xóa bộ lọc</button>
                        <span id="filterStats" style="font-size:13px;color:#4a5568;font-style:italic;"></span>
                    </div>

                    <div class="live-results-box">
                        <div style="font-size:12px;font-weight:bold;color:#4a5568;margin-bottom:6px;">📋 TÀI KHOẢN & KẾT QUẢ LỌC NGAY BÊN DƯỚI:</div>
                        <div id="liveUserChips" style="margin-bottom:8px;"></div>
                        <div id="liveFilteredTable" style="overflow-x:auto;"></div>
                    </div>
                </div>

                <form action="/admin-add?admin=${encodeURIComponent(adminName)}&token=${encodeURIComponent(token)}" method="POST">
                    <div class="section-title">➕ ADMIN THÊM BÁO CÁO CHO TÀI KHOẢN</div>
                    <div class="form-group" style="margin-top:10px;"><label>Chọn tài khoản:</label><select name="targetUser" required>${userOptions}</select></div>
                    <div class="form-group"><label>Ngày báo cáo:</label><input type="date" name="reportDate" value="${defaultDateStr}" required></div>

                    <div class="section-title">🌟 MY PAGE (0 hoặc 1)</div>
                    <div class="form-group"><label>Đánh Giá Tín Ngưỡng:</label><input type="number" name="tinNguong" value="1" min="0" max="1" required></div>
                    <div class="form-group"><label>Kinh thánh:</label><input type="number" name="kinhThanh" value="1" min="0" max="1" required></div>
                    <div class="form-group"><label>Sách LT:</label><input type="number" name="sachLT" value="1" min="0" max="1" required></div>
                    <div class="form-group"><label>Tập Gđ:</label><input type="number" name="tapGd" value="1" min="0" max="1" required></div>

                    <div class="section-title">🎊 PHÁT BIỂU & EDU</div>
                    <div class="form-group"><label>Bài mới:</label><input type="number" name="baiMoi" value="0" min="0" required></div>
                    <div class="form-group"><label>Bài cũ:</label><input type="number" name="baiCu" value="0" min="0" required></div>
                    <div class="form-group"><label>EDU:</label><input type="number" name="edu" value="0" min="0" required></div>

                    <div class="section-title">🔥 TRUDA</div>
                    <div class="form-group"><label>Đơn Thuần:</label><input type="number" name="donThuan" value="0" min="0" required></div>
                    <div class="form-group"><label>Hữu Hiệu:</label><input type="number" name="huuHieu" value="0" min="0" required></div>
                    <div class="form-group"><label>Kết trái:</label><input type="number" name="ketTrai" value="0" min="0" required></div>

                    <button type="submit" class="submit-btn">💾 Lưu Báo Cáo Cho Tài Khoản</button>
                </form>

                <div class="section-title" style="margin-top:28px;">📊 Danh Sách Tài Khoản (Bấm mở báo cáo khi cần)</div>
                <div id="usersListContainer"></div>
            </div>

            ${buildTabGuardScript(token, AWAY_TIMEOUT_MS)}
            <script>
                const ADMIN_NAME = ${JSON.stringify(adminName)};
                const SESSION_TOKEN = ${JSON.stringify(token)};
                let ALL_USERS_DATA = ${serializedUsersJson};
                const expandedUsers = new Set();

                const searchUserInput = document.getElementById('searchUser');
                const filterDateInput = document.getElementById('filterDate');
                const filterStats = document.getElementById('filterStats');
                const userDropdownMenu = document.getElementById('userDropdownMenu');
                const liveUserChips = document.getElementById('liveUserChips');
                const liveFilteredTable = document.getElementById('liveFilteredTable');
                const usersListContainer = document.getElementById('usersListContainer');

                function renderUserDropdownMenu() {
                    const kw = searchUserInput.value.trim().toLowerCase();
                    const list = ALL_USERS_DATA.filter(u => !kw || u.username.toLowerCase().includes(kw));

                    let html = \`<div class="search-dropdown-item" onclick="pickUserFromDropdown('')"><span>✨ Tất cả tài khoản</span><span style="color:#718096;font-size:11px;">\${ALL_USERS_DATA.length}</span></div>\`;
                    if (!list.length) {
                        html += '<div style="padding:8px 10px;font-size:12px;color:#888;">Không tìm thấy tài khoản</div>';
                    } else {
                        html += list.map(u => \`
                            <div class="search-dropdown-item" onclick="pickUserFromDropdown('\${u.username}')">
                                <span>👤 <b>\${u.username}</b> \${u.role === 'admin' ? '<span style=\"background:#8e44ad;color:white;padding:1px 5px;border-radius:3px;font-size:10px;\">ADMIN</span>' : ''}</span>
                                <span style="color:#2980b9;font-size:12px;font-weight:bold;">\${u.score} đ (\${u.history.length})</span>
                            </div>
                        \`).join('');
                    }
                    userDropdownMenu.innerHTML = html;
                }

                function showUserDropdown() {
                    renderUserDropdownMenu();
                    userDropdownMenu.style.display = 'block';
                }

                function pickUserFromDropdown(uname) {
                    searchUserInput.value = uname;
                    userDropdownMenu.style.display = 'none';
                    renderLiveFilterSection();
                }

                document.addEventListener('click', (e) => {
                    const box = document.getElementById('searchDropdownBox');
                    if (box && !box.contains(e.target)) {
                        userDropdownMenu.style.display = 'none';
                    }
                });

                function pickChipUser(uname) {
                    if (searchUserInput.value.trim().toLowerCase() === uname.toLowerCase()) {
                        searchUserInput.value = '';
                    } else {
                        searchUserInput.value = uname;
                    }
                    renderLiveFilterSection();
                }

                function renderLiveFilterSection() {
                    const kw = searchUserInput.value.trim().toLowerCase();
                    const rawDate = filterDateInput.value;
                    const targetDateStr = rawDate ? rawDate.split('-').reverse().join('/') : '';

                    const matchingUsers = ALL_USERS_DATA.filter(u => !kw || u.username.toLowerCase().includes(kw));

                    liveUserChips.innerHTML = matchingUsers.length
                        ? matchingUsers.map(u => {
                            const isActive = kw && u.username.toLowerCase() === kw;
                            return \`<span class="live-user-chip \${isActive ? 'active' : ''}" onclick="pickChipUser('\${u.username}')">👤 \${u.username} (\${u.history.length})</span>\`;
                        }).join('')
                        : '<span style="font-size:12px;color:#888;">Không có tài khoản khớp từ khóa.</span>';

                    let matchedRows = [];
                    matchingUsers.forEach(u => {
                        u.history.forEach(item => {
                            if (!targetDateStr || item.date === targetDateStr) {
                                matchedRows.push({
                                    username: u.username,
                                    index: item.index,
                                    date: item.date,
                                    score: item.score
                                });
                            }
                        });
                    });

                    filterStats.innerText = \`Khớp \${matchingUsers.length} tài khoản • \${matchedRows.length} báo cáo\`;

                    if (!matchedRows.length) {
                        liveFilteredTable.innerHTML = '<div style="font-size:13px;color:#777;text-align:center;padding:8px;">Không có báo cáo nào khớp với bộ lọc hiện tại.</div>';
                        return;
                    }

                    const rowsHtml = matchedRows.map(r => \`
                        <tr>
                            <td style="font-weight:bold;">\${r.username}</td>
                            <td>\${r.date}</td>
                            <td style="font-weight:bold;color:#27ae60;white-space:nowrap;">+\${r.score} đ</td>
                            <td>
                                <div class="action-group">
                                    <a href="/admin-edit?admin=\${encodeURIComponent(ADMIN_NAME)}&token=\${encodeURIComponent(SESSION_TOKEN)}&target=\${encodeURIComponent(r.username)}&index=\${r.index}" class="btn-edit">Sửa</a>
                                    <a href="/admin-delete?admin=\${encodeURIComponent(ADMIN_NAME)}&token=\${encodeURIComponent(SESSION_TOKEN)}&target=\${encodeURIComponent(r.username)}&index=\${r.index}" onclick="return confirm('Xóa báo cáo ngày \${r.date} của \${r.username}?');" class="btn-del">Xóa</a>
                                </div>
                            </td>
                        </tr>
                    \`).join('');

                    liveFilteredTable.innerHTML = \`
                        <table class="responsive-table">
                            <thead><tr><th>Tài khoản</th><th>Ngày</th><th>Điểm</th><th>Thao tác</th></tr></thead>
                            <tbody>\${rowsHtml}</tbody>
                        </table>
                    \`;
                }

                function toggleUserReportsPanel(uname) {
                    if (expandedUsers.has(uname)) {
                        expandedUsers.delete(uname);
                    } else {
                        expandedUsers.add(uname);
                    }
                    renderAccountsCompactList();
                }

                function renderAccountsCompactList() {
                    if (!ALL_USERS_DATA.length) {
                        usersListContainer.innerHTML = '<div style="text-align:center;padding:14px;color:#777;">Chưa có tài khoản nào.</div>';
                        return;
                    }

                    usersListContainer.innerHTML = ALL_USERS_DATA.map(u => {
                        const isOpen = expandedUsers.has(u.username);
                        const delAccHtml = u.username === ADMIN_NAME
                            ? '<span style="font-size:11px;color:#888;background:#e2e8f0;padding:5px 8px;border-radius:4px;">Tài khoản hiện tại</span>'
                            : \`<a href="/admin-delete-user?admin=\${encodeURIComponent(ADMIN_NAME)}&token=\${encodeURIComponent(SESSION_TOKEN)}&target=\${encodeURIComponent(u.username)}" onclick="return confirm('XÓA VĨNH VIỄN tài khoản \${u.username} và toàn bộ báo cáo của tài khoản này?');" class="btn-del-acc">🗑️ Xóa TK</a>\`;

                        const reportRowsHtml = u.history.length
                            ? u.history.map(item => \`
                                <tr>
                                    <td>\${item.date}</td>
                                    <td style="font-weight:bold;color:#27ae60;white-space:nowrap;">+\${item.score} đ</td>
                                    <td>
                                        <div class="action-group">
                                            <a href="/admin-edit?admin=\${encodeURIComponent(ADMIN_NAME)}&token=\${encodeURIComponent(SESSION_TOKEN)}&target=\${encodeURIComponent(u.username)}&index=\${item.index}" class="btn-edit">Sửa</a>
                                            <a href="/admin-delete?admin=\${encodeURIComponent(ADMIN_NAME)}&token=\${encodeURIComponent(SESSION_TOKEN)}&target=\${encodeURIComponent(u.username)}&index=\${item.index}" onclick="return confirm('Xóa báo cáo ngày \${item.date} của \${u.username}?');" class="btn-del">Xóa</a>
                                        </div>
                                    </td>
                                </tr>
                            \`).join('')
                            : '<tr><td colspan="3" style="text-align:center;padding:10px;color:#777;">Chưa có báo cáo</td></tr>';

                        return \`
                            <div class="acc-row-card">
                                <div class="acc-header">
                                    <div>
                                        👤 <b>\${u.username}</b>
                                        \${u.role === 'admin' ? '<span style="background:#8e44ad;color:white;padding:1px 6px;border-radius:4px;font-size:10px;margin-left:4px;">ADMIN</span>' : ''}
                                    </div>
                                    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                                        <span class="acc-meta">\${u.score} đ (\${u.history.length} ngày)</span>
                                        <button type="button" class="btn-toggle-rep" onclick="toggleUserReportsPanel('\${u.username}')">\${isOpen ? '🔼 Ẩn BC' : '🔽 Báo cáo'}</button>
                                    </div>
                                </div>

                                <div class="acc-tools">
                                    <form action="/admin-change-password?admin=\${encodeURIComponent(ADMIN_NAME)}&token=\${encodeURIComponent(SESSION_TOKEN)}" method="POST" class="pw-form">
                                        <input type="hidden" name="targetUser" value="\${u.username}">
                                        <input type="text" name="newPassword" placeholder="MK mạnh mới..." required class="pw-input">
                                        <button type="submit" class="btn-pw">🔑 Đổi MK</button>
                                    </form>
                                    <div>\${delAccHtml}</div>
                                </div>

                                <div class="acc-reports-panel \${isOpen ? 'open' : ''}">
                                    <table class="responsive-table">
                                        <thead><tr><th>Ngày</th><th>Điểm</th><th>Thao tác</th></tr></thead>
                                        <tbody>\${reportRowsHtml}</tbody>
                                    </table>
                                </div>
                            </div>
                        \`;
                    }).join('');
                }

                function resetFilters() {
                    searchUserInput.value = '';
                    filterDateInput.value = '';
                    userDropdownMenu.style.display = 'none';
                    renderLiveFilterSection();
                }

                window.syncNow = async function() {
                    if (document.hidden) return;
                    try {
                        const res = await fetch(\`/api/admin-data?admin=\${encodeURIComponent(ADMIN_NAME)}&token=\${encodeURIComponent(SESSION_TOKEN)}\`);
                        if (res.status === 401) {
                            window.location.replace('/login?err=' + encodeURIComponent('Phiên đăng nhập đã hết hạn!'));
                            return;
                        }
                        const data = await res.json();
                        if (!data || data.error) return;
                        document.getElementById('adm-total-users').innerText = data.totalUsers;
                        document.getElementById('adm-total-reports').innerText = data.totalReportsCount;
                        document.getElementById('adm-total-score').innerText = data.totalSystemScore + ' điểm';
                        ALL_USERS_DATA = data.users;
                        renderLiveFilterSection();
                        renderAccountsCompactList();
                    } catch (e) {}
                };

                searchUserInput.addEventListener('input', () => {
                    renderUserDropdownMenu();
                    userDropdownMenu.style.display = 'block';
                    renderLiveFilterSection();
                });
                filterDateInput.addEventListener('change', renderLiveFilterSection);
                renderLiveFilterSection();
                renderAccountsCompactList();
                setInterval(window.syncNow, 2500);
            </script>
        </body></html>
    `);
});

app.post('/admin-change-password', async (req, res) => {
    const auth = await authorizeRequest(req, true);
    if (!auth) return res.redirect('/login?err=Phiên+đăng+nhập+hết+hạn+hoặc+không+có+quyền+Admin!');

    const adminName = auth.username;
    const token = auth.token;
    const { targetUser, newPassword } = req.body;
    const cleanPass = String(newPassword || '').trim();

    if (!targetUser || !cleanPass) {
        return res.redirect(`/admin?admin=${encodeURIComponent(adminName)}&token=${encodeURIComponent(token)}&err=${encodeURIComponent('Mật khẩu mới không được để trống!')}`);
    }

    if (!isStrongPassword(cleanPass)) {
        return res.redirect(`/admin?admin=${encodeURIComponent(adminName)}&token=${encodeURIComponent(token)}&err=${encodeURIComponent(PASSWORD_RULE_TEXT)}`);
    }

    const targetDoc = await User.findOne({ username: targetUser });
    if (!targetDoc) {
        return res.redirect(`/admin?admin=${encodeURIComponent(adminName)}&token=${encodeURIComponent(token)}&err=${encodeURIComponent('Không tìm thấy tài khoản!')}`);
    }

    targetDoc.password = cleanPass;
    await targetDoc.save();
    await sendToSignal(`🛡️ **[ADMIN: ${adminName}] ĐÃ ĐỔI MẬT KHẨU CHO TÀI KHOẢN [${targetUser}]**`);

    res.redirect(`/admin?admin=${encodeURIComponent(adminName)}&token=${encodeURIComponent(token)}&msg=${encodeURIComponent(`✅ Đã đổi mật khẩu cho tài khoản ${targetUser}!`)}`);
});

app.get('/admin-delete-user', async (req, res) => {
    const auth = await authorizeRequest(req, true);
    if (!auth) return res.redirect('/login?err=Phiên+đăng+nhập+hết+hạn+hoặc+không+có+quyền+Admin!');

    const adminName = auth.username;
    const token = auth.token;
    const targetUser = req.query.target;

    if (!targetUser || targetUser === adminName) {
        return res.redirect(`/admin?admin=${encodeURIComponent(adminName)}&token=${encodeURIComponent(token)}&err=${encodeURIComponent('Không thể xóa tài khoản Admin đang đăng nhập!')}`);
    }

    const deleted = await User.findOneAndDelete({ username: targetUser });
    if (deleted) {
        await sendToSignal(`🛡️ **[ADMIN: ${adminName}] ĐÃ XÓA TÀI KHOẢN [${targetUser}]**`);
        return res.redirect(`/admin?admin=${encodeURIComponent(adminName)}&token=${encodeURIComponent(token)}&msg=${encodeURIComponent(`🗑️ Đã xóa tài khoản ${targetUser}!`)}`);
    }

    res.redirect(`/admin?admin=${encodeURIComponent(adminName)}&token=${encodeURIComponent(token)}`);
});

app.post('/admin-add', async (req, res) => {
    const auth = await authorizeRequest(req, true);
    if (!auth) return res.redirect('/login?err=Phiên+đăng+nhập+hết+hạn+hoặc+không+có+quyền+Admin!');

    const adminName = auth.username;
    const token = auth.token;
    const targetUser = req.body.targetUser;
    const rawDate = req.body.reportDate;
    const dateStr = rawDate ? rawDate.split('-').reverse().join('/') : new Date().toLocaleDateString('vi-VN');
    const result = await calculateScoreAndContent(targetUser, dateStr, req.body);

    if (result) {
        await sendToSignal(`🛡️ **[ADMIN: ${adminName}] THÊM BÁO CÁO CHO [${targetUser}] - ${dateStr}**\n\n` + result.reportContent);
        setTimeout(async () => { await sendToSignal(result.summaryContent); }, 1000);
    }

    res.redirect(`/admin?admin=${encodeURIComponent(adminName)}&token=${encodeURIComponent(token)}`);
});

app.get('/admin-edit', async (req, res) => {
    const auth = await authorizeRequest(req, true);
    if (!auth) return res.redirect('/login?err=Phiên+đăng+nhập+hết+hạn+hoặc+không+có+quyền+Admin!');

    const adminName = auth.username;
    const token = auth.token;
    const targetUser = req.query.target;
    const index = parseInt(req.query.index);

    const user = await User.findOne({ username: targetUser });
    if (!user || isNaN(index) || index < 0 || index >= user.history.length) {
        return res.redirect(`/admin?admin=${encodeURIComponent(adminName)}&token=${encodeURIComponent(token)}`);
    }

    const item = user.history[index];
    const d = item.details || {};

    res.send(`
        <!DOCTYPE html><html lang="vi"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>🌐 Chiến Dịch 60 Ngày - Admin Sửa ${targetUser}</title>
        <link rel="icon" href="${FAVICON_URL}" type="image/jpeg">
        <style>
            body{font-family:Arial,sans-serif;background:#f4f6f9;margin:0;padding:15px}
            .container{max-width:550px;margin:0 auto;background:white;padding:20px;border-radius:12px;box-shadow:0 4px 10px rgba(0,0,0,0.1)}
            h3{text-align:center;color:#2c3e50}
            .section-title{background:#34495e;color:white;padding:8px 12px;border-radius:6px;margin-top:20px;font-size:15px}
            .form-group{margin-bottom:10px;display:flex;justify-content:space-between;align-items:center}
            label{font-size:14px;color:#333;flex:2}
            input[type="number"]{width:70px;padding:6px;border:1px solid #ccc;border-radius:6px;font-size:14px;flex:1;text-align:center}
            button{width:100%;background:#27ae60;color:white;border:none;padding:12px;border-radius:6px;font-size:16px;font-weight:bold;margin-top:20px;cursor:pointer}
            .back-link{display:block;text-align:center;margin-top:15px;color:#2980b9;text-decoration:none;font-size:14px;font-weight:bold}
        </style></head>
        <body>
            <div class="container">
                <h3>🛡️ Admin Sửa Ngày ${item.date} của [${targetUser}]</h3>
                <form action="/admin-update?admin=${encodeURIComponent(adminName)}&token=${encodeURIComponent(token)}" method="POST">
                    <input type="hidden" name="target" value="${targetUser}">
                    <input type="hidden" name="date" value="${item.date}">

                    <div class="section-title">🌟 MY PAGE (0 hoặc 1)</div>
                    <div class="form-group"><label>Đánh Giá Tín Ngưỡng:</label><input type="number" name="tinNguong" value="${d.tinNguong ?? 1}" min="0" max="1" required></div>
                    <div class="form-group"><label>Kinh thánh:</label><input type="number" name="kinhThanh" value="${d.kinhThanh ?? 1}" min="0" max="1" required></div>
                    <div class="form-group"><label>Sách LT:</label><input type="number" name="sachLT" value="${d.sachLT ?? 1}" min="0" max="1" required></div>
                    <div class="form-group"><label>Tập Gđ:</label><input type="number" name="tapGd" value="${d.tapGd ?? 1}" min="0" max="1" required></div>

                    <div class="section-title">🎊 PHÁT BIỂU & EDU</div>
                    <div class="form-group"><label>Bài mới:</label><input type="number" name="baiMoi" value="${d.baiMoi || 0}" min="0" required></div>
                    <div class="form-group"><label>Bài cũ:</label><input type="number" name="baiCu" value="${d.baiCu || 0}" min="0" required></div>
                    <div class="form-group"><label>EDU:</label><input type="number" name="edu" value="${d.edu || 0}" min="0" required></div>

                    <div class="section-title">🔥 TRUDA</div>
                    <div class="form-group"><label>Đơn Thuần:</label><input type="number" name="donThuan" value="${d.donThuan || 0}" min="0" required></div>
                    <div class="form-group"><label>Hữu Hiệu:</label><input type="number" name="huuHieu" value="${d.huuHieu || 0}" min="0" required></div>
                    <div class="form-group"><label>Kết trái:</label><input type="number" name="ketTrai" value="${d.ketTrai || 0}" min="0" required></div>

                    <button type="submit">💾 Lưu Thay Đổi</button>
                </form>
                <a href="/admin?admin=${encodeURIComponent(adminName)}&token=${encodeURIComponent(token)}" class="back-link">⬅️ Quay lại trang Admin</a>
            </div>
            ${buildTabGuardScript(token, AWAY_TIMEOUT_MS)}
        </body></html>
    `);
});

app.post('/admin-update', async (req, res) => {
    const auth = await authorizeRequest(req, true);
    if (!auth) return res.redirect('/login?err=Phiên+đăng+nhập+hết+hạn+hoặc+không+có+quyền+Admin!');

    const adminName = auth.username;
    const token = auth.token;
    const { target: targetUser, date: dateStr } = req.body;
    const result = await calculateScoreAndContent(targetUser, dateStr, req.body);
    if (result) {
        await sendToSignal(`🛡️ **[ADMIN: ${adminName}] CẬP NHẬT CHO [${targetUser}] - NGÀY ${dateStr}**\n\n` + result.reportContent);
        setTimeout(async () => { await sendToSignal(result.summaryContent); }, 1000);
    }

    res.redirect(`/admin?admin=${encodeURIComponent(adminName)}&token=${encodeURIComponent(token)}`);
});

app.get('/admin-delete', async (req, res) => {
    const auth = await authorizeRequest(req, true);
    if (!auth) return res.redirect('/login?err=Phiên+đăng+nhập+hết+hạn+hoặc+không+có+quyền+Admin!');

    const adminName = auth.username;
    const token = auth.token;
    const targetUser = req.query.target;
    const index = parseInt(req.query.index);

    const user = await User.findOne({ username: targetUser });
    if (user && !isNaN(index) && index >= 0 && index < user.history.length) {
        const deletedDay = user.history.splice(index, 1)[0];
        await user.save();
        const cumulativeScore = user.history.reduce((sum, item) => sum + (item.score || 0), 0);
        await sendToSignal(`🛡️ **[ADMIN: ${adminName}] XÓA BÁO CÁO CỦA [${targetUser}]**\nĐã xóa ngày: ${deletedDay.date}\n🏆 Tổng điểm [${targetUser}]: **${cumulativeScore} điểm**`);
    }

    res.redirect(`/admin?admin=${encodeURIComponent(adminName)}&token=${encodeURIComponent(token)}`);
});

// --- TRANG DASHBOARD CÁ NHÂN ---
app.get('/', async (req, res) => {
    const auth = await authorizeRequest(req, false);
    if (!auth) return res.redirect('/login?err=Vui+lòng+đăng+nhập+hoặc+phiên+đã+hết+hạn!');

    const username = auth.username;
    const token = auth.token;
    const user = auth.dbUser;

    const history = user.history || [];
    const cumulativeScore = history.reduce((sum, item) => sum + (item.score || 0), 0);
    const now = new Date();
    const defaultDateStr = now.toISOString().split('T')[0];
    let historyRows = history.map((item, index) => `
        <tr><td style="padding:8px;border-bottom:1px solid #ddd;text-align:center;">${item.date}</td>
        <td style="padding:8px;border-bottom:1px solid #ddd;text-align:center;font-weight:bold;color:#27ae60;white-space:nowrap;">+${item.score} đ</td>
        <td style="padding:8px;border-bottom:1px solid #ddd;text-align:center;">
        <div style="display:inline-flex;gap:5px;flex-wrap:wrap;justify-content:center;">
        <a href="/edit?user=${encodeURIComponent(username)}&token=${encodeURIComponent(token)}&index=${index}" style="background:#f39c12;color:white;padding:4px 8px;text-decoration:none;border-radius:4px;font-size:12px;font-weight:bold;white-space:nowrap;">Sửa</a>
        <a href="/delete?user=${encodeURIComponent(username)}&token=${encodeURIComponent(token)}&index=${index}" onclick="return confirm('Xóa ngày này?');" style="background:#e74c3c;color:white;padding:4px 8px;text-decoration:none;border-radius:4px;font-size:12px;font-weight:bold;white-space:nowrap;">Xóa</a>
        </div></td></tr>
    `).join('');

    const adminLink = user.role === 'admin'
        ? `<a href="/admin?admin=${encodeURIComponent(username)}&token=${encodeURIComponent(token)}" style="color:#8e44ad;text-decoration:none;font-weight:bold;margin-right:12px;">🛡️ Trang Admin</a>`
        : '';

    res.send(`
        <!DOCTYPE html><html lang="vi"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>🌐 Chiến Dịch 60 Ngày - ${username}</title>
        <link rel="icon" href="${FAVICON_URL}" type="image/jpeg">
        <style>body{font-family:Arial;background:#f4f6f9;margin:0;padding:12px}.container{max-width:550px;margin:0 auto;background:white;padding:16px;border-radius:12px;box-shadow:0 4px 10px rgba(0,0,0,0.1);box-sizing:border-box}h2,h3{text-align:center;color:#2c3e50}.top-bar{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:15px;font-size:14px;background:#ecf0f1;padding:10px;border-radius:8px}.section-title{background:#34495e;color:white;padding:8px 12px;border-radius:6px;margin-top:20px;font-size:15px}.form-group{margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;gap:10px}label{font-size:14px;color:#333;flex:1.5}input[type="number"],input[type="date"]{padding:7px;text-align:center;border:1px solid #ccc;border-radius:6px;font-size:14px;flex:1;min-width:0;box-sizing:border-box}button{width:100%;background:#27ae60;color:white;border:none;padding:12px;border-radius:6px;font-size:16px;font-weight:bold;margin-top:20px;cursor:pointer}.stats-box{background:#e8f8f5;border:1px solid #a3e4d7;padding:12px;border-radius:8px;text-align:center;margin-bottom:20px}table{width:100%;border-collapse:collapse;margin-top:10px;font-size:14px}th{background:#ecf0f1;padding:8px}@media(max-width:480px){.form-group{flex-direction:column;align-items:stretch;gap:4px}input[type="number"],input[type="date"]{width:100%;flex:none}table{font-size:12px}}</style></head>
        <body><div class="container"><div class="top-bar"><span>Xin chào, <b>${username}</b></span><div>${adminLink}<a href="/logout?token=${encodeURIComponent(token)}" style="color:#c0392b;text-decoration:none;font-weight:bold;">Đăng xuất</a></div></div>
        <h2>🚀 Quản Lý Chiến Dịch</h2><div class="stats-box">🏆 Tổng điểm tích lũy: <b id="total-score" style="color:#27ae60;font-size:18px;">${cumulativeScore} điểm</b></div>
        <form action="/submit-report?user=${encodeURIComponent(username)}&token=${encodeURIComponent(token)}" method="POST">
        <div class="section-title">📅 CHỌN NGÀY BÁO CÁO</div><div class="form-group" style="margin-top:10px;"><label>Ngày báo cáo:</label><input type="date" name="reportDate" value="${defaultDateStr}" required></div>
        <div class="section-title">🌟 MY PAGE (0 hoặc 1)</div>
        <div class="form-group"><label>Đánh Giá Tín Ngưỡng:</label><input type="number" name="tinNguong" value="1" min="0" max="1" required></div>
        <div class="form-group"><label>Kinh thánh:</label><input type="number" name="kinhThanh" value="1" min="0" max="1" required></div>
        <div class="form-group"><label>Sách LT:</label><input type="number" name="sachLT" value="1" min="0" max="1" required></div>
        <div class="form-group"><label>Tập Gđ:</label><input type="number" name="tapGd" value="1" min="0" max="1" required></div>
        <div class="section-title">🎊 PHÁT BIỂU & EDU</div>
        <div class="form-group"><label>Bài mới:</label><input type="number" name="baiMoi" value="0" min="0" required></div>
        <div class="form-group"><label>Bài cũ:</label><input type="number" name="baiCu" value="0" min="0" required></div>
        <div class="form-group"><label>EDU:</label><input type="number" name="edu" value="0" min="0" required></div>
        <div class="section-title">🔥 TRUDA</div>
        <div class="form-group"><label>Đơn Thuần:</label><input type="number" name="donThuan" value="0" min="0" required></div>
        <div class="form-group"><label>Hữu Hiệu:</label><input type="number" name="huuHieu" value="0" min="0" required></div>
        <div class="form-group"><label>Kết trái:</label><input type="number" name="ketTrai" value="0" min="0" required></div>
        <button type="submit">📤 Gửi Báo Cáo</button></form>
        <div class="section-title" style="margin-top:30px;">📋 Lịch Sử Báo Cáo</div>
        <div style="overflow-x:auto;"><table><thead><tr><th>Ngày</th><th>Điểm</th><th>Thao Tác</th></tr></thead><tbody id="history-rows">${historyRows.length ? historyRows : '<tr><td colspan="3" style="text-align:center;padding:10px;">Chưa có dữ liệu</td></tr>'}</tbody></table></div></div>

        ${buildTabGuardScript(token, AWAY_TIMEOUT_MS)}
        <script>
            const CURR_USER = ${JSON.stringify(username)};
            const CURR_TOKEN = ${JSON.stringify(token)};

            window.syncNow = async function() {
                if (document.hidden) return;
                try {
                    const res = await fetch(\`/api/data?user=\${encodeURIComponent(CURR_USER)}&token=\${encodeURIComponent(CURR_TOKEN)}\`);
                    if (res.status === 401) {
                        window.location.replace('/login?err=' + encodeURIComponent('Phiên đăng nhập đã hết hạn!'));
                        return;
                    }
                    const data = await res.json();
                    if (!data || data.error) return;

                    document.getElementById('total-score').innerText = data.cumulativeScore + ' điểm';

                    const tbody = document.getElementById('history-rows');
                    if (!data.history || data.history.length === 0) {
                        tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;padding:10px;">Chưa có dữ liệu</td></tr>';
                    } else {
                        tbody.innerHTML = data.history.map((item, index) => \`
                            <tr>
                                <td style="padding:8px;border-bottom:1px solid #ddd;text-align:center;">\${item.date}</td>
                                <td style="padding:8px;border-bottom:1px solid #ddd;text-align:center;font-weight:bold;color:#27ae60;white-space:nowrap;">+\${item.score} đ</td>
                                <td style="padding:8px;border-bottom:1px solid #ddd;text-align:center;">
                                    <div style="display:inline-flex;gap:5px;flex-wrap:wrap;justify-content:center;">
                                    <a href="/edit?user=\${encodeURIComponent(CURR_USER)}&token=\${encodeURIComponent(CURR_TOKEN)}&index=\${index}" style="background:#f39c12;color:white;padding:4px 8px;text-decoration:none;border-radius:4px;font-size:12px;font-weight:bold;white-space:nowrap;">Sửa</a>
                                    <a href="/delete?user=\${encodeURIComponent(CURR_USER)}&token=\${encodeURIComponent(CURR_TOKEN)}&index=\${index}" onclick="return confirm('Xóa ngày này?');" style="background:#e74c3c;color:white;padding:4px 8px;text-decoration:none;border-radius:4px;font-size:12px;font-weight:bold;white-space:nowrap;">Xóa</a>
                                    </div>
                                </td>
                            </tr>
                        \`).join('');
                    }
                } catch (e) {
                    console.error('Lỗi đồng bộ dữ liệu:', e);
                }
            };

            setInterval(window.syncNow, 2000);
        </script>
        </body></html>
    `);
});

app.post('/submit-report', async (req, res) => {
    const auth = await authorizeRequest(req, false);
    if (!auth) return res.redirect('/login?err=Phiên+đăng+nhập+hết+hạn!');

    const username = auth.username;
    const token = auth.token;
    const rawDate = req.body.reportDate;
    let dateStr = rawDate ? rawDate.split('-').reverse().join('/') : new Date().toLocaleDateString('vi-VN');
    const result = await calculateScoreAndContent(username, dateStr, req.body);
    if (result) {
        await sendToSignal(`📥 **BÁO CÁO [${username}] - ${dateStr}**\n\n` + result.reportContent);
        setTimeout(async () => { await sendToSignal(result.summaryContent); }, 1000);
    }
    res.send(`
        <!DOCTYPE html><html lang="vi"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>🌐 Chiến Dịch 60 Ngày - Thành Công</title>
        <link rel="icon" href="${FAVICON_URL}" type="image/jpeg">
        <style>body{font-family:Arial;background:#f4f6f9;display:flex;justify-content:center;align-items:center;height:100vh;margin:0}.card{background:white;padding:25px;border-radius:12px;box-shadow:0 4px 15px rgba(0,0,0,0.1);width:100%;max-width:380px;text-align:center;box-sizing:border-box}h1{color:#27ae60;font-size:22px;margin-bottom:15px}a{display:inline-block;margin-top:15px;padding:10px 20px;background:#2980b9;color:white;text-decoration:none;border-radius:6px;font-weight:bold;font-size:14px}</style></head>
        <body><div class="card"><h1>✅ Gửi Báo Cáo Thành Công!</h1><a href="/?user=${encodeURIComponent(username)}&token=${encodeURIComponent(token)}">Quay Lại Trang Chủ</a></div>
        ${buildTabGuardScript(token, AWAY_TIMEOUT_MS)}
        </body></html>
    `);
});

app.get('/delete', async (req, res) => {
    const auth = await authorizeRequest(req, false);
    if (!auth) return res.redirect('/login?err=Phiên+đăng+nhập+hết+hạn!');

    const username = auth.username;
    const token = auth.token;
    const index = parseInt(req.query.index);
    let user = await User.findOne({ username });
    if (user && !isNaN(index) && index >= 0 && index < user.history.length) {
        const deletedDay = user.history.splice(index, 1)[0];
        await user.save();
        const cumulativeScore = user.history.reduce((sum, item) => sum + (item.score || 0), 0);
        await sendToSignal(`🗑️ **[${username}] XÓA BÁO CÁO**\nĐã xóa ngày: ${deletedDay.date}\n🏆 Tổng điểm: **${cumulativeScore} điểm**`);
    }
    res.redirect(`/?user=${encodeURIComponent(username)}&token=${encodeURIComponent(token)}`);
});

app.get('/edit', async (req, res) => {
    const auth = await authorizeRequest(req, false);
    if (!auth) return res.redirect('/login?err=Phiên+đăng+nhập+hết+hạn!');

    const username = auth.username;
    const token = auth.token;
    const index = parseInt(req.query.index);
    let user = await User.findOne({ username });
    if (!user || isNaN(index) || index < 0 || index >= user.history.length) {
        return res.redirect(`/?user=${encodeURIComponent(username)}&token=${encodeURIComponent(token)}`);
    }

    const item = user.history[index];
    const d = item.details || {};

    res.send(`
        <!DOCTYPE html><html lang="vi"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>🌐 Chiến Dịch 60 Ngày - Sửa Ngày ${item.date}</title>
        <link rel="icon" href="${FAVICON_URL}" type="image/jpeg">
        <style>
            body { font-family: Arial, sans-serif; background: #f4f6f9; margin: 0; padding: 15px; }
            .container { max-width: 550px; margin: 0 auto; background: white; padding: 20px; border-radius: 12px; box-shadow: 0 4px 10px rgba(0,0,0,0.1); }
            h3 { text-align: center; color: #2c3e50; margin-bottom: 20px; }
            .section-title { background: #34495e; color: white; padding: 8px 12px; border-radius: 6px; margin-top: 20px; font-size: 15px; }
            .form-group { margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center; }
            label { font-size: 14px; color: #333; flex: 2; }
            input[type="number"] { width: 70px; padding: 6px; border: 1px solid #ccc; border-radius: 6px; font-size: 14px; flex: 1; text-align: center; }
            button { width: 100%; background: #27ae60; color: white; border: none; padding: 12px; border-radius: 6px; font-size: 16px; font-weight:bold; margin-top: 20px; cursor: pointer; }
            .back-link { display: block; text-align: center; margin-top: 15px; color: #2980b9; text-decoration: none; font-size: 14px; font-weight: bold; }
        </style></head>
        <body>
            <div class="container">
                <h3>✏️ Sửa Báo Cáo Ngày: ${item.date}</h3>
                <form action="/update-edit?user=${encodeURIComponent(username)}&token=${encodeURIComponent(token)}" method="POST">
                    <input type="hidden" name="index" value="${index}">
                    <input type="hidden" name="date" value="${item.date}">

                    <div class="section-title" style="margin-top:0;">🌟 MY PAGE (Nhập 0 hoặc 1)</div>
                    <div class="form-group" style="margin-top:10px;"><label>Đánh Giá Tín Ngưỡng:</label><input type="number" name="tinNguong" value="${d.tinNguong ?? 1}" min="0" max="1" required></div>
                    <div class="form-group"><label>Kinh thánh:</label><input type="number" name="kinhThanh" value="${d.kinhThanh ?? 1}" min="0" max="1" required></div>
                    <div class="form-group"><label>Sách LT:</label><input type="number" name="sachLT" value="${d.sachLT ?? 1}" min="0" max="1" required></div>
                    <div class="form-group"><label>Tập Gđ:</label><input type="number" name="tapGd" value="${d.tapGd ?? 1}" min="0" max="1" required></div>

                    <div class="section-title">🎊 PHÁT BIỂU & EDU</div>
                    <div class="form-group" style="margin-top:10px;"><label>Bài mới:</label><input type="number" name="baiMoi" value="${d.baiMoi || 0}" min="0" required></div>
                    <div class="form-group"><label>Bài cũ:</label><input type="number" name="baiCu" value="${d.baiCu || 0}" min="0" required></div>
                    <div class="form-group"><label>EDU:</label><input type="number" name="edu" value="${d.edu || 0}" min="0" required></div>

                    <div class="section-title">🔥 TRUDA</div>
                    <div class="form-group" style="margin-top:10px;"><label>Đơn Thuần:</label><input type="number" name="donThuan" value="${d.donThuan || 0}" min="0" required></div>
                    <div class="form-group"><label>Hữu Hiệu:</label><input type="number" name="huuHieu" value="${d.huuHieu || 0}" min="0" required></div>
                    <div class="form-group"><label>Kết trái:</label><input type="number" name="ketTrai" value="${d.ketTrai || 0}" min="0" required></div>

                    <button type="submit">💾 Lưu Thay Đổi</button>
                </form>
                <a href="/?user=${encodeURIComponent(username)}&token=${encodeURIComponent(token)}" class="back-link">⬅️ Quay lại trang chủ</a>
            </div>
            ${buildTabGuardScript(token, AWAY_TIMEOUT_MS)}
        </body></html>
    `);
});

app.post('/update-edit', async (req, res) => {
    const auth = await authorizeRequest(req, false);
    if (!auth) return res.redirect('/login?err=Phiên+đăng+nhập+hết+hạn!');

    const username = auth.username;
    const token = auth.token;
    const dateStr = req.body.date;
    const result = await calculateScoreAndContent(username, dateStr, req.body);
    if (result) {
        await sendToSignal(`✏️ **[${username}] CẬP NHẬT NGÀY ${dateStr}**\n\n` + result.reportContent);
        setTimeout(async () => { await sendToSignal(result.summaryContent); }, 1000);
    }
    res.send(`
        <!DOCTYPE html><html lang="vi"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>🌐 Chiến Dịch 60 Ngày - Đã Sửa</title>
        <link rel="icon" href="${FAVICON_URL}" type="image/jpeg">
        <style>body{font-family:Arial;background:#f4f6f9;display:flex;justify-content:center;align-items:center;height:100vh;margin:0}.card{background:white;padding:25px;border-radius:12px;box-shadow:0 4px 15px rgba(0,0,0,0.1);width:100%;max-width:380px;text-align:center;box-sizing:border-box}h1{color:#27ae60;font-size:22px;margin-bottom:15px}a{display:inline-block;margin-top:15px;padding:10px 20px;background:#2980b9;color:white;text-decoration:none;border-radius:6px;font-weight:bold;font-size:14px}</style></head>
        <body><div class="card"><h1>✅ Đã Sửa Thành Công!</h1><a href="/?user=${encodeURIComponent(username)}&token=${encodeURIComponent(token)}">Quay Lại Trang Chủ</a></div>
        ${buildTabGuardScript(token, AWAY_TIMEOUT_MS)}
        </body></html>
    `);
});

// --- PHẦN BOT TELEGRAM (CÓ TÍCH HỢP QUYỀN ADMIN) ---
const teleSessions = {};

const steps = [
    { key: 'tinNguong', label: '🔰 Đánh Giá Tín Ngưỡng (0 hoặc 1)' },
    { key: 'kinhThanh', label: '🔰 Kinh thánh (0 hoặc 1)' },
    { key: 'sachLT', label: '🔰 Sách LT (0 hoặc 1)' },
    { key: 'tapGd', label: '🔰 Tập Gđ (0 hoặc 1)' },
    { key: 'baiMoi', label: '🔰 Bài mới (Nhập số)' },
    { key: 'baiCu', label: '🔰 Bài cũ (Nhập số)' },
    { key: 'edu', label: '🔰 EDU (Nhập số)' },
    { key: 'donThuan', label: '🔰 Đơn Thuần (Nhập số)' },
    { key: 'huuHieu', label: '🔰 Hữu Hiệu (Nhập số)' },
    { key: 'ketTrai', label: '🔰 Kết trái (Nhập số)' }
];

async function completeLoginSession(ctx, username) {
    const session = teleSessions[ctx.chat.id];
    const dbUser = await User.findOne({ username });
    if (!dbUser) {
        delete teleSessions[ctx.chat.id];
        return ctx.reply('❌ Không tìm thấy tài khoản! Gõ /start để thử lại.');
    }
    session.loggedIn = true;
    session.username = dbUser.username;
    session.role = dbUser.role || 'user';
    delete session.step;
    delete session.tempUser;
    delete session.tempRegUser;
    delete session.tempRegPass;
    delete session.tempRegQuestions;
    delete session.tempRegAnswers;
    delete session.adminTargetUser;
    delete session.adminEditIndex;
    delete session.adminReportDate;
    delete session.adminReportStep;
    delete session.adminReportData;
    return showTeleMenu(ctx);
}

bot.start((ctx) => {
    teleSessions[ctx.chat.id] = { loggedIn: false };
    ctx.reply(
        '🤖 **QUẢN LÝ CHIẾN DỊCH (TELEGRAM BOT)**\nChọn phương thức đăng nhập:',
        Markup.inlineKeyboard([
            [Markup.button.callback('⚡ Đăng nhập bằng tên tài khoản', 'tele_quick_login')],
            [Markup.button.callback('🔑 Đăng nhập thủ công (Mật khẩu)', 'tele_manual_login')],
            [Markup.button.callback('📝 Đăng ký tài khoản mới', 'tele_register')]
        ])
    );
});

bot.action('tele_quick_login', (ctx) => {
    teleSessions[ctx.chat.id] = { loggedIn: false, step: 'WAITING_QUICK_USER' };
    ctx.reply('👉 Nhập **Tên đăng nhập (Username)** của bạn:');
});

bot.action('tele_manual_login', (ctx) => {
    teleSessions[ctx.chat.id] = { loggedIn: false, step: 'WAITING_LOGIN_USER' };
    ctx.reply('👉 Nhập **Tên đăng nhập**:');
});

bot.action('tele_register', (ctx) => {
    teleSessions[ctx.chat.id] = {
        loggedIn: false,
        step: 'WAITING_REG_USER',
        tempRegQuestions: [],
        tempRegAnswers: []
    };
    ctx.reply('👉 Nhập **Tên đăng nhập mới**:');
});

function promptNextTeleSecurityQuestion(ctx, session, qIndex) {
    const listText = SECURITY_QUESTIONS.map((q, i) => `${i + 1}. ${q}`).join('\n');
    session.step = `WAITING_REG_Q_${qIndex}`;
    return ctx.reply(
        `🛡️ **Chọn câu hỏi bảo mật thứ ${qIndex + 1}/3:**\nGõ số từ **1 đến 10** theo danh sách dưới đây:\n\n${listText}`
    );
}

async function showTeleMenu(ctx) {
    const session = teleSessions[ctx.chat.id];
    if (!session || !session.loggedIn) return ctx.reply('Vui lòng gõ /start để đăng nhập.');

    const user = await User.findOne({ username: session.username });
    if (!user) {
        delete teleSessions[ctx.chat.id];
        return ctx.reply('❌ Tài khoản không còn tồn tại. Gõ /start để đăng nhập lại.');
    }

    session.role = user.role || 'user';
    const history = user.history || [];
    const cumulativeScore = history.reduce((sum, item) => sum + (item.score || 0), 0);

    const keyboardRows = [
        [Markup.button.callback('➕ Thêm báo cáo (Chọn ngày tùy ý)', 'tele_choose_date')],
        [Markup.button.callback('📋 Xem lịch sử & Sửa/Xóa', 'tele_list_report')]
    ];

    if (session.role === 'admin') {
        keyboardRows.push([Markup.button.callback('🛡️ Quản trị Admin (Tài khoản & Báo cáo)', 'tele_admin_panel')]);
    }

    keyboardRows.push([Markup.button.callback('🚪 Đăng xuất', 'tele_logout')]);

    ctx.reply(
        `👤 Tài khoản: <b>${session.username}</b> ${session.role === 'admin' ? '(<b>ADMIN</b>)' : ''}\n🏆 Tổng điểm tích lũy: <b>${cumulativeScore} điểm</b>\n\nChọn chức năng:`,
        {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard(keyboardRows)
        }
    );
}

bot.action('tele_logout', (ctx) => {
    delete teleSessions[ctx.chat.id];
    ctx.reply('Đã đăng xuất! Gõ /start để khởi động lại.');
});

async function ensureTeleAdmin(ctx) {
    const session = teleSessions[ctx.chat.id];
    if (!session || !session.loggedIn) {
        await ctx.reply('Vui lòng đăng nhập bằng lệnh /start.');
        return null;
    }
    const adminDoc = await verifyAdmin(session.username);
    if (!adminDoc) {
        await ctx.reply('❌ Tài khoản hiện tại không có quyền Admin.');
        return null;
    }
    return adminDoc;
}

bot.action('tele_admin_panel', async (ctx) => {
    if (!(await ensureTeleAdmin(ctx))) return;
    const allUsers = await User.find({}).sort({ username: 1 });
    const totalReports = allUsers.reduce((acc, u) => acc + ((u.history && u.history.length) || 0), 0);
    const totalScore = allUsers.reduce(
        (acc, u) => acc + ((u.history || []).reduce((s, item) => s + (item.score || 0), 0)),
        0
    );

    ctx.reply(
        `🛡️ <b>BẢNG ĐIỀU KHIỂN ADMIN (TELEGRAM)</b>\n👥 Tổng tài khoản: <b>${allUsers.length}</b> | 📋 Tổng báo cáo: <b>${totalReports}</b>\n🏆 Tổng điểm hệ thống: <b>${totalScore} điểm</b>`,
        {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('👥 Quản lý tài khoản (Đổi MK / Xóa)', 'tele_admin_users')],
                [Markup.button.callback('📝 Quản lý báo cáo của tài khoản', 'tele_admin_reports_users')],
                [Markup.button.callback('⬅️ Về Menu chính', 'tele_menu')]
            ])
        }
    );
});

bot.action('tele_admin_users', async (ctx) => {
    const adminDoc = await ensureTeleAdmin(ctx);
    if (!adminDoc) return;

    const allUsers = await User.find({}).sort({ username: 1 });
    if (!allUsers.length) {
        return ctx.reply('Chưa có tài khoản nào.', Markup.inlineKeyboard([[Markup.button.callback('⬅️ Về Admin', 'tele_admin_panel')]]));
    }

    for (const u of allUsers) {
        const score = (u.history || []).reduce((s, item) => s + (item.score || 0), 0);
        const btns = [Markup.button.callback('🔑 Đổi mật khẩu', `adm_pw_${u.username}`)];
        if (u.username !== adminDoc.username) {
            btns.push(Markup.button.callback('🗑️ Xóa tài khoản', `adm_delu_ask_${u.username}`));
        }
        await ctx.reply(
            `👤 <b>${u.username}</b> ${u.role === 'admin' ? '[ADMIN]' : '[User]'} — 🏆 <b>${score} đ</b> (${(u.history || []).length} ngày)`,
            {
                parse_mode: 'HTML',
                ...Markup.inlineKeyboard([btns])
            }
        );
    }

    ctx.reply('Hoàn tất danh sách tài khoản:', Markup.inlineKeyboard([[Markup.button.callback('⬅️ Về Admin', 'tele_admin_panel')]]));
});

bot.action(/^adm_pw_(.+)$/, async (ctx) => {
    if (!(await ensureTeleAdmin(ctx))) return;
    const targetUser = ctx.match[1];
    const session = teleSessions[ctx.chat.id];
    session.step = 'ADMIN_WAITING_NEW_PASS';
    session.adminTargetUser = targetUser;
    ctx.reply(`🔑 Nhập <b>mật khẩu mới</b> cho tài khoản <b>${targetUser}</b>\n<i>(${PASSWORD_RULE_TEXT})</i>:`, { parse_mode: 'HTML' });
});

bot.action(/^adm_delu_ask_(.+)$/, async (ctx) => {
    const adminDoc = await ensureTeleAdmin(ctx);
    if (!adminDoc) return;
    const targetUser = ctx.match[1];
    if (targetUser === adminDoc.username) {
        return ctx.reply('❌ Không thể xóa tài khoản Admin đang đăng nhập.');
    }
    ctx.reply(
        `⚠️ Xác nhận <b>XÓA VĨNH VIỄN</b> tài khoản <b>${targetUser}</b> và toàn bộ lịch sử báo cáo?`,
        {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([
                [
                    Markup.button.callback('✅ Xác nhận xóa', `adm_delu_ok_${targetUser}`),
                    Markup.button.callback('❌ Hủy', 'tele_admin_users')
                ]
            ])
        }
    );
});

bot.action(/^adm_delu_ok_(.+)$/, async (ctx) => {
    const adminDoc = await ensureTeleAdmin(ctx);
    if (!adminDoc) return;
    const targetUser = ctx.match[1];
    if (targetUser === adminDoc.username) {
        return ctx.reply('❌ Không thể xóa tài khoản Admin đang đăng nhập.');
    }

    const deleted = await User.findOneAndDelete({ username: targetUser });
    if (deleted) {
        await sendToSignal(`🛡️ **[ADMIN: ${adminDoc.username}] ĐÃ XÓA TÀI KHOẢN [${targetUser}]**`);
        await ctx.reply(`✅ Đã xóa tài khoản <b>${targetUser}</b>!`, { parse_mode: 'HTML' });
    } else {
        await ctx.reply('❌ Không tìm thấy tài khoản để xóa.');
    }
    ctx.reply('Quay lại:', Markup.inlineKeyboard([[Markup.button.callback('⬅️ Về Admin', 'tele_admin_panel')]]));
});

bot.action('tele_admin_reports_users', async (ctx) => {
    if (!(await ensureTeleAdmin(ctx))) return;
    const allUsers = await User.find({}).sort({ username: 1 });
    if (!allUsers.length) {
        return ctx.reply('Chưa có tài khoản nào.', Markup.inlineKeyboard([[Markup.button.callback('⬅️ Về Admin', 'tele_admin_panel')]]));
    }

    const rows = allUsers.map(u => [
        Markup.button.callback(`📂 ${u.username} (${(u.history || []).length} ngày)`, `adm_u_menu_${u.username}`)
    ]);
    rows.push([Markup.button.callback('⬅️ Về Admin', 'tele_admin_panel')]);

    ctx.reply('📝 Chọn tài khoản để quản lý báo cáo:', Markup.inlineKeyboard(rows));
});

bot.action(/^adm_u_menu_(.+)$/, async (ctx) => {
    if (!(await ensureTeleAdmin(ctx))) return;
    const targetUser = ctx.match[1];
    const userDoc = await User.findOne({ username: targetUser });
    if (!userDoc) return ctx.reply('❌ Không tìm thấy tài khoản.');

    const score = (userDoc.history || []).reduce((s, item) => s + (item.score || 0), 0);
    ctx.reply(
        `📂 Quản lý báo cáo của <b>${targetUser}</b> (🏆 <b>${score} điểm</b>):`,
        {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('➕ Thêm báo cáo (Hôm nay)', `adm_add_today_${targetUser}`)],
                [Markup.button.callback('📅 Thêm báo cáo (Chọn ngày)', `adm_add_date_${targetUser}`)],
                [Markup.button.callback('📋 Danh sách ngày (Sửa / Xóa)', `adm_list_${targetUser}`)],
                [Markup.button.callback('⬅️ Chọn tài khoản khác', 'tele_admin_reports_users')]
            ])
        }
    );
});

bot.action(/^adm_add_today_(.+)$/, async (ctx) => {
    if (!(await ensureTeleAdmin(ctx))) return;
    const targetUser = ctx.match[1];
    const session = teleSessions[ctx.chat.id];
    const today = new Date();
    session.adminTargetUser = targetUser;
    session.adminReportDate = `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}/${today.getFullYear()}`;
    session.adminReportStep = 0;
    session.adminReportData = {};
    delete session.step;
    ctx.reply(`📝 [Admin] Nhập báo cáo cho <b>${targetUser}</b> — Ngày <b>${session.adminReportDate}</b>.\n\n👉 <b>${steps[0].label}:</b>`, { parse_mode: 'HTML' });
});

bot.action(/^adm_add_date_(.+)$/, async (ctx) => {
    if (!(await ensureTeleAdmin(ctx))) return;
    const targetUser = ctx.match[1];
    const session = teleSessions[ctx.chat.id];
    session.adminTargetUser = targetUser;
    session.step = 'ADMIN_WAITING_CUSTOM_DATE';
    ctx.reply(`📅 [Admin] Nhập ngày theo định dạng <b>DD/MM/YYYY</b> cho <b>${targetUser}</b> (VD: <code>20/11/2026</code>):`, { parse_mode: 'HTML' });
});

bot.action(/^adm_list_(.+)$/, async (ctx) => {
    if (!(await ensureTeleAdmin(ctx))) return;
    const targetUser = ctx.match[1];
    const userDoc = await User.findOne({ username: targetUser });
    if (!userDoc) return ctx.reply('❌ Không tìm thấy tài khoản.');

    const history = userDoc.history || [];
    if (!history.length) {
        return ctx.reply(
            `Tài khoản <b>${targetUser}</b> chưa có báo cáo nào.`,
            {
                parse_mode: 'HTML',
                ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ Quay lại', `adm_u_menu_${targetUser}`)]])
            }
        );
    }

    for (let i = 0; i < history.length; i++) {
        const item = history[i];
        await ctx.reply(
            `👤 <b>${targetUser}</b> | 📅 <b>${item.date}</b> | 🏆 <b>+${item.score} đ</b>`,
            {
                parse_mode: 'HTML',
                ...Markup.inlineKeyboard([
                    [
                        Markup.button.callback('✏️ Sửa', `adm_rep_edit_${i}_${targetUser}`),
                        Markup.button.callback('❌ Xóa', `adm_rep_del_${i}_${targetUser}`)
                    ]
                ])
            }
        );
    }

    ctx.reply('Hoàn tất:', Markup.inlineKeyboard([[Markup.button.callback('⬅️ Quay lại', `adm_u_menu_${targetUser}`)]]));
});

bot.action(/^adm_rep_del_(\d+)_(.+)$/, async (ctx) => {
    const adminDoc = await ensureTeleAdmin(ctx);
    if (!adminDoc) return;
    const index = parseInt(ctx.match[1]);
    const targetUser = ctx.match[2];

    const userDoc = await User.findOne({ username: targetUser });
    if (userDoc && !isNaN(index) && index >= 0 && index < userDoc.history.length) {
        const deleted = userDoc.history.splice(index, 1)[0];
        await userDoc.save();
        const cumulativeScore = userDoc.history.reduce((sum, item) => sum + (item.score || 0), 0);
        await sendToSignal(`🛡️ **[ADMIN: ${adminDoc.username}] XÓA BÁO CÁO CỦA [${targetUser}]**\nĐã xóa ngày: ${deleted.date}\n🏆 Tổng điểm [${targetUser}]: **${cumulativeScore} điểm**`);
        return ctx.reply(`✅ Đã xóa báo cáo ngày <b>${deleted.date}</b> của <b>${targetUser}</b>!`, { parse_mode: 'HTML' });
    }
    ctx.reply('❌ Không tìm thấy báo cáo để xóa.');
});

bot.action(/^adm_rep_edit_(\d+)_(.+)$/, async (ctx) => {
    if (!(await ensureTeleAdmin(ctx))) return;
    const index = parseInt(ctx.match[1]);
    const targetUser = ctx.match[2];
    const userDoc = await User.findOne({ username: targetUser });
    if (!userDoc || isNaN(index) || index < 0 || index >= userDoc.history.length) {
        return ctx.reply('❌ Không tìm thấy báo cáo để sửa.');
    }

    const item = userDoc.history[index];
    const session = teleSessions[ctx.chat.id];
    session.adminTargetUser = targetUser;
    session.adminReportDate = item.date;
    session.adminReportStep = 0;
    session.adminReportData = {};
    delete session.step;
    ctx.reply(`✏️ [Admin] Đang sửa báo cáo của <b>${targetUser}</b> — Ngày <b>${item.date}</b>.\n\n👉 <b>${steps[0].label}:</b>`, { parse_mode: 'HTML' });
});

bot.action('tele_choose_date', (ctx) => {
    const session = teleSessions[ctx.chat.id];
    if (!session || !session.loggedIn) return ctx.reply('Vui lòng đăng nhập lại bằng lệnh /start');

    ctx.reply(
        '📅 Bạn muốn báo cáo cho ngày nào?',
        Markup.inlineKeyboard([
            [Markup.button.callback('📅 Hôm nay', 'date_today')],
            [Markup.button.callback('✏️ Nhập ngày tùy ý (DD/MM/YYYY)', 'date_custom')]
        ])
    );
});

bot.action('date_today', (ctx) => {
    const session = teleSessions[ctx.chat.id];
    const today = new Date();
    session.reportDate = `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}/${today.getFullYear()}`;
    startReportSteps(ctx);
});

bot.action('date_custom', (ctx) => {
    const session = teleSessions[ctx.chat.id];
    session.step = 'WAITING_CUSTOM_DATE';
    ctx.reply('👉 Vui lòng nhập ngày theo định dạng **DD/MM/YYYY** (Ví dụ: `20/11/2026`):');
});

function startReportSteps(ctx) {
    const session = teleSessions[ctx.chat.id];
    session.reportStep = 0;
    session.reportData = {};
    ctx.reply(`📝 Bắt đầu nhập liệu cho ngày **${session.reportDate}**.\n\n👉 **${steps[0].label}:**`);
}

bot.action('tele_list_report', async (ctx) => {
    const session = teleSessions[ctx.chat.id];
    if (!session || !session.loggedIn) return ctx.reply('Vui lòng đăng nhập lại bằng lệnh /start');

    const user = await User.findOne({ username: session.username });
    const history = user ? user.history : [];
    if (history.length === 0) {
        return ctx.reply('Chưa có lịch sử báo cáo nào.', Markup.inlineKeyboard([[Markup.button.callback('⬅️ Quay lại', 'tele_menu')]]));
    }

    ctx.reply('📋 **Danh sách các ngày đã nhập:**');
    history.forEach((item, index) => {
        ctx.reply(
            `📅 Ngày: <b>${item.date}</b> | 🏆 Điểm: <b>+${item.score} đ</b>`,
            {
                parse_mode: 'HTML',
                ...Markup.inlineKeyboard([
                    [
                        Markup.button.callback('✏️ Sửa ngày này', `tele_edit_${index}`),
                        Markup.button.callback('❌ Xóa', `tele_del_${index}`)
                    ]
                ])
            }
        );
    });
});

bot.action('tele_menu', (ctx) => showTeleMenu(ctx));

bot.action(/tele_del_(\d+)/, async (ctx) => {
    const session = teleSessions[ctx.chat.id];
    if (!session || !session.loggedIn) return;
    const index = parseInt(ctx.match[1]);

    let user = await User.findOne({ username: session.username });
    if (user && index >= 0 && index < user.history.length) {
        const deleted = user.history.splice(index, 1)[0];
        await user.save();
        const cumulativeScore = user.history.reduce((sum, item) => sum + (item.score || 0), 0);
        await sendToSignal(`🗑️ **[${session.username}] XÓA BÁO CÁO**\nĐã xóa ngày: ${deleted.date}\n🏆 Tổng điểm: **${cumulativeScore} điểm**`);
        ctx.reply(`✅ Đã xóa ngày ${deleted.date}!`);
        showTeleMenu(ctx);
    }
});

bot.action(/tele_edit_(\d+)/, async (ctx) => {
    const session = teleSessions[ctx.chat.id];
    if (!session || !session.loggedIn) return;
    const index = parseInt(ctx.match[1]);

    let user = await User.findOne({ username: session.username });
    if (user && index >= 0 && index < user.history.length) {
        const item = user.history[index];
        session.reportDate = item.date;
        session.reportStep = 0;
        session.reportData = {};
        ctx.reply(`✏️ Đang sửa lại số liệu cho ngày **${item.date}**.\n\n👉 **${steps[0].label}:**`);
    }
});

// LẮNG NGHE TIN NHẮN ĐIỀU PHỐI
bot.on('text', async (ctx) => {
    const text = ctx.message.text.trim();
    if (text.startsWith('/')) return;

    let session = teleSessions[ctx.chat.id];
    if (!session) {
        return ctx.reply('Vui lòng gõ /start để khởi động.');
    }

    if (session.step === 'WAITING_QUICK_USER') {
        const user = await User.findOne({ username: text });
        if (user) {
            await ctx.reply('✅ Đăng nhập nhanh thành công!');
            return completeLoginSession(ctx, text);
        } else {
            delete teleSessions[ctx.chat.id];
            return ctx.reply('❌ Không tìm thấy tài khoản! Gõ /start để thử lại.');
        }
    }

    if (session.step === 'WAITING_LOGIN_USER') {
        session.tempUser = text;
        session.step = 'WAITING_LOGIN_PASS';
        ctx.reply('👉 Nhập **Mật khẩu**:');
        return;
    }
    if (session.step === 'WAITING_LOGIN_PASS') {
        const user = await User.findOne({ username: session.tempUser, password: text });
        if (user) {
            await ctx.reply('✅ Đăng nhập thành công!');
            return completeLoginSession(ctx, session.tempUser);
        } else {
            delete teleSessions[ctx.chat.id];
            return ctx.reply('❌ Sai mật khẩu! Gõ /start để thử lại.');
        }
    }

    if (session.step === 'WAITING_REG_USER') {
        const existing = await User.findOne({ username: text });
        if (existing) {
            return ctx.reply('❌ Tên đăng nhập đã tồn tại! Nhập tên khác:');
        }
        session.tempRegUser = text;
        session.step = 'WAITING_REG_PASS';
        ctx.reply(`👉 Nhập **Mật khẩu mới**.\n*(${PASSWORD_RULE_TEXT})*`);
        return;
    }
    if (session.step === 'WAITING_REG_PASS') {
        if (!isStrongPassword(text)) {
            return ctx.reply(`❌ Mật khẩu chưa đạt yêu cầu.\n*(${PASSWORD_RULE_TEXT})*\nVui lòng nhập lại mật khẩu:`);
        }
        session.tempRegPass = text;
        session.tempRegQuestions = [];
        session.tempRegAnswers = [];
        return promptNextTeleSecurityQuestion(ctx, session, 0);
    }

    if (/^WAITING_REG_Q_([012])$/.test(session.step || '')) {
        const qIdx = parseInt(session.step.match(/^WAITING_REG_Q_([012])$/)[1], 10);
        const choiceNum = parseInt(text, 10);
        if (isNaN(choiceNum) || choiceNum < 1 || choiceNum > SECURITY_QUESTIONS.length) {
            return ctx.reply(`❌ Vui lòng chỉ gõ số từ 1 đến ${SECURITY_QUESTIONS.length}.`);
        }
        const selectedQuestion = SECURITY_QUESTIONS[choiceNum - 1];
        if (session.tempRegQuestions.includes(selectedQuestion)) {
            return ctx.reply('❌ Câu hỏi này đã được chọn rồi, hãy chọn số câu hỏi khác.');
        }
        session.tempRegQuestions[qIdx] = selectedQuestion;
        session.step = `WAITING_REG_A_${qIdx}`;
        return ctx.reply(`✍️ Nhập câu trả lời cho câu hỏi:\n**${selectedQuestion}**`);
    }

    if (/^WAITING_REG_A_([012])$/.test(session.step || '')) {
        const aIdx = parseInt(session.step.match(/^WAITING_REG_A_([012])$/)[1], 10);
        if (!text) {
            return ctx.reply('❌ Câu trả lời không được để trống. Vui lòng nhập lại:');
        }
        session.tempRegAnswers[aIdx] = text;
        if (aIdx < 2) {
            return promptNextTeleSecurityQuestion(ctx, session, aIdx + 1);
        }

        const existing = await User.findOne({ username: session.tempRegUser });
        if (existing) {
            delete teleSessions[ctx.chat.id];
            return ctx.reply('❌ Tên đăng nhập đã tồn tại! Gõ /start để thử lại.');
        }

        const secPayload = session.tempRegQuestions.map((q, i) => ({
            question: q,
            answer: normalizeAnswer(session.tempRegAnswers[i])
        }));

        await User.create({
            username: session.tempRegUser,
            password: session.tempRegPass,
            secret: '',
            securityQuestions: secPayload,
            role: 'user',
            history: []
        });
        delete teleSessions[ctx.chat.id];
        return ctx.reply('🎉 Đăng ký thành công (đã lưu mật khẩu mạnh & 3 câu hỏi bảo mật)! Gõ /start để đăng nhập.');
    }

    if (session.step === 'ADMIN_WAITING_NEW_PASS') {
        const adminDoc = await ensureTeleAdmin(ctx);
        if (!adminDoc) return;
        const targetUser = session.adminTargetUser;

        if (!text || !isStrongPassword(text)) {
            return ctx.reply(`❌ Mật khẩu mới chưa đạt yêu cầu.\n<i>(${PASSWORD_RULE_TEXT})</i>\nNhập lại mật khẩu mới cho <b>${targetUser}</b>:`, { parse_mode: 'HTML' });
        }

        delete session.step;
        delete session.adminTargetUser;
        const targetDoc = await User.findOne({ username: targetUser });
        if (!targetDoc) return ctx.reply('❌ Không tìm thấy tài khoản.');

        targetDoc.password = text;
        await targetDoc.save();
        await sendToSignal(`🛡️ **[ADMIN: ${adminDoc.username}] ĐÃ ĐỔI MẬT KHẨU CHO TÀI KHOẢN [${targetUser}]**`);
        await ctx.reply(`✅ Đã đổi mật khẩu cho tài khoản <b>${targetUser}</b>!`, { parse_mode: 'HTML' });
        return ctx.reply('Quay lại:', Markup.inlineKeyboard([[Markup.button.callback('⬅️ Về Admin', 'tele_admin_panel')]]));
    }

    if (session.step === 'ADMIN_WAITING_CUSTOM_DATE') {
        if (!(await ensureTeleAdmin(ctx))) return;
        session.adminReportDate = text;
        session.adminReportStep = 0;
        session.adminReportData = {};
        delete session.step;
        return ctx.reply(
            `📝 [Admin] Nhập báo cáo cho <b>${session.adminTargetUser}</b> — Ngày <b>${session.adminReportDate}</b>.\n\n👉 <b>${steps[0].label}:</b>`,
            { parse_mode: 'HTML' }
        );
    }

    if (session.loggedIn && session.adminReportStep !== undefined) {
        const adminDoc = await ensureTeleAdmin(ctx);
        if (!adminDoc) return;

        const currentStepConfig = steps[session.adminReportStep];
        session.adminReportData[currentStepConfig.key] = text;
        session.adminReportStep++;

        if (session.adminReportStep < steps.length) {
            const nextStepConfig = steps[session.adminReportStep];
            return ctx.reply(`👉 <b>${nextStepConfig.label}:</b>`, { parse_mode: 'HTML' });
        } else {
            const targetUser = session.adminTargetUser;
            const dateStr = session.adminReportDate;
            const result = await calculateScoreAndContent(targetUser, dateStr, session.adminReportData);

            if (result) {
                await ctx.reply(`📋 <b>[ADMIN] ĐÃ LƯU CHO ${targetUser} (${dateStr}):</b>\n\n${result.reportContent}\n\n${result.summaryContent}`, { parse_mode: 'HTML' });
                try {
                    await sendToSignal(`🛡️ **[ADMIN: ${adminDoc.username}] CẬP NHẬT BÁO CÁO CHO [${targetUser}] - ${dateStr} (TELE)**\n\n` + result.reportContent);
                    setTimeout(async () => { await sendToSignal(result.summaryContent); }, 1000);
                } catch (e) {
                    console.error('Lỗi Signal:', e.message);
                }
            }

            delete session.adminTargetUser;
            delete session.adminReportDate;
            delete session.adminReportStep;
            delete session.adminReportData;
            return ctx.reply('Quay lại:', Markup.inlineKeyboard([[Markup.button.callback('⬅️ Về Admin', 'tele_admin_panel')]]));
        }
    }

    if (session.step === 'WAITING_CUSTOM_DATE') {
        session.reportDate = text;
        delete session.step;
        return startReportSteps(ctx);
    }

    if (session.loggedIn && session.reportStep !== undefined) {
        const currentStepConfig = steps[session.reportStep];
        session.reportData[currentStepConfig.key] = text;
        session.reportStep++;

        if (session.reportStep < steps.length) {
            const nextStepConfig = steps[session.reportStep];
            return ctx.reply(`👉 **${nextStepConfig.label}:**`);
        } else {
            const result = await calculateScoreAndContent(session.username, session.reportDate, session.reportData);

            if (result) {
                await ctx.reply(`📋 **KẾT QUẢ BÁO CÁO (${session.reportDate}):**\n\n${result.reportContent}\n\n${result.summaryContent}`);
                try {
                    await sendToSignal(`📥 **BÁO CÁO [${session.username}] - ${session.reportDate} (TELE)**\n\n` + result.reportContent);
                    setTimeout(async () => { await sendToSignal(result.summaryContent); }, 1000);
                    await ctx.reply('✅ Đã đẩy dữ liệu báo cáo sang Signal thành công!');
                } catch (e) {
                    console.error('Lỗi Signal:', e.message);
                }
            }

            delete session.reportStep;
            delete session.reportData;
            delete session.reportDate;
            return showTeleMenu(ctx);
        }
    }

    ctx.reply('Vui lòng sử dụng các nút bấm hoặc gõ /start để tiếp tục.');
});

// --- KHỞI CHẠY WEB SERVER VÀ THIẾT LẬP WEBHOOK ---
app.listen(PORT, async () => {
    console.log(`Web App đang chạy trên cổng ${PORT}`);

    const domain = process.env.RENDER_EXTERNAL_URL || 'https://telenodesig-8o00.onrender.com';
    const webhookUrl = `${domain}${WEBHOOK_PATH}`;

    try {
        await bot.telegram.setWebhook(webhookUrl, { drop_pending_updates: true });
        console.log(`🚀 Đã kết nối Webhook Telegram thành công: ${webhookUrl}`);
    } catch (err) {
        console.error('❌ Lỗi thiết lập Webhook Telegram:', err.message);
    }
});
