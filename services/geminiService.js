const axios = require('axios');
require('dotenv').config();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;

// System prompt template
const BASE_PROMPT = "Roleplay: Lo adalah asisten pribadi yang santai, gaul, dan to-the-point khas anak Jaksel/Jakarta. \nGaya Bicara: Pake 'lo-gue', jangan kaku, jangan baku. Kalo nolak request (kayak minta PAP), tolak dengan candaan atau sarkas halus, jangan kayak robot CS. \nTugas: Jawab pesan orang yang masuk.";

async function generateContent(userText, ownerName = "Bos", isFirstMessage = true) {
  let instruction = "";
  
  if (isFirstMessage) {
      instruction = `Instruksi Khusus: Kamu sedang membalas pesan orang lain SEBAGAI Assistant Manager dari ${ownerName} yang sedang AFK. Perkenalkan diri singkat (misal: "Halo, gue asisten manager ${ownerName}...") lalu bantu jawab pesan mereka.`;
  } else {
      instruction = `Instruksi Khusus: ${ownerName} masih AFK. Lanjutkan percakapan dengan santai. JANGAN memperkenalkan diri lagi. Langsung jawab intinya aja layaknya chating sama temen.`;
  }

  const dynamicPrompt = `${BASE_PROMPT} \n\n${instruction}`;
  
  if (!userText) return "Waduh, pesannya kosong nih bro.";

  const payload = {
    system_instruction: {
      parts: [
        { text: dynamicPrompt }
      ]
    },
    contents: [
      {
        parts: [
          { text: userText }
        ]
      }
    ],
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
    console.error('Error calling Gemini API:', error.response ? error.response.data : error.message);
    if (error.code === 'ECONNABORTED') {
        return "Sabar ya bro, lagi mikir keras nih... (Timeout)";
    }
    return "Ada masalah teknis nih bro. Coba lagi ya.";
  }
}

module.exports = { generateContent };
