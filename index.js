const fs = require('fs');
const path = require('path');
const { 
    Client, 
    GatewayIntentBits, 
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    AttachmentBuilder 
} = require('discord.js');

// --- BUILT-IN SELF-PING KEEP-ALIVE SERVER ---
const express = require('express');
const http = require('http');
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('Wan Shi Tong Memory Game Bot is online and running 24/7! 🦉');
});

app.listen(PORT, () => {
    console.log(`Keep-alive web server active on port ${PORT}`);

    const targetUrl = process.env.RAILWAY_STATIC_URL 
        ? `http://${process.env.RAILWAY_STATIC_URL}` 
        : `http://localhost:${PORT}`;

    setInterval(() => {
        http.get(targetUrl, (res) => {
            console.log(`Internal heartbeat ping sent! Status: ${res.statusCode}`);
        }).on('error', (err) => {
            console.error('Self-ping failed:', err.message);
        });
    }, 4 * 60 * 1000);
});
// --------------------------------------------

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

const activeMemoryGames = new Map();

client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isButton() || !interaction.customId.startsWith('mem_')) return;

    const gameId = interaction.message.id;
    const memoryGame = activeMemoryGames.get(gameId);

    if (!memoryGame) {
        return interaction.reply({ content: '⚠️ This memory game session has expired or ended.', ephemeral: true });
    }

    if (!memoryGame.allowedUserIds.includes(interaction.user.id)) {
        return interaction.reply({ content: '⛔ You are not chosen to participate in this memory match session!', ephemeral: true });
    }

    if (memoryGame.mode === '2player') {
        const currentTurnUserId = memoryGame.players[memoryGame.currentTurnPlayerIndex];
        if (interaction.user.id !== currentTurnUserId) {
            return interaction.reply({ content: `⏳ It is not your turn! Waiting for <@${currentTurnUserId}>.`, ephemeral: true });
        }
    }

    const index = parseInt(interaction.customId.split('_')[1]);
    const card = memoryGame.cards[index];

    if (card.matched || memoryGame.flippedIndices.includes(index)) {
        return interaction.deferUpdate();
    }

    memoryGame.flippedIndices.push(index);
    await updateMemoryGrid(interaction, memoryGame, false);

    if (memoryGame.flippedIndices.length === 2) {
        memoryGame.attempts += 1;
        const [firstIdx, secondIdx] = memoryGame.flippedIndices;
        const card1 = memoryGame.cards[firstIdx];
        const card2 = memoryGame.cards[secondIdx];

        if (card1.name === card2.name) {
            card1.matched = true;
            card2.matched = true;
            memoryGame.matchedPairs += 1;
            memoryGame.flippedIndices = [];

            if (memoryGame.mode === '2player') {
                const activePlayerId = memoryGame.players[memoryGame.currentTurnPlayerIndex];
                memoryGame.scores[activePlayerId] = (memoryGame.scores[activePlayerId] || 0) + 1;
            }

            if (memoryGame.matchedPairs === memoryGame.totalPairs) {
                await updateMemoryGrid(interaction, memoryGame, true);
                activeMemoryGames.delete(gameId);

                let rankTitle = 'WINNER';
                let gifFile = './assets/winner.gif';

                if (memoryGame.mode === 'solo') {
                    if (memoryGame.attempts < 6) {
                        rankTitle = '🌟 LEGEND';
                        gifFile = './assets/legend.gif';
                    } else if (memoryGame.attempts === 6) {
                        rankTitle = '🏆 WINNER';
                        gifFile = './assets/winner.gif';
                    } else if (memoryGame.attempts >= 12) {
                        rankTitle = '💀 LOSER';
                        gifFile = './assets/loser.gif';
                    } else {
                        rankTitle = '🏆 WINNER';
                        gifFile = './assets/winner.gif';
                    }
                }

                let winText = `🦉 **Wan Shi Tong's Archive #${memoryGame.archiveNum} Completed!**\n📊 **Total Attempts:** \`${memoryGame.attempts}\`\n\n🎯 **Rank Achieved:** **${rankTitle}**`;
                
                if (memoryGame.mode === '2player') {
                    const p1Score = memoryGame.scores[memoryGame.players[0]] || 0;
                    const p2Score = memoryGame.scores[memoryGame.players[1]] || 0;
                    let winner = p1Score > p2Score ? `<@${memoryGame.players[0]}>` : p2Score > p1Score ? `<@${memoryGame.players[1]}>` : 'It\'s a tie';
                    winText = `🦉 **Wan Shi Tong's Archive #${memoryGame.archiveNum} Completed!**\n🏆 **Winner:** ${winner}!\nScores: <@${memoryGame.players[0]}> (${p1Score}) vs <@${memoryGame.players[1]}> (${p2Score})`;
                }

                const gifAttachment = new AttachmentBuilder(gifFile);
                return interaction.followUp({
                    content: winText,
                    files: [gifAttachment]
                }).catch(() => {
                    return interaction.followUp({ content: winText });
                });
            }
        } else {
            setTimeout(async () => {
                memoryGame.flippedIndices = [];
                if (memoryGame.mode === '2player') {
                    memoryGame.currentTurnPlayerIndex = memoryGame.currentTurnPlayerIndex === 0 ? 1 : 0;
                }
                try {
                    await updateMemoryGrid(interaction, memoryGame, false);
                } catch (err) {}
            }, 1500);
        }
    }
});

