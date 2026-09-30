// Facebook Downloader Plugin for HASAA-MD
// Usage: .fb <facebook_url>
// Powered by @renpwn/fb-downloader

const getFBInfo = require('@renpwn/fb-downloader');

module.exports = {
    name: 'fb',

    async onMessage(sock, msg, config) {
        try {
            const from = msg.key.remoteJid;
            if (!from || from === 'status@broadcast') return;

            const body = (msg.message?.conversation ||
                         msg.message?.extendedTextMessage?.text || '').trim();

            if (!body.toLowerCase().startsWith('.fb')) return;

            const url = body.slice(3).trim();

            if (!url) {
                return await sock.sendMessage(from, {
                    text: "❌ *Facebook video link එක දෙන්න!*\n\nඋදා: `.fb https://fb.watch/xxxxx`"
                }, { quoted: msg });
            }

            await sock.sendMessage(from, { text: "⏳ *Downloading Facebook video...*" }, { quoted: msg });

            try {
                const result = await getFBInfo(url);

                if (!result || (!result.hd && !result.sd)) {
                    throw new Error('No video found');
                }

                const videoUrl = result.hd || result.sd;
                const title = result.title || 'Facebook Video';
                const quality = result.hd ? 'HD' : 'SD';

                await sock.sendMessage(from, {
                    video: { url: videoUrl },
                    caption: `📥 *${title}*\n📺 *Quality:* ${quality}\n\n> HASAA-MD ⚡`
                }, { quoted: msg });

            } catch (err) {
                console.error('FB download error:', err.message);
                await sock.sendMessage(from, {
                    text: "❌ *Video එක download කරගන්න බැරි වුණා.*\n\n*හේතු:* Link එක වැරදි, private video, හෝ Facebook එකෙන් block කරලා."
                }, { quoted: msg });
            }

        } catch (e) {
            console.error('FB plugin error:', e.message);
        }
    }
};
