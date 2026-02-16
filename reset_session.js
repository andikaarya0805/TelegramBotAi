const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const DB_URL = process.env.DB_URL;
const DB_KEY = process.env.DB_KEY;
const TARGET_CHAT_ID = '6089201366'; // ID for dumpiey from logs

async function resetSession() {
    if (!DB_URL || !DB_KEY) {
        console.error("Missing DB_URL or DB_KEY in .env");
        return;
    }

    const supabase = createClient(DB_URL, DB_KEY);

    console.log(`Resetting session for ${TARGET_CHAT_ID}...`);

    // Update session_string to null to force re-login
    const { data, error } = await supabase
        .from('user_sessions')
        .update({ session_string: null, state: 'IDLE' })
        .eq('chat_id', TARGET_CHAT_ID);

    if (error) {
        console.error("Error resetting session:", error.message);
    } else {
        console.log("✅ Session reset successful! Please run /connect again in the bot.");
    }
}

resetSession();
