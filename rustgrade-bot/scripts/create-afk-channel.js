'use strict';

// Создаёт AFK-канал в Discord-сервере (guildId из config.json) и прописывает
// его ID в config.json -> discord.channels.afk (туда бот шлёт «АФК» из игры).
// Требуется право бота «Управление каналами» (Manage Channels).

const { Client, GatewayIntentBits, ChannelType } = require('discord.js');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'config.json');

async function main() {
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  const token = config.discord && config.discord.token;
  const guildId = process.argv[2] || (config.discord && config.discord.guildId);
  if (!token || !guildId) {
    console.error('Нет discord.token или discord.guildId в config.json');
    process.exit(1);
  }

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  await client.login(token);

  const guild = await client.guilds.fetch(guildId);
  if (!guild) {
    console.error('Гильдия не найдена (guildId).');
    process.exit(1);
  }

  const name = 'афк';
  await guild.channels.fetch().catch(() => {});
  let channel = guild.channels.cache.find((c) => c.name === name && c.type === ChannelType.GuildText);
  if (!channel) {
    channel = await guild.channels.create({
      name,
      type: ChannelType.GuildText,
      topic: 'Кто из пачки АФК — сюда бот пишет по команде !afk',
    });
    console.log(`Канал «${name}» создан: ${channel.id}`);
  } else {
    console.log(`Канал «${name}» уже есть: ${channel.id}`);
  }

  config.discord = config.discord || {};
  config.discord.channels = config.discord.channels || {};
  config.discord.channels.afk = channel.id;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
  console.log(`config.json: discord.channels.afk = ${channel.id}`);

  await client.destroy();
  process.exit(0);
}

main().catch((err) => {
  console.error('Ошибка:', err.message);
  if (err.code === 50013) {
    console.error('Нет прав. Дай боту роль с правом «Управление каналами» (Manage Channels) и запусти снова.');
  }
  process.exit(1);
});