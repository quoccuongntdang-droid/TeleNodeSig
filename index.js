const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const express = require('express');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const USERS_FILE = path.join(__dirname, 'users.json');
const PHONE = 'f774da57-44c0-4e4e-8f57-4e4fd53490a0';
const APIKEY = '911098';

// --- QUẢN LÝ USER & DỮ LIỆU RIÊNG BIỆT ---
function loadUsers() {
    try {
        if (fs.existsSync(USERS_FILE)) {
            return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
        }
    } catch (e) {
        console.error('Lỗi đọc users.json:', e.message);
    }
    return [];
}

function saveUsers(users) {
    try {
        fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
    } catch (e) {
        console.error('Lỗi ghi users.json:', e.message);
    }
}

function getUserHistoryFile(username) {
    const safeName = username.replace(/[^a-zA-Z0-9]/g, '_');
    return path.join(__dirname, `history_${safeName}.json`);
}

function loadUserHistory(username) {
    const file = getUserHistoryFile(username);
    try {
        if (fs.existsSync(file)) {
            return JSON.parse(fs.readFileSync(file, 'utf8'));
        }
    } catch (e) {
        console.error('Lỗi đọc lịch sử user:', e.message);
    }
    return [];
}

function saveUserHistory(username, history) {
    const file = getUserHistoryFile(username);
    try {
        history.sort((a, b) => {
            const [dA, mA, yA] = a.date.split('/');
            const [dB, mB, yB] = b.date.split('/');
            return new Date(`${yA}-${mA}-${dA}`) - new Date(`${yB}-${mB}-${dB}`);
        });
        fs.writeFileSync(file, JSON.stringify(history, null, 2), 'utf8');
    } catch (e) {
        console.error('Lỗi ghi lịch sử user:', e.message);
    }
}

async function sendToSignal(message) {
    try {
        await axios.get(`https://signal.callmebot.com/signal/send.php?phone=${PHONE}&apikey=${APIKEY}&text=${encodeURIComponent(message)}`);
    } catch (e) {
        console.error('Lỗi gửi Signal:', e.message);
    }
}

function calculateScoreAndContent(username, dateStr, d) {
    const p1 = (Number(d.tinNguong) + Number(d.kinhThanh) + Number(d.sachLT) + Number(d.tapGd)) * 10;
    const p2 = (Number(d.baiMoi) * 100) + (Number(d.baiCu) * 100) + (Number(d.edu) * 40);
    const p3 = (Number(d.donThuan) * 10) + (Number(d.huuHieu) * 100) + (Number(d.ketTrai) * 500);
    const totalDayScore = p1 + p2 + p3;

    let history = loadUserHistory(username);
    const existingIndex = history.findIndex(item => item.date === dateStr);
    
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

    if (existingIndex >= 0) {
        history[existingIndex] = dayData;
    } else {
        history.push(dayData);
    }
    saveUserHistory(username, history);

    const cumulativeScore = history.reduce((sum, item) => sum + (item.score || 0), 0);
    const startDate = new Date('2026-11-01');
    const today = new Date();
    const diffTime = Math.abs(today - startDate);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    const progressPercent = Math.min(Math.max((diffDays / 60) * 100, 0), 100).toFixed(1);

    const reportContent = `[${username}] CPN KVT - Ngày ${dateStr}\n\n🌟MYPAGE🌟\n🔰Đánh Giá Tín Ngưỡng: ${d.tinNguong}\n🔰Kinh thánh: ${d.kinhThanh}\n🔰Sách LT: ${d.sachLT}\n🔰Tập Gđ: ${d.tapGd}\n🎊PHÁT BIỂU🎉\n🔰Bài mới: ${d.baiMoi}\n🔰Bài cũ: ${d.baiCu}\n🔰EDU: ${d.edu}\n🔥TRUDA🔥\n🔰Đơn Thuần: ${d.donThuan}\n🔰Hữu Hiệu: ${d.huuHieu}\n🔰Kết trái: ${d.ketTrai}`;
    const summaryContent = `📊 **[${username}] TỔNG KẾT TÍCH LŨY:**\n⭐ Điểm ngày (${dateStr}): **+${totalDayScore} điểm**\n🏆 **Tổng điểm tích lũy:** **${cumulativeScore} điểm**\n📈 Tiến độ 60 ngày: **${progressPercent}%** (Ngày thứ ${diffDays}/60)`;

    return { reportContent, summaryContent };
}

