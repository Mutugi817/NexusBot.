const dotenv = require("dotenv").config();
const { 
    makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion 
} = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode-terminal'); // For displaying QR code in terminal
const OpenAI = require("openai");

// --- Configuration ---
// DeepSeek configuration
const autoReply = true;
const API_KEY = process.env.OPENROUTER_API_KEY;


if(!API_KEY) {
    console.error("Please include your API_KEY inside the .env file");
    process.exit(1);
}

const deepseekClient = new OpenAI({
    apiKey: API_KEY,
    baseURL: 'https://openrouter.ai/api/v1',
});

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys'); // Directory to save session
    const { version, isLatest } = await fetchLatestBaileysVersion();
    console.log(`Using Baileys version ${version.join('.')} (latest: ${isLatest})`);

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true, // Set to false if you want to handle QR display manually
        browser: ['My Baileys Bot', 'Chrome', '1.0'], // Customize browser info
        version: version // Use the fetched Baileys version
    });

    // Save credentials when updated
    sock.ev.on('creds.update', saveCreds);

    // Handle connection updates
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log('Open WhatsApp on your phone,\n tap the three dots on the top right side of your screen,\n select Linked devices then Link a device and \nScan this QR code with your WhatsApp app:');
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Connection closed due to ', lastDisconnect.error.message, ', reconnecting ', shouldReconnect);
            // reconnect if not logged out
            if (shouldReconnect) {
                connectToWhatsApp();
            } else {
                console.log('Logged out. Please rescan QR code to connect again.');
            }
        } else if (connection === 'open') {
            console.log('Opened connection');
        }
    });

    // Listen for incoming messages
    sock.ev.on('messages.upsert', async (chatUpdate) => {
      console.log('chat update', JSON.stringify(chatUpdate, undefined, 2));
        if (chatUpdate.messages) {
            for (const msg of chatUpdate.messages) {
                // Ignore messages from yourself or status updates
                if (!msg.key.fromMe && chatUpdate.type === 'notify' && autoReply) {
                    const senderJid = msg.key.remoteJid;
                    const messageContent = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';

                  console.log(`Received message from ${senderJid}`);

                    // Example: Simple echo bot
                    if (messageContent.toLowerCase() === 'hello') {
                        await sock.sendMessage(senderJid, { text: 'Hi there!' });
                    } else if (messageContent.toLowerCase() === 'time') {
                        const now = new Date();
                        // Ensure proper timezone handling for Thika, Kenya (EAT is UTC+3)
                        const options = { 
                            timeZone: 'Africa/Nairobi', // Explicitly set for EAT
                            hour: '2-digit', 
                            minute: '2-digit', 
                            second: '2-digit', 
                            hour12: false 
                        };
                        const currentTime = now.toLocaleTimeString('en-US', options);
                        await sock.sendMessage(senderJid, { text: `The current time in Thika is ${currentTime}` });

                    } else if (messageContent.toLowerCase().startsWith(".deepseek")) {
                        console.log(`Sending prompt to DeepSeek: "${messageContent}"`);
                        const response = await deepseekClient.chat.completions.create({
                            model: 'deepseek/deepseek-r1:free',
                            messages: [
                                { role: 'system', content: "You are a helpful AI assistant."},
                                { role: "user", content: messageContent},
                            ], 
                            temperature: 0.7,
                            max_tokens: 2000,
                        });
                        const generatedContent = response.choices[0].message.content;
                        console.log("\n DeepSeek's response:");
                        console.log(generatedContent);
                        await sock.sendMessage(senderJid, {text: generatedContent});
                    }
                     else if (messageContent.toLowerCase() === 'help') {
                        await sock.sendMessage(senderJid, { text: 'I can echo your messages, tell you the "time", or respond to "hello".' });
                    }
                }
            }
        }
    });
}

// Start the bot
connectToWhatsApp();