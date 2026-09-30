// Auto Voice Plugin for HASAA-MD
// Settings: 1.1 (ON), 1.2 (OFF)

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

            const voiceUrl = 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3';

            await sock.sendMessage(from, {
                audio: { url: voiceUrl },
                mimetype: 'audio/mp4',
                ptt: true
            }, { quoted: msg });
        } catch (e) {
            console.error('Auto Voice error:', e.message);
        }
    }
};
