const express = require('express');
const bodyParser = require('body-parser');
require('dotenv').config();

const telegramService = require('./services/telegramService');
const geminiService = require('./services/geminiService');

const app = express();
const PORT = process.env.PORT || 3000;

// Global State
let isAfk = false;
let adminId = null;

app.use(bodyParser.json());

// Basic health check
app.get('/', (req, res) => {
  res.send('Telegram Gemini Bot is running!');
});

// Webhook endpoint for Telegram
app.post('/webhook', async (req, res) => {
  try {
    const update = req.body;

    // Check if it's a message
    if (update.message) {
      const chatId = update.message.chat.id;
      const text = update.message.text;
      const userId = update.message.from.id;

      console.log(`Received message from ${userId} in ${chatId}: ${text}`);

      // COMMAND: /afk (Turn ON)
      if (text === '/afk') {
        isAfk = true;
        adminId = userId; // The person who activates it becomes the 'owner'
        await telegramService.sendMessage(chatId, "🔇 Mode AFK Aktif! Gue bakal balesin chat orang lain. Chat lagi buat matiin.");
        return res.sendStatus(200);
      }

      // COMMAND: /back or AUTO-BACK (Turn OFF)
      // If the Admin chats (and it's not the /afk command itself), turn OFF.
      if (isAfk && userId === adminId) {
        isAfk = false;
        adminId = null;
        await telegramService.sendMessage(chatId, "🔊 Welcome back, bos! Mode AFK dimatiin.");
        return res.sendStatus(200);
      }

      // BOT LOGIC: Only reply if AFK is ON and sender is NOT Admin
      if (isAfk && userId !== adminId) {
         const replyText = await geminiService.generateContent(text);
         await telegramService.sendMessage(chatId, replyText);
      } else {
        // Normal Mode: Bot is silent (ignores chat) unless specific commands used
        // console.log('Ignored message (Not AFK or Admin chatting)');
      }
    }

    res.sendStatus(200); // Always return 200 to Telegram
  } catch (error) {
    console.error('Error handling webhook:', error);
    res.sendStatus(500);
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
