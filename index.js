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

// Your 18 custom emojis split across 3 archives (6 pairs / 12 cards each)
const ARCHIVE_ICONS = {
    1: ['st', 'aimee', 'appaflyingbisona', 'cin', 'cyan', 'derek'],
    2: ['dhruvi', 'dregun', 'fate', 'gray', 'joa', 'mardie'],
    3: ['shinji', 'starr', 'vagg', 'yuji', 'zoe', 'butterfly']
};

client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isButton() || !interaction.customId.startsWith('mem_')) return;

    const gameId = interaction.message.id;
    const memoryGame = activeMemoryGames.get(gameId);

    if (!memoryGame) {
        return interaction.reply({ content: '⚠️ This memory game session has expired or ended.', ephemeral: true, flags: 64 });
    }

    if (!memoryGame.allowedUserIds.includes(interaction.user.id)) {
        return interaction.reply({ content: '⛔ You are not chosen to participate in this memory match session!', ephemeral: true, flags: 64 });
    }

    if (memoryGame.mode === '2player') {
        const currentTurnUserId = memoryGame.players[memoryGame.currentTurnPlayerIndex];
        if (interaction.user.id !== currentTurnUserId) {
            return interaction.reply({ content: `⏳ It is not your turn! Waiting for <@${currentTurnUserId}>.`, ephemeral: true, flags: 64 });
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
                    }
                }

                let winText = `🦉 **=== WAN SHI TONG'S ARCHIVE #${memoryGame.archiveNum} COMPLETED ===**\n\n📊 **Total Attempts:** \`${memoryGame.attempts}\`\n🎯 **Achieved Rank:** **${rankTitle}**`;
                
                if (memoryGame.mode === '2player') {
                    const p1Score = memoryGame.scores[memoryGame.players[0]] || 0;
                    const p2Score = memoryGame.scores[memoryGame.players[1]] || 0;
                    let winner = p1Score > p2Score ? `<@${memoryGame.players[0]}>` : p2Score > p1Score ? `<@${memoryGame.players[1]}>` : 'It\'s a tie';
                    winText = `🦉 **=== VERSUS TRIAL ARCHIVE #${memoryGame.archiveNum} COMPLETED ===**\n\n🏆 **Winner:** ${winner}!\nScores: <@${memoryGame.players[0]}> (${p1Score}) vs <@${memoryGame.players[1]}> (${p2Score})`;
                }

                return interaction.followUp({
                    content: winText,
                    files: [new AttachmentBuilder(gifFile)]
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

async function updateMemoryGrid(interaction, memoryGame, isWon) {
    const rows = [];
    const guild = interaction.guild;
    const cardLayout = [4, 4, 4]; // 3 rows of 4 buttons
    let cardIndex = 0;

    for (const count of cardLayout) {
        const row = new ActionRowBuilder();
        for (let i = 0; i < count && cardIndex < memoryGame.cards.length; i++) {
            const card = memoryGame.cards[cardIndex];
            const button = new ButtonBuilder().setCustomId(`mem_${cardIndex}`);
            const customEmoji = guild ? guild.emojis.cache.find(e => e.name.toLowerCase() === card.name.toLowerCase()) : null;

            if (card.matched) {
                if (customEmoji) {
                    button.setEmoji(customEmoji.id).setStyle(ButtonStyle.Success).setDisabled(true);
                } else {
                    button.setLabel(`✅ ${card.name}`).setStyle(ButtonStyle.Success).setDisabled(true);
                }
            } else if (memoryGame.flippedIndices.includes(cardIndex)) {
                if (customEmoji) {
                    button.setEmoji(customEmoji.id).setStyle(ButtonStyle.Primary);
                } else {
                    button.setLabel(card.name).setStyle(ButtonStyle.Primary);
                }
            } else {
                button.setEmoji('⬛').setStyle(ButtonStyle.Secondary);
            }
            row.addComponents(button);
            cardIndex++;
        }
        rows.push(row);
    }

    let statusHeader = isWon ? `🎉 **ARCHIVE CONQUERED!**` : `⚡ **ARCHIVE TRIAL IN PROGRESS**`;
    let descText = isWon 
        ? `Completed in **${memoryGame.attempts}** attempts!` 
        : `📊 **Live Attempts:** \`${memoryGame.attempts}\``;

    if (memoryGame.mode === '2player') {
        const activeTurnUser = memoryGame.players[memoryGame.currentTurnPlayerIndex];
        descText += `\n👉 **Current Turn:** <@${activeTurnUser}>`;
    }

    const embed = new EmbedBuilder()
        .setTitle(`🦉 ARCHIVE #${memoryGame.archiveNum}`)
        .setColor(isWon ? '#2ed573' : '#ff4757')
        .setDescription(`${statusHeader}\n${descText}`);

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

            // --- CASE 1: !memory typed alone (Show Intro with intro.jpg) ---
            if (!args[0] || args[0] === '') {
                const introEmbed = new EmbedBuilder()
                    .setTitle('🦉 AVATAR TRIAL: WAN SHI TONG\'S MEMORY ARCHIVE 🦉')
                    .setColor('#ffa502')
                    .setDescription(`*“Humans always think they know so much, yet your minds are easily tested by my vast library archives. Prove your intellect by uncovering the hidden knowledge.”*\n\n` +
                        `✨ **How to Access the Archives:**\n` +
                        `Select one of the three archives and challenge yourself or a friend!\n\n` +
                        `🏆 **Scholar Ranking Tiers:**\n` +
                        `• **< 6 attempts** ➔ **LEGEND** (\`legend.gif\`)\n` +
                        `• **= 6 attempts** ➔ **WINNER** (\`winner.gif\`)\n` +
                        `• **12+ attempts** ➔ **LOSER** (\`loser.gif\`)`)
                    .setImage('attachment://intro.jpg');

                const introAttachment = new AttachmentBuilder('./assets/intro.jpg');

                return message.reply({ embeds: [introEmbed], files: [introAttachment] }).catch(() => {
                    // Fallback if intro.jpg is in root directory instead of assets folder
                    return message.reply({ embeds: [introEmbed], files: [new AttachmentBuilder('./intro.jpg')] });
                });
            }

            // --- CASE 2: !memory (number) @Player (Start Game Board Only) ---
            let archiveNum = 1;
            if (['1', '2', '3'].includes(args[0])) {
                archiveNum = parseInt(args[0]);
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

            const iconList = ARCHIVE_ICONS[archiveNum] || ARCHIVE_ICONS[1];
            let deck = [];
            iconList.forEach(iconName => {
                deck.push({ name: iconName }, { name: iconName });
            });
            
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
            const cardLayout = [4, 4, 4];
            let cardIndex = 0;

            for (const count of cardLayout) {
                const row = new ActionRowBuilder();
                for (let i = 0; i < count && cardIndex < cards.length; i++) {
                    row.addComponents(
                        new ButtonBuilder()
                            .setCustomId(`mem_${cardIndex}`)
                            .setEmoji('⬛')
                            .setStyle(ButtonStyle.Secondary)
                    );
                    cardIndex++;
                }
                rows.push(row);
            }

            let initDesc = `⚡ **ARCHIVE TRIAL IN PROGRESS**\n📊 **Live Attempts:** \`0\``;
            if (mode === '2player') {
                initDesc += `\n👉 **Current Turn:** <@${players[0]}>`;
            }

            const embed = new EmbedBuilder()
                .setTitle(`🦉 ARCHIVE #${archiveNum}`)
                .setColor('#ff4757')
                .setDescription(initDesc);

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
