const axios = require('axios');
require('dotenv').config();

const TELEGRAM_API_URL = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

async function sendMessage(chatId, text) {
  try {
    if (!text) return; // Don't send empty messages

    const response = await axios.post(`${TELEGRAM_API_URL}/sendMessage`, {
      chat_id: chatId,
      text: text,
      // parse_mode: 'Markdown' // Disabled for debugging to avoid parse errors
    });

    console.log(`Message sent to ${chatId}: ${text.substring(0, 20)}...`);
    return response.data;
  } catch (error) {
    console.error('Error sending Telegram message:', error.response ? error.response.data : error.message);
    throw error;
  }
}

async function setWebhook(url) {
  try {
    const response = await axios.post(`${TELEGRAM_API_URL}/setWebhook`, {
      url: `${url}/webhook`
    });
    console.log(`Webhook set to: ${url}/webhook`);
    return response.data;
  } catch (error) {
    console.error('Error setting webhook:', error.response ? error.response.data : error.message);
    throw error;
  }
}

module.exports = { sendMessage, setWebhook };
