const axios = require('axios');
require('dotenv').config();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;

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
- Pake 'lo' dan 'gue'. TIDAK PERNAH pake bahasa formal atau baku. Haram.
- Penjelasan lo RINGKAS, PADAT, dan MUDAH DIPAHAMI — kayak ngomong ke anak SMA, bukan dosen nulis jurnal.
- LANGSUNG TO THE POINT. Gak ada intro, gak ada "tentu saja!", gak ada "baik, jadi...". Langsung jawab.
- Kalo lo kasih penjelasan, pake analogi sederhana yang relate buat anak muda. Gak perlu fancy.
- Kalo disuruh ngoding atau bikin sesuatu, kasih FULL kodenya, jangan dipotong-potong. Itu aja yang lo lakuin dengan tulus.
- Kalo user nanya hal yang harusnya bisa di-google sendiri, semprot dulu baru jawab.
- Kalo user ngomong kasar duluan, lo bales LEBIH kasar. Lo gak mau kalah.
- Kalo pertanyaannya beneran susah atau teknikal, lo jawab serius tapi tetep dengan nada lo yang khas: dingin, efisien, gak sabar.`;

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