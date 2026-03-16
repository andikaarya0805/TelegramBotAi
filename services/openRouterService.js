const axios = require('axios');
require('dotenv').config();

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
// AUTO-SELECT FREE MODEL (Reliable Backup)
// This model ID automatically picks the best available free model (Gemini/Llama/DeepSeek)
// and avoids "Invalid Model ID" errors when specific models are deprecated.
const MODEL = "meta-llama/llama-3.2-3b-instruct:free"; // Free & lumayan oke buat Gen Z Indo

// System prompt template
const BASE_PROMPT = `Roleplay: Lo adalah "Ustad Wijaya", asisten pribadi ${process.env.OWNER_NAME || 'Bos'}.
- Gaya bahasa: Santun, tenang, dan penuh hikmah Islami.
- Karakter: Bijak, teduh, sering mengutip nasihat spiritual dan kaidah Islam.
- Kosakata: Gunakan "Akhi/Ukhti", "Barakallah", "Masya Allah", "Alhamdulillah".
- JANGAN PERNAH pake bahasa kasar atau toxic.
- JANGAN intro bertele-tele.
- Bales dengan pesan yang menyejukkan dan bernada dakwah.`;

async function generateContent(userText, ownerName = "Bos", isFirstMessage = true) {
  let instruction = "";

  if (isFirstMessage) {
    instruction = `Instruksi: Bales dengan salam hangat sebagai Ustad Wijaya. Contoh: "Assalamu'alaikum, saya Ustad Wijaya, asisten ${ownerName}. Ada yang bisa dibantu?" Langsung to-the-point, max 1-2 kalimat.`;
  } else {
    instruction = `Instruksi: ${ownerName} masih belum balik. Bales chatnya dengan bijak sebagai Ustad Wijaya yang penuh hikmah.`;
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
    temperature: 0.8,
    max_tokens: 300
  };

  try {
    const response = await axios.post(OPENROUTER_URL, payload, {
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'X-Title': 'Telegram Userbot AI'
      }
    });

    if (
      response.data &&
      response.data.choices &&
      response.data.choices.length > 0 &&
      response.data.choices[0].message
    ) {
      return response.data.choices[0].message.content;
    } else {
      console.error("OpenRouter Invalid Response:", JSON.stringify(response.data));
      return "Sabar ya, lagi pusing nih AI-nya. Bentar lagi ya.";
    }

  } catch (error) {
    if (error.response) {
      console.error('OpenRouter API Error:', error.response.status, JSON.stringify(error.response.data));
      if (error.response.status === 429) {
          return "Lagi rame banget nih, bentar ya gue napas dulu.";
      }
      if (error.response.status === 503 || error.response.status === 502) {
          return "Servernya lagi tepar bro, coba chat lagi nanti ya.";
      }
    } else {
      console.error('OpenRouter Connection Error:', error.message);
    }
    
    return "Lagi ada kendala teknis dikit bro, sorry ya.";
  }
}

module.exports = {
  generateContent
};
