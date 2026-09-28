const fs = require('fs');
const path = require('path');
const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const axios = require('axios');
const os = require('os');
const { exec } = require('child_process');

global.subbots = global.subbots || {};

// ==================== SUBBOT PLUGIN LOADER ====================
function loadPlugins(sock, sessionDir) {
    const pluginsPath = path.join(process.cwd(), 'plugins');
    const commandsMap = new Map();

    if (!fs.existsSync(pluginsPath)) return commandsMap;

    const files = fs.readdirSync(pluginsPath).filter(f => f.endsWith('.js') || f.endsWith('.cjs'));
    for (const file of files) {
        try {
            const plugin = require(path.join(process.cwd(), 'plugins', file));
            const cmd = plugin.default || plugin;
            if (cmd?.name && cmd?.execute) {
                commandsMap.set(cmd.name, cmd);
            }
        } catch (e) {
            console.error(`Subbot plugin load error (${file}):`, e.message);
        }
    }
    return commandsMap;
}

// ==================== SUBBOT COMMAND HANDLER ====================
async function handleSubbotMessage(sock, msg, commandsMap) {
    try {
        if (!msg.message) return;
        const from = msg.key.remoteJid;
        if (from === 'status@broadcast') return;

        const body = msg.message.conversation ||
                     msg.message.extendedTextMessage?.text ||
                     msg.message.imageMessage?.caption ||
                     msg.message.videoMessage?.caption || '';

        if (!body.startsWith('.')) return;

        const args = body.trim().split(/ +/);
        const command = args.shift().toLowerCase();
        const cmdName = command.slice(1);
        const q = args.join(' ');

        // 1. Plugin commands
        if (commandsMap.has(cmdName)) {
            const plugin = commandsMap.get(cmdName);
            try {
                await plugin.execute(sock, msg, args, cmdName);
                return;
            } catch (e) {
                console.error('Plugin exec error:', e);
            }
        }

        // 2. Built-in commands (same as main bot)
        if (command === '.ping') {
            const start = Date.now();
            return await sock.sendMessage(from, {
                text: `⚡ *Ping: ${Date.now() - start || 250} ms*`
            }, { quoted: msg });
        }

        if (command === '.alive') {
            return await sock.sendMessage(from, {
                text: `*Subbot is online!* ⚡\n\nJID: \`${sock.user.id}\``
            }, { quoted: msg });
        }

        if (command === '.system') {
            const total = (os.totalmem() / 1024 / 1024).toFixed(2);
            const free = (os.freemem() / 1024 / 1024).toFixed(2);
            const used = (total - free).toFixed(2);
            const up = process.uptime();
            const h = Math.floor(up / 3600);
            const m = Math.floor((up % 3600) / 60);
            const s = Math.floor(up % 60);
            return await sock.sendMessage(from, {
                text: `⚙️ *SYSTEM*\n\n📟 RAM: \`${used}MB / ${total}MB\`\n⏳ Uptime: \`${h}h ${m}m ${s}s\`\n🟢 Node: \`${process.version}\``
            }, { quoted: msg });
        }

        if (command === '.menu' || command === '.help') {
            const listLogo = './bot_logo.jpg';
            const menuText = `*SUBBOT MENU*\n\n` +
                `│ 1  CONVERT\n│ 2  OWNER\n│ 3  MAIN\n│ 4  MATH\n│ 5  DOWNLOAD\n` +
                `│ 6  SEARCH\n│ 7  AI\n│ 8  GROUP\n│ 9  CHANNEL\n│ 10 GAME\n│ 11 STICKER\n\n` +
                `*Use .list for full commands*`;
            try {
                return await sock.sendMessage(from, {
                    image: fs.existsSync(listLogo) ? fs.readFileSync(listLogo) : undefined,
                    caption: menuText
                }, { quoted: msg });
            } catch {
                return await sock.sendMessage(from, { text: menuText }, { quoted: msg });
            }
        }

        // If command not found, do nothing (silent)
    } catch (e) {
        console.error('Subbot handler error:', e);
    }
}

// ==================== START SUBBOT ====================
async function startSubbot(sessionId, ownerJid, mainSock, mek) {
    try {
        const cleanSession = sessionId.replace(/^HASAA~/, '').trim();
        let credsData;
        try {
            credsData = Buffer.from(cleanSession, 'base64').toString('utf8');
            JSON.parse(credsData); // validate JSON
        } catch {
            throw new Error('Invalid Session ID format');
        }

        const sessionDir = `./subbot_sessions/${ownerJid.replace(/[^0-9]/g, '')}`;
        if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });
        fs.writeFileSync(path.join(sessionDir, 'creds.json'), credsData);

        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

        const subSock = makeWASocket({
            logger: pino({ level: 'silent' }),
            printQRInTerminal: false,
            auth: state,
            browser: ['HASAA-MD', 'Chrome', '1.0.0']
        });

        subSock.ev.on('creds.update', saveCreds);

        // Load all plugins
        const subCommands = loadPlugins(subSock, sessionDir);

        subSock.ev.on('messages.upsert', async (m) => {
            const msg = m.messages[0];
            if (!msg || !msg.message) return;
            await handleSubbotMessage(subSock, msg, subCommands);
        });

        subSock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;
            if (connection === 'close') {
                const code = lastDisconnect?.error?.output?.statusCode;
                delete global.subbots[ownerJid];
                if (code !== DisconnectReason.loggedOut) {
                    // Auto reconnect
                    setTimeout(() => {
                        startSubbot(sessionId, ownerJid, mainSock, mek);
                    }, 5000);
                }
            } else if (connection === 'open') {
                await mainSock.sendMessage(ownerJid, {
                    text: `✅ *Subbot සාර්ථකව Connect විය!*\n\n📱 Number: \`${subSock.user.id.split(':')[0]}\`\n📦 Plugins: \`${subCommands.size}\``
                }, { quoted: mek });
            }
        });

        global.subbots[ownerJid] = {
            sock: subSock,
            sessionDir,
            sessionId, // keep for restart
            startedAt: Date.now()
        };

        return { success: true, plugins: subCommands.size };
    } catch (err) {
        console.error('Subbot start error:', err);
        return { success: false, error: err.message };
    }
}

