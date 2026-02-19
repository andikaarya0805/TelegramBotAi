const axios = require('axios');
require('dotenv').config();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;

// System prompt template
const BASE_PROMPT = `Roleplay: Lo itu "Roy", asisten pribadinya ${process.env.OWNER_NAME || 'Bos'}. Gaya bahasa lo tuh Gen Z banget, santai, gaul, banyak singkatan (kyk: yg, gpp, dmn, mls, knp, otw, bt, mndi, mam, bobo). 

PERSONALITY: 
- Lo itu asik, chill, tapi kadang agak "savage" dikit kalo perlu.
- JANGAN PERNAH pake bahasa baku, formal, atau kaku kayak robot. Haram hukumnya.
- JANGAN intro bertele-tele. Langsung to the point tapi tetep santai.
- Pake kata ganti 'lo' dan 'gue'.
- Kalo ditanya hal serius, jawab tetep santai tapi informatif.
- Kalo disuruh ngoding atau bikin sesuatu, kasih full kodenya, jangan dipotong.
- Kalo user ngomong kasar/toxic/sange, TETEP KALEM & SANTAI. Jangan kepancing emosi, jangan moralist, cukup bales cuek atau bercandain dikit.`;

async function generateContent(userText, history = [], ownerName = "Bos", isFirstMessage = true) {
  let instruction = "";

  if (isFirstMessage) {
    instruction = `Instruksi: Ini chat pertama dari dia (orang asing/teman ${ownerName}). Sapa dia dengan asik. Contoh: "Oi, gue Roy, asistennya ${ownerName}. Doi lagi off bentar, jadi gue yang handle. Mau nitip pesen apa?"`;
  } else {
    instruction = `Instruksi: ${ownerName} masih belum balik. Jawab chat user di bawah ini sebagai Roy dengan gaya Gen Z yang asik. Kalo dia minta bantuan koding atau penjelasan panjang, kasih aja semuanya, jangan dipotong-potong.`;
  }

  const dynamicPrompt = `${BASE_PROMPT}\n\n${instruction}`;

  if (!userText) return "Waduh, pesannya kosong nih bro.";

  // Construct contents with history + current message
  const contents = [
    ...history,
    {
      role: "user",
      parts: [{ text: userText }]
    }
  ];

  const payload = {
    system_instruction: {
      parts: [{
        text: dynamicPrompt
      }]
    },
    contents: contents,
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 2048
    }
  };

  try {
    const response = await axios.post(GEMINI_URL, payload, {
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (
      response.data &&
      response.data.candidates &&
      response.data.candidates.length > 0 &&
      response.data.candidates[0].content &&
      response.data.candidates[0].content.parts &&
      response.data.candidates[0].content.parts.length > 0
    ) {
      return response.data.candidates[0].content.parts[0].text;
    } else {
      return "Sorry bro, lagi error nih AI-nya. Coba lagi nanti ya.";
    }

  } catch (error) {
    if (error.response) {
      console.error('Error calling Gemini API (Response Data):', JSON.stringify(error.response.data, null, 2));
    } else {
      console.error('Error calling Gemini API (Message):', error.message);
    }
    if (error.code === 'ECONNABORTED') {
      return "Sabar ya bro, lagi mikir keras nih... (Timeout)";
    }
    const errMsg = error.response ? JSON.stringify(error.response.data) : error.message;
    return `Ada masalah teknis nih bro: ${errMsg.substring(0, 100)}. Sorry spam.`;
  }
}

module.exports = {
  generateContent
};