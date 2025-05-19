import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";

import fs from 'fs';
import readline from 'readline';

const apiId = 22110800;
const apiHash = "c0611e1cf17abb5e98607e38f900641e";
const stringSession = new StringSession(""); // Empty string for new session

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function askQuestion(query) {
  return new Promise(resolve => rl.question(query, resolve));
}

async function authenticate() {
  const client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 5,
  });

  await client.start({
    phoneNumber: async () => await askQuestion("Please enter your phone number: "),
    password: async () => await askQuestion("Please enter your password: "),
    phoneCode: async () => await askQuestion("Please enter the code you received: "),
    onError: (err) => console.log(err),
  });

  console.log("You are now connected.");
  console.log("Session string: ", client.session.save());

// Create a file to store just the session
fs.writeFileSync('./tokens/telegram_session.txt', client.session.save());
console.log("Session saved to tokens/telegram_session.txt");
console.log("Please add this to your .env file as GRAM_SESSION=...");

  rl.close();
}

authenticate();