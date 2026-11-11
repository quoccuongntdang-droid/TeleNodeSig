const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const express = require('express');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');

// Khởi tạo HTTP Server giả lập cho Render
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('Bot chiến dịch tích lũy điểm đang chạy ngầm 24/7!');
});

app.listen(PORT, () => {
    console.log(`HTTP Server đang lắng nghe trên cổng ${PORT}`);
});

// Khởi tạo bot
const bot = new Telegraf('9115484646:AAHC5Cf_2jEm_jf0iuz7ccwZv3Hgm9Uu80E');

let savedChatId = null;
const HISTORY_FILE = path.join(__dirname, 'history.json');

// Danh sách các bước báo cáo
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

// Hàm đọc lịch sử điểm số
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

// Hàm ghi lịch sử điểm số
function saveHistory(history) {
    try {
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf8');
    } catch (e) {
        console.error('Lỗi ghi lịch sử:', e.message);
    }
}

// Bàn phím nút bấm cố định dưới ô chat
const persistentKeyboard = Markup.keyboard([
    ['🚀 Bắt Đầu Báo Cáo Nhanh']
]).resize();

// Khi gõ /start
bot.start((ctx) => {
    savedChatId = ctx.chat.id;
    ctx.reply('Chào Cường! Bot quản lý chiến dịch tích lũy điểm đã sẵn sàng.', persistentKeyboard);
});

bot.hears('🚀 Bắt Đầu Báo Cáo Nhanh', (ctx) => {
    savedChatId = ctx.chat.id;
    startReportSession(ctx);
});

bot.command('nhacnho', (ctx) => {
    savedChatId = ctx.chat.id;
    startReportSession(ctx);
});

async function startReportSession(ctx) {
    const chatId = ctx.chat.id;
    sessions[chatId] = { step: 0, data: {} };
    await ctx.reply(`🚀 **BÁO CÁO CHIẾN DỊCH**\nNhập số cho mục:\n\n👉 **${steps[0].label}:**`, persistentKeyboard);
}

// Lịch hẹn tự động nhắc nhở lúc 21:00 hằng ngày
cron.schedule('0 21 * * *', async () => {
    if (savedChatId) {
        try {
            await bot.telegram.sendMessage(
                savedChatId, 
                '⏰ **Đến giờ báo cáo chiến dịch rồi Cường ơi!** Hãy bấm nút bên dưới để cập nhật số liệu nhé:', 
                persistentKeyboard
            );
        } catch (error) {
            console.error('Lỗi gửi tin nhắn định giờ:', error.message);
        }
    }
}, {
    timezone: "Asia/Ho_Chi_Minh"
});

// Lắng nghe tin nhắn văn bản bạn tự gõ từng bước
bot.on('text', async (ctx) => {
    const chatId = ctx.chat.id;
    savedChatId = chatId;
    const text = ctx.message.text;

    if (text.startsWith('/') || text === '🚀 Bắt Đầu Báo Cáo Nhanh') return;

    let session = sessions[chatId];

    if (!session) {
        if (text.includes('🌟MYPAGE🌟')) {
            await sendToSignal(ctx, text);
            return;
        }
        await ctx.reply('Cường ơi, hãy bấm nút **🚀 Bắt Đầu Báo Cáo Nhanh** phía dưới trước nhé!', persistentKeyboard);
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

        // --- TÍNH TOÁN ĐIỂM SỐ NGÀY HÔM NAY ---
        const p1 = (Number(d.tinNguong) + Number(d.kinhThanh) + Number(d.sachLT) + Number(d.tapGd)) * 10;
        const p2 = (Number(d.baiMoi) * 100) + (Number(d.baiCu) * 100) + (Number(d.edu) * 40);
        const p3 = (Number(d.donThuan) * 10) + (Number(d.huuHieu) * 100) + (Number(d.ketTrai) * 500);
        const totalDayScore = p1 + p2 + p3;

        // Lấy ngày tháng hiện tại
        const today = new Date();
        const dd = String(today.getDate()).padStart(2, '0');
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const yyyy = today.getFullYear();
        const currentDateStr = `${dd}/${mm}/${yyyy}`;

        // Cập nhật lịch sử điểm số vào file history.json
        let history = loadHistory();
        const existingIndex = history.findIndex(item => item.date === currentDateStr);
        if (existingIndex >= 0) {
            history[existingIndex].score = totalDayScore;
        } else {
            history.push({ date: currentDateStr, score: totalDayScore });
        }
        saveHistory(history);

        // Tính tổng điểm tích lũy toàn chiến dịch
        const cumulativeScore = history.reduce((sum, item) => sum + item.score, 0);

        // Tính % tiến độ chiến dịch (01/11 - 30/12, tổng 60 ngày)
        const startDate = new Date('2026-11-01');
        const diffTime = Math.abs(today - startDate);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        const progressPercent = Math.min(Math.max((diffDays / 60) * 100, 0), 100).toFixed(1);

        // Nội dung tin nhắn
        const reportContent = `CPN KVT - Ngày ${currentDateStr}\n\n🌟MYPAGE🌟\n🔰Đánh Giá Tín Ngưỡng: ${d.tinNguong}\n🔰Kinh thánh: ${d.kinhThanh}\n🔰Sách LT: ${d.sachLT}\n🔰Tập Gđ: ${d.tapGd}\n🎊PHÁT BIỂU🎉\n🔰Bài mới: ${d.baiMoi}\n🔰Bài cũ: ${d.baiCu}\n🔰EDU: ${d.edu}\n🔥TRUDA🔥\n🔰Đơn Thuần: ${d.donThuan}\n🔰Hữu Hiệu: ${d.huuHieu}\n🔰Kết trái: ${d.ketTrai}`;

        const summaryContent = `📊 **TỔNG KẾT TÍCH LŨY:**\n⭐ Điểm ngày (${currentDateStr}): **+${totalDayScore} điểm**\n🏆 **Tổng điểm tích lũy:** **${cumulativeScore} điểm**\n📈 Tiến độ 60 ngày: **${progressPercent}%** (Ngày thứ ${diffDays}/60)`;

        await ctx.reply(`📋 **ĐÃ TỔNG HỢP XONG:**\n\n${reportContent}\n\n${summaryContent}`, persistentKeyboard);
        
        try {
            const phone = 'f774da57-44c0-4e4e-8f57-4e4fd53490a0';
            const apikey = '911098';

            // Gửi tin nhắn 1: Báo cáo chính
            const url1 = `https://signal.callmebot.com/signal/send.php?phone=${phone}&apikey=${apikey}&text=${encodeURIComponent(reportContent)}`;
            await axios.get(url1);

            // Đợi 1 giây rồi gửi tin nhắn 2: Tổng kết tích lũy
            setTimeout(async () => {
                const url2 = `https://signal.callmebot.com/signal/send.php?phone=${phone}&apikey=${apikey}&text=${encodeURIComponent(summaryContent)}`;
                await axios.get(url2);
            }, 1000);

            await ctx.reply('✅ **Đã gửi báo cáo và tổng kết tích lũy sang Signal thành công!**', persistentKeyboard);
        } catch (error) {
            console.error('Lỗi gửi Signal:', error.message);
            await ctx.reply('❌ Gửi sang Signal thất bại.', persistentKeyboard);
        }
        delete sessions[chatId];
    }
});

bot.launch();
console.log('Bot quản lý chiến dịch tích lũy điểm đang chạy ổn định...');
