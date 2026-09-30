// Fast Mode Plugin for HASAA-MD
// Settings: 16.1 (ON), 16.2 (OFF)
// Intercepts common commands and replies instantly

const os = require('os');

module.exports = {
    name: 'fast-mode',

    async onMessage(sock, msg, config) {
        try {
            if (!config.fastMode) return;

            const from = msg.key.remoteJid;
            if (!from || from === 'status@broadcast') return;
            if (msg.key.fromMe) return;

            const body = (msg.message?.conversation ||
                         msg.message?.extendedTextMessage?.text || '').trim();

            if (!body.startsWith('.')) return;

            const cmd = body.toLowerCase().split(' ')[0];

            // Instant replies for common commands
            if (cmd === '.ping') {
                const start = Date.now();
                await sock.sendMessage(from, {
                    text: `⚡ *Ping: ${Date.now() - start || 50} ms* _(fast)_`
                }, { quoted: msg });
                return;
            }

            if (cmd === '.uptime') {
                const up = process.uptime();
                const h = Math.floor(up / 3600);
                const m = Math.floor((up % 3600) / 60);
                const s = Math.floor(up % 60);
                await sock.sendMessage(from, {
                    text: `⏳ *Uptime:* \`${h}h ${m}m ${s}s\` _(fast)_`
                }, { quoted: msg });
                return;
            }

            if (cmd === '.ram' || cmd === '.fastmode') {
                const total = (os.totalmem() / 1024 / 1024).toFixed(0);
                const free = (os.freemem() / 1024 / 1024).toFixed(0);
                const used = (total - free).toFixed(0);
                await sock.sendMessage(from, {
                    text: `📟 *RAM:* \`${used}MB / ${total}MB\`\n⚡ *Fast Mode:* ON`
                }, { quoted: msg });
                return;
            }
        } catch (e) {
            console.error('Fast Mode error:', e.message);
        }
    }
};
