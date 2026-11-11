const { Telegraf } = require('telegraf');
const axios = require('axios');
const express = require('express');

// Khởi tạo HTTP Server giả lập cho Render
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('Bot Telegram đang chạy ngầm 24/7 ổn định!');
});

app.listen(PORT, () => {
    console.log(`HTTP Server đang lắng nghe trên cổng ${PORT}`);
});

// Khởi tạo bot
const bot = new Telegraf('9115484646:AAHC5Cf_2jEm_jf0iuz7ccwZv3Hgm9Uu80E');

const userSessions = {};

const steps = [
    { key: 'tinNguong', label: '🔰Đánh Giá Tín Ngưỡng' },
    { key: 'kinhThanh', label: '🔰Kinh thánh' },
    { key: 'sachLT', label: '🔰Sách LT' },
    { key: 'tapGd', label: '🔰Tập Gđ' },
    { key: 'baiMoi', label: '🔰Bài mới (Phát biểu)' },
    { key: 'baiCu', label: '🔰Bài cũ (Phát biểu)' },
    { key: 'edu', label: '🔰EDU (Phát biểu)' },
    { key: 'donThuan', label: '🔰Đơn Thuần (Truda)' },
    { key: 'huuHieu', label: '🔰Hữu Hiệu (Truda)' },
    { key: 'ketTrai', label: '🔰Kết trái (Truda)' }
];

bot.command('nhacnho', (ctx) => {
    const chatId = ctx.chat.id;
    userSessions[chatId] = { stepIndex: 0, data: {} };
    ctx.reply(`🚀 **BẮT ĐẦU BÁO CÁO NHANH**\nNhập số cho mục sau:\n\n👉 **${steps[0].label}:**`);
});

bot.on('text', async (ctx) => {
    const chatId = ctx.chat.id;
    const text = ctx.message.text;

    if (text.startsWith('/')) return; // Bỏ qua nếu là lệnh khác

    let session = userSessions[chatId];

    // Nếu bot quên session, tự động khởi tạo lại từ đầu để không bị kẹt
    if (!session) {
        if (text.includes('🌟MYPAGE🌟')) {
            await sendToSignal(ctx, text);
            return;
        }
        session = { stepIndex: 0, data: {} };
        userSessions[chatId] = session;
    }

    const currentStep = steps[session.stepIndex];
    session.data[currentStep.key] = text;
    session.stepIndex++;

    if (session.stepIndex < steps.length) {
        const nextStep = steps[session.stepIndex];
        await ctx.reply(`👉 **${nextStep.label}:**`);
    } else {
        const d = session.data;
        const finalReport = `🌟MYPAGE🌟\n🔰Đánh Giá Tín Ngưỡng: ${d.tinNguong}\n🔰Kinh thánh: ${d.kinhThanh}\n🔰Sách LT: ${d.sachLT}\n🔰Tập Gđ: ${d.tapGd}\n🎊PHÁT BIỂU🎉\n🔰Bài mới: ${d.baiMoi}\n🔰Bài cũ: ${d.baiCu}\n🔰EDU: ${d.edu}\n🔥TRUDA🔥\n🔰Đơn Thuần: ${d.donThuan}\n🔰Hữu Hiệu: ${d.huuHieu}\n🔰Kết trái: ${d.ketTrai}`;

        await ctx.reply(`📋 **ĐÃ TỔNG HỢP XONG:**\n\n${finalReport}\n\n⏳ Đang gửi sang Signal...`);
        await sendToSignal(ctx, finalReport);
        delete userSessions[chatId];
    }
});

async function sendToSignal(ctx, reportText) {
    try {
        const phone = 'f774da57-44c0-4e4e-8f57-4e4fd53490a0';
        const apikey = '911098';
        const url = `https://signal.callmebot.com/signal/send.php?phone=${phone}&apikey=${apikey}&text=${encodeURIComponent(`[Báo cáo từ Telegram]\n\n${reportText}`)}`;
        
        await axios.get(url);
        await ctx.reply('✅ **Đã gửi báo cáo thành công sang Signal!**');
    } catch (error) {
        console.error('Lỗi gửi Signal:', error.message);
        await ctx.reply('❌ Gửi sang Signal thất bại.');
    }
}

bot.launch();
console.log('Bot báo cáo đang chạy...');
