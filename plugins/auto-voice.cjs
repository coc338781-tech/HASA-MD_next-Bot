// Auto Voice Plugin for HASAA-MD
// Settings: 1.1 (ON), 1.2 (OFF)
// Replies with a voice note when voice message received

module.exports = {
    name: 'auto-voice',

    async onMessage(sock, msg, config) {
        try {
            if (!config.autoVoice) return;

            const from = msg.key.remoteJid;
            if (!from || from === 'status@broadcast') return;
            if (msg.key.fromMe) return;

            const audioMsg = msg.message?.audioMessage;
            if (!audioMsg) return;
            if (audioMsg.ptt === false) return;

            // Proper OGG voice note URL (short, WhatsApp compatible)
            const voiceUrl = 'https://upload.wikimedia.org/wikipedia/commons/c/c8/Example.ogg';

            await sock.sendMessage(from, {
                audio: { url: voiceUrl },
                mimetype: 'audio/ogg; codecs=opus',
                ptt: true
            }, { quoted: msg });
        } catch (e) {
            console.error('Auto Voice error:', e.message);
        }
    }
};