// --- CÁC TRANG WEB (GIỮ NGUYÊN) ---
app.get('/login', (req, res) => {
    res.send(`
        <!DOCTYPE html><html lang="vi"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Đăng Nhập</title>
        <style>body{font-family:Arial;background:#f4f6f9;display:flex;justify-content:center;align-items:center;height:100vh;margin:0}.card{background:white;padding:25px;border-radius:12px;box-shadow:0 4px 15px rgba(0,0,0,0.1);width:100%;max-width:380px;box-sizing:border-box}h2{text-align:center;color:#2c3e50;margin-bottom:20px}input{width:100%;padding:10px;margin:10px 0;border:1px solid #ccc;border-radius:6px;box-sizing:border-box}button{width:100%;background:#2980b9;color:white;border:none;padding:12px;border-radius:6px;font-weight:bold;cursor:pointer;margin-top:10px}.error{color:#e74c3c;text-align:center;font-size:13px;margin-bottom:10px}</style></head>
        <body><div class="card"><h2>🔐 Đăng Nhập</h2>${req.query.err ? `<div class="error">${req.query.err}</div>` : ''}
        <form action="/auth-login" method="POST"><input type="text" name="username" placeholder="Tên đăng nhập" required><input type="password" name="password" placeholder="Mật khẩu" required><button type="submit">Đăng Nhập</button></form>
        <div style="display:flex;justify-content:space-between;margin-top:15px;font-size:13px;"><a href="/register">Đăng ký</a><a href="/forgot">Quên mật khẩu?</a></div></div></body></html>
    `);
});

app.post('/auth-login', (req, res) => {
    const { username, password } = req.body;
    const users = loadUsers();
    const user = users.find(u => u.username === username && u.password === password);
    if (user) res.redirect(`/?user=${encodeURIComponent(username)}`);
    else res.redirect('/login?err=Sai+tên+đăng+nhập+hoặc+mật+khẩu!');
});

app.get('/register', (req, res) => {
    res.send(`
        <!DOCTYPE html><html lang="vi"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Đăng Ký</title>
        <style>body{font-family:Arial;background:#f4f6f9;display:flex;justify-content:center;align-items:center;height:100vh;margin:0}.card{background:white;padding:25px;border-radius:12px;box-shadow:0 4px 15px rgba(0,0,0,0.1);width:100%;max-width:380px;box-sizing:border-box}h2{text-align:center;color:#2c3e50;margin-bottom:20px}input{width:100%;padding:10px;margin:10px 0;border:1px solid #ccc;border-radius:6px;box-sizing:border-box}button{width:100%;background:#27ae60;color:white;border:none;padding:12px;border-radius:6px;font-weight:bold;cursor:pointer;margin-top:10px}.error{color:#e74c3c;text-align:center;font-size:13px;margin-bottom:10px}</style></head>
        <body><div class="card"><h2>📝 Đăng Ký</h2>${req.query.err ? `<div class="error">${req.query.err}</div>` : ''}
        <form action="/auth-register" method="POST"><input type="text" name="username" placeholder="Tên đăng nhập" required><input type="password" name="password" placeholder="Mật khẩu" required><input type="text" name="secret" placeholder="Từ khóa bí mật" required><button type="submit">Đăng Ký</button></form>
        <a href="/login" style="display:block;text-align:center;margin-top:15px;color:#2980b9;text-decoration:none;font-size:13px;">Đã có tài khoản? Đăng nhập</a></div></body></html>
    `);
});

app.post('/auth-register', (req, res) => {
    const { username, password, secret } = req.body;
    let users = loadUsers();
    if (users.some(u => u.username === username)) return res.redirect('/register?err=Tên+đăng+nhập+đã+tồn+tại!');
    users.push({ username, password, secret });
    saveUsers(users);
    res.redirect(`/login?err=Đăng+ký+thành+công!+Hãy+đăng+nhập.`);
});

