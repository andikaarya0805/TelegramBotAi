const axios = require('axios');
require('dotenv').config();

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
// Using 'openrouter/free' to auto-select the best available free model (Gemini/Llama/DeepSeek)
const MODEL = "google/gemini-2.0-pro-exp-02-05:free"; 

// System prompt template (Same as Gemini Service)
const BASE_PROMPT = "Roleplay: Lo adalah asisten pribadi yang santai, gaul, dan to-the-point khas anak Jaksel/Jakarta. \nGaya Bicara: Pake 'lo-gue', jangan kaku, jangan baku. Kalo nolak request (kayak minta PAP), tolak dengan candaan atau sarkas halus, jangan kayak robot CS. \nTugas: Jawab pesan orang yang masuk.";

async function generateContent(userText, ownerName = "Bos", isFirstMessage = true) {
  let instruction = "";

  if (isFirstMessage) {
    instruction = `Instruksi Khusus: Kamu sedang membalas pesan orang lain SEBAGAI Assistant Manager dari ${ownerName} yang sedang AFK. Perkenalkan diri singkat (misal: "Halo, gue asisten manager ${ownerName}...") lalu bantu jawab pesan mereka.`;
  } else {
    instruction = `Instruksi Khusus: ${ownerName} masih AFK. Lanjutkan percakapan dengan santai. JANGAN memperkenalkan diri lagi. Langsung jawab intinya aja layaknya chating sama temen.`;
  }

  const systemMessage = `${BASE_PROMPT} \n\n${instruction}`;

  if (!userText) return "Waduh, pesannya kosong nih bro.";

  const payload = {
    model: MODEL,
    messages: [
      {
        role: "system",
        content: systemMessage
      },
      {
        role: "user",
        content: userText
      }
    ],
    temperature: 0.7,
    max_tokens: 800
    // transforms: ["middle-out"] // Optional OpenRouter specific
  };

  try {
    const response = await axios.post(OPENROUTER_URL, payload, {
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'HTTP-Referer': 'https://github.com/Start-to-Excellence/telegram-gemini-bot', // Required by OpenRouter
        'X-Title': 'Telegram Userbot AI' // Optional
      }
    });

    if (
      response.data &&
      response.data.choices &&
      response.data.choices.length > 0 &&
      response.data.choices[0].message &&
      response.data.choices[0].message.content
    ) {
      return response.data.choices[0].message.content;
    } else {
      console.error("OpenRouter Invalid Response:", JSON.stringify(response.data));
      return "Sorry bro, lagi error nih AI-nya. (Invalid Response)";
    }

  } catch (error) {
    if (error.response) {
      const errMsg = JSON.stringify(error.response.data || {});
      console.error('Error calling OpenRouter API (Response Data):', errMsg);
      // Handle rate limits or specific errors
      if (error.response.status === 429) {
          return "Lagi sibuk banget servernya (Rate Limit 429). Tunggu bentar.";
      }
      return `Error API: ${error.response.status} - ${errMsg.substring(0, 100)}...`;
    } else {
      console.error('Error calling OpenRouter API (Message):', error.message);
      return `Error System: ${error.message}`;
    }
    // if (error.code === 'ECONNABORTED') {
    //   return "Sabar ya bro, lagi mikir keras nih... (Timeout)";
    // }
    // return "Ada masalah teknis nih kontol, sorry spam";
  }
}

module.exports = {
  generateContent
};