// Helper function to build 3 rows of 4 buttons with image/emoji indicator for revealed cards
async function updateMemoryGrid(interaction, memoryGame, isWon) {
    const rows = [];
    const attachments = [];

    for (let i = 0; i < memoryGame.cards.length; i += 4) {
        const row = new ActionRowBuilder();
        for (let j = i; j < i + 4 && j < memoryGame.cards.length; j++) {
            const card = memoryGame.cards[j];
            const button = new ButtonBuilder().setCustomId(`mem_${j}`);

            if (card.matched) {
                // Matched state: show label and green success
                button.setLabel(card.name.toUpperCase()).setStyle(ButtonStyle.Success).setDisabled(true);
            } else if (memoryGame.flippedIndices.includes(j)) {
                // Flipped state: show icon name clearly or attach image preview if applicable
                button.setLabel(card.name.toUpperCase()).setStyle(ButtonStyle.Primary);
            } else {
                // Hidden card back state (⬛ tile)
                button.setLabel('⬛').setStyle(ButtonStyle.Secondary);
            }
            row.addComponents(button);
        }
        rows.push(row);
    }

    let descText = isWon 
        ? `🎉 **Archive Completed in ${memoryGame.attempts} attempts!**` 
        : `Match all 6 pairs! Live Attempts: **${memoryGame.attempts}**`;

    if (memoryGame.mode === '2player') {
        const p1 = memoryGame.players[0];
        const p2 = memoryGame.players[1];
        const activeTurnUser = memoryGame.players[memoryGame.currentTurnPlayerIndex];
        descText += `\n\n👥 **Mode:** 2-Player Versus\n👉 Current Turn: <@${activeTurnUser}>\nScores — <@${p1}>: ${memoryGame.scores[p1] || 0} | <@${p2}>: ${memoryGame.scores[p2] || 0}`;
    } else {
        descText += `\n👤 **Player:** <@${memoryGame.players[0]}> (Solo Mode)`;
    }

    const embed = new EmbedBuilder()
        .setTitle(`🦉 AVATAR TRIAL: WAN SHI TONG'S ARCHIVE #${memoryGame.archiveNum}`)
        .setColor(isWon ? '#2ed573' : '#70a1ff')
        .setDescription(`*“Humans always think they know so much, yet your minds are easily tested by my archive. Prove your intellect by uncovering the hidden knowledge within these cards.”*\n\n` + descText);

    if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ embeds: [embed], components: rows });
    } else {
        await interaction.update({ embeds: [embed], components: rows });
    }
}

