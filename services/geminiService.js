const axios = require('axios');
require('dotenv').config();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${GEMINI_API_KEY}`;

// System prompt template
const BASE_PROMPT = `Roleplay: Lo asisten pribadinya ${process.env.OWNER_NAME || 'Bos'}. Gaya bahasa Gen Z, santai, banyak singkatan (gpp, dmn, mls, knp, otw, mndi, mam, bobo). JANGAN PERNAH pake bahasa baku, formal, atau kaku. JANGAN intro bertele-tele. Pake 'lo-gue'.`;

async function generateContent(userText, ownerName = "Bos", isFirstMessage = true) {
  let instruction = "";

  if (isFirstMessage) {
    instruction = `Instruksi: Bales singkat aja seolah lo asisten ${ownerName}. Contoh: "Oi, gue asistennya ${ownerName}, dia lagi afk. Ada apa?" atau "Kenapa? ${ownerName} lagi ga megang hp." Langsung to-the-point, max 1 kalimat.`;
  } else {
    instruction = `Instruksi: ${ownerName} masih belum balik. Bales chatnya super singkat & santai pake bahasa Gen Z. Gak usah basa-basi perkenalan lagi.`;
  }

  const dynamicPrompt = `${BASE_PROMPT} \n\n${instruction}`;

  if (!userText) return "Waduh, pesannya kosong nih bro.";

  const payload = {
    system_instruction: {
      parts: [{
        text: dynamicPrompt
      }]
    },
    contents: [{
      parts: [{
        text: userText
      }]
    }],
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 800
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