// Fake Hack Prank Plugin for HASAA-MD
// OWNER ONLY command - for entertainment only

const delay = (ms) => new Promise(r => setTimeout(r, ms));

// ASCII Banner (string with \n escapes - safer than template literal)
const BANNER = "╔══════════════════════════════════╗\n║   H A S A A - M D   H A C K E R  ║\n║        v2.0 | Ghost Protocol     ║\n╚══════════════════════════════════╝";

const hackSteps = [
    BANNER,
    '🔴 *INITIALIZING HACK PROTOCOL...*',
    '🟠 *Bypassing WhatsApp Encryption...*',
    '🟡 *Injecting payload into target device...*',
    '🟢 *Access granted to /data/com.whatsapp/*',
    '🔵 *Downloading chat history...* ████████ 100%',
    '🟣 *Extracting contacts...* ████████ 100%',
    '🔴 *Accessing gallery photos...* ████████ 100%',
    '🟠 *Reading private messages...* ████████ 100%',
    '🟡 *Getting location data...* 📍 Colombo, Sri Lanka',
    '🟢 *Cloning WhatsApp session...* ████████ 100%',
    '🔵 *Installing backdoor RAT...* ████████ 100%',
    '🟣 *Uploading data to dark web server...* ████████ 100%',
    '🔴 *HACK COMPLETE!* ✅',
    '',
    '⚠️ *ALL DATA COMPROMISED*',
    '',
    '📱 *Target Device:* Redmi Note 12',
    '🌍 *IP Address:* 175.157.***.**',
    '📸 *Photos Leaked:* 2,847',
    '💬 *Messages Read:* 18,392',
    '👥 *Contacts Stolen:* 421'
];

module.exports = {
    name: 'hack',

    async onMessage(sock, msg, config) {
        try {
            const from = msg.key.remoteJid;
            if (!from || from === 'status@broadcast') return;

            const body = (msg.message?.conversation ||
                         msg.message?.extendedTextMessage?.text || '').trim();
            const lowerBody = body.toLowerCase();

            if (!lowerBody.startsWith('.hack')) return;

            // ============ OWNER ONLY CHECK ============
            const senderJid = msg.key.participant || from;
            const senderNum = senderJid.split('@')[0].split(':')[0];
            const sudoList = (config.SUDO || '').split(',').map(s => s.trim()).filter(Boolean);
            const isOwner = sudoList.includes(senderNum) || msg.key.fromMe;

            if (!isOwner) {
                return await sock.sendMessage(from, {
                    text: "⛔ *මේ command එක owner ට විතරයි!*"
                }, { quoted: msg });
            }

            // Target chat
            const mention = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            const targetJid = mention || from;

            // Start
            await sock.sendMessage(from, {
                text: '💀 *HASAA-MD HACKER MODE ACTIVATED* 💀'
            }, { quoted: msg });

            await delay(1500);

            // Send each step
            for (const step of hackSteps) {
                if (!step) {
                    await delay(500);
                    continue;
                }
                await sock.sendMessage(targetJid, { text: step });
                await delay(1200);
            }

        } catch (e) {
            console.error('Hack prank error:', e.message);
        }
    }
};
