const express = require('express');
const bodyParser = require('body-parser');
const { TelegramClient, Api } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { NewMessage } = require('telegram/events');
const telegramService = require('./services/telegramService');
const geminiService = require('./services/geminiService');
const aiService = geminiService; 
// const openRouterService = require('./services/openRouterService');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;
const API_ID_RAW = process.env.API_ID;
const API_HASH = process.env.API_HASH;
const WEBHOOK_URL = process.env.WEBHOOK_URL;

// Auto-Set Webhook if URL is provided
if (WEBHOOK_URL) {
    console.log(`[Webhook] Target URL detected: ${WEBHOOK_URL}`);
    telegramService.setWebhook(WEBHOOK_URL).then(res => {
        console.log("[Webhook] Set Successful:", res);
    }).catch(e => {
        console.error("[Webhook] Set Failed:", e.message);
    });
} else {
    console.log("⚠️ [Webhook] WEBHOOK_URL is missing! Bot won't receive messages.");
}

console.log('Loading Credentials:', { API_ID: API_ID_RAW, API_HASH });

if (!API_ID_RAW || !API_HASH) {
    console.error("FATAL: API_ID or API_HASH is missing in .env");
    process.exit(1);
}

const API_ID = parseInt(API_ID_RAW);

// --- Process Monitoring ---
process.on('uncaughtException', (err) => {
    console.error('SERVER CRASHED (Uncaught Exception):', err);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
process.on('exit', (code) => {
    console.log(`SERVER EXITING with code: ${code}`);
});

// --- Keep Alive ---
const INSTANCE_ID = Math.random().toString(36).substring(7).toUpperCase();
console.log(`[System] Initializing Instance: ${INSTANCE_ID}`);

setInterval(() => {
    console.log(`[Status][${INSTANCE_ID}] Server is ALIVE. Time: ${new Date().toLocaleTimeString()}`);
}, 30000);

// In-Memory Storage
// users[telegramId] = { 
//   state: 'IDLE' | 'WAIT_PHONE' | 'WAIT_CODE', 
//   client: GramJSClient, 
//   phone: String, 
//   phoneCodeHash: String,
//   isAfk: false
// }
const users = {};
const processedUpdates = new Set(); // Deduplication for Telegram Retries

app.use(bodyParser.json());

// Helper: Get or Init User
const getUser = (id) => {
  if (!users[id]) users[id] = { 
    state: 'IDLE', 
    isAfk: false, 
    processing: false,
    queue: [],
    isProcessingQueue: false
  };
  return users[id];
};

// AUTO-LOGIN ON STARTUP (FETCH FROM SUPABASE)
const { createClient } = require('@supabase/supabase-js');
const DB_URL = process.env.DB_URL;
const DB_KEY = process.env.DB_KEY;

if (DB_URL && DB_KEY) {
    const supabase = createClient(DB_URL, DB_KEY);
    
    (async () => {
        console.log("[System] Fetching sessions from Supabase...");
        const { data, error } = await supabase.from('user_sessions').select('*');
        
        if (error) {
            console.error("[System] Supabase Fetch Error:", error.message);
            return;
        }

        console.log(`[System] Found ${data.length} sessions to initialize.`);
        
        for (const row of data) {
            if (!row.session_string) continue;
            
            console.log(`[System] Initializing session for: ${row.first_name || row.chat_id}`);
            const session = new StringSession(row.session_string);
            const client = new TelegramClient(session, API_ID, API_HASH, { 
                connectionRetries: 5, 
                useWSS: false 
            });

            client.connect().then(async () => {
                const me = await client.getMe();
                const userIdStr = String(me.id);
                
                users[userIdStr] = {
                    state: 'CONNECTED',
                    client: client,
                    firstName: me.firstName,
                    phone: me.phone,
                    isAfk: row.is_afk || false,
                    queue: [],
                    isProcessingQueue: false
                };
                
                console.log(`✅ [System] Session Activated: ${me.firstName} (${userIdStr})`);
                startUserbotListener(users[userIdStr], userIdStr);
            }).catch(e => {
                console.error(`❌ [System] Failed to connect ${row.first_name || row.chat_id}:`, e.message);
                if (e.message.includes('406')) {
                   console.error("   └─ Hint: This session is already active elsewhere (Duplicate).");
                }
            });
        }
    })();
} else {
    console.log("⚠️ [System] Supabase not configured. Auto-login skipped.");
}

async function syncSessionsFromDB() {
    if (!DB_URL || !DB_KEY) return "DB not configured";
    const supabase = createClient(DB_URL, DB_KEY);
    const { data, error } = await supabase.from('user_sessions').select('*');
    if (error) return `Error: ${error.message}`;
    
    let count = 0;
    for (const row of data) {
        const userIdStr = String(row.chat_id);
        if (users[userIdStr] && users[userIdStr].state === 'CONNECTED') continue;
        
        if (row.session_string) {
            console.log(`[Sync] Activating new session: ${row.first_name}`);
            const session = new StringSession(row.session_string);
            const client = new TelegramClient(session, API_ID, API_HASH, { connectionRetries: 3 });
            try {
                await client.connect();
                const me = await client.getMe();
                users[String(me.id)] = {
                    state: 'CONNECTED',
                    client: client,
                    firstName: me.firstName,
                    isAfk: row.is_afk || false,
                    queue: [],
                    isProcessingQueue: false
                };
                startUserbotListener(users[String(me.id)], String(me.id));
                count++;
            } catch (e) { console.error(`[Sync] Failed ${row.first_name}:`, e.message); }
        }
    }
    return `Synced ${count} new sessions. Total active: ${Object.keys(users).length}`;
}

// --- HEALTH CHECKS ---
app.get('/', (req, res) => res.send('SaaS Manager is Online!'));
app.get('/health', (req, res) => res.json({ status: 'alive', sessions: Object.keys(users).length }));

// 1. WEBHOOK (Chatbot Interface)
app.post('/webhook', async (req, res) => {
  // Acknowledge immediately to prevent timeouts/retries from Telegram
  res.sendStatus(200);

  try {
    const update = req.body;
    
    // Deduplication check
    if (update.update_id) {
        if (processedUpdates.has(update.update_id)) {
            console.log(`[Webhook] Duplicate update_id ${update.update_id} ignored.`);
            return;
        }
        processedUpdates.add(update.update_id);
        // Keep set small (last 100 IDs)
        if (processedUpdates.size > 100) {
            const first = processedUpdates.values().next().value;
            processedUpdates.delete(first);
        }
    }
    // Log incoming update for debugging
    if (update.message) {
        console.log(`[Webhook] Update from ${update.message.chat.id} (${update.message.chat.first_name}): "${update.message.text}"`);
    } else {
        console.log(`[Webhook] Received non-message update:`, JSON.stringify(update).substring(0, 100));
    }

    if (!update.message) return;

    const text = update.message.text;
    const chatId = String(update.message.chat.id); // Normalize to String
    const user = getUser(chatId);

    console.log(`[Chatbot] Update: "${text}" | State: ${user.state} | Processing: ${user.processing}`);

    if (user.processing) {
        console.log(`[Chatbot] User ${chatId} is currently processing another request. Ignored.`);
        return;
    }

    // --- STATE MACHINE ---
    const cleanCmd = text.trim().toLowerCase();

    // 1. IDLE STATE
    if (user.state === 'IDLE') {
        // ALWAYS check /connect first
        if (cleanCmd.startsWith('/connect')) {
            console.log(`[Chatbot] ${chatId} triggered /connect`);
            user.state = 'WAIT_PHONE';
            await telegramService.sendMessage(chatId, "🔌 **[LOCAL] Connect Userbot**\n\nKirim nomor HP Telegram lo (misal: +628123456789).");
            console.log(`[Chatbot] ${chatId} /connect response sent.`);
        } else if (cleanCmd.startsWith('/me')) {
            await telegramService.sendMessage(chatId, `🆔 **[LOCAL] ID Telegram Lo:** \`${chatId}\``);
        } else if (cleanCmd.startsWith('/afk')) {
            if (!user.client) {
                return telegramService.sendMessage(chatId, "⚠️ **[LOCAL]** Belum connect akun! Ketik /connect dulu.");
                return telegramService.sendMessage(chatId, "⚠️ **[LOCAL]** Belum connect akun! Ketik /connect dulu.");
            }
            user.isAfk = true;
            await telegramService.sendMessage(chatId, "🔇 **[LOCAL] AFK Mode ON**.");
        } else if (cleanCmd.startsWith('/back')) {
            if (!user.client) {
                return telegramService.sendMessage(chatId, "⚠️ **[LOCAL]** Belum connect akun! Ketik /connect dulu.");
            }
            user.isAfk = false;
            // Clear memory
            if (user.interactedUsers) user.interactedUsers.clear();
            await telegramService.sendMessage(chatId, "🔊 **[LOCAL] AFK Mode OFF**.");
        } else if (cleanCmd.startsWith('/sync')) {
            await telegramService.sendMessage(chatId, "⏳ **[LOCAL]** Menyingkronkan sesi dari database Supabase...");
            const res = await syncSessionsFromDB();
            await telegramService.sendMessage(chatId, `✅ **[LOCAL] Sync Selesai**:\n${res}`);
        } else {
            await telegramService.sendMessage(chatId, "🤖 **[LOCAL] Menu Bot**:\n/connect - Login\n/sync - Sync Database\n/afk - ON\n/back - OFF");
        }
    } 

    // 2. WAIT PHONE
    else if (user.state === 'WAIT_PHONE') {
        // Prevent "/connect" or other commands from being read as phone number
        if (text.startsWith('/')) {
            console.log(`[Chatbot] Command "${text}" received in WAIT_PHONE. Resetting to IDLE.`);
            user.state = 'IDLE';
            // Let the recursion/next loop handle it as a command if needed, or just ask user to retry
            return telegramService.sendMessage(chatId, "⚠️ **[LOCAL]** Mode Login dibatalkan. Ketik `/connect` lagi kalau mau mulai.");
        }

        user.processing = true;
        user.phone = text.replace(/\s/g, '');
        await telegramService.sendMessage(chatId, `⏳ **[LOCAL]** Mengirim kode OTP ke ${user.phone}...`);
        
        try {
            console.log(`[System][${INSTANCE_ID}] Initializing Client for ${user.phone}...`);
            
            // CLEANUP: Disconnect existing client if any
            if (user.client) {
                console.log(`[System][${INSTANCE_ID}] Disconnecting stale client...`);
                try { await user.client.disconnect(); } catch (e) { /* ignore */ }
                user.client = null;
            }

            const session = new StringSession("");

            user.client = new TelegramClient(session, API_ID, API_HASH, { 
                connectionRetries: 5,
                useWSS: false 
            });
            
            console.log(`[System][${INSTANCE_ID}] Connecting client...`);
            await user.client.connect();
            console.log(`[System][${INSTANCE_ID}] Client Connected.`);
            
            console.log(`[System][${INSTANCE_ID}] Sending Code to ${user.phone}...`);
            const result = await user.client.invoke(
                new Api.auth.SendCode({
                    phoneNumber: String(user.phone),
                    apiId: Number(API_ID),
                    apiHash: String(API_HASH),
                    settings: new Api.CodeSettings({
                        allowFlashcall: false,
                        currentNumber: false,
                        allowAppHash: false
                    })
                })
            );
            
            const phoneCodeHash = result.phoneCodeHash;
            console.log(`[System][${INSTANCE_ID}] Code Sent. Hash: ${phoneCodeHash}`);
            user.phoneCodeHash = phoneCodeHash;
            user.state = 'WAIT_CODE';
            await telegramService.sendMessage(chatId, "✅ **[LOCAL]** Kode dikirim ke Telegram lo.\n\nKetik kodenya di sini bro:");
        } catch (e) {
            console.error(`[System][${INSTANCE_ID}] SEND_CODE ERROR:`, e);
            user.state = 'IDLE'; 
            const stackMsg = e.stack ? e.stack.substring(0, 1000) : e.message;
            await telegramService.sendMessage(chatId, `❌ **[LOCAL] ERROR**:\n\`\`\`\n${stackMsg}\n\`\`\`\nUlangi /connect.`);
        } finally {
            user.processing = false;
        }
    }

    // 3. WAIT CODE
    else if (user.state === 'WAIT_CODE') {
        // Prevent commands from being read as OTP code
        if (text.startsWith('/')) {
             console.log(`[Chatbot] Command "${text}" received in WAIT_CODE. Resetting to IDLE.`);
             user.state = 'IDLE';
             if (user.client) {
                try { await user.client.disconnect(); } catch (e) {}
                user.client = null;
             }
             return telegramService.sendMessage(chatId, "⚠️ **[LOCAL]** Login dibatalkan. Ketik `/connect` lagi buat ulang.");
        }

        user.processing = true;
        if (!user.client) {
            user.state = 'IDLE';
            user.processing = false;
            return telegramService.sendMessage(chatId, "❌ Session expired. Ulangi /connect.");
        }
 
        try {
           const cleanCode = String(text).trim();
           console.log(`[System][${INSTANCE_ID}] Signing in for ${user.phone} with code ${cleanCode}...`);
           
           const result = await user.client.invoke(
                new Api.auth.SignIn({
                    phoneNumber: String(user.phone),
                    phoneCodeHash: user.phoneCodeHash,
                    phoneCode: cleanCode
                })
            );
            console.log(`[System][${INSTANCE_ID}] SignIn Success!`);
            
            const session = user.client.session.save();
            user.state = 'CONNECTED';
            
            startUserbotListener(user, chatId);
            await telegramService.sendMessage(chatId, "🎉 **[LOCAL] Login Sukses!**\nSekarang AI Userbot lo udah aktif.\n\nKetik `/afk` buat mulai auto-reply.");
        } catch (e) {
             console.error(`[System][${INSTANCE_ID}] SIGN_IN ERROR:`, e);
             if (e.success === false && e.message === 'SESSION_PASSWORD_NEEDED') {
                 await telegramService.sendMessage(chatId, "❌ Akun lo pake 2FA. Matikan dulu 2FA-nya bro.");
             } else {
                 await telegramService.sendMessage(chatId, `❌ **[LOCAL]** Login Gagal: ${e.message}`);
             }
             user.state = 'IDLE';
        } finally {
            user.processing = false;
        }
    }
    
    // 4. CONNECTED
    else if (user.state === 'CONNECTED') {
         // Handle commands normally
         if (text === '/afk') {
            user.isAfk = true;
            await telegramService.sendMessage(chatId, "🔇 **AFK Mode ON**.");
        } else if (text === '/back') {
            user.isAfk = false;
            // Clear memory
            if (user.interactedUsers) user.interactedUsers.clear();
            await telegramService.sendMessage(chatId, "🔊 **AFK Mode OFF**.");
        } else if (text === '/logout') {
            await user.client.disconnect();
            delete users[chatId];
            await telegramService.sendMessage(chatId, "👋 Logout sukses.");
        } else {
            // IGNORE non-commands to prevent spam/looping
            // await telegramService.sendMessage(chatId, "🤖 Akun Terhubung. Pake /afk atau /back.");
        }
    }
  } catch (error) {
    console.error('Webhook Error:', error);
  }
});

// --- USERBOT LOGIC ---
function startUserbotListener(userObj, ownerChatId) {
    const client = userObj.client;
    // Cache for session
    const interactedUsers = new Set();
    const cooldowns = new Map();
    const errorSilence = new Map();
    
    // Reset cache when AFK is toggled OFF (need to hook into the main logic or just clear here periodically)
    // For MVP, we attach it to the userObj so checking /back can clear it
    userObj.interactedUsers = interactedUsers;

    // Listen for incoming messages on the USER'S account
    client.addEventHandler(async (event) => {
        const message = event.message;
        const now = Date.now();
        
        if (!message || message.out) return;

        // Ignore messages from the BOT itself to prevent loops
        const senderId = String(message.senderId);
        const botId = String(process.env.TELEGRAM_BOT_TOKEN.split(':')[0]);
        if (senderId === botId) return;

        if (!userObj.isAfk) return;

        // Determine if it's a private chat
        const isPrivate = message.peerId instanceof Api.PeerUser;
        if (!isPrivate) return;

        // --- FILTERING ---
        // 1. Check for Media (Photo, Sticker, Document, etc.)
        if (message.photo || message.sticker || message.video || message.audio || message.voice || message.document) {
            console.log(`[Userbot] Ignored media message from ${senderId}`);
            return;
        }

        // 2. Check for Emoji-Only text
        const incomingText = message.text || "";
        const emojiRegex = /^[\u{1F300}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}\u{1F170}-\u{1F251}\u{1F004}\u{1F0CF}\u{1F18E}\u{1F191}-\u{1F19A}\u{203C}\u{2049}\u{2122}\u{2139}\u{2194}-\u{2199}\u{21A9}-\u{21AA}\u{231A}-\u{231B}\u{2328}\u{2388}\u{23CF}\u{23E9}-\u{23F3}\u{23F8}-\u{23FA}\u{24C2}\u{25AA}-\u{25AB}\u{25B6}\u{25C0}\u{25FB}-\u{25FE}\u{2600}-\u{2604}\u{260E}\u{2611}\u{2614}-\u{2615}\u{2618}\u{261D}\u{2620}\u{2622}-\u{2623}\u{2626}\u{262E}-\u{262F}\u{2638}-\u{263A}\u{2640}\u{2642}\u{2648}-\u{2653}\u{265F}\u{2660}\u{2663}\u{2665}-\u{2666}\u{2668}\u{267B}\u{267E}-\u{267F}\u{2692}-\u{2697}\u{2699}\u{269B}-\u{269C}\u{26A0}-\u{26A1}\u{26A7}\u{26AA}-\u{26AB}\u{26B0}-\u{26B1}\u{26BD}-\u{26BE}\u{26C4}-\u{26C5}\u{26C8}\u{26CE}-\u{26CF}\u{26D1}\u{26D3}-\u{26D4}\u{26E9}-\u{26EA}\u{26F0}-\u{26F5}\u{26F7}-\u{26FA}\u{2702}\u{2705}\u{2708}-\u{270D}\u{270F}\u{2712}\u{2714}\u{2716}\u{271D}\u{2721}\u{2728}\u{2733}-\u{2734}\u{2744}\u{2747}\u{274C}\u{274E}\u{2753}-\u{2755}\u{2757}\u{2763}-\u{2764}\u{27A1}\u{27B0}\u{27BF}\u{2934}-\u{2935}\u{2B05}-\u{2B07}\u{2B1B}-\u{2B1C}\u{2B50}\u{2B55}\u{3030}\u{303D}\u{3297}\u{3299}\s]+$/u;
        
        if (incomingText && emojiRegex.test(incomingText)) {
            console.log(`[Userbot] Ignored emoji-only message from ${senderId}`);
            return;
        }

        if (!incomingText.trim()) return;

        // --- QUEUEING ---
        userObj.queue.push({ message, senderId, now });
        console.log(`[Userbot] Message from ${senderId} queued. Queue length: ${userObj.queue.length}`);
        
        processUserQueue(userObj);

    }, new NewMessage({ incoming: true })); 

    // --- QUEUE WORKER ---
    async function processUserQueue(userObj) {
        if (userObj.isProcessingQueue || userObj.queue.length === 0) return;
        
        userObj.isProcessingQueue = true;
        
        while (userObj.queue.length > 0) {
            const { message, senderId, now } = userObj.queue.shift();
            
            try {
                // Determine if it's still relevant (optional: check if AFK was turned off)
                if (!userObj.isAfk) continue;

                // 1. Error Silence Period
                if (errorSilence.has(senderId) && Date.now() < errorSilence.get(senderId)) {
                    console.log(`[Userbot] Silence active for ${senderId}. Skipping.`);
                    continue;
                }

                // 2. Cooldown
                if (cooldowns.has(senderId) && (Date.now() - cooldowns.get(senderId)) < 5000) {
                    console.log(`[Userbot] Cooldown active for ${senderId}. Skipping.`);
                    continue;
                }
                cooldowns.set(senderId, Date.now());

                const sender = await message.getSender();
                if (!sender || sender.bot || (sender.username && sender.username.toLowerCase().endsWith('bot'))) {
                    console.log(`[Userbot] Ignored bot/service: ${senderId}`);
                    continue;
                }

                const senderName = sender.firstName || "Bro";
                const incomingText = message.text;
                
                console.log(`[Userbot] Processing queued chat from ${senderName}: ${incomingText}`);

                // --- Keyword Auto-Reply ---
                const cleanText = incomingText.trim().toLowerCase();
                const KEYWORD_REPLIES = {
                    'p': 'Oi, kenapa?',
                    'pinjam dulu seratus': 'Gak ada duit bro',
                    'pagi': 'Pagi juga bos!',
                    'malam': 'Malam, ada apa nih?',
                    'dik': 'eitsss no no yh'
                };

                if (KEYWORD_REPLIES[cleanText]) {
                    const instantReply = KEYWORD_REPLIES[cleanText];
                    await client.sendMessage(sender.id, { message: instantReply });
                } else {
                    // --- Gemini AI Fallback ---
                    const ownerName = process.env.OWNER_NAME || userObj.firstName || "Gue";
                    const isFirstMessage = !userObj.interactedUsers.has(sender.id);
                    
                    try {
                        const reply = await aiService.generateContent(incomingText, ownerName, isFirstMessage);
                        if (isFirstMessage) userObj.interactedUsers.add(sender.id);
                        await client.sendMessage(sender.id, { message: reply });
                    } catch (e) {
                        console.error(`[Userbot] Service Error for ${senderName}:`, e.message);
                        if (e.message?.includes('429')) errorSilence.set(senderId, Date.now() + 60000);
                        await client.sendMessage(sender.id, { message: "Ada masalah teknis nih bro. Coba lagi ya." });
                    }
                }

            } catch (err) {
                console.error("[Userbot] Queue processing item error:", err);
            }

            // Wait 10 seconds before processing next message in queue
            if (userObj.queue.length > 0) {
                console.log(`[Userbot] Waiting 10s before next queue item for owner...`);
                await new Promise(resolve => setTimeout(resolve, 10000));
            }
        }
        
        userObj.isProcessingQueue = false;
    }
    
    console.log(`Userbot listener started for ${userObj.phone}`);
}


app.listen(PORT, () => {
  console.log(`SaaS Manager running on port ${PORT}`);
});
