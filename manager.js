const express = require('express');
const bodyParser = require('body-parser');
const { TelegramClient, Api } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { NewMessage } = require('telegram/events');
const telegramService = require('./services/telegramService');
// const geminiService = require('./services/geminiService');
const aiService = require('./services/openRouterService'); // Switched to OpenRouter
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;
const API_ID_RAW = process.env.API_ID;
const API_HASH = process.env.API_HASH;

console.log('Loading Credentials:', { API_ID: API_ID_RAW, API_HASH });

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
  if (!users[id]) users[id] = { state: 'IDLE', isAfk: false, processing: false };
  return users[id];
};

// AUTO-LOGIN ON STARTUP
const fs = require('fs');
let savedSession = null;

if (fs.existsSync('session.txt')) {
    console.log("Loading saved session from session.txt...");
    savedSession = fs.readFileSync('session.txt', 'utf8');
} else if (process.env.SESSION_STRING) {
    console.log("Loading saved session from Environment Variable SESSION_STRING...");
    savedSession = process.env.SESSION_STRING;
} else {
    console.log("No saved session found (Checked session.txt and process.env.SESSION_STRING)");
}

if (savedSession) {
    const session = new StringSession(savedSession);
    
    // Create Client
    const autoClient = new TelegramClient(session, API_ID, API_HASH, { connectionRetries: 5, useWSS: false });
    
    autoClient.connect().then(async () => {
        console.log("AUTO-LOGIN SUCCESS!");
        const me = await autoClient.getMe();
        console.log(`Logged in as: ${me.firstName} (${me.id})`);
        
        // Store in memory mapping (Normalizing ID to String)
        const userIdStr = String(me.id);
        
        users[userIdStr] = {
            state: 'CONNECTED',
            client: autoClient,
            firstName: me.firstName,
            phone: me.phone,
            isAfk: false
        };
        
        console.log(`[System] Registered User ID: ${userIdStr}`);
        startUserbotListener(users[userIdStr], userIdStr);
    }).catch(e => {
        console.error("AUTO-LOGIN CRITICAL ERROR:", e.message);
        if (e.message.includes('AUTH_KEY_DUPLICATED')) {
            console.error("DANGER: Session is being used elsewhere (maybe local bot still running or session revoked).");
        }
    });
}

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
        } else {
            await telegramService.sendMessage(chatId, "🤖 **[LOCAL] Menu Bot**:\n/connect - Login\n/afk - ON\n/back - OFF");
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
        
        
        // Log removed to reduce spam: Only logging processed messages below

        // Ignore messages from the BOT itself to prevent loops
        const senderId = String(message.senderId);
        if (senderId === String(process.env.TELEGRAM_BOT_TOKEN.split(':')[0])) {
            return;
        }

        if (!userObj.isAfk) {
            // console.log("[Userbot] Ignored: Not in AFK mode.");
            return;
        }
        
        // Determine if it's a private chat
        const isPrivate = message.peerId instanceof Api.PeerUser;
        
        // Only reply to Private Chats and ignore messages from SELF (me)
        if (isPrivate && !message.out) {
            console.log(`[Userbot] Processing private message from ${senderId}`);
            
            // 1. Error Silence Period (Stop failure loops)
            if (errorSilence.has(senderId) && now < errorSilence.get(senderId)) {
                console.log(`[Userbot] Silence active for ${senderId}.`);
                return;
            }

            // 2. Cooldown (Don't spam Gemini)
            if (cooldowns.has(senderId) && (now - cooldowns.get(senderId)) < 5000) {
                return;
            }
            cooldowns.set(senderId, now);

            const sender = await message.getSender();
            
            // Security: Ignore other bots to prevent infinite loops or spam replies
            // Check 'bot' flag AND username ending with 'bot' (common convention)
            if (sender.bot || (sender.username && sender.username.toLowerCase().endsWith('bot'))) {
                console.log(`[Userbot] Ignored message from bot/service: ${sender.firstName} (@${sender.username})`);
                return;
            }

            const senderName = sender.firstName || "Bro";
            const incomingText = message.text;
            
            console.log(`[Userbot] Chat from ${senderName}: ${incomingText}`);

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
                console.log(`[Userbot] Keyword Match: "${cleanText}" -> ${instantReply}`);
                await client.sendMessage(sender.id, { message: instantReply });
                return; // Gak usah panggil Gemini
            }

            // --- Gemini AI Fallback ---
            // Fetch owner name from userObj or client
            const ownerName = userObj.firstName || "Gue";
            
            // Check if first message
            const isFirstMessage = !userObj.interactedUsers.has(sender.id);
            
            try {
                const reply = await aiService.generateContent(incomingText, ownerName, isFirstMessage);
                
                // Mark as interacted
                if (isFirstMessage) {
                    userObj.interactedUsers.add(sender.id);
                }
                
                // Send Reply AS THE USER
                await client.sendMessage(sender.id, { message: reply });
            } catch (e) {
                console.error(`[Userbot] Gemini Error for ${senderName}:`, e.message);
                
                // Set silence period for 60 seconds if Quota exceeded
                if (e.message?.includes('429') || (e.response && e.response.status === 429)) {
                    errorSilence.set(senderId, now + 60000); 
                    console.log(`[Userbot] Quota Exceeded. Silencing ${senderName} for 60s.`);
                }
                
                await client.sendMessage(sender.id, { message: "Ada masalah teknis nih bro. Coba lagi ya." });
            }
        }
        
        // Auto-Disable if User replies manually?
        // Checking message.out === true is tricky because the BOT sending is also "out".
        // We'd need to distinguish Bot-sent vs User-sent. 
        // Simple heuristic: If message.out AND message.message !== lastBotReply, then User typed it.
        // Skipping for MVP stability.
        
    }, new NewMessage({ incoming: true })); 
    
    console.log(`Userbot listener started for ${userObj.phone}`);
}


app.listen(PORT, () => {
  console.log(`SaaS Manager running on port ${PORT}`);
});
