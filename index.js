const { Telegraf } = require('telegraf');
const axios = require('axios');

// Thay Token Telegram Bot của bạn vào đây
const bot = new Telegraf('YOUR_TELEGRAM_BOT_TOKEN');

// Mẫu form báo cáo của bạn
const reportFormTemplate = `🌟MYPAGE🌟
🔰Đánh Giá Tín Ngưỡng: 
🔰Kinh thánh: 
🔰Sách LT: 
🔰Tập Gđ: 
🎊PHÁT BIỂU🎉
🔰Bài mới: 
🔰Bài cũ: 
🔰EDU: 
🔥TRUDA🔥
🔰Đơn Thuần: 
🔰Hữu Hiệu: 
🔰Kết trái: `;

// Lệnh gọi form
bot.command('nhacnho', (ctx) => {
    ctx.reply(`Đến giờ báo cáo rồi Cường ơi! Hãy copy mẫu này điền vào nhé:\n\n${reportFormTemplate}`);
});

// Lắng nghe khi bạn điền và gửi form cho Bot
bot.on('text', async (ctx) => {
    const userMessage = ctx.message.text;

    // Kiểm tra đúng form báo cáo chứa từ khóa
    if (userMessage.includes('🌟MYPAGE🌟')) {
        ctx.reply('⏳ Đang xử lý và chuyển tiếp báo cáo...');

        try {
            // Tích hợp gửi sang Signal (Dùng CallMeBot hoặc API Signal của bạn)
            const phone = '+84_SỐ_ĐIỆN_THOẠI_CỦA_SẾP'; 
            const apikey = 'YOUR_CALLMEBOT_APIKEY';
            const url = `https://signal.callmebot.com/signal/send.php?phone=${phone}&apikey=${apikey}&text=${encodeURIComponent(`[Báo cáo từ Telegram]\n\n${userMessage}`)}`;
            
            await axios.get(url);

            console.log("Đã gửi thành công sang Signal!");
            ctx.reply('✅ Đã gửi báo cáo thành công sang Signal của sếp!');
        } catch (error) {
            console.error('Lỗi gửi Signal:', error.message);
            ctx.reply('❌ Gửi sang Signal thất bại, vui lòng kiểm tra lại.');
        }
    } else {
        ctx.reply('Bot đã nhận được tin nhắn.');
    }
});

// Khởi chạy bot
bot.launch();
console.log('Bot đang chạy...');

