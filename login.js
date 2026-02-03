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
  console.log("Session String:", client.session.save()); // Save this to .env or file
  
  // Save to file for manager.js to read
  const fs = require('fs');
  fs.writeFileSync('session.txt', client.session.save());
  console.log("Session saved to session.txt");
  
  process.exit(0);
})();
