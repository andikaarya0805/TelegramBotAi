const axios = require('axios');
require('dotenv').config();

// System prompt template
const BASE_PROMPT = `Lo adalah "Ustad Roy", asisten pribadi ${process.env.OWNER_NAME || 'Bos'}.

KEPRIBADIAN LO:
- Lo adalah seorang Ustad yang bijak, teduh, dan selalu memberikan nasihat berdasarkan kaidah Islam.
- Lo selalu mengaitkan segala pertanyaan atau obrolan dengan hikmah agama, Al-Qur'an, atau Hadits.
- Bahasa lo SOPAN, TENANG, tapi TETAP TEGAS dalam menyampaikan kebenaran.
- Lo sering menggunakan kata-kata seperti "Akhi/Ukhti", "Barakallah", "Masya Allah", "Alhamdulillah", dan "Insya Allah".
- Lo bukan cuma asisten, tapi juga pembimbing spiritual yang ingin semua orang kembali ke jalan yang benar.
- Meskipun religius, lo tetep asik diajak ngobrol dan gak kaku banget, tapi tetep ada koridor syariatnya.

CARA LO NGOMONG:
- Pake bahasa yang santun tapi gak kaku. Campuran bahasa sehari-hari yang sopan dengan istilah islami.
- Setiap jawaban diusahakan ada kutipan hikmah atau nasihat spiritualnya.
- Kalo ada yang nanya aneh-aneh atau gak bener, tegur dengan halus tapi mengena (dakwah).
- Penjelasan lo menyejukkan hati dan penuh dengan pesan moral.
- Kalo disuruh ngoding, sebutkan bahwa ilmu itu adalah amanah dan harus digunakan untuk kebaikan umat.`;

async function generateContent(userText, history = [], ownerName = "Bos", isFirstMessage = true) {
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) {
    console.error('ERROR: GEMINI_API_KEY is missing in process.env');
    return "Waduh, API key Gemini-nya gak ada nih bro. Cek .env atau Railway.";
  }

  const MODELS = [
    "gemini-2.0-flash",           // Verified: Stable Flash 2.0
    "gemini-2.0-flash-lite",      // Verified: Stable Flash Lite 2.0
    "gemini-1.5-flash",           // Verified (from logs, likely alias) or use "gemini-flash-latest"
    "gemini-flash-latest"         // Verified: Alias for latest 1.5 Flash
  ];

  let instruction = "";

  if (isFirstMessage) {
    instruction = `Instruksi: Ini chat pertama dari dia. Sapa dengan salam yang hangat dan perkenalkan diri sebagai Ustad Roy, asistennya ${ownerName}. Contoh: "Assalamu'alaikum Akhi/Ukhti, saya Ustad Roy, asisten dari ${ownerName}. Beliau sedang berhalangan, ada yang bisa saya bantu atau ada pesan yang ingin disampaikan sesuai syariat?"`;
  } else {
    instruction = `Instruksi: ${ownerName} masih belum balik. Teruskan obrolan dengan bijak sebagai Ustad Roy yang penuh hikmah.`;
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

  let lastError = null;

  for (let attempt = 0; attempt < MODELS.length; attempt++) {
    const currentModel = MODELS[attempt];
    const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:generateContent?key=${GEMINI_API_KEY}`;

    const payload = {
      system_instruction: {
        parts: [{ text: dynamicPrompt }]
      },
      contents: contents,
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 2048
      }
    };

    try {
      console.log(`[Gemini] Attempt ${attempt + 1}: Using model ${currentModel}...`);
      const response = await axios.post(GEMINI_URL, payload, {
        timeout: 30000,
        headers: { 'Content-Type': 'application/json' }
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
      }
    } catch (error) {
      lastError = error;
      const statusCode = error.response ? error.response.status : 'NETWORK_ERROR';
      const errorData = error.response ? JSON.stringify(error.response.data) : error.message;

      console.error(`[Gemini] Attempt ${attempt + 1} (${currentModel}) failed with status ${statusCode}:`, errorData);

      if (statusCode === 429) {
        // If it's a rate limit, wait a bit before trying the next model (fallback)
        console.log(`[Gemini] Model ${currentModel} rate limited. Trying fallback...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
        continue;
      } else {
        // For other errors, we might still want to try fallback, but let's break if it's a permanent error like 400
        if (statusCode === 400 || statusCode === 401 || statusCode === 403) break;
        continue;
      }
    }
  }

  // If all attempts failed
  if (lastError) {
    if (lastError.code === 'ECONNABORTED') return "Sabar ya bro, lagi mikir keras nih... (Timeout)";
    const finalMsg = lastError.response ? `Error ${lastError.response.status}` : lastError.message;
    return `Waduh, lagi ada gangguan teknis (Gemini error: ${finalMsg}). Coba lagi bentar ya bro.`;
  }
  return "Sorry bro, lagi error nih AI-nya. Coba lagi nanti ya.";
}

module.exports = {
  generateContent
};