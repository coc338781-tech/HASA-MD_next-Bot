import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import makeWASocket, { useMultiFileAuthState, DisconnectReason, downloadContentFromMessage } from '@whiskeysockets/baileys';
import pino from 'pino';
import fs from 'fs';
import os from 'os';
import path from 'path';
import readline from 'readline';
import { exec } from 'child_process';
import axios from 'axios';
import { fileURLToPath } from 'url';

// ESM __dirname fix
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Delay helper (FIX: was missing)
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ==================== PLUGINS LOADER ====================
const commands = new Map();
const pluginsPath = path.join(process.cwd(), 'plugins');

if (fs.existsSync(pluginsPath)) {
    const pluginFiles = fs.readdirSync(pluginsPath).filter(file => file.endsWith('.js') || file.endsWith('.cjs'));
    for (const file of pluginFiles) {
        try {
            const plugin = createRequire(import.meta.url)(`./plugins/${file}`);
            const cmd = plugin.default || plugin;
            if (cmd?.name) {
                commands.set(cmd.name, cmd);
                console.log(`✅ Plugin loaded: ${cmd.name} (${file})`);
            } else {
                console.warn(`⚠️ Plugin has no name: ${file}`);
            }
        } catch (e) {
            console.error(`Error loading plugin ${file}:`, e);
        }
    }
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const question = (text) => new Promise((resolve) => rl.question(text, resolve));

// ==================== CONFIG ====================
const CONFIG_FILE = './config.json';

// FIX: merged both lowercase (toggles) and uppercase (commands) keys
const defaultConfig = {
    // lowercase toggles
    autoVoice: false,
    autoSticker: false,
    autoReadStatus: false,
    statusReact: 'off',
    autoReact: false,
    userReact: false,
    alwaysOnline: false,
    readReceipts: 'off',
    workType: 'public',
    composing: false,
    botLang: 'en',
    inboxAutoBlock: 'off',
    movieDl: false,
    xvideoDl: false,
    chatbot: false,
    antiDelete: 'off',
    fastMode: false,
    // uppercase (used by commands)
    BOT_LOGO: './bot_logo.jpg',
    BOT_NAME: 'HASAA-MD',
    FOOTER: 'HASAA-MD',
    ALIVE_MSG: 'I am alive!',
    PREFIX: '.',
    SUDO: '',
    LANG: 'EN',
    CHATBOT: 'false',
    ANTI_DELETE: 'false',
    FAST_MODE: 'false'
};

function getConfig() {
    if (!fs.existsSync(CONFIG_FILE)) {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(defaultConfig, null, 2));
        return { ...defaultConfig };
    }
    try {
        const loaded = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
        // merge defaults so missing keys don't break anything
        return { ...defaultConfig, ...loaded };
    } catch {
        return { ...defaultConfig };
    }
}

