const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const express = require('express');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');

// Khởi tạo HTTP Server trên Render
const app = express();
const PORT = process.env.PORT || 3000;

// Cấu hình để Express đọc được dữ liệu gửi từ Web Form
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const HISTORY_FILE = path.join(__dirname, 'history.json');

// Hàm đọc/ghi lịch sử điểm số
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

// --- GIAO DIỆN WEB DASHBOARD CHO CƯỜNG NHẬP LIỆU ---
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="vi">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Báo Cáo Chiến Dịch 60 Ngày</title>
            <style>
                body { font-family: Arial, sans-serif; background: #f4f6f9; margin: 0; padding: 20px; }
                .container { max-width: 500px; margin: 0 auto; background: white; padding: 20px; border-radius: 12px; box-shadow: 0 4px 10px rgba(0,0,0,0.1); }
                h2 { text-align: center; color: #2c3e50; }
                .section-title { background: #34495e; color: white; padding: 8px 12px; border-radius: 6px; margin-top: 20px; font-size: 15px; }
                .form-group { margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center; }
                label { font-size: 14px; color: #333; flex: 2; }
                input { width: 70px; padding: 6px; text-align: center; border: 1px solid #ccc; border-radius: 6px; font-size: 14px; flex: 1; }
                button { width: 100%; background: #27ae60; color: white; border: none; padding: 12px; border-radius: 6px; font-size: 16px; font-weight: bold; margin-top: 25px; cursor: pointer; }
                button:hover { background: #219653; }
            </style>
        </head>
        <body>
            <div class="container">
                <h2>🚀 Báo Cáo Chiến Dịch</h2>
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

                    <button type="submit">📤 Gửi Báo Cáo Ngay</button>
                </form>
            </div>
        </body>
        </html>
    `);
});

// Xử lý khi bấm nút Gửi trên Web
app.post('/submit-report', async (req, res) => {
    const d = req.body;

    // Tính điểm
    const p1 = (Number(d.tinNguong) + Number(d.kinhThanh) + Number(d.sachLT) + Number(d.tapGd)) * 10;
    const p2 = (Number(d.baiMoi) * 100) + (Number(d.baiCu) * 100) + (Number(d.edu) * 40);
    const p3 = (Number(d.donThuan) * 10) + (Number(d.huuHieu) * 100) + (Number(d.ketTrai) * 500);
    const totalDayScore = p1 + p2 + p3;

    const today = new Date();
    const dd = String(today.getDate()).padStart(2, '0');
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const yyyy = today.getFullYear();
    const currentDateStr = `${dd}/${mm}/${yyyy}`;

    // Lưu vào history
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

        // Gửi 2 tin nhắn sang Signal
        await axios.get(`https://signal.callmebot.com/signal/send.php?phone=${phone}&apikey=${apikey}&text=${encodeURIComponent(reportContent)}`);
        setTimeout(async () => {
            await axios.get(`https://signal.callmebot.com/signal/send.php?phone=${phone}&apikey=${apikey}&text=${encodeURIComponent(summaryContent)}`);
        }, 1000);

        res.send(`
            <!DOCTYPE html>
            <html lang="vi">
            <head><meta charset="UTF-8"><title>Thành Công</title></head>
            <body style="text-align:center; padding-top:50px; font-family:Arial;">
                <h1 style="color:green;">✅ Gửi Báo Cáo Thành Công!</h1>
                <p>Số liệu và điểm tích lũy đã được gửi thẳng sang Signal của bạn.</p>
                <a href="/" style="display:inline-block; margin-top:20px; padding:10px 20px; background:#2980b9; color:white; text-decoration:none; border-radius:6px;">Nhập Báo Cáo Tiếp</a>
            </body>
            </html>
        `);
    } catch (error) {
        res.send(`<h3 style="color:red;">❌ Gửi sang Signal thất bại: ${error.message}</h3><a href="/">Quay lại</a>`);
    }
});

// --- PHẦN BOT TELEGRAM VẪN GIỮ NGUYÊN HOẠT ĐỘNG ---
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

bot.start((ctx) => { savedChatId = ctx.chat.id; ctx.reply('Bot & Web Dashboard đã sẵn sàng!', persistentKeyboard); });
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
            await bot.telegram.sendMessage(savedChatId, '⏰ **Đến giờ báo cáo chiến dịch rồi Cường ơi!** Bấm nút dưới hoặc truy cập Web Dashboard để nhập nhé:', persistentKeyboard);
        } catch (e) { console.error(e.message); }
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
                await axios.get(`https://signal.callmebot.com/signal/send.php?phone=${phone}&apikey=${apikey}&text=${encodeURIComponent(summaryContent)}`);
            }, 1000);
            await ctx.reply('✅ **Đã gửi báo cáo tích lũy sang Signal thành công!**', persistentKeyboard);
        } catch (e) {
            await ctx.reply('❌ Gửi sang Signal thất bại.', persistentKeyboard);
        }
        delete sessions[chatId];
    }
});

app.listen(PORT, () => {
    console.log(`Web Dashboard và Bot đang chạy trên cổng ${PORT}`);
});
bot.launch();