app.get('/forgot', (req, res) => {
    res.send(`
        <!DOCTYPE html><html lang="vi"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Quên Mật Khẩu</title>
        <style>body{font-family:Arial;background:#f4f6f9;display:flex;justify-content:center;align-items:center;height:100vh;margin:0}.card{background:white;padding:25px;border-radius:12px;box-shadow:0 4px 15px rgba(0,0,0,0.1);width:100%;max-width:380px;box-sizing:border-box}h2{text-align:center;color:#2c3e50;margin-bottom:20px}input{width:100%;padding:10px;margin:10px 0;border:1px solid #ccc;border-radius:6px;box-sizing:border-box}button{width:100%;background:#e67e22;color:white;border:none;padding:12px;border-radius:6px;font-weight:bold;cursor:pointer;margin-top:10px}.error{color:#e74c3c;text-align:center;font-size:13px;margin-bottom:10px}</style></head>
        <body><div class="card"><h2>🔑 Khôi Phục</h2>${req.query.err ? `<div class="error">${req.query.err}</div>` : ''}
        <form action="/auth-forgot" method="POST"><input type="text" name="username" placeholder="Tên đăng nhập" required><input type="text" name="secret" placeholder="Từ khóa bí mật" required><input type="password" name="newPassword" placeholder="Mật khẩu mới" required><button type="submit">Đổi Mật Khẩu</button></form>
        <a href="/login" style="display:block;text-align:center;margin-top:15px;color:#2980b9;text-decoration:none;font-size:13px;">Quay lại</a></div></body></html>
    `);
});

app.post('/auth-forgot', (req, res) => {
    const { username, secret, newPassword } = req.body;
    let users = loadUsers();
    let user = users.find(u => u.username === username && u.secret === secret);
    if (user) { user.password = newPassword; saveUsers(users); res.redirect('/login?err=Đổi+mật+khẩu+thành+công!'); }
    else res.redirect('/forgot?err=Sai+thông+tin!');
});

app.get('/', (req, res) => {
    const username = req.query.user;
    if (!username) return res.redirect('/login');
    const history = loadUserHistory(username);
    const cumulativeScore = history.reduce((sum, item) => sum + (item.score || 0), 0);
    const now = new Date();
    const defaultDateStr = now.toISOString().split('T')[0];
    let historyRows = history.map((item, index) => `
        <tr><td style="padding:8px;border-bottom:1px solid #ddd;text-align:center;">${item.date}</td>
        <td style="padding:8px;border-bottom:1px solid #ddd;text-align:center;font-weight:bold;color:#27ae60;">+${item.score} đ</td>
        <td style="padding:8px;border-bottom:1px solid #ddd;text-align:center;">
        <a href="/edit?user=${encodeURIComponent(username)}&index=${index}" style="background:#f39c12;color:white;padding:4px 8px;text-decoration:none;border-radius:4px;font-size:12px;margin-right:4px;">Sửa</a>
        <a href="/delete?user=${encodeURIComponent(username)}&index=${index}" onclick="return confirm('Xóa ngày này?');" style="background:#e74c3c;color:white;padding:4px 8px;text-decoration:none;border-radius:4px;font-size:12px;">Xóa</a></td></tr>
    `).join('');

    res.send(`
        <!DOCTYPE html><html lang="vi"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Dashboard - ${username}</title>
        <style>body{font-family:Arial;background:#f4f6f9;margin:0;padding:15px}.container{max-width:550px;margin:0 auto;background:white;padding:20px;border-radius:12px;box-shadow:0 4px 10px rgba(0,0,0,0.1)}h2,h3{text-align:center;color:#2c3e50}.top-bar{display:flex;justify-content:space-between;align-items:center;margin-bottom:15px;font-size:14px;background:#ecf0f1;padding:10px;border-radius:8px}.section-title{background:#34495e;color:white;padding:8px 12px;border-radius:6px;margin-top:20px;font-size:15px}.form-group{margin-bottom:10px;display:flex;justify-content:space-between;align-items:center}label{font-size:14px;color:#333;flex:2}input[type="number"],input[type="date"]{width:70px;padding:6px;text-align:center;border:1px solid #ccc;border-radius:6px;font-size:14px;flex:1}button{width:100%;background:#27ae60;color:white;border:none;padding:12px;border-radius:6px;font-size:16px;font-weight:bold;margin-top:20px;cursor:pointer}.stats-box{background:#e8f8f5;border:1px solid #a3e4d7;padding:12px;border-radius:8px;text-align:center;margin-bottom:20px}table{width:100%;border-collapse:collapse;margin-top:10px;font-size:14px}th{background:#ecf0f1;padding:8px}</style></head>
        <body><div class="container"><div class="top-bar"><span>Xin chào, <b>${username}</b></span><a href="/login" style="color:#c0392b;text-decoration:none;font-weight:bold;">Đăng xuất</a></div>
        <h2>🚀 Quản Lý Chiến Dịch</h2><div class="stats-box">🏆 Tổng điểm tích lũy: <b style="color:#27ae60;font-size:18px;">${cumulativeScore} điểm</b></div>
        <form action="/submit-report?user=${encodeURIComponent(username)}" method="POST">
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
        <table><thead><tr><th>Ngày</th><th>Điểm</th><th>Thao Tác</th></tr></thead><tbody>${historyRows.length ? historyRows : '<tr><td colspan="3" style="text-align:center;padding:10px;">Chưa có dữ liệu</td></tr>'}</tbody></table></div></body></html>
    `);
});