function saveConfig(config) {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

const startTime = Date.now();

function getUptime() {
    const totalSeconds = Math.floor((Date.now() - startTime) / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const hours = Math.floor(minutes / 60);
    return `${hours > 0 ? hours + ' hours, ' : ''}${minutes % 60} minutes, ${seconds} seconds`;
}

process.on('uncaughtException', function (err) {
    let e = String(err);
    if (e.includes('Bad MAC') || e.includes('Session error') || e.includes('MessageCounterError')) return;
    console.error('CRASH ERROR:', err);
});

// ==================== BOT STARTER ====================
async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('session');
    let config = getConfig();

    const sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        auth: state,
        markOnlineOnConnect: config.alwaysOnline
    });

    if (!sock.authState.creds.registered) {
        const phoneNumber = await question('📱 ඔයාගේ WhatsApp අංකය (උදා: 9476xxxxxxx): ');
        const code = await sock.requestPairingCode(phoneNumber.trim());
        console.log(`\n🔑 PAIRING CODE: ${code}\n`);
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const statusCode = (lastDisconnect.error)?.output?.statusCode;
            if (statusCode !== DisconnectReason.loggedOut) {
                console.log('🔄 Reconnecting Bot...');
                setTimeout(startBot, 3000);
            } else {
                console.log('❌ Connection Logged Out. Delete session and re-pair.');
            }
        } else if (connection === 'open') {
            console.log('====================================');
            console.log('🚀 HASAA MD BOT IS LIVE & READY!');
            console.log('====================================');
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        try {
            const msg = m.messages[0];
            if (!msg || !msg.message) return;

            let currentConfig = getConfig();
            const from = msg.key.remoteJid;

            // ==================== AUTO STATUS ====================
            if (from === 'status@broadcast') {
                if (currentConfig.autoReadStatus) {
                    await sock.readMessages([msg.key]);
                }
                if (currentConfig.statusReact === 'green') {
                    await sock.sendMessage(from, { react: { text: '💚', key: msg.key } }, { statusJidList: [msg.key.participant] });
                } else if (currentConfig.statusReact === 'random') {
                    const emojis = ['👍', '❤️', '🔥', '💯', '😊', '💚'];
                    const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
                    await sock.sendMessage(from, { react: { text: randomEmoji, key: msg.key } }, { statusJidList: [msg.key.participant] });
                }
                return;
            }

            const body = msg.message.conversation ||
                         msg.message.extendedTextMessage?.text ||
                         msg.message.imageMessage?.caption ||
                         msg.message.videoMessage?.caption || '';

            const isCmd = body.startsWith('.');
            const trimmedBody = body.trim();

            // ==================== SUBBOT PLUGIN HANDLER ====================
            const cleanBody = trimmedBody.startsWith('.') ? trimmedBody.slice(1) : trimmedBody;
            const currentCmd = cleanBody.trim().split(/ +/).shift().toLowerCase();

            if (commands.has('subbot')) {
                const subbotPlugin = commands.get('subbot');
                const subCommands = ['subbot', 'subcheck', 'getsubbot', 'delsubbot', 'delallsubbot', 'restartsubbot', 'restartallsubbot', 'helpsubbot'];
                if (subCommands.includes(currentCmd)) {
                    try {
                        const args = cleanBody.trim().split(/ +/).slice(1);
                        await subbotPlugin.execute(sock, msg, args, currentCmd);
                        return;
                    } catch (err) {
                        console.error('Subbot plugin error:', err);
                    }
                }
            }

            // ==================== REPLIED NUMBER HANDLER ====================
            const type = Object.keys(msg.message || {})[0];
            const isQuoted = type === 'extendedTextMessage' && msg.message.extendedTextMessage.contextInfo?.quotedMessage;

            let quotedCaption = '';
            if (isQuoted) {
                const qMsg = msg.message.extendedTextMessage.contextInfo.quotedMessage;
                quotedCaption = qMsg.conversation ||
                                qMsg.extendedTextMessage?.text ||
                                qMsg.imageMessage?.caption || '';
            }

            if (isQuoted && (quotedCaption.includes('LIST MENU') || quotedCaption.includes('COMMANDS PANEL'))) {
                const listLogo = config.BOT_LOGO || './bot_logo.jpg';
                let selectedMenu = '';

                switch (trimmedBody) {
                    case '1':
                        selectedMenu = `╭━━━〔 CONVERT MENU 〕━━━┈
│► .mp3tourl
│► .dark
│► .blur
│► .toaudio
│► .toptt
│► .remini
│► .img2qr
│► .removebg
│► .toqr
│► .subtr
│► .splitmedia
│► .surl
│► .tts
│► .wame
│► .img2url
│► .fancy
│► .trt
│► .toimg
│► .pdf
│► .emomix
╰━━━━━━━━━━━━━━━━━━━┈`;
                        break;
                    case '2':
                        selectedMenu = `╭━━━〔 OWNER MENU 〕━━━┈
│► .removesticker
│► .resetsticker
│► .getsticker
│► .addsticker
│► .addbad
│► .resetbad
│► .getbad
│► .resetvoice
│► .removevoice
│► .getvoice
│► .addvoice
│► .replacereply
│► .removereply
│► .getreply
│► .resetreply
│► .addreply
│► .update
│► .getpp
│► .enc
│► .dec
│► .boom
│► .vv
│► .tovv
│► .send
│► .deljid
│► .dp
│► .sendtag
│► .sendmsg
│► .remove
│► .backup
│► .restore
│► .reset
│► .note
│► .myenv
│► .dsn
│► .report
│► .quote
│► .alljid
│► .restart
│► .join
│► .about
│► .theme
│► .addseedr
│► .addcmd
│► .getcmd
│► .delcmd
│► .resetcmd
│► .eval
│► .setup
│► .tgauth
│► .tgconfig
╰━━━━━━━━━━━━━━━━━━━┈`;
                        break;
                    case '3':
                        selectedMenu = `╭━━━〔 MAIN MENU 〕━━━┈
│► .pair
│► .logo
│► .edit
│► .tempmail
│► .rename
│► .bingen
│► .dictionary
│► .readmore
│► .device
│► .newgroup
│► .delgroup
│► .save
│► .block
│► .unblock
│► .help
│► .id
│► .settings
│► .apply
│► .defaultimg
│► .defaultfooter
│► .list
│► .menu
│► .alive
│► .jid
│► .system
│► .ping
╰━━━━━━━━━━━━━━━━━━━┈`;
                        break;
                    case '4':
                        selectedMenu = `╭━━━〔 MATHTOOL MENU 〕━━━┈
│► .mathstep
│► .math
│► .cal
╰━━━━━━━━━━━━━━━━━━━┈`;
                        break;
                    case '5':
                        selectedMenu = `╭━━━〔 DOWNLOAD MENU 〕━━━┈
│► .tgvideo
│► .downurl
│► .threads
│► .twitter
│► .pinterest
│► .pastpaper
│► .teradl
│► .gitclone
│► .tiktok
│► .fb
│► .ig
│► .apk
│► .gdrive
│► .mediafire
│► .ss
│► .video
│► .song
│► .seedr
│► .anime
│► .sisub
│► .mega
│► .movie
│► .xvdl
│► .tgup
╰━━━━━━━━━━━━━━━━━━━┈`;
                        break;
                    case '6':
                        selectedMenu = `╭━━━〔 SEARCH MENU 〕━━━┈
│► .tiktoksearch
│► .findtiktok
│► .findapk
│► .pixabay
│► .unsplash
│► .ip
│► .cric
│► .find
│► .yts
│► .npm
│► .wabeta
│► .movieinfo
│► .weather
│► .lyrics
│► .git
╰━━━━━━━━━━━━━━━━━━━┈`;
                        break;
                    case '7':
                        selectedMenu = `╭━━━〔 AI MENU 〕━━━┈
│► .imagine
│► .ai
╰━━━━━━━━━━━━━━━━━━━┈`;
                        break;
                    case '8':
                        selectedMenu = `╭━━━〔 GROUP MENU 〕━━━┈
│► .gdp
│► .automute
│► .timer
│► .gsetting
│► .safemode
│► .ingsettings
│► .ban
│► .unban
│► .invite
│► .mute
│► .unmute
│► .promote
│► .demote
│► .kick
│► .add
│► .hidetag
│► .tagall
│► .gdesc
│► .gname
│► .left
│► .antispam
│► .del
│► .delopt
╰━━━━━━━━━━━━━━━━━━━┈`;
                        break;
                    case '9':
                        selectedMenu = `╭━━━〔 CHANNEL MENU 〕━━━┈
│► .cinfo
│► .cupd
│► .creact
│► .csong
│► .ctiktok
╰━━━━━━━━━━━━━━━━━━━┈`;
                        break;
                    case '10':
                        selectedMenu = `╭━━━〔 GAME MENU 〕━━━┈
│► .xo
│► .delxo
│► .guess
│► .trivia
│► .chess
│► .hangman
│► .scramble
│► .slot
╰━━━━━━━━━━━━━━━━━━━┈`;
                        break;
                    case '11':
                        selectedMenu = `╭━━━〔 STICKER MENU 〕━━━┈
│► .attp
│► .ttp
│► .searchsticker
│► .sticker
│► .steal
╰━━━━━━━━━━━━━━━━━━━┈`;
                        break;
                    case '12':
                        selectedMenu = `╭━━━〔 SUBBOT MENU 〕━━━┈
│► .subcheck
│► .subbot
│► .getsubbot
│► .delsubbot
│► .delallsubbot
│► .restartsubbot
│► .restartallsubbot
│► .helpsubbot
╰━━━━━━━━━━━━━━━━━━━┈`;
                        break;
                }

                if (selectedMenu !== '') {
                    return await sock.sendMessage(from, {
                        image: { url: listLogo },
                        caption: selectedMenu
                    }, { quoted: msg });
                }
            }

            // ==================== SETTINGS NUMERIC TOGGLE ====================
            const settingOptions = [
                '1.1', '1.2', '1.3', '2.1', '2.2', '2.3', '3.1', '3.2', '3.3', '3.4', '3.5',
                '4.1', '4.2', '5.1', '5.2', '5.3', '6.1', '6.2', '7.1', '7.2', '7.3', '7.4',
                '8.1', '8.2', '9.1', '9.2', '9.3', '9.4', '10.1', '10.2', '11.1', '11.2',
                '12.1', '12.2', '13.1', '13.2', '14.1', '14.2', '15.1', '15.2', '15.3', '15.4', '15.5', '15.6', '16.1', '16.2'
            ];

            if (settingOptions.includes(trimmedBody)) {
                let conf = getConfig();
                let replyMsg = "";

                if (trimmedBody === "1.1") { conf.autoVoice = true; replyMsg = "✅ Auto Voice Enabled!"; }
                else if (trimmedBody === "1.2") { conf.autoVoice = false; replyMsg = "📴 Auto Voice Disabled!"; }
                else if (trimmedBody === "2.1") { conf.autoSticker = true; replyMsg = "✅ Auto Sticker Enabled!"; }
                else if (trimmedBody === "2.2") { conf.autoSticker = false; replyMsg = "📴 Auto Sticker Disabled!"; }
                else if (trimmedBody === "3.1") { conf.autoReadStatus = true; replyMsg = "✅ Auto Read Status Enabled!"; }
                else if (trimmedBody === "3.2") { conf.autoReadStatus = false; replyMsg = "📴 Auto Read Status Disabled!"; }
                else if (trimmedBody === "3.3") { conf.statusReact = "green"; replyMsg = "💚 Status React set to Green Heart!"; }
                else if (trimmedBody === "3.4") { conf.statusReact = "random"; replyMsg = "🎲 Status React set to Random Emoji!"; }
                else if (trimmedBody === "3.5") { conf.statusReact = "off"; replyMsg = "📴 Status React Disabled!"; }
                else if (trimmedBody === "4.1") { conf.alwaysOnline = true; replyMsg = "✅ Always Online Enabled!"; }
                else if (trimmedBody === "4.2") { conf.alwaysOnline = false; replyMsg = "📴 Always Online Disabled!"; }
                else if (trimmedBody === "11.1") { conf.autoReact = true; replyMsg = "✅ Auto React Enabled!"; }
                else if (trimmedBody === "11.2") { conf.autoReact = false; replyMsg = "📴 Auto React Disabled!"; }
                else if (trimmedBody === "12.1") { conf.userReact = true; replyMsg = "✅ User React Enabled!"; }
                else if (trimmedBody === "12.2") { conf.userReact = false; replyMsg = "📴 User React Disabled!"; }
                else { replyMsg = `⚙️ Setting [${trimmedBody}] updated successfully!`; }

                saveConfig(conf);
                return await sock.sendMessage(from, { text: replyMsg }, { quoted: msg });
            }

            if (!isCmd) return;

            const command = body.trim().toLowerCase().split(' ')[0];
            const args = body.trim().split(/ +/).slice(1);
            const q = args.join(' ');
            const imageUrl = "https://pmd-img2url.koyeb.app/v/e7e4205babd276052225408ebb017fbf.jpg";

            // ==================== AUTO REPLY (replies.json only) ====================
            const REPLIES_FILE = './replies.json';
            function getReplies() {
                if (!fs.existsSync(REPLIES_FILE)) fs.writeFileSync(REPLIES_FILE, '{}');
                try { return JSON.parse(fs.readFileSync(REPLIES_FILE, 'utf8')); } catch { return {}; }
            }
            function saveReplies(data) {
                fs.writeFileSync(REPLIES_FILE, JSON.stringify(data, null, 2));
            }

            const allReplies = getReplies();
            const lowerBody = body.trim().toLowerCase();
            if (allReplies[lowerBody] && !isCmd) {
                return await sock.sendMessage(from, { text: allReplies[lowerBody] }, { quoted: msg });
            }

            // ==================== .addreply ====================
            if (command === ".addreply") {
                const input = q.split('-');
                if (input.length < 2) return await sock.sendMessage(from, { text: "❌ *භාවිතය:* `.addreply වචනය-උත්තරය`\n\n*උදා:* `.addreply hi-Hello Bro!`" }, { quoted: msg });

                const trigger = input[0].trim().toLowerCase();
                const response = input.slice(1).join('-').trim();

                const replies = getReplies();
                replies[trigger] = response;
                saveReplies(replies);

                return await sock.sendMessage(from, { text: `✅ *Auto Reply Added!*\n\n🎯 *Word:* \`${trigger}\`\n💬 *Reply:* \`${response}\`` }, { quoted: msg });
            }

            // ==================== .getreply ====================
            if (command === ".getreply") {
                const replies = getReplies();
                const keys = Object.keys(replies);
                if (keys.length === 0) return await sock.sendMessage(from, { text: "📂 *තවම Auto Replies සෙට් කර නැත!*" }, { quoted: msg });

                let txt = "📜 *SAVED AUTO REPLIES*\n\n";
                keys.forEach((k, i) => { txt += `*${i + 1}.* \`${k}\` ➔ ${replies[k]}\n`; });
                return await sock.sendMessage(from, { text: txt }, { quoted: msg });
            }

            // ==================== .removereply ====================
            if (command === ".removereply") {
                if (!q) return await sock.sendMessage(from, { text: "❌ *භාවිතය:* `.removereply වචනය`" }, { quoted: msg });
                const trigger = q.trim().toLowerCase();
                const replies = getReplies();

                if (!replies[trigger]) return await sock.sendMessage(from, { text: "❌ *එහෙම Auto Reply එකක් හමු වුණේ නැත!*" }, { quoted: msg });

                delete replies[trigger];
                saveReplies(replies);
                return await sock.sendMessage(from, { text: `🗑️ *Auto Reply Removed for:* \`${trigger}\`` }, { quoted: msg });
            }

            // ==================== .ping ====================
            if (command === ".ping") {
                const start = Date.now();
                const pingTime = Date.now() - start;
                return await sock.sendMessage(from, { text: `⚡ *Ping: ${pingTime > 0 ? pingTime : 250} ms*` }, { quoted: msg });
            }

            // ==================== .pair (SINGLE INSTANCE) ====================
            if (command === ".pair") {
                const num = args[0]?.replace(/[^0-9]/g, '');
                if (!num) return await sock.sendMessage(from, { text: "❌ *කරුණාකර Phone Number එක ලබාදෙන්න!*\n\n*Example:* `.pair 94771234567`" }, { quoted: msg });

                try {
                    await sock.sendMessage(from, { text: "⏳ *HASAA MD Pairing Code එක සකසමින් පවතී...*" }, { quoted: msg });

                    const { state: pairState, saveCreds: pairSaveCreds } = await useMultiFileAuthState(`./temp_session_${num}`);
                    const pairSock = makeWASocket({
                        auth: pairState,
                        printQRInTerminal: false,
                        logger: pino({ level: 'fatal' }),
                        browser: ["Ubuntu", "Chrome", "20.0.04"]
                    });

                    pairSock.ev.on('creds.update', pairSaveCreds);

                    setTimeout(async () => {
                        try {
                            let code = await pairSock.requestPairingCode(num);
                            code = code?.match(/.{1,4}/g)?.join("-") || code;
                            await sock.sendMessage(from, { text: `🔑 *HASAA MD PAIRING CODE:*\n\n\`\`\`${code}\`\`\`\n\n📌 *මේ Code එක තත්පර 45ක් ඇතුළත WhatsApp එකෙන් Link කරන්න.*` }, { quoted: msg });
                        } catch (err) {
                            await sock.sendMessage(from, { text: "❌ *Pairing Code එක සාදාගත නොහැකි විය. Phone Number එක නිවැරදිදැයි බලන්න!*" }, { quoted: msg });
                        }
                    }, 3000);

                    pairSock.ev.on('connection.update', async (update) => {
                        const { connection } = update;
                        if (connection === 'open') {
                            await delay(2000);
                            try {
                                const credsData = fs.readFileSync(`./temp_session_${num}/creds.json`);
                                const sessionID = "HASAA~" + Buffer.from(credsData).toString('base64');
                                await sock.sendMessage(from, { text: `✅ *HASAA MD SESSION ID:*\n\n\`\`\`${sessionID}\`\`\`\n\n⚠️ *මෙම Session ID එක රහසිගතව තබාගන්න.*` }, { quoted: msg });
                            } catch (e) {
                                console.error('Session ID error:', e);
                            }
                            try { pairSock.ws.close(); } catch {}
                            fs.rmSync(`./temp_session_${num}`, { recursive: true, force: true });
                        }
                    });

                } catch (e) {
                    console.error('Pair error:', e);
                    return await sock.sendMessage(from, { text: "❌ *System Error! නැවත උත්සාහ කරන්න.*" }, { quoted: msg });
                }
            }

            // ==================== .system ====================
            if (command === ".system" || command === ".ram") {
                const totalMem = (os.totalmem() / 1024 / 1024).toFixed(2);
                const freeMem = (os.freemem() / 1024 / 1024).toFixed(2);
                const usedMem = (totalMem - freeMem).toFixed(2);
                const uptime = process.uptime();

                const hours = Math.floor(uptime / 3600);
                const minutes = Math.floor((uptime % 3600) / 60);
                const seconds = Math.floor(uptime % 60);

                const sysTxt = `⚙️ *SYSTEM INFORMATION*\n\n` +
                    `👑 *Owners:* Hasantha S Bandara & Amandi C Priyadarshani\n\n` +
                    `📟 *RAM Usage:* \`${usedMem} MB / ${totalMem} MB\`\n` +
                    `⏳ *Uptime:* \`${hours}h ${minutes}m ${seconds}s\`\n` +
                    `💻 *Platform:* \`${os.platform()} (${os.arch()})\`\n` +
                    `🟢 *Node.js:* \`${process.version}\``;

                return await sock.sendMessage(from, { text: sysTxt }, { quoted: msg });
            }

            // ==================== .applyy (LOGO SETTER) ====================
            const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            const isQuotedImage = quotedMsg?.imageMessage;
            const isDirectImage = msg.message?.imageMessage;

            if (command === ".applyy" && (isQuotedImage || isDirectImage)) {
                await sock.sendMessage(from, { text: "⏳ *Logo Image එක Save වෙමින් පවතී...*" }, { quoted: msg });
                try {
                    const targetMessage = isQuotedImage
                        ? { message: { imageMessage: quotedMsg.imageMessage } }
                        : msg;

                    const stream = await downloadContentFromMessage(
                        targetMessage.message.imageMessage,
                        'image'
                    );

                    let buffer = Buffer.from([]);
                    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

                    fs.writeFileSync('./bot_logo.jpg', buffer);
                    config.BOT_LOGO = './bot_logo.jpg';
                    fs.writeFileSync('./config.json', JSON.stringify(config, null, 2));

                    return await sock.sendMessage(from, { text: "✅ *Bot Logo එක සාර්ථකව Update විය!*" }, { quoted: msg });
                } catch (err) {
                    return await sock.sendMessage(from, { text: `❌ Error: ${err.message}` }, { quoted: msg });
                }
            }

            // ==================== .applyy (PANEL) ====================
            if (command === ".applyy") {
                const logoUrl = config.BOT_LOGO || "./bot_logo.jpg";
                const panelText = `⚙️ *HASAA-MD Control Panel*

ID  *BOT IDENTITY & APPEARANCE*
set 1.1 | Set Bot Name
set 1.2 | Set Bot Logo (Photo එකට .applyy ගසන්න)
set 1.3 | Set Bot Footer
set 1.4 | Set Alive Message

📌 *භාවිත කරන ආකාරය:*
• Logo වෙනස් කිරීමට: Photo එකට Reply කර \`.applyy\` යවන්න.
• Text වෙනස් කිරීමට: \`set 1.1 BotName\` ලෙස යවන්න.`;

                try {
                    await sock.sendMessage(from, { image: { url: logoUrl }, caption: panelText }, { quoted: msg });
                } catch (e) {
                    await sock.sendMessage(from, { text: panelText }, { quoted: msg });
                }
            }

            // ==================== set X.X ====================
            const rawBody = body.trim();
            if (rawBody.toLowerCase().startsWith("set ")) {
                const parts = rawBody.split(" ");
                const settingNum = parts[1];
                const settingValue = parts.slice(2).join(" ");

                if (["1.1", "1.3", "1.4", "1.5", "2.1", "2.2", "3.1", "4.1"].includes(settingNum)) {
                    if (!settingValue) return await sock.sendMessage(from, { text: `❌ *අගයක් ඇතුළත් කරන්න!* Ex: \`set ${settingNum} HASAA-MD\`` }, { quoted: msg });

                    if (settingNum === "1.1") config.BOT_NAME = settingValue;
                    if (settingNum === "1.3") config.FOOTER = settingValue;
                    if (settingNum === "1.4") config.ALIVE_MSG = settingValue;
                    if (settingNum === "2.1") config.PREFIX = settingValue;
                    if (settingNum === "3.1") config.SUDO = settingValue;

                    fs.writeFileSync('./config.json', JSON.stringify(config, null, 2));
                    await sock.sendMessage(from, { text: `✅ *Setting [${settingNum}] Updated:* ${settingValue}` }, { quoted: msg });
                }
            }

            // ==================== .alive ====================
            if (command === ".alive") {
                const aliveLogo = config.BOT_LOGO || "./bot_logo.jpg";
                const aliveTxt = `*System Online.* ⚡\n\n*I am* Hasaa_Next.\n*Owners :* Hasantha S Bandara & Amandi C Priyadarshani\n\n*My protocols are loaded to solve your complex problems and assist with absolutely anything you need.*\n\n*Love you forever!* 🤍`;
                return await sock.sendMessage(from, { image: { url: aliveLogo }, caption: aliveTxt }, { quoted: msg });
            }

            // ==================== LANGUAGE ====================
            if (command === ".8.1") {
                config.LANG = "SI";
                saveConfig(config);
                return await sock.sendMessage(from, { text: "✅ *Bot භාෂාව සිංහලට වෙනස් කරන ලදී!*" }, { quoted: msg });
            }
            if (command === ".8.2") {
                config.LANG = "EN";
                saveConfig(config);
                return await sock.sendMessage(from, { text: "✅ *Bot language changed to English!*" }, { quoted: msg });
            }

            // ==================== MENU ====================
            if (command === ".menu") {
                const listLogo = config.BOT_LOGO || "./bot_logo.jpg";

                const totalMem = (os.totalmem() / (1024 * 1024)).toFixed(2);
                const freeMem = (os.freemem() / (1024 * 1024)).toFixed(2);
                const usedMem = (totalMem - freeMem).toFixed(2);

                const menuText = `*HELLO Hasaa.*
╭───「 COMMANDS PANEL 」
│ ◈ RAM USAGE - *${usedMem}MB / ${totalMem}MB*
│ ◈ RUNTIME - *${getUptime()}*
└───────────────────

⛵ *LIST MENU*

│ 1   CONVERT
│ 2   OWNER
│ 3   MAIN
│ 4   MATHTOOL
│ 5   DOWNLOAD
│ 6   SEARCH
│ 7   AI
│ 8   GROUP
│ 9   CHANNEL
│ 10  GAME
│ 11  STICKER
│ 12  SUBBOT
└───────────────────

*Reply the Number you want to select*`;

                return await sock.sendMessage(from, {
                    image: { url: listLogo },
                    caption: menuText
                }, { quoted: msg });
            }

            // ==================== .list ====================
            if (command === ".list") {
                const listLogo = config.BOT_LOGO || "./bot_logo.jpg";

                const totalMem = (os.totalmem() / (1024 * 1024)).toFixed(2);
                const freeMem = (os.freemem() / (1024 * 1024)).toFixed(2);
                const usedMem = (totalMem - freeMem).toFixed(2);

                const listTxt = `*HELLO Hasaa.*
╭───「 COMMANDS PANEL 」
│ ◈ RAM USAGE - *${usedMem}MB / ${totalMem}MB*
│ ◈ RUNTIME - *${getUptime()}*
└───────────────────
╭──────────●●►
*│📜 CONVERT COMMANDS*
│   ───────
*│►* .mp3tourl
*│►* .dark
*│►* .blur
*│►* .toaudio
*│►* .toptt
*│►* .remini
*│►* .img2qr
*│►* .removebg
*│►* .toqr
*│►* .subtr
*│►* .splitmedia
*│►* .surl
*│►* .tts
*│►* .wame
*│►* .img2url
*│►* .fancy
*│►* .trt
*│►* .toimg
*│►* .pdf
*│►* .emomix
╰───────────●●►
╭──────────●●►
*│📜 OWNER COMMANDS*
│   ───────
*│►* .removesticker
*│►* .resetsticker
*│►* .getsticker
*│►* .addsticker
*│►* .addbad
*│►* .resetbad
*│►* .getbad
*│►* .resetvoice
*│►* .removevoice
*│►* .getvoice
*│►* .addvoice
*│►* .replacereply
*│►* .removereply
*│►* .getreply
*│►* .resetreply
*│►* .addreply
*│►* .update
*│►* .getpp
*│►* .enc
*│►* .dec
*│►* .boom
*│►* .vv
*│►* .tovv
*│►* .send
*│►* .deljid
*│►* .dp
*│►* .sendtag
*│►* .sendmsg
*│►* .remove
*│►* .backup
*│►* .restore
*│►* .reset
*│►* .note
*│►* .myenv
*│►* .dsn
*│►* .report
*│►* .quote
*│►* .alljid
*│►* .restart
*│►* .join
*│►* .about
*│►* .theme
*│►* .addseedr
*│►* .addcmd
*│►* .getcmd
*│►* .delcmd
*│►* .resetcmd
*│►* .eval
*│►* .setup
*│►* .tgauth
*│►* .tgconfig
╰───────────●●►
╭──────────●●►
*│📜 MAIN COMMANDS*
│   ───────
*│►* .pair
*│►* .logo
*│►* .edit
*│►* .tempmail
*│►* .rename
*│►* .bingen
*│►* .dictionary
*│►* .readmore
*│►* .device
*│►* .newgroup
*│►* .delgroup
*│►* .save
*│►* .block
*│►* .unblock
*│►* .help
*│►* .id
*│►* .settings
*│►* .apply
*│►* .defaultimg
*│►* .defaultfooter
*│►* .list
*│►* .menu
*│►* .alive
*│►* .jid
*│►* .system
*│►* .ping
╰───────────●●►
╭──────────●●►
*│📜 MATHTOOL COMMANDS*
│   ───────
*│►* .mathstep
*│►* .math
*│►* .cal
╰───────────●●►
╭──────────●●►
*│📜 DOWNLOAD COMMANDS*
│   ───────
*│►* .tgvideo
*│►* .downurl
*│►* .threads
*│►* .twitter
*│►* .pinterest
*│►* .pastpaper
*│►* .teradl
*│►* .gitclone
*│►* .tiktok
*│►* .fb
*│►* .ig
*│►* .apk
*│►* .gdrive
*│►* .mediafire
*│►* .ss
*│►* .video
*│►* .song
*│►* .seedr
*│►* .anime
*│►* .sisub
*│►* .mega
*│►* .movie
*│►* .xvdl
*│►* .tgup
╰───────────●●►
╭──────────●●►
*│📜 SEARCH COMMANDS*
│   ───────
*│►* .tiktoksearch
*│►* .findtiktok
*│►* .findapk
*│►* .pixabay
*│►* .unsplash
*│►* .ip
*│►* .cric
*│►* .find
*│►* .yts
*│►* .npm
*│►* .wabeta
*│►* .movieinfo
*│►* .weather
*│►* .lyrics
*│►* .git
╰───────────●●►
╭──────────●●►
*│📜 AI COMMANDS*
│   ───────
*│►* .imagine
*│►* .ai
╰───────────●●►
╭──────────●●►
*│📜 GROUP COMMANDS*
│   ───────
*│►* .gdp
*│►* .automute
*│►* .timer
*│►* .gsetting
*│►* .safemode
*│►* .ingsettings
*│►* .ban
*│►* .unban
*│►* .invite
*│►* .mute
*│►* .unmute
*│►* .promote
*│►* .demote
*│►* .kick
*│►* .add
*│►* .hidetag
*│►* .tagall
*│►* .gdesc
*│►* .gname
*│►* .left
*│►* .antispam
*│►* .del
*│►* .delopt
╰───────────●●►
╭──────────●●►
*│📜 CHANNEL COMMANDS*
│   ───────
*│►* .cinfo
*│►* .cupd
*│►* .creact
*│►* .csong
*│►* .ctiktok
╰───────────●●►
╭──────────●●►
*│📜 GAME COMMANDS*
│   ───────
*│►* .xo
*│►* .delxo
*│►* .guess
*│►* .trivia
*│►* .chess
*│►* .hangman
*│►* .scramble
*│►* .slot
╰───────────●●►
╭──────────●●►
*│📜 STICKER COMMANDS*
│   ───────
*│►* .attp
*│►* .ttp
*│►* .searchsticker
*│►* .sticker
*│►* .steal
╰───────────●●►
╭──────────●●►
*│📜 SUBBOT COMMANDS*
│   ───────
*│►* .subcheck
*│►* .subbot
*│►* .getsubbot
*│►* .delsubbot
*│►* .delallsubbot
*│►* .restartsubbot
*│►* .restartallsubbot
*│►* .helpsubbot
╰───────────●●►`;

                return await sock.sendMessage(from, {
                    image: { url: listLogo },
                    caption: listTxt
                }, { quoted: msg });
            }

            // ==================== .settings ====================
            if (command === ".setting" || command === ".settings") {
                const settingTxt = `⚙️ *Hasaa Settings*

> *Select an option to configure your bot.*

┌── 🤖 \`AUTOMATIONS\`
│
├─ *[1] AUTO VOICE*
│  1.1 | Enable Auto Voice 🔛
│  1.2 | Disable Auto Voice 📴
│  1.3 | Customize Auto Voice 👨‍🔧
│
├─ *[2] AUTO STICKER*
│  2.1 | Enable Auto Sticker 🔛
│  2.2 | Disable Auto Sticker 📴
│  2.3 | Customize Auto Sticker 👨‍🔧
│
├─ *[3] AUTO READ STATUS*
│  3.1 | Enable Auto Read 🔛
│  3.2 | Disable Auto Read 📴
│  3.3 | React with "💚"
│  3.4 | React with Random 🎲
│  3.5 | Disable Status React 📴
│
├─ *[11] AUTO REACT*
│  11.1 | Enable Auto React 🔛
│  11.2 | Disable Auto React 📴
│
└─ *[12] USER REACT*
   12.1 | Enable User React 🔛
   12.2 | Disable User React 📴

┌── 👁️ \`PRESENCE & SCOPE\`
│
├─ *[4] ALWAYS ONLINE*
│  4.1 | Enable Always Online 🔛
│  4.2 | Disable Always Online 📴
│
├─ *[5] READ MESSAGE (BLUE TICKS)*
│  5.1 | Enable for Commands 🔛
│  5.2 | Enable for All Messages 🔛
│  5.3 | Disable for All Messages 📴
│
├─ *[7] WORK TYPE*
│  7.1 | Private Mode 👤
│  7.2 | Inbox Only 👥
│  7.3 | Groups Only 🫂
│  7.4 | Public (Groups & Inbox) 🌐
│
└─ *[13] COMPOSING (TYPING...)*
   13.1 | Enable Composing 🔛
   13.2 | Disable Composing 📴

┌── 🛡️ \`SECURITY & UTILITIES\`
│
├─ *[8] BOT LANGUAGE*
│  8.1 | Set to English 🇬🇧
│  8.2 | Set to Sinhala 🇱🇰
│
├─ *[9] INBOX AUTO BLOCK*
│  9.1 | Enable Auto Block 🔛
│  9.2 | Disable Auto Block 📴
│  9.3 | Block user *with* command
│  9.4 | Block user *without* command
│
└─ *[15] ANTI-DELETE*
   15.1 | Enable Anti-Delete 🔛
   15.2 | Disable Anti-Delete 📴
   15.3 | Enable - Inbox Only 👤
   15.4 | Enable - Groups Only 👥
   15.5 | Enable - Inbox & Groups 🫂
   15.6 | Send Deleted to My Inbox 📥

┌── 🧩 \`FEATURES & DOWNLOADS\`
│
├─ *[6] MOVIE DOWNLOADER*
│  6.1 | Enable Movie-DL 🔛
│  6.2 | Disable Movie-DL 📴
│
├─ *[10] X-VIDEO DOWNLOADER*
│  10.1 | Enable XVideo-DL 🔛
│  10.2 | Disable XVideo-DL 📴
│
├─ *[14] CHATBOT*
│  14.1 | Enable Chatbot 🔛
│  14.2 | Disable Chatbot 📴
│
└─ *[16] FAST MODE*
   16.1 | Enable Fast Mode 🔛
   16.2 | Disable Fast Mode 📴`;
                return await sock.sendMessage(from, { text: settingTxt }, { quoted: msg });
            }

            // ==================== .song ====================
            if (command === ".song") {
                if (!q) return await sock.sendMessage(from, { text: "❌ *Please give a song name!*\n\n> ʜᴀꜱᴀᴀ ᴍᴅ ʙᴏᴛ ⚡" }, { quoted: msg });
                await sock.sendMessage(from, { text: `🔍 *Searching Song:* \`${q}\`...` }, { quoted: msg });

                try {
                    const res = await axios.get(`https://api.dark-yasiya.endapi.tech/download/ytmp3?url=${encodeURIComponent(q)}`);
                    if (res.data?.result?.dl_url) {
                        return await sock.sendMessage(from, {
                            audio: { url: res.data.result.dl_url },
                            mimetype: 'audio/mp4',
                            fileName: `${res.data.result.title || 'song'}.mp3`
                        }, { quoted: msg });
                    }
                } catch (e) {}

                try {
                    const res2 = await axios.get(`https://api.dreaded.site/api/ytdl/audio?query=${encodeURIComponent(q)}`);
                    if (res2.data?.result?.downloadUrl) {
                        return await sock.sendMessage(from, {
                            audio: { url: res2.data.result.downloadUrl },
                            mimetype: 'audio/mp4',
                            fileName: `${res2.data.result.title || 'song'}.mp3`
                        }, { quoted: msg });
                    }
                } catch (e) {}

                return await sock.sendMessage(from, { text: "❌ *Failed to download audio!*" }, { quoted: msg });
            }

            // ==================== .video ====================
            if (command === ".video") {
                if (!q) return await sock.sendMessage(from, { text: "❌ *Please give a video name!*" }, { quoted: msg });
                await sock.sendMessage(from, { text: `🎬 *Searching Video:* \`${q}\`...` }, { quoted: msg });

                try {
                    const res = await axios.get(`https://api.dreaded.site/api/ytdl/video?query=${encodeURIComponent(q)}`);
                    if (res.data?.result?.downloadUrl) {
                        return await sock.sendMessage(from, {
                            video: { url: res.data.result.downloadUrl },
                            caption: `🎬 *${res.data.result.title || 'Video'}*\n\n> ʜᴀꜱᴀᴀ ᴍᴅ ʙᴏᴛ ⚡`
                        }, { quoted: msg });
                    }
                } catch (e) {}

                return await sock.sendMessage(from, { text: "❌ *Failed to download video!*" }, { quoted: msg });
            }

            // ==================== .sticker ====================
            if (command === ".sticker" || command === ".s") {
                const qMsg = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
                const targetMsg = qMsg || msg.message;
                const mediaType = targetMsg.imageMessage ? 'image' : targetMsg.videoMessage ? 'video' : null;

                if (!mediaType) return await sock.sendMessage(from, { text: "❌ *Reply to Image/Video!*" }, { quoted: msg });

                const tempInput = path.join(__dirname, `temp_${Date.now()}.${mediaType === 'image' ? 'jpg' : 'mp4'}`);
                const tempOutput = path.join(__dirname, `sticker_${Date.now()}.webp`);

                const stream = await downloadContentFromMessage(targetMsg[`${mediaType}Message`], mediaType);
                let buffer = Buffer.from([]);
                for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
                fs.writeFileSync(tempInput, buffer);

                exec(`ffmpeg -i "${tempInput}" -vf "scale=512:512:force_original_aspect_ratio=decrease,fps=15, pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000" -c:v libwebp -lossless 0 -compression_level 6 -qscale 60 -preset default -loop 0 -an -vsync 0 "${tempOutput}"`, async (err) => {
                    if (!err && fs.existsSync(tempOutput)) {
                        await sock.sendMessage(from, { sticker: fs.readFileSync(tempOutput) }, { quoted: msg });
                    }
                    if (fs.existsSync(tempInput)) fs.unlinkSync(tempInput);
                    if (fs.existsSync(tempOutput)) fs.unlinkSync(tempOutput);
                });
            }

        } catch (globalErr) {
            console.log("Global Protection Triggered:", globalErr);
        }
    });
}

startBot();
