const express = require('express');
const bodyParser = require('body-parser');
const { TelegramClient, Api } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { NewMessage } = require('telegram/events');
const telegramService = require('./services/telegramService');
const geminiService = require('./services/geminiService');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;
const API_ID_RAW = process.env.API_ID;
const API_HASH = process.env.API_HASH;

console.log('Loading Credentials:', { API_ID: API_ID_RAW, API_HASH });

// --- TEMPORARY RAILWAY KILL-SWITCH ---
// Ini biar Railway diem pas lo lagi login di laptop. 
const IS_RAILWAY = process.env.RAILWAY_STATIC_URL || process.env.RAILWAY_ENVIRONMENT;

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
setInterval(() => {
    console.log(`[Status] Server is ALIVE. Time: ${new Date().toLocaleTimeString()}`);
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

app.use(bodyParser.json());

// Helper: Get or Init User
const getUser = (id) => {
  if (!users[id]) users[id] = { state: 'IDLE', isAfk: false };
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

if (savedSession && !IS_RAILWAY) {
    const session = new StringSession(savedSession);
    
    // Create Client
    const autoClient = new TelegramClient(session, API_ID, API_HASH, { connectionRetries: 5, useWSS: false });
    
    autoClient.connect().then(async () => {
        console.log("AUTO-LOGIN SUCCESS!");
        const me = await autoClient.getMe();
        console.log(`Logged in as: ${me.firstName} (${me.id})`);
        
        // Store in memory mapping
        users[me.id] = {
            state: 'CONNECTED',
            client: autoClient,
            firstName: me.firstName,
            phone: me.phone,
            isAfk: false
        };
        
        startUserbotListener(users[me.id], me.id);
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

  if (IS_RAILWAY) {
      console.log("⚠️ [RAILWAY Webhook] Ignored (Silence Mode active)");
      return;
  }

  try {
    const update = req.body;
    
    // Log incoming update for debugging
    if (update.message) {
        console.log(`[Webhook] Update from ${update.message.chat.id} (${update.message.chat.first_name}): "${update.message.text}"`);
    } else {
        console.log(`[Webhook] Received non-message update:`, JSON.stringify(update).substring(0, 100));
    }

    if (!update.message) return;

    const chatId = update.message.chat.id;
    const text = update.message.text;
    const user = getUser(chatId);

    console.log(`[Chatbot] Current State for ${chatId}: ${user.state}`);

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
                // FALLBACK: If current user has no client, try to find ANY connected client (Single User Mode)
                const connectedIds = Object.keys(users).filter(k => users[k].client);
                if (connectedIds.length > 0) {
                     // AUTO-SWITCH to the logged in user
                     const loggedInId = connectedIds[0];
                     users[loggedInId].isAfk = true;
                     return telegramService.sendMessage(chatId, `🔇 **[LOCAL] AFK Mode ON** (Akun: \`${loggedInId}\`).`);
                }
                return telegramService.sendMessage(chatId, "⚠️ **[LOCAL]** Belum connect akun! Ketik /connect dulu.");
            }
            user.isAfk = true;
            await telegramService.sendMessage(chatId, "🔇 **[LOCAL] AFK Mode ON**.");
        } else if (cleanCmd.startsWith('/back')) {
            if (!user.client) {
                // FALLBACK: Try to find ANY connected client
                const connectedIds = Object.keys(users).filter(k => users[k].client);
                if (connectedIds.length > 0) {
                     const loggedInId = connectedIds[0];
                     users[loggedInId].isAfk = false;
                     if (users[loggedInId].interactedUsers) users[loggedInId].interactedUsers.clear();
                     return telegramService.sendMessage(chatId, `🔊 **[LOCAL] AFK Mode OFF** (Akun: \`${loggedInId}\`).`);
                }
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
        user.phone = text.replace(/\s/g, '');
        await telegramService.sendMessage(chatId, `⏳ Mengirim kode OTP ke ${user.phone}...`);
        
        try {
            console.log("DEBUG: Initializing Client...");
            console.log("DEBUG: API_ID:", API_ID, typeof API_ID);
            console.log("DEBUG: API_HASH:", API_HASH, typeof API_HASH);
            console.log("DEBUG: StringSession:", StringSession);

            // Init GramJS Client
            const session = new StringSession("");
            console.log("DEBUG: Session Created:", session);

            // FORCE non-interactive mode using 'useWSS: false' (default) and avoiding 'input' package usage by library
            user.client = new TelegramClient(session, API_ID, API_HASH, { 
                connectionRetries: 5,
                useWSS: false 
            });
            
            // Overwrite the internal 'input' handler of the client to throw error instead of waiting for stdin
            // user.client._input = () => { throw new Error("STDIN_DISABLED"); };

            console.log("DEBUG: Client Created");
            
            await user.client.connect();
            console.log("DEBUG: Client Connected");
            
            await user.client.connect();
            console.log("DEBUG: Client Connected");
            
            console.log("DEBUG: Invoking auth.SendCode directly...");
            console.log("Params:", {
                phoneNumber: user.phone,
                apiId: API_ID,
                apiHash: API_HASH
            });

            // Use Direct Invoke to avoid helper issues
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
            
            console.log("DEBUG: Code Sent via Invoke. Result:", result);
            const phoneCodeHash = result.phoneCodeHash;
            
            user.phoneCodeHash = phoneCodeHash;
            user.state = 'WAIT_CODE';
            await telegramService.sendMessage(chatId, "✅ Kode dikirim ke Telegram lo (BUKAN SMS).\n\nKetik kodenya di sini bro:");
        } catch (e) {
            console.error("CRITICAL ERROR:", e);
            user.state = 'IDLE'; 
            // Send Stack Trace to Telegram (Truncated to 1000 chars)
            const stackMsg = e.stack ? e.stack.substring(0, 1000) : e.message;
            await telegramService.sendMessage(chatId, `❌ **[LOCAL] CRITICAL ERROR**:\n\`\`\`\n${stackMsg}\n\`\`\`\nUlangi /connect.`);
        }
    }

    // 3. WAIT CODE
    else if (user.state === 'WAIT_CODE') {
        if (!user.client) {
            user.state = 'IDLE';
            return telegramService.sendMessage(chatId, "❌ Session expired. Ulangi /connect.");
        }

        try {
           console.log("DEBUG: Signing in...");
           console.log("DEBUG: Stored Hash:", user.phoneCodeHash);
           const cleanCode = String(text).trim();
           console.log("DEBUG: Input Code:", cleanCode);
           
           // Use Direct Invoke for SignIn
           const result = await user.client.invoke(
                new Api.auth.SignIn({
                    phoneNumber: String(user.phone),
                    phoneCodeHash: user.phoneCodeHash,
                    phoneCode: cleanCode
                })
            );
            console.log("DEBUG: SignIn Result:", result);
            
            // Save Session (In Memory)
            // Since we used 'invoke', the client internal session might not be fully updated immediately 
            // but stringSession should catch the auth key update.
            const session = user.client.session.save();
            user.state = 'CONNECTED';
            
            // Start Listener for Userbot
            startUserbotListener(user, chatId);

            await telegramService.sendMessage(chatId, "🎉 **Login Sukses!**\nSekarang lo bisa ketik `/afk` buat nyalain AI.");
        } catch (e) {
             console.error(e);
             /* If 2FA is needed, e.message usually contains 'PASSWORD_REQUIRED' */
             if (e.success === false && e.message === 'SESSION_PASSWORD_NEEDED') {
                 // user.state = 'WAIT_PASSWORD'; // Not implemented yet
                 await telegramService.sendMessage(chatId, "❌ Akun lo pake 2FA (Password). Bot ini belum support 2FA bro. Matiin dulu 2FA-nya atau coba nanti.");
             } else {
                 await telegramService.sendMessage(chatId, `❌ **[LOCAL]** Login Gagal: ${e.message}`);
             }
             user.state = 'IDLE';
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
        
        // Log all incoming messages for debugging Cloud issues
        console.log(`[Userbot] Received event. Message: "${message.message?.substring(0, 20)}..." | AFK: ${userObj.isAfk} | Out: ${message.out}`);

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
                const reply = await geminiService.generateContent(incomingText, ownerName, isFirstMessage);
                
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
