const { Telegraf } = require('telegraf');
const axios = require('axios');
const express = require('express');

// Khởi tạo HTTP Server giả lập để vượt qua lỗi Port timeout của Render
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

// Lưu trạng thái nhập liệu của bạn (mỗi tài khoản chat có một tiến trình riêng)
const userSessions = {};

// Các bước câu hỏi lần lượt
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

// Lệnh bắt đầu quy trình báo cáo từng bước
bot.command('nhacnho', (ctx) => {
    const chatId = ctx.chat.id;
    userSessions[chatId] = { stepIndex: 0, data: {} };
    
    ctx.reply(`🚀 **BẮT ĐẦU BÁO CÁO NHANH**\nBot sẽ hỏi bạn từng mục, bạn chỉ việc nhập số hoặc nội dung rồi gửi nhé!\n\n👉 **${steps[0].label}:**`);
});

// Lắng nghe tin nhắn trả lời từng bước
bot.on('text', async (ctx) => {
    const chatId = ctx.chat.id;
    const session = userSessions[chatId];

    // Nếu chưa bấm /nhacnho mà gõ linh tinh thì bỏ qua hoặc hướng dẫn
    if (!session) {
        if (ctx.message.text.includes('🌟MYPAGE🌟')) {
            // Vẫn giữ khả năng nhận form cũ nếu bạn lỡ copy dán
            await sendToSignal(ctx, ctx.message.text);
        } else {
            ctx.reply('Cường ơi, hãy gõ lệnh /nhacnho để bắt đầu báo cáo từng bước nhé!');
        }
        return;
    }

    // Lưu câu trả lời của bước hiện tại
    const currentStep = steps[session.stepIndex];
    session.data[currentStep.key] = ctx.message.text;
    session.stepIndex++;

    // Nếu còn câu hỏi tiếp theo thì hỏi tiếp
    if (session.stepIndex < steps.length) {
        const nextStep = steps[session.stepIndex];
        await ctx.reply(`👉 **${nextStep.label}:**`);
    } else {
        // --- ĐÃ ĐIỀN XONG TẤT CẢ CÁC BƯỚC ---
        const d = session.data;
        const finalReport = `🌟MYPAGE🌟\n🔰Đánh Giá Tín Ngưỡng: ${d.tinNguong}\n🔰Kinh thánh: ${d.kinhThanh}\n🔰Sách LT: ${d.sachLT}\n🔰Tập Gđ: ${d.tapGd}\n🎊PHÁT BIỂU🎉\n🔰Bài mới: ${d.baiMoi}\n🔰Bài cũ: ${d.baiCu}\n🔰EDU: ${d.edu}\n🔥TRUDA🔥\n🔰Đơn Thuần: ${d.donThuan}\n🔰Hữu Hiệu: ${d.huuHieu}\n🔰Kết trái: ${d.ketTrai}`;

        await ctx.reply(`📋 **ĐÃ TỔNG HỢP XONG BÁO CÁO:**\n\n${finalReport}\n\n⏳ Đang tự động gửi sang Signal...`);

        // Gửi sang Signal
        await sendToSignal(ctx, finalReport);

        // Xóa phiên làm việc
        delete userSessions[chatId];
    }
});

// Hàm hỗ trợ gửi CallMeBot Signal
async function sendToSignal(ctx, reportText) {
    try {
        const phone = 'f774da57-44c0-4e4e-8f57-4e4fd53490a0';
        const apikey = '911098';
        const url = `https://signal.callmebot.com/signal/send.php?phone=${phone}&apikey=${apikey}&text=${encodeURIComponent(`[Báo cáo từ Telegram]\n\n${reportText}`)}`;
        
        await axios.get(url);
        await ctx.reply('✅ **Đã gửi báo cáo thành công sang Signal của sếp!**');
    } catch (error) {
        console.error('Lỗi gửi Signal:', error.message);
        await ctx.reply('❌ Gửi sang Signal thất bại, vui lòng kiểm tra lại.');
    }
}

// Khởi chạy bot
bot.launch();
console.log('Bot báo cáo tương tác từng bước đang chạy...');
