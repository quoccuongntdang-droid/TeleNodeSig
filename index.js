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

const HISTORY_FILE = path.join(__dirname, 'history.json');

function loadHistory() {
    try {
        if (fs.existsSync(HISTORY_FILE)) {
            const data = fs.readFileSync(HISTORY_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (e) {
        console.error('Lỗi đọc lịch sử:', e.message);
    }
    return [];
}

function saveHistory(history) {
    try {
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf8');
    } catch (e) {
        console.error('Lỗi ghi lịch sử:', e.message);
    }
}

// --- GIAO DIỆN WEB DASHBOARD (CÓ FORM NHẬP & BẢNG QUẢN LÝ LỊCH SỬ) ---
app.get('/', (req, res) => {
    const history = loadHistory();
    const cumulativeScore = history.reduce((sum, item) => sum + (item.score || 0), 0);

    let historyRows = history.map((item, index) => `
        <tr>
            <td style="padding: 8px; border-bottom: 1px solid #ddd; text-align:center;">${item.date}</td>
            <td style="padding: 8px; border-bottom: 1px solid #ddd; text-align:center; font-weight:bold; color:#27ae60;">+${item.score} đ</td>
            <td style="padding: 8px; border-bottom: 1px solid #ddd; text-align:center;">
                <a href="/edit?index=${index}" style="background:#f39c12; color:white; padding:4px 8px; text-decoration:none; border-radius:4px; font-size:12px; margin-right:4px;">Sửa</a>
                <a href="/delete?index=${index}" onclick="return confirm('Bạn có chắc muốn xóa ngày này không?');" style="background:#e74c3c; color:white; padding:4px 8px; text-decoration:none; border-radius:4px; font-size:12px;">Xóa</a>
            </td>
        </tr>
    `).join('');

    res.send(`
        <!DOCTYPE html>
        <html lang="vi">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Quản Lý Chiến Dịch 60 Ngày</title>
            <style>
                body { font-family: Arial, sans-serif; background: #f4f6f9; margin: 0; padding: 15px; }
                .container { max-width: 550px; margin: 0 auto; background: white; padding: 20px; border-radius: 12px; box-shadow: 0 4px 10px rgba(0,0,0,0.1); }
                h2, h3 { text-align: center; color: #2c3e50; }
                .section-title { background: #34495e; color: white; padding: 8px 12px; border-radius: 6px; margin-top: 20px; font-size: 15px; }
                .form-group { margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center; }
                label { font-size: 14px; color: #333; flex: 2; }
                input { width: 70px; padding: 6px; text-align: center; border: 1px solid #ccc; border-radius: 6px; font-size: 14px; flex: 1; }
                button { width: 100%; background: #27ae60; color: white; border: none; padding: 12px; border-radius: 6px; font-size: 16px; font-weight: bold; margin-top: 20px; cursor: pointer; }
                button:hover { background: #219653; }
                .stats-box { background: #e8f8f5; border: 1px solid #a3e4d7; padding: 12px; border-radius: 8px; text-align: center; margin-bottom: 20px; }
                table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 14px; }
                th { background: #ecf0f1; padding: 8px; border-bottom: 2px solid #bdc3c7; }
            </style>
        </head>
        <body>
            <div class="container">
                <h2>🚀 Quản Lý Chiến Dịch</h2>
                
                <div class="stats-box">
                    🏆 Tổng điểm tích lũy toàn chiến dịch: <b style="color: #27ae60; font-size: 18px;">${cumulativeScore} điểm</b>
                </div>

                <form action="/submit-report" method="POST">
                    <div class="section-title">🌟 MY PAGE (Nhập 0 hoặc 1)</div>
                    <div class="form-group"><label>Đánh Giá Tín Ngưỡng:</label><input type="number" name="tinNguong" value="1" min="0" max="1" required></div>
                    <div class="form-group"><label>Kinh thánh:</label><input type="number" name="kinhThanh" value="1" min="0" max="1" required></div>
                    <div class="form-group"><label>Sách LT:</label><input type="number" name="sachLT" value="1" min="0" max="1" required></div>
                    <div class="form-group"><label>Tập Gđ:</label><input type="number" name="tapGd" value="1" min="0" max="1" required></div>

                    <div class="section-title">🎊 PHÁT BIỂU & EDU (Nhập số lượng)</div>
                    <div class="form-group"><label>Bài mới:</label><input type="number" name="baiMoi" value="0" min="0" required></div>
                    <div class="form-group"><label>Bài cũ:</label><input type="number" name="baiCu" value="0" min="0" required></div>
                    <div class="form-group"><label>EDU:</label><input type="number" name="edu" value="0" min="0" required></div>

                    <div class="section-title">🔥 TRUDA (Nhập số lượng)</div>
                    <div class="form-group"><label>Đơn Thuần:</label><input type="number" name="donThuan" value="0" min="0" required></div>
                    <div class="form-group"><label>Hữu Hiệu:</label><input type="number" name="huuHieu" value="0" min="0" required></div>
                    <div class="form-group"><label>Kết trái:</label><input type="number" name="ketTrai" value="0" min="0" required></div>

                    <button type="submit">📤 Gửi Báo Cáo Hôm Nay</button>
                </form>

                <div class="section-title" style="margin-top:30px;">📋 Lịch Sử Báo Cáo Các Ngày</div>
                <table>
                    <thead>
                        <tr><th>Ngày</th><th>Điểm</th><th>Thao Tác</th></tr>
                    </thead>
                    <tbody>
                        ${historyRows.length > 0 ? historyRows : '<tr><td colspan="3" style="text-align:center; padding:10px;">Chưa có dữ liệu lịch sử</td></tr>'}
                    </tbody>
                </table>
            </div>
        </body>
        </html>
    `);
});

// Xử lý Gửi báo cáo mới
app.post('/submit-report', async (req, res) => {
    const d = req.body;
    const p1 = (Number(d.tinNguong) + Number(d.kinhThanh) + Number(d.sachLT) + Number(d.tapGd)) * 10;
    const p2 = (Number(d.baiMoi) * 100) + (Number(d.baiCu) * 100) + (Number(d.edu) * 40);
    const p3 = (Number(d.donThuan) * 10) + (Number(d.huuHieu) * 100) + (Number(d.ketTrai) * 500);
    const totalDayScore = p1 + p2 + p3;

    const today = new Date();
    const dd = String(today.getDate()).padStart(2, '0');
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const yyyy = today.getFullYear();
    const currentDateStr = `${dd}/${mm}/${yyyy}`;

    let history = loadHistory();
    const existingIndex = history.findIndex(item => item.date === currentDateStr);
    if (existingIndex >= 0) {
        history[existingIndex].score = totalDayScore;
    } else {
        history.push({ date: currentDateStr, score: totalDayScore });
    }
    saveHistory(history);

    const cumulativeScore = history.reduce((sum, item) => sum + item.score, 0);
    const startDate = new Date('2026-11-01');
    const diffTime = Math.abs(today - startDate);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    const progressPercent = Math.min(Math.max((diffDays / 60) * 100, 0), 100).toFixed(1);

    const reportContent = `CPN KVT - Ngày ${currentDateStr}\n\n🌟MYPAGE🌟\n🔰Đánh Giá Tín Ngưỡng: ${d.tinNguong}\n🔰Kinh thánh: ${d.kinhThanh}\n🔰Sách LT: ${d.sachLT}\n🔰Tập Gđ: ${d.tapGd}\n🎊PHÁT BIỂU🎉\n🔰Bài mới: ${d.baiMoi}\n🔰Bài cũ: ${d.baiCu}\n🔰EDU: ${d.edu}\n🔥TRUDA🔥\n🔰Đơn Thuần: ${d.donThuan}\n🔰Hữu Hiệu: ${d.huuHieu}\n🔰Kết trái: ${d.ketTrai}`;
    const summaryContent = `📊 **TỔNG KẾT TÍCH LŨY:**\n⭐ Điểm ngày (${currentDateStr}): **+${totalDayScore} điểm**\n🏆 **Tổng điểm tích lũy:** **${cumulativeScore} điểm**\n📈 Tiến độ 60 ngày: **${progressPercent}%** (Ngày thứ ${diffDays}/60)`;

    try {
        const phone = 'f774da57-44c0-4e4e-8f57-4e4fd53490a0';
        const apikey = '911098';
        await axios.get(`https://signal.callmebot.com/signal/send.php?phone=${phone}&apikey=${apikey}&text=${encodeURIComponent(reportContent)}`);
        setTimeout(async () => {
            await axios.get(`https://signal.callmebot.com/signal/send.php?phone=${phone}&apikey=${apikey}&text=${encodeURIComponent(summaryContent)}`);
        }, 1000);

        res.send(`
            <body style="text-align:center; padding-top:50px; font-family:Arial;">
                <h1 style="color:green;">✅ Gửi & Cập Nhật Thành Công!</h1>
                <a href="/" style="display:inline-block; margin-top:20px; padding:10px 20px; background:#2980b9; color:white; text-decoration:none; border-radius:6px;">Quay Lại Trang Chủ</a>
            </body>
        `);
    } catch (e) {
        res.send(`<h3 style="color:red;">Lỗi gửi Signal: ${e.message}</h3><a href="/">Quay lại</a>`);
    }
});

// Xử lý Xóa lịch sử một ngày
app.get('/delete', (req, res) => {
    const index = parseInt(req.query.index);
    let history = loadHistory();
    if (!isNaN(index) && index >= 0 && index < history.length) {
        history.splice(index, 1);
        saveHistory(history);
    }
    res.redirect('/');
});

// Xử lý Sửa lịch sử (Giao diện đơn giản để nhập lại điểm số ngày đó)
app.get('/edit', (req, res) => {
    const index = parseInt(req.query.index);
    let history = loadHistory();
    if (isNaN(index) || index < 0 || index >= history.length) {
        return res.redirect('/');
    }
    const item = history[index];

    res.send(`
        <!DOCTYPE html>
        <html lang="vi">
        <head><meta charset="UTF-8"><title>Sửa Điểm Ngày ${item.date}</title></head>
        <body style="font-family:Arial; padding:20px; background:#f4f6f9;">
            <div style="max-width:400px; margin:0 auto; background:white; padding:20px; border-radius:8px;">
                <h3>Sửa Điểm Cho Ngày: ${item.date}</h3>
                <form action="/update-edit" method="POST">
                    <input type="hidden" name="index" value="${index}">
                    <label>Nhập lại tổng điểm cho ngày này:</label>
                    <input type="number" name="newScore" value="${item.score}" style="width:100%; padding:8px; margin:15px 0; box-sizing:border-box;" required>
                    <button type="submit" style="width:100%; background:#27ae60; color:white; border:none; padding:10px; border-radius:5px; font-weight:bold;">Lưu Thay Đổi</button>
                </form>
                <a href="/" style="display:block; text-align:center; margin-top:15px; color:#555; text-decoration:none;">Quay lại</a>
            </div>
        </body>
        </html>
    `);
});

app.post('/update-edit', (req, res) => {
    const index = parseInt(req.body.index);
    const newScore = parseInt(req.body.newScore);
    let history = loadHistory();
    if (!isNaN(index) && index >= 0 && index < history.length && !isNaN(newScore)) {
        history[index].score = newScore;
        saveHistory(history);
    }
    res.redirect('/');
});

// --- PHẦN BOT TELEGRAM VẪN GIỮ NGUYÊN ---
const bot = new Telegraf('9115484646:AAHC5Cf_2jEm_jf0iuz7ccwZv3Hgm9Uu80E');
let savedChatId = null;
const steps = [
    { key: 'tinNguong', label: '🔰 Đánh Giá Tín Ngưỡng' },
    { key: 'kinhThanh', label: '🔰 Kinh thánh' },
    { key: 'sachLT', label: '🔰 Sách LT' },
    { key: 'tapGd', label: '🔰 Tập Gđ' },
    { key: 'baiMoi', label: '🔰 Bài mới (Phát biểu)' },
    { key: 'baiCu', label: '🔰 Bài cũ (Phát biểu)' },
    { key: 'edu', label: '🔰 EDU (Phát biểu)' },
    { key: 'donThuan', label: '🔰 Đơn Thuần (Truda)' },
    { key: 'huuHieu', label: '🔰 Hữu Hiệu (Truda)' },
    { key: 'ketTrai', label: '🔰 Kết trái (Truda)' }
];
const sessions = {};
const persistentKeyboard = Markup.keyboard([['🚀 Bắt Đầu Báo Cáo Nhanh']]).resize();

bot.start((ctx) => { savedChatId = ctx.chat.id; ctx.reply('Bot & Web Quản Lý đã sẵn sàng!', persistentKeyboard); });
bot.hears('🚀 Bắt Đầu Báo Cáo Nhanh', (ctx) => { savedChatId = ctx.chat.id; startReportSession(ctx); });
bot.command('nhacnho', (ctx) => { savedChatId = ctx.chat.id; startReportSession(ctx); });

async function startReportSession(ctx) {
    const chatId = ctx.chat.id;
    sessions[chatId] = { step: 0, data: {} };
    await ctx.reply(`🚀 **BÁO CÁO CHIẾN DỊCH**\nNhập số cho mục:\n\n👉 **${steps[0].label}:**`, persistentKeyboard);
}

cron.schedule('0 21 * * *', async () => {
    if (savedChatId) {
        try {
            await bot.telegram.sendMessage(savedChatId, '⏰ **Đến giờ báo cáo chiến dịch rồi Cường ơi!** Truy cập Web Dashboard để quản lý và nhập liệu nhé:', persistentKeyboard);
        } catch (e) {}
    }
}, { timezone: "Asia/Ho_Chi_Minh" });

bot.on('text', async (ctx) => {
    const chatId = ctx.chat.id;
    savedChatId = chatId;
    const text = ctx.message.text;
    if (text.startsWith('/') || text === '🚀 Bắt Đầu Báo Cáo Nhanh') return;

    let session = sessions[chatId];
    if (!session) {
        await ctx.reply('Cường ơi, hãy bấm nút **🚀 Bắt Đầu Báo Cáo Nhanh** phía dưới nhé!', persistentKeyboard);
        return;
    }

    const currentStep = steps[session.step];
    session.data[currentStep.key] = text;
    session.step++;

    if (session.step < steps.length) {
        const nextStep = steps[session.step];
        await ctx.reply(`👉 **${nextStep.label}:**`, persistentKeyboard);
    } else {
        const d = session.data;
        const p1 = (Number(d.tinNguong) + Number(d.kinhThanh) + Number(d.sachLT) + Number(d.tapGd)) * 10;
        const p2 = (Number(d.baiMoi) * 100) + (Number(d.baiCu) * 100) + (Number(d.edu) * 40);
        const p3 = (Number(d.donThuan) * 10) + (Number(d.huuHieu) * 100) + (Number(d.ketTrai) * 500);
        const totalDayScore = p1 + p2 + p3;

        const today = new Date();
        const dd = String(today.getDate()).padStart(2, '0');
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const yyyy = today.getFullYear();
        const currentDateStr = `${dd}/${mm}/${yyyy}`;

        let history = loadHistory();
        const existingIndex = history.findIndex(item => item.date === currentDateStr);
        if (existingIndex >= 0) history[existingIndex].score = totalDayScore;
        else history.push({ date: currentDateStr, score: totalDayScore });
        saveHistory(history);

        const cumulativeScore = history.reduce((sum, item) => sum + item.score, 0);
        const startDate = new Date('2026-11-01');
        const diffTime = Math.abs(today - startDate);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        const progressPercent = Math.min(Math.max((diffDays / 60) * 100, 0), 100).toFixed(1);

        const reportContent = `CPN KVT - Ngày ${currentDateStr}\n\n🌟MYPAGE🌟\n🔰Đánh Giá Tín Ngưỡng: ${d.tinNguong}\n🔰Kinh thánh: ${d.kinhThanh}\n🔰Sách LT: ${d.sachLT}\n🔰Tập Gđ: ${d.tapGd}\n🎊PHÁT BIỂU🎉\n🔰Bài mới: ${d.baiMoi}\n🔰Bài cũ: ${d.baiCu}\n🔰EDU: ${d.edu}\n🔥TRUDA🔥\n🔰Đơn Thuần: ${d.donThuan}\n🔰Hữu Hiệu: ${d.huuHieu}\n🔰Kết trái: ${d.ketTrai}`;
        const summaryContent = `📊 **TỔNG KẾT TÍCH LŨY:**\n⭐ Điểm ngày (${currentDateStr}): **+${totalDayScore} điểm**\n🏆 **Tổng điểm tích lũy:** **${cumulativeScore} điểm**\n📈 Tiến độ 60 ngày: **${progressPercent}%** (Ngày thứ ${diffDays}/60)`;

        await ctx.reply(`📋 **ĐÃ TỔNG HỢP XONG:**\n\n${reportContent}\n\n${summaryContent}`, persistentKeyboard);
        
        try {
            const phone = 'f774da57-44c0-4e4e-8f57-4e4fd53490a0';
            const apikey = '911098';
            await axios.get(`https://signal.callmebot.com/signal/send.php?phone=${phone}&apikey=${apikey}&text=${encodeURIComponent(reportContent)}`);
            setTimeout(async () => {
                await axios.get(`https://signal.callmebox.com/signal/send.php?phone=${phone}&apikey=${apikey}&text=${encodeURIComponent(summaryContent)}`);
            }, 1000);
            await ctx.reply('✅ **Đã gửi báo cáo tích lũy sang Signal thành công!**', persistentKeyboard);
        } catch (e) {}
        delete sessions[chatId];
    }
});

app.listen(PORT, () => {
    console.log(`Web Dashboard quản lý đang chạy trên cổng ${PORT}`);
});
bot.launch();
