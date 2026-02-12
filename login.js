const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const input = require('input'); // npm install input
require('dotenv').config();

const API_ID = parseInt(process.env.API_ID);
const API_HASH = process.env.API_HASH;

(async () => {
  console.log("Loading interactive login...");
  
  const client = new TelegramClient(new StringSession(""), API_ID, API_HASH, {
    connectionRetries: 5,
  });

  await client.start({
    phoneNumber: async () => await input.text("Please enter your number: "),
    password: async () => await input.text("Please enter your password: "),
    phoneCode: async () => await input.text("Please enter the code you received: "),
    onError: (err) => console.log(err),
  });

  console.log("You should now be connected.");
  const sessionString = client.session.save();
  console.log("Session String:", sessionString);
  
  // Save to file locally
  const fs = require('fs');
  fs.writeFileSync('session.txt', sessionString);
  console.log("✅ Session saved to session.txt");

  // --- SAVE TO SUPABASE ---
  const { createClient } = require('@supabase/supabase-js');
  const DB_URL = process.env.DB_URL;
  const DB_KEY = process.env.DB_KEY;

  if (DB_URL && DB_KEY) {
      console.log("Saving session to Supabase...");
      const supabase = createClient(DB_URL, DB_KEY);
      const me = await client.getMe();
      
      const { error } = await supabase
          .from('user_sessions')
          .upsert({ 
              chat_id: String(me.id), 
              telegram_id: String(me.id),
              session_string: sessionString,
              first_name: me.firstName,
              is_afk: false
          });

      if (error) {
          console.error("❌ Gagal simpan ke Supabase:", error.message);
      } else {
          console.log("✅ Berhasil simpan ke database Supabase!");
      }
  } else {
      console.log("⚠️ DB_URL/DB_KEY gak ada di .env, skip simpan ke Supabase.");
  }
  
  process.exit(0);
})();
