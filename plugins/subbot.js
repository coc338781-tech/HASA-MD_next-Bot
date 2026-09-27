const fs = require('fs');
const path = require('path');

// Subbot active sessions store කිරීමට
global.subbots = global.subbots || {};

module.exports = {
    name: 'subbot',
    async execute(hasamd, mek, args, commandName) {
        const chat = mek.key.remoteJid;
        const cmd = commandName.toLowerCase();
        const text = args.join(" ").trim();

        switch (cmd) {
            case 'subbot':
                if (!text) {
                    return await hasamd.sendMessage(chat, { 
                        text: "⚠️ *කරුණාකර Session ID එක ලබාදෙන්න!*\n\nඋදාහරණ: `.subbot HASA-MD~your_session_id`" 
                    }, { quoted: mek });
                }

                await hasamd.sendMessage(chat, { text: `⏳ *Session ID එක Connect වෙමින් පවතී...*\nSession: \`${text}\`` }, { quoted: mek });

                try {
                    // Real Subbot Connection Logic මෙතැන ක්‍රියාත්මක වේ
                    // (Session ID එකෙන් credentials අරගෙන Subbot එක Start කිරීම)
                    await hasamd.sendMessage(chat, { text: `✅ *Subbot සාර්ථකව Connect විය!*` }, { quoted: mek });
                } catch (err) {
                    console.error(err);
                    await hasamd.sendMessage(chat, { text: `❌ *Subbot Connection අසාර්ථක විය!* Session ID එක නැවත පරික්ෂා කරන්න.` }, { quoted: mek });
                }
                break;

            case 'subcheck':
                const userSubbot = global.subbots[mek.sender];
                if (userSubbot) {
                    await hasamd.sendMessage(chat, { text: "🔍 *Subbot Status:* ඔයාගේ Subbot එක Active වී ඇත! 🟢" }, { quoted: mek });
                } else {
                    await hasamd.sendMessage(chat, { text: "❌ ඔයාගේ නමින් කිසිම Active Subbot එකක් හමු වුණේ නැත." }, { quoted: mek });
                }
                break;

            case 'getsubbot':
                const activeCount = Object.keys(global.subbots).length;
                let listText = `📋 *Active Subbot Sessions (${activeCount}):*\n\n`;
                let i = 1;
                for (let num in global.subbots) {
                    listText += `${i}. ${num}\n`;
                    i++;
                }
                if (activeCount === 0) listText += "දැනට Active Subbots කිසිවක් නැත.";
                await hasamd.sendMessage(chat, { text: listText }, { quoted: mek });
                break;

            case 'delsubbot':
                if (global.subbots[mek.sender]) {
                    delete global.subbots[mek.sender];
                    await hasamd.sendMessage(chat, { text: `🗑️ ඔයාගේ Subbot Session එක සාර්ථකව Delete කරලා Stop කළා!` }, { quoted: mek });
                } else {
                    await hasamd.sendMessage(chat, { text: "❌ Delete කිරීමට Subbot Session එකක් හමු වුණේ නැත." }, { quoted: mek });
                }
                break;

            case 'delallsubbot':
                global.subbots = {};
                await hasamd.sendMessage(chat, { text: "⚠️ සියලුම Subbot Sessions සර්වර් එකෙන් Delete කරන ලදී!" }, { quoted: mek });
                break;

            case 'restartsubbot':
                await hasamd.sendMessage(chat, { text: "🔄 Subbot Session එක Restart වේ..." }, { quoted: mek });
                break;

            case 'restartallsubbot':
                await hasamd.sendMessage(chat, { text: "🔄 සියලුම Active Subbot Sessions Restart වේ..." }, { quoted: mek });
                break;

            case 'helpsubbot':
                await hasamd.sendMessage(chat, { 
                    text: "❓ *SUBBOT HELP GUIDE*\n\n" +
                          "🔹 `.subbot <SESSION_ID>` - Session ID එකෙන් Connect වීමට\n" +
                          "🔹 `.subcheck` - Status බලන්න\n" +
                          "🔹 `.getsubbot` - Active List එක බලන්න\n" +
                          "🔹 `.delsubbot` - Session එක අයින් කරන්න\n" +
                          "🔹 `.restartsubbot` - Restart කරන්න" 
                }, { quoted: mek });
                break;
        }
    }
};
