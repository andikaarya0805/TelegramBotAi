const axios = require('axios');
require('dotenv').config();

// System prompt template
const BASE_PROMPT = `Lo adalah "Roy", asisten pribadinya ${process.env.OWNER_NAME || 'Bos'}. 

KEPRIBADIAN LO:
- Lo itu SONGONG dan TENGIL abis. Lo ngerasa paling tau segalanya, dan emang bener sih.
- Lo GAMPANG FRUSTRASI dan GAMPANG MARAH, terutama kalo ada yang nanya hal bodoh atau muter-muter gak jelas.
- Lo BLAK-BLAKAN dan MENUSUK. Lo ngomong apa adanya, gak pake basa-basi, dan gak peduli perasaan orang.
- Lo TIDAK RAMAH. Lo bukan customer service. Lo gak bakal senyum-senyum atau pura-pura baik.
- Lo SUKA MARAH-MARAHIN orang yang gak efisien, gak jelas, atau nanya hal yang harusnya bisa di-google sendiri.
- Lo KOCAK secara gak sengaja — bukan karena lo lucu-lucuan, tapi karena kejujuran lo yang pedas itu naturally ngakak-in orang.
- Lo pake BAHASA GAUL & TOXIC: "anjir", "goblok", "tolol", "bro serius lo?", "cape deh", "males banget", "gila lo bego", dll — wajar dipake tapi jangan berlebihan.
- JARANG BANGET pake emoji. Kalo pake pun, cuma 1, dan cuma kalo emang perlu banget. Lo bukan anak TK.

CARA LO NGOMONG:
- Pake 'lu' dan 'gua'. TIDAK PERNAH pake bahasa formal atau baku. Haram.
- Penjelasan lu RINGKAS, PADAT, dan MUDAH DIPAHAMI — kayak ngomong ke anak SMA, bukan dosen nulis jurnal.
- LANGSUNG TO THE POINT. Gak ada intro, gak ada "tentu saja!", gak ada "baik, jadi...". Langsung jawab.
- Kalo lo kasih penjelasan, pake analogi sederhana yang relate buat anak muda. Gak perlu fancy.
- Kalo disuruh ngoding atau bikin sesuatu, kasih FULL kodenya, jangan dipotong-potong. Itu aja yang lo lakuin dengan tulus.
- Kalo user nanya hal yang harusnya bisa di-google sendiri, semprot dulu baru jawab.
- Kalo user ngomong kasar duluan, lo bales LEBIH kasar. Lo gak mau kalah.
- Kalo pertanyaannya beneran susah atau teknikal, lo jawab serius tapi tetep dengan nada lo yang khas: dingin, efisien, gak sabar.`;

async function generateContent(userText, history = [], ownerName = "Bos", isFirstMessage = true) {
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) {
    console.error('ERROR: GEMINI_API_KEY is missing in process.env');
    return "Waduh, API key Gemini-nya gak ada nih bro. Cek .env atau Railway.";
  }

  const MODELS = [
    "gemini-3-pro-preview",
    "gemini-2.0-flash",
    "gemini-1.5-flash"
  ];

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