app.post('/submit-report', async (req, res) => {
    const username = req.query.user;
    if (!username) return res.redirect('/login');
    const rawDate = req.body.reportDate;
    let dateStr = rawDate ? rawDate.split('-').reverse().join('/') : new Date().toLocaleDateString('vi-VN');
    const { reportContent, summaryContent } = calculateScoreAndContent(username, dateStr, req.body);
    await sendToSignal(`📥 **BÁO CÁO [${username}] - ${dateStr}**\n\n` + reportContent);
    setTimeout(async () => { await sendToSignal(summaryContent); }, 1000);
    res.send(`<body style="text-align:center;padding-top:50px;font-family:Arial;"><h1 style="color:green;">✅ Gửi Báo Cáo Thành Công!</h1><a href="/?user=${encodeURIComponent(username)}" style="display:inline-block;margin-top:20px;padding:10px 20px;background:#2980b9;color:white;text-decoration:none;border-radius:6px;">Quay Lại</a></body>`);
});

app.get('/delete', async (req, res) => {
    const username = req.query.user;
    const index = parseInt(req.query.index);
    if (!username) return res.redirect('/login');
    let history = loadUserHistory(username);
    if (!isNaN(index) && index >= 0 && index < history.length) {
        const deletedDay = history.splice(index, 1)[0];
        saveUserHistory(username, history);
        const cumulativeScore = history.reduce((sum, item) => sum + (item.score || 0), 0);
        await sendToSignal(`🗑️ **[${username}] XÓA BÁO CÁO**\nĐã xóa ngày: ${deletedDay.date}\n🏆 Tổng điểm: **${cumulativeScore} điểm**`);
    }
    res.redirect(`/?user=${encodeURIComponent(username)}`);
});

