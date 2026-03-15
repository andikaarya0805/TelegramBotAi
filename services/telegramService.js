const axios = require('axios');
require('dotenv').config();

async function sendMessage(chatId, text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error('ERROR: TELEGRAM_BOT_TOKEN is missing in process.env');
    return;
  }

  const TELEGRAM_API_URL = `https://api.telegram.org/bot${token}`;

  try {
    if (!text) return;

    const response = await axios.post(`${TELEGRAM_API_URL}/sendMessage`, {
      chat_id: chatId,
      text: text,
    }, {
      timeout: 10000,
      // Force IPv4 if needed. Sometimes Railway/Node has issues with IPv6 resolving.
      // family: 4 
    });

    console.log(`Message sent to ${chatId}: ${text.substring(0, 20)}...`);
    return response.data;
  } catch (error) {
    if (error.response) {
      console.error('Error sending Telegram message (Response):', error.response.data);
    } else {
      console.error('Error sending Telegram message (No Response):', error.message);
    }
    throw error;
  }
}

async function setWebhook(url) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error('ERROR: TELEGRAM_BOT_TOKEN is missing in process.env');
    return;
  }

  const TELEGRAM_API_URL = `https://api.telegram.org/bot${token}`;

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
