const { 
    Client, 
    GatewayIntentBits, 
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle 
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
    // --- MEMORY GAME BUTTON HANDLER ---
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
            // Correct match! Icons stay visible and locked as matched
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

                let winText = `🦉 **Wan Shi Tong's Avatar Trial Completed!**\n📊 **Total Attempts / Turns:** \`${memoryGame.attempts}\``;
                
                if (memoryGame.mode === 'solo') {
                    if (memoryGame.attempts <= 20) {
                        winText += `\n\n👑 **CROWNED WINNER!** <@${memoryGame.players[0]}> matched all 18 pairs in **${memoryGame.attempts} attempts** (<= 20 attempts)! A true scholar worthy of the Spirit Library! 🌟`;
                    } else {
                        winText += `\n\n🎯 Impressive knowledge, <@${memoryGame.players[0]}>! You found all pairs in ${memoryGame.attempts} attempts.`;
                    }
                } else if (memoryGame.mode === '2player') {
                    const p1Score = memoryGame.scores[memoryGame.players[0]] || 0;
                    const p2Score = memoryGame.scores[memoryGame.players[1]] || 0;
                    let winner = p1Score > p2Score ? `<@${memoryGame.players[0]}>` : p2Score > p1Score ? `<@${memoryGame.players[1]}>` : 'It\'s a tie';
                    winText += `\n\n🏆 **Winner:** ${winner}!\nScores: <@${memoryGame.players[0]}> (${p1Score}) vs <@${memoryGame.players[1]}> (${p2Score})`;
                }

                return interaction.followUp({
                    content: winText,
                    files: ['./win.gif']
                }).catch(() => {
                    return interaction.followUp({ content: winText });
                });
            }
        } else {
            // Wrong match: Flip back to ⬛ after a short delay
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
    for (let i = 0; i < memoryGame.cards.length; i += 5) {
        const row = new ActionRowBuilder();
        for (let j = i; j < i + 5 && j < memoryGame.cards.length; j++) {
            const card = memoryGame.cards[j];
            const button = new ButtonBuilder().setCustomId(`mem_${j}`);

            if (card.matched) {
                // If matched, show the icon permanently with a green success state
                button.setLabel(card.name.toUpperCase()).setStyle(ButtonStyle.Success).setDisabled(true);
            } else if (memoryGame.flippedIndices.includes(j)) {
                // When clicked/flipped from ⬛, show the specific icon (icon0 to icon17)
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
        ? `🎉 **All 18 pairs found in ${memoryGame.attempts} attempts!**` 
        : `Match all 18 pairs! Total Attempts: **${memoryGame.attempts}**`;

    if (memoryGame.mode === '2player') {
        const p1 = memoryGame.players[0];
        const p2 = memoryGame.players[1];
        const activeTurnUser = memoryGame.players[memoryGame.currentTurnPlayerIndex];
        descText += `\n\n👥 **Mode:** 2-Player Versus\n👉 Current Turn: <@${activeTurnUser}>\nScores — <@${p1}>: ${memoryGame.scores[p1] || 0} | <@${p2}>: ${memoryGame.scores[p2] || 0}`;
    } else {
        descText += `\n👤 **Player:** <@${memoryGame.players[0]}> (Solo Mode)`;
    }

    const embed = new EmbedBuilder()
        .setTitle('🦉 AVATAR TRIAL: WAN SHI TONG\'S MEMORY ARCHIVE')
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

    // --- MEMORY GAME START COMMAND ---
    // Solo: !memory @Player
    // Versus: !memory @Player1 @Player2
    if (contentLower.startsWith('!memory')) {
        if (!isHost) return message.reply('⛔ Only **0ladybunny** can start Wan Shi Tong\'s memory trial.');

        const mentions = message.mentions.users;
        if (mentions.size === 0) {
            return message.reply('⚠️ Please mention the player(s) for the Avatar Trial!\n*Solo:* `!memory @Player`\n*Versus:* `!memory @Player1 @Player2`');
        }

        const players = Array.from(mentions.keys());
        const mode = players.length >= 2 ? '2player' : 'solo';

        // Build deck using icon0 through icon17 (two of each for 36 cards total)
        let deck = [];
        for (let i = 0; i <= 17; i++) {
            const cardName = `icon${i}`;
            deck.push({ name: cardName }, { name: cardName });
        }
        
        // Shuffle deck
        deck.sort(() => Math.random() - 0.5);

        const cards = deck.map(c => ({ name: c.name, matched: false }));
        const memoryGame = {
            cards,
            flippedIndices: [],
            matchedPairs: 0,
            totalPairs: 18,
            attempts: 0,
            mode,
            players,
            allowedUserIds: players,
            currentTurnPlayerIndex: 0,
            scores: {}
        };

        const rows = [];
        for (let i = 0; i < cards.length; i += 5) {
            const row = new ActionRowBuilder();
            for (let j = i; j < i + 5 && j < cards.length; j++) {
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
            ? `👥 **2-Player Versus Avatar Trial!**\nParticipants: <@${players[0]}> vs <@${players[1]}>\n👉 First turn: <@${players[0]}>\n\nClick the ⬛ tiles to reveal icons and find all **18 matching pairs**!`
            : `👤 **Solo Avatar Trial Mode!**\nPlayer: <@${players[0]}>\n\nFind all pairs in **20 attempts or fewer** to win Wan Shi Tong's Crown! 👑`;

        const embed = new EmbedBuilder()
            .setTitle('🦉 AVATAR TRIAL: WAN SHI TONG\'S MEMORY ARCHIVE')
            .setColor('#70a1ff')
            .setDescription(`*“Humans always think they know so much, yet your minds are easily tested by my archive. Prove your intellect by uncovering the hidden knowledge within these cards.”*\n\n` + initDesc);

        const sentMsg = await message.reply({ embeds: [embed], components: rows });
        activeMemoryGames.set(sentMsg.id, memoryGame);
        return;
    }
});

client.login(process.env.DISCORD_TOKEN);
