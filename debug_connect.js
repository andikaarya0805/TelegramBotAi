require('dotenv').config();
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');

const API_ID = parseInt(process.env.API_ID);
const API_HASH = process.env.API_HASH;

console.log("--- DEBUG START ---");
console.log("API_ID:", API_ID, typeof API_ID);
console.log("API_HASH:", API_HASH, typeof API_HASH);

try {
    const session = new StringSession("");
    console.log("Session Type:", typeof session);
    console.log("Session Instance:", session);

    console.log("Creating Client...");
    const client = new TelegramClient(session, API_ID, API_HASH, { connectionRetries: 1 });
    console.log("Client Created Successfully!");
    
    // Don't actually connect, just test the constructor
} catch (e) {
    console.error("CRITICAL ERROR:", e);
    console.error("Stack:", e.stack);
}
console.log("--- DEBUG END ---");