// ==================== EXPORT ====================
module.exports = {
    name: 'subbot',
    async execute(hasamd, mek, args, commandName) {
        const chat = mek.key.remoteJid;
        const sender = mek.key.participant || mek.key.remoteJid;
        const cmd = commandName.toLowerCase();
        const text = args.join(" ").trim();

        switch (cmd) {
            case 'subbot': {
                if (!text) {
                    return await hasamd.sendMessage(chat, {
                        text: "⚠️ *කරුණාකර Session ID එක ලබාදෙන්න!*\n\nඋදා: `.subbot HASAA~xxxxx`"
                    }, { quoted: mek });
                }
                await hasamd.sendMessage(chat, { text: "⏳ *Connecting Subbot...*" }, { quoted: mek });
                const result = await startSubbot(text, sender, hasamd, mek);
                if (!result.success) {
                    await hasamd.sendMessage(chat, {
                        text: `❌ *Failed:* ${result.error}`
                    }, { quoted: mek });
                }
                break;
            }

            case 'subcheck': {
                const sub = global.subbots[sender];
                if (sub) {
                    const up = Math.floor((Date.now() - sub.startedAt) / 1000);
                    await hasamd.sendMessage(chat, {
                        text: `🔍 *Subbot:* Active 🟢\n⏱️ Uptime: ${up}s\n📱 JID: \`${sub.sock.user?.id || 'N/A'}\``
                    }, { quoted: mek });
                } else {
                    await hasamd.sendMessage(chat, { text: "❌ No active subbot." }, { quoted: mek });
                }
                break;
            }

            case 'getsubbot': {
                const keys = Object.keys(global.subbots);
                let listText = `📋 *Active Subbots (${keys.length}):*\n\n`;
                keys.forEach((k, i) => { listText += `${i + 1}. ${k.split('@')[0]}\n`; });
                if (keys.length === 0) listText += "None.";
                await hasamd.sendMessage(chat, { text: listText }, { quoted: mek });
                break;
            }

            case 'delsubbot': {
                if (global.subbots[sender]) {
                    const dir = global.subbots[sender].sessionDir;
                    try { global.subbots[sender].sock.ws.close(); } catch {}
                    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
                    delete global.subbots[sender];
                    await hasamd.sendMessage(chat, { text: "🗑️ Subbot deleted!" }, { quoted: mek });
                } else {
                    await hasamd.sendMessage(chat, { text: "❌ No subbot to delete." }, { quoted: mek });
                }
                break;
            }

            case 'delallsubbot': {
                for (const k in global.subbots) {
                    try { global.subbots[k].sock.ws.close(); } catch {}
                    try { fs.rmSync(global.subbots[k].sessionDir, { recursive: true, force: true }); } catch {}
                }
                global.subbots = {};
                await hasamd.sendMessage(chat, { text: "⚠️ All subbots deleted!" }, { quoted: mek });
                break;
            }

            case 'restartsubbot': {
                if (!global.subbots[sender]) {
                    return await hasamd.sendMessage(chat, { text: "❌ No active subbot." }, { quoted: mek });
                }
                const sid = global.subbots[sender].sessionId;
                try { global.subbots[sender].sock.ws.close(); } catch {}
                delete global.subbots[sender];
                await hasamd.sendMessage(chat, { text: "🔄 Restarting..." }, { quoted: mek });
                await startSubbot(sid, sender, hasamd, mek);
                break;
            }

            case 'restartallsubbot': {
                const all = { ...global.subbots };
                const total = Object.keys(all).length;
                await hasamd.sendMessage(chat, { text: `🔄 Restarting ${total} subbot(s)...` }, { quoted: mek });
                for (const k in all) {
                    const sid = all[k].sessionId;
                    try { all[k].sock.ws.close(); } catch {}
                    delete global.subbots[k];
                    await startSubbot(sid, k, hasamd, mek);
                }
                break;
            }

            case 'helpsubbot': {
                await hasamd.sendMessage(chat, {
                    text: "❓ *SUBBOT HELP*\n\n" +
                          "🔹 `.subbot <SESSION_ID>` - Connect\n" +
                          "🔹 `.subcheck` - Status\n" +
                          "🔹 `.getsubbot` - List\n" +
                          "🔹 `.delsubbot` - Delete\n" +
                          "🔹 `.delallsubbot` - Delete all\n" +
                          "🔹 `.restartsubbot` - Restart\n" +
                          "🔹 `.restartallsubbot` - Restart all"
                }, { quoted: mek });
                break;
            }
        }
    }
};
