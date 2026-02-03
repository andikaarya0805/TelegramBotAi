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

if (!API_ID_RAW || !API_HASH) {
    console.error("FATAL: API_ID or API_HASH is missing in .env");
    process.exit(1);
}

const API_ID = parseInt(API_ID_RAW);

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
    console.log("Loading saved session from Environment Variable...");
    savedSession = process.env.SESSION_STRING;
}

if (savedSession) {
    const session = new StringSession(savedSession);
    
    // Create Client
    const autoClient = new TelegramClient(session, API_ID, API_HASH, { connectionRetries: 5, useWSS: false });
    
    autoClient.connect().then(async () => {
        console.log("AUTO-LOGIN SUCCESS!");
        const me = await autoClient.getMe();
        console.log(`Logged in as: ${me.firstName} (${me.id})`);
        
        // Store in memory mapping
        // We use the ID from 'me.id' to map it correctly
        users[me.id] = {
            state: 'CONNECTED',
            client: autoClient,
            firstName: me.firstName, // Store name for AI Persona
            phone: me.phone,
            isAfk: false
        };
        
        // Start Listener
        startUserbotListener(users[me.id], me.id);
    }).catch(e => {
        console.error("Auto-Login Failed:", e);
    });
}

// 1. WEBHOOK (Chatbot Interface)
app.post('/webhook', async (req, res) => {
  try {
    const update = req.body;
    if (!update.message) return res.sendStatus(200);

    const chatId = update.message.chat.id;
    const text = update.message.text;
    const user = getUser(chatId);

    console.log(`[Chatbot] ${chatId} (${user.state}): ${text}`);

    // --- STATE MACHINE ---

    // 1. IDLE STATE
    if (user.state === 'IDLE') {
        if (text === '/me') {
            await telegramService.sendMessage(chatId, `🆔 **ID Telegram Lo:** \`${chatId}\`\n\nCoba cocokin sama ID Userbot di logs.`);
        } else if (text === '/connect') {
            user.state = 'WAIT_PHONE';
            await telegramService.sendMessage(chatId, "🔌 **Connect Userbot**\n\nKirim nomor HP Telegram lo (pake kode negara, misal: +628123456789).");
        } else if (text === '/afk') {
            if (!user.client) {
                // FALLBACK: If current user has no client, try to find ANY connected client (Single User Mode)
                const connectedIds = Object.keys(users).filter(k => users[k].client);
                if (connectedIds.length > 0) {
                     // AUTO-SWITCH to the logged in user
                     const loggedInId = connectedIds[0];
                     users[loggedInId].isAfk = true;
                     return telegramService.sendMessage(chatId, `🔇 **AFK Mode ON** (Untuk Akun: \`${loggedInId}\`).\n(Gue izinin lo kontrol akun ini sementara).`);
                }
                return telegramService.sendMessage(chatId, "⚠️ Belum connect akun! Ketik /connect dulu.");
            }
            user.isAfk = true;
            await telegramService.sendMessage(chatId, "🔇 **AFK Mode ON** (Userbot).\nGue bakal balesin Chat Pribadi lo.");
        } else if (text === '/back') {
            user.isAfk = false;
            await telegramService.sendMessage(chatId, "🔊 **AFK Mode OFF**.");
        } else {
            await telegramService.sendMessage(chatId, "🤖 **Menu Bot**:\n/connect - Login Akun Telegram\n/afk - Nyalain Auto Reply\n/back - Matiin Auto Reply");
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
            await telegramService.sendMessage(chatId, `❌ **CRITICAL ERROR**:\n\`\`\`\n${stackMsg}\n\`\`\`\nUlangi /connect.`);
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
                 await telegramService.sendMessage(chatId, `❌ Login Gagal: ${e.message}`);
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

    res.sendStatus(200);
  } catch (error) {
    console.error('Webhook Error:', error);
    res.sendStatus(500);
  }
});

// --- USERBOT LOGIC ---
function startUserbotListener(userObj, ownerChatId) {
    const client = userObj.client;
    // Cache to track who we've already introduced ourselves to
    // Set<SenderID>
    const interactedUsers = new Set();
    
    // Reset cache when AFK is toggled OFF (need to hook into the main logic or just clear here periodically)
    // For MVP, we attach it to the userObj so checking /back can clear it
    userObj.interactedUsers = interactedUsers;

    // Listen for incoming messages on the USER'S account
    client.addEventHandler(async (event) => {
        const message = event.message;
        
        // DEBUG LOG
        if (event.isPrivate && !message.out) {
             console.log("DEBUG: Private Msg Received:", message.text);
             console.log("DEBUG: AFK Status:", userObj.isAfk);
        }

        if (!userObj.isAfk) return;
        
        // Only reply to Private Chats (isPrivate property)
        // And ignore messages from SELF (me)
        if (event.isPrivate && !message.out) {
            const sender = await message.getSender();
            const senderName = sender.firstName || "Bro";
            const incomingText = message.text;
            
            console.log(`[Userbot] Chat from ${senderName}: ${incomingText}`);

            // Generate AI Reply
            // Fetch owner name from userObj or client
            const ownerName = userObj.firstName || "Gue";
            
            // Check if first message
            const isFirstMessage = !userObj.interactedUsers.has(sender.id);
            
            const reply = await geminiService.generateContent(incomingText, ownerName, isFirstMessage);
            
            // Mark as interacted
            if (isFirstMessage) {
                userObj.interactedUsers.add(sender.id);
            }
            
            // Send Reply AS THE USER
            await client.sendMessage(sender.id, { message: reply });
            
            // Optional: Notify Owner via Chatbot?
            // await telegramService.sendMessage(ownerChatId, `📩 **Auto-Reply Sent** to ${senderName}`);
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