client.on('messageCreate', async message => {
    if (message.author.bot) return;

    const content = message.content;
    const contentLower = content.toLowerCase().trim();
    const isHost = message.author.username === '0ladybunny';

    if (contentLower.startsWith('!memory')) {
        if (!isHost) {
            return message.reply('⛔ Only **0ladybunny** can start Wan Shi Tong\'s memory trial.');
        }

        try {
            const args = content.replace('!memory', '').trim().split(/\s+/);

            // --- CASE 1: !memory typed alone (Show Intro Only) ---
            if (!args[0] || args[0] === '') {
                const introEmbed = new EmbedBuilder()
                    .setTitle('🦉 AVATAR TRIAL: WAN SHI TONG\'S MEMORY ARCHIVE')
                    .setColor('#70a1ff')
                    .setDescription(`*“Humans always think they know so much, yet your minds are easily tested by my archive. Prove your intellect by uncovering the hidden knowledge within these cards.”*\n\n` +
                        `✨ **How to Play the Trial:**\n` +
                        `Choose one of three secret archives and challenge yourself or a friend!\n\n` +
                        `📌 **Commands:**\n` +
                        `• Archive 1: \`!memory 1 @Player\`\n` +
                        `• Archive 2: \`!memory 2 @Player\`\n` +
                        `• Archive 3: \`!memory 3 @Player\`\n` +
                        `*(You can also add a second player for Versus mode: \`!memory 1 @Player1 @Player2\`)*\n\n` +
                        `🏆 **Solo Tiers:**\n` +
                        `• < 6 attempts ➔ **LEGEND** (\`legend.gif\`)\n` +
                        `• = 6 attempts ➔ **WINNER** (\`winner.gif\`)\n` +
                        `• 12+ attempts ➔ **LOSER** (\`loser.gif\`)`);

                return message.reply({ embeds: [introEmbed] });
            }

            // --- CASE 2: !memory (number) @Player (Start Game) ---
            let archiveNum = 1;
            let playerArgsIndex = 0;

            if (['1', '2', '3'].includes(args[0])) {
                archiveNum = parseInt(args[0]);
                playerArgsIndex = 1;
            }

            let players = Array.from(message.mentions.users.keys());
            if (players.length === 0) {
                const matches = content.match(/<@!?(\d+)>/g);
                if (matches) {
                    players = matches.map(m => m.replace(/<@!?|>/g, ''));
                }
            }

            if (players.length === 0) {
                return message.reply('⚠️ Please specify an archive number and tag player(s)!\n*Example:* `!memory 1 @Player`');
            }

            const mode = players.length >= 2 ? '2player' : 'solo';

            let startIndex = 0;
            let endIndex = 5;
            if (archiveNum === 2) { startIndex = 6; endIndex = 11; }
            if (archiveNum === 3) { startIndex = 12; endIndex = 17; }

            let deck = [];
            for (let i = startIndex; i <= endIndex; i++) {
                const cardName = `icon${i}`;
                deck.push({ name: cardName }, { name: cardName });
            }
            
            deck.sort(() => Math.random() - 0.5);

            const cards = deck.map(c => ({ name: c.name, matched: false }));
            const memoryGame = {
                cards,
                flippedIndices: [],
                matchedPairs: 0,
                totalPairs: 6,
                attempts: 0,
                archiveNum,
                mode,
                players,
                allowedUserIds: players,
                currentTurnPlayerIndex: 0,
                scores: {}
            };

            const rows = [];
            for (let i = 0; i < cards.length; i += 4) {
                const row = new ActionRowBuilder();
                for (let j = i; j < i + 4 && j < cards.length; j++) {
                    row.addComponents(
                        new ButtonBuilder()
                            .setCustomId(`mem_${j}`)
                            .setLabel('⬛')
                            .setStyle(ButtonStyle.Secondary)
                    );
                }
                rows.push(row);
            }

            let initDesc = mode === '2player' 
                ? `👥 **2-Player Versus Trial (Archive #${archiveNum})!**\nParticipants: <@${players[0]}> vs <@${players[1]}>\n👉 First turn: <@${players[0]}>\n\nClick the ⬛ tiles to find all **6 matching pairs**!`
                : `👤 **Solo Trial Mode (Archive #${archiveNum})!**\nPlayer: <@${players[0]}>\n\nFind all 6 pairs in your 3x4 archive grid! 🦉\n*(<6 attempts = LEGEND | 6 attempts = WINNER | 12+ attempts = LOSER)*`;

            const embed = new EmbedBuilder()
                .setTitle(`🦉 AVATAR TRIAL: WAN SHI TONG'S ARCHIVE #${archiveNum}`)
                .setColor('#70a1ff')
                .setDescription(`*“Humans always think they know so much, yet your minds are easily tested by my archive. Prove your intellect by uncovering the hidden knowledge within these cards.”*\n\n` + initDesc);

            const sentMsg = await message.reply({ embeds: [embed], components: rows });
            activeMemoryGames.set(sentMsg.id, memoryGame);

        } catch (err) {
            console.error('Memory Game Error:', err);
            return message.reply(`❌ **Bot Error Caught:** \`${err.message}\``);
        }
        return;
    }
});

client.login(process.env.DISCORD_TOKEN);