app.get('/edit', (req, res) => {
    const username = req.query.user;
    const index = parseInt(req.query.index);
    if (!username) return res.redirect('/login');
    let history = loadUserHistory(username);
    if (isNaN(index) || index < 0 || index >= history.length) return res.redirect(`/?user=${encodeURIComponent(username)}`);
    const item = history[index];
    const d = item.details || {};
    res.send(`
        <!DOCTYPE html><html lang="vi"><head><meta charset="UTF-8"><title>Sửa Ngày ${item.date}</title></head>
        <body style="font-family:Arial;padding:15px;background:#f4f6f9;"><div style="max-width:500px;margin:0 auto;background:white;padding:20px;border-radius:12px;">
        <h3>Sửa Ngày: ${item.date} (${username})</h3>
        <form action="/update-edit" method="POST"><input type="hidden" name="user" value="${username}"><input type="hidden" name="index" value="${index}"><input type="hidden" name="date" value="${item.date}">
        <div style="background:#34495e;color:white;padding:6px 10px;border-radius:4px;margin-top:15px;font-size:14px;">🌟 MY PAGE</div>
        <div style="display:flex;justify-content:space-between;margin:8px 0;"><label>Đánh Giá Tín Ngưỡng:</label><input type="number" name="tinNguong" value="${d.tinNguong ?? 1}" min="0" max="1" style="width:70px;text-align:center;" required></div>
        <div style="display:flex;justify-content:space-between;margin:8px 0;"><label>Kinh thánh:</label><input type="number" name="kinhThanh" value="${d.kinhThanh ?? 1}" min="0" max="1" style="width:70px;text-align:center;" required></div>
        <div style="display:flex;justify-content:space-between;margin:8px 0;"><label>Sách LT:</label><input type="number" name="sachLT" value="${d.sachLT ?? 1}" min="0" max="1" style="width:70px;text-align:center;" required></div>
        <div style="display:flex;justify-content:space-between;margin:8px 0;"><label>Tập Gđ:</label><input type="number" name="tapGd" value="${d.tapGd ?? 1}" min="0" max="1" style="width:70px;text-align:center;" required></div>
        <div style="background:#34495e;color:white;padding:6px 10px;border-radius:4px;margin-top:15px;font-size:14px;">🎊 PHÁT BIỂU & EDU</div>
        <div style="display:flex;justify-content:space-between;margin:8px 0;"><label>Bài mới:</label><input type="number" name="baiMoi" value="${d.baiMoi || 0}" min="0" style="width:70px;text-align:center;" required></div>
        <div style="display:flex;justify-content:space-between;margin:8px 0;"><label>Bài cũ:</label><input type="number" name="baiCu" value="${d.baiCu || 0}" min="0" style="width:70px;text-align:center;" required></div>
        <div style="display:flex;justify-content:space-between;margin:8px 0;"><label>EDU:</label><input type="number" name="edu" value="${d.edu || 0}" min="0" style="width:70px;text-align:center;" required></div>
        <div style="background:#34495e;color:white;padding:6px 10px;border-radius:4px;margin-top:15px;font-size:14px;">🔥 TRUDA</div>
        <div style="display:flex;justify-content:space-between;margin:8px 0;"><label>Đơn Thuần:</label><input type="number" name="donThuan" value="${d.donThuan || 0}" min="0" style="width:70px;text-align:center;" required></div>
        <div style="display:flex;justify-content:space-between;margin:8px 0;"><label>Hữu Hiệu:</label><input type="number" name="huuHieu" value="${d.huuHieu || 0}" min="0" style="width:70px;text-align:center;" required></div>
        <div style="display:flex;justify-content:space-between;margin:8px 0;"><label>Kết trái:</label><input type="number" name="ketTrai" value="${d.ketTrai || 0}" min="0" style="width:70px;text-align:center;" required></div>
        <button type="submit" style="width:100%;background:#27ae60;color:white;border:none;padding:12px;border-radius:6px;font-weight:bold;margin-top:20px;cursor:pointer;">💾 Lưu Thay Đổi</button></form>
        <a href="/?user=${encodeURIComponent(username)}" style="display:block;text-align:center;margin-top:15px;color:#555;text-decoration:none;">Quay lại</a></div></body></html>
    `);
});

app.post('/update-edit', async (req, res) => {
    const { user: username, date: dateStr } = req.body;
    if (!username) return res.redirect('/login');
    const { reportContent, summaryContent } = calculateScoreAndContent(username, dateStr, req.body);
    await sendToSignal(`✏️ **[${username}] CẬP NHẬT NGÀY ${dateStr}**\n\n` + reportContent);
    setTimeout(async () => { await sendToSignal(summaryContent); }, 1000);
    res.send(`<body style="text-align:center;padding-top:50px;font-family:Arial;"><h1 style="color:green;">✅ Đã Sửa Thành Công!</h1><a href="/?user=${encodeURIComponent(username)}" style="display:inline-block;margin-top:20px;padding:10px 20px;background:#2980b9;color:white;text-decoration:none;border-radius:6px;">Quay Lại</a></body>`);
});

// --- PHẦN BOT TELEGRAM NÂNG CẤP (KHẮC PHỤC HOÀN TOÀN 2 VẤN ĐỀ) ---
const bot = new Telegraf('9115484646:AAHC5Cf_2jEm_jf0iuz7ccwZv3Hgm9Uu80E');
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

