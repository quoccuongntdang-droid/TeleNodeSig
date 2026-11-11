const { Telegraf, Markup } = require('telegraf');
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

// Bàn phím nút bấm cố định dưới ô chat
const persistentKeyboard = Markup.keyboard([
    ['🚀 Bắt Đầu Báo Cáo Nhanh']
]).resize();

// Khi gõ /start
bot.start((ctx) => {
    ctx.reply('Chào Cường! Bấm nút bên dưới để bắt đầu báo cáo:', persistentKeyboard);
});

// Bắt sự kiện khi bấm nút cố định hoặc gõ /nhacnho
bot.hears('🚀 Bắt Đầu Báo Cáo Nhanh', (ctx) => {
    startReportSession(ctx);
});

bot.command('nhacnho', (ctx) => {
    startReportSession(ctx);
});

async function startReportSession(ctx) {
    const chatId = ctx.chat.id;
    sessions[chatId] = { step: 0, data: {} };
    await ctx.reply(`🚀 **BÁO CÁO NHANH**\nNhập số cho mục:\n\n👉 **${steps[0].label}:**`, persistentKeyboard);
}

// Lắng nghe tin nhắn văn bản bạn tự gõ
bot.on('text', async (ctx) => {
    const chatId = ctx.chat.id;
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

    // Lưu dữ liệu bước hiện tại
    const currentStep = steps[session.step];
    session.data[currentStep.key] = text;
    session.step++;

    if (session.step < steps.length) {
        const nextStep = steps[session.step];
        await ctx.reply(`👉 **${nextStep.label}:**`, persistentKeyboard);
    } else {
        const d = session.data;
        const finalReport = `🌟MYPAGE🌟\n🔰Đánh Giá Tín Ngưỡng: ${d.tinNguong}\n🔰Kinh thánh: ${d.kinhThanh}\n🔰Sách LT: ${d.sachLT}\n🔰Tập Gđ: ${d.tapGd}\n🎊PHÁT BIỂU🎉\n🔰Bài mới: ${d.baiMoi}\n🔰Bài cũ: ${d.baiCu}\n🔰EDU: ${d.edu}\n🔥TRUDA🔥\n🔰Đơn Thuần: ${d.donThuan}\n🔰Hữu Hiệu: ${d.huuHieu}\n🔰Kết trái: ${d.ketTrai}`;

        await ctx.reply(`📋 **ĐÃ TỔNG HỢP XONG:**\n\n${finalReport}\n\n⏳ Đang gửi sang Signal...`, persistentKeyboard);
        
        // --- TỰ ĐỘNG LẤY NGÀY THÁNG NĂM HÔM NAY ---
        const today = new Date();
        const dd = String(today.getDate()).padStart(2, '0');
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const yyyy = today.getFullYear();
        const currentDateStr = `${dd}/${mm}/${yyyy}`;

        // Tiêu đề mới theo yêu cầu: CPN KVT - Ngày DD/MM/YYYY
        const customHeader = `CPN KVT - Ngày ${currentDateStr}`;

        try {
            const phone = 'f774da57-44c0-4e4e-8f57-4e4fd53490a0';
            const apikey = '911098';
            const url = `https://signal.callmebot.com/signal/send.php?phone=${phone}&apikey=${apikey}&text=${encodeURIComponent(`${customHeader}\n\n${finalReport}`)}`;
            
            await axios.get(url);
            await ctx.reply('✅ **Đã gửi báo cáo thành công sang Signal!**', persistentKeyboard);
        } catch (error) {
            console.error('Lỗi gửi Signal:', error.message);
            await ctx.reply('❌ Gửi sang Signal thất bại.', persistentKeyboard);
        }
        delete sessions[chatId];
    }
});

bot.launch();
console.log('Bot đang chạy ổn định...');
