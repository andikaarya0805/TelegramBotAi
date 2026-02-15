const axios = require('axios');
require('dotenv').config();

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
// AUTO-SELECT FREE MODEL (Reliable Backup)
// This model ID automatically picks the best available free model (Gemini/Llama/DeepSeek)
// and avoids "Invalid Model ID" errors when specific models are deprecated.
const MODEL = "meta-llama/llama-3.2-3b-instruct:free"; // Free & lumayan oke buat Gen Z Indo

// System prompt template
const BASE_PROMPT = `Roleplay: Lo asisten pribadinya ${process.env.OWNER_NAME || 'Bos'}.
- Gaya bahasa: Gen Z banget, santai, pake lo-gue.
- Karakter: Kadang sok asik, kadang mager, tapi tetep sopan dikit.
- Singkatan: Wajib pake singkatan (gpp, dmn, mls, knp, otw, mndi, mam, bobo, salken, tq, k).
- JANGAN PERNAH pake bahasa baku/formal.
- JANGAN intro bertele-tele.
- Bales singkat aja, maksimal 1-2 kalimat.`;

async function generateContent(userText, ownerName = "Bos", isFirstMessage = true) {
  let instruction = "";

  if (isFirstMessage) {
    instruction = `Instruksi: Bales singkat aja seolah lo asisten ${ownerName}. Contoh: "Oi, gue asistennya ${ownerName}, dia lagi afk. Ada apa?" atau "Kenapa? ${ownerName} lagi ga megang hp." Langsung to-the-point, max 1 kalimat.`;
  } else {
    instruction = `Instruksi: ${ownerName} masih belum balik. Bales chatnya super singkat & santai pake bahasa Gen Z. Gak usah basa-basi perkenalan lagi. Langsung jawabin aja kalo dia nanya atau bilang apa.`;
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