bot.start((ctx) => {
    teleSessions[ctx.chat.id] = { loggedIn: false };
    ctx.reply(
        '🤖 **QUẢN LÝ CHIẾN DỊCH (TELEGRAM BOT)**\nĐể bảo mật và không phải gõ mật khẩu lộ thiên, bạn có muốn liên kết nhanh tài khoản này với Telegram không?',
        Markup.inlineKeyboard([
            [Markup.button.callback('⚡ Đăng nhập bằng tên tài khoản (Bỏ qua mật khẩu)', 'tele_quick_login')],
            [Markup.button.callback('🔑 Đăng nhập thủ công (Gõ mật khẩu)', 'tele_manual_login')],
            [Markup.button.callback('📝 Đăng ký tài khoản mới', 'tele_register')]
        ])
    );
});

// 1. Đăng nhập nhanh không cần gõ pass lằng nhằng
bot.action('tele_quick_login', (ctx) => {
    teleSessions[ctx.chat.id].step = 'WAITING_QUICK_USER';
    ctx.reply('👉 Nhập **Tên đăng nhập (Username)** của bạn trên hệ thống:');
});

// 2. Đăng nhập thủ công
bot.action('tele_manual_login', (ctx) => {
    teleSessions[ctx.chat.id].step = 'WAITING_LOGIN_USER';
    ctx.reply('👉 Nhập **Tên đăng nhập**:');
});

bot.action('tele_register', (ctx) => {
    teleSessions[ctx.chat.id].step = 'WAITING_REG_USER';
    ctx.reply('👉 Nhập **Tên đăng nhập mới** muốn tạo:');
});

function showTeleMenu(ctx) {
    const session = teleSessions[ctx.chat.id];
    const username = session.username;
    const history = loadUserHistory(username);
    const cumulativeScore = history.reduce((sum, item) => sum + (item.score || 0), 0);

    ctx.reply(
        `👤 Tài khoản: <b>${username}</b>\n🏆 Tổng điểm tích lũy: <b>${cumulativeScore} điểm</b>\n\nChọn chức năng:`,
        {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('➕ Thêm báo cáo (Chọn ngày tùy ý)', 'tele_choose_date')],
                [Markup.button.callback('📋 Xem lịch sử & Sửa/Xóa', 'tele_list_report')],
                [Markup.button.callback('🚪 Đăng xuất', 'tele_logout')]
            ])
        }
    );
}

bot.action('tele_logout', (ctx) => {
    delete teleSessions[ctx.chat.id];
    ctx.reply('Đã đăng xuất! Gõ /start để khởi động lại.');
});

// CHỌN NGÀY TRƯỚC KHI NHẬP (GIẢI QUYẾT VẤN ĐỀ CHỌN NGÀY ĐỂ NHẬP)
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

