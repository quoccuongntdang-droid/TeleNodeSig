const { Telegraf } = require('telegraf');
const axios = require('axios');
const express = require('express'); // Thêm thư viện express để mở cổng HTTP ảo cho Render

// Khởi tạo HTTP Server giả lập để vượt qua lỗi Port timeout của Render
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('Bot Telegram đang chạy ngầm 24/7 ổn định!');
});

app.listen(PORT, () => {
    console.log(`HTTP Server đang lắng nghe trên cổng ${PORT}`);
});

// Thay Token Telegram Bot của bạn vào đây
const bot = new Telegraf('9115484646:AAHC5Cf_2jEm_jf0iuz7ccwZv3Hgm9Uu80E');

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
            // Tích hợp gửi sang Signal (Dùng CallMeBot)
            const phone = 'f774da57-44c0-4e4e-8f57-4e4fd53490a0';
            const apikey = '911098';
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
