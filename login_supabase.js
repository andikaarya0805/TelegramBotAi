const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
require('dotenv').config();

const DB_URL = process.env.DB_URL;
const DB_KEY = process.env.DB_KEY;

if (!DB_URL || !DB_KEY) {
    console.error("FATAL: DB_URL or DB_KEY is missing in .env");
    process.exit(1);
}

const supabase = createClient(DB_URL, DB_KEY);

async function bypassLogin() {
    console.log("--- Supabase Session Bypass ---");
    
    // Ambil semua session yang ada
    const { data, error } = await supabase
        .from('user_sessions')
        .select('*');

    if (error) {
        console.error("Gagal ambil data dari Supabase:", error.message);
        return;
    }

    if (!data || data.length === 0) {
        console.log("Gak ada session tersimpan di Supabase.");
        return;
    }

    // Tampilkan pilihan (atau pakai yang pertama kalau cuma satu)
    const target = data[0]; 
    console.log(`Ditemukan session buat: ${target.first_name} (${target.chat_id})`);
    
    if (target.session_string) {
        fs.writeFileSync('session.txt', target.session_string);
        console.log("✅ SESSION_STRING berhasil ditarik dan disimpan ke session.txt");
        console.log("--- SEKARANG LO BISA JALANIN: npm start ---");
    } else {
        console.log("❌ Baris data ketemu tapi SEESION_STRING nya kosong.");
    }
}

bypassLogin();