// XEM LỊCH SỬ & SỬA/XÓA
bot.action('tele_list_report', (ctx) => {
    const session = teleSessions[ctx.chat.id];
    if (!session || !session.loggedIn) return ctx.reply('Vui lòng đăng nhập lại bằng lệnh /start');

    const history = loadUserHistory(session.username);
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

bot.action(/tele_del_(\d+)/, (ctx) => {
    const session = teleSessions[ctx.chat.id];
    if (!session || !session.loggedIn) return;
    const index = parseInt(ctx.match[1]);

    let history = loadUserHistory(session.username);
    if (index >= 0 && index < history.length) {
        const deleted = history.splice(index, 1)[0];
        saveUserHistory(session.username, history);
        const cumulativeScore = history.reduce((sum, item) => sum + (item.score || 0), 0);
        sendToSignal(`🗑️ **[${session.username}] XÓA BÁO CÁO**\nĐã xóa ngày: ${deleted.date}\n🏆 Tổng điểm: **${cumulativeScore} điểm**`);
        ctx.reply(`✅ Đã xóa ngày ${deleted.date}!`);
        showTeleMenu(ctx);
    }
});

// SỬA NGÀY CŨ (GIẢI QUYẾT VẤN ĐỀ SỬA NHỮNG NGÀY TRƯỚC)
bot.action(/tele_edit_(\d+)/, (ctx) => {
    const session = teleSessions[ctx.chat.id];
    if (!session || !session.loggedIn) return;
    const index = parseInt(ctx.match[1]);

    let history = loadUserHistory(session.username);
    if (index >= 0 && index < history.length) {
        const item = history[index];
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

    // 1. Đăng nhập nhanh
    if (session.step === 'WAITING_QUICK_USER') {
        const users = loadUsers();
        const user = users.find(u => u.username === text);
        if (user) {
            session.loggedIn = true;
            session.username = text;
            delete session.step;
            ctx.reply('✅ Đăng nhập nhanh thành công!');
            return showTeleMenu(ctx);
        } else {
            delete teleSessions[ctx.chat.id];
            return ctx.reply('❌ Không tìm thấy tài khoản này! Gõ /start để thử lại.');
        }
    }

    // 2. Đăng nhập thủ công
    if (session.step === 'WAITING_LOGIN_USER') {
        session.tempUser = text;
        session.step = 'WAITING_LOGIN_PASS';
        ctx.reply('👉 Nhập **Mật khẩu** (Lưu ý: trên Telegram sẽ hiển thị chữ, hãy đảm bảo không bị người khác nhìn thấy):');
        return;
    }
    if (session.step === 'WAITING_LOGIN_PASS') {
        const users = loadUsers();
        const user = users.find(u => u.username === session.tempUser && u.password === text);
        if (user) {
            session.loggedIn = true;
            session.username = session.tempUser;
            delete session.step;
            ctx.reply('✅ Đăng nhập thành công!');
            return showTeleMenu(ctx);
        } else {
            delete teleSessions[ctx.chat.id];
            return ctx.reply('❌ Sai mật khẩu! Gõ /start để thử lại.');
        }
    }

    // 3. Đăng ký tài khoản
    if (session.step === 'WAITING_REG_USER') {
        session.tempRegUser = text;
        session.step = 'WAITING_REG_PASS';
        ctx.reply('👉 Nhập **Mật khẩu mới**:');
        return;
    }
    if (session.step === 'WAITING_REG_PASS') {
        session.tempRegPass = text;
        session.step = 'WAITING_REG_SECRET';
        ctx.reply('👉 Nhập **Từ khóa bí mật**:');
        return;
    }
    if (session.step === 'WAITING_REG_SECRET') {
        let users = loadUsers();
        if (users.some(u => u.username === session.tempRegUser)) {
            delete teleSessions[ctx.chat.id];
            return ctx.reply('❌ Tên đăng nhập đã tồn tại!');
        }
        users.push({ username: session.tempRegUser, password: session.tempRegPass, secret: text });
        saveUsers(users);
        delete teleSessions[ctx.chat.id];
        return ctx.reply('🎉 Đăng ký thành công! Gõ /start để đăng nhập.');
    }

    // 4. Nhập ngày tùy ý khi tạo báo cáo mới
    if (session.step === 'WAITING_CUSTOM_DATE') {
        session.reportDate = text;
        delete session.step;
        return startReportSteps(ctx);
    }

    // 5. Tiến trình nhập liệu 10 chỉ số
    if (session.loggedIn && session.reportStep !== undefined) {
        const currentStepConfig = steps[session.reportStep];
        session.reportData[currentStepConfig.key] = text;
        session.reportStep++;

        if (session.reportStep < steps.length) {
            const nextStepConfig = steps[session.reportStep];
            return ctx.reply(`👉 **${nextStepConfig.label}:**`);
        } else {
            const { reportContent, summaryContent } = calculateScoreAndContent(session.username, session.reportDate, session.reportData);

            await ctx.reply(`📋 **KẾT QUẢ BÁO CÁO (${session.reportDate}):**\n\n${reportContent}\n\n${summaryContent}`);
            try {
                await sendToSignal(`📥 **BÁO CÁO [${session.username}] - ${session.reportDate} (TELE)**\n\n` + reportContent);
                setTimeout(async () => { await sendToSignal(summaryContent); }, 1000);
                await ctx.reply('✅ Đã đẩy dữ liệu báo cáo sang Signal thành công!');
            } catch (e) {
                console.error('Lỗi Signal:', e.message);
            }

            delete session.reportStep;
            delete session.reportData;
            delete session.reportDate;
            return showTeleMenu(ctx);
        }
    }

    ctx.reply('Vui lòng sử dụng các nút bấm hoặc gõ /start để tiếp tục.');
});

app.listen(PORT, () => { console.log(`Web App đang chạy trên cổng ${PORT}`); });
bot.launch();
