'use strict';

// Надсилає вміст файлу в Discord-канал через токен з config.json.
// Запуск: node scripts/discord-say.js <channelId> <filePath>
const { Client, GatewayIntentBits, Events } = require('discord.js');
const fs = require('fs');
const config = require('../config.json');

const channelId = process.argv[2];
const file = process.argv[3];

if (!channelId || !file) {
  console.error('Использование: node scripts/discord-say.js <channelId> <file>');
  process.exit(1);
}
if (!fs.existsSync(file)) {
  console.error('Файл не найден:', file);
  process.exit(1);
}

const text = fs.readFileSync(file, 'utf8').trim();
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, async () => {
  try {
    const ch = await client.channels.fetch(channelId);
    if (!ch || !ch.isTextBased()) throw new Error('Канал не текстовий');
    if (text.length <= 1900) {
      await ch.send(text);
      console.log(`ОТПРАВЛЕНО ✔ в #${ch.name} (${text.length} символов)`);
    } else {
      const parts = text.split(/\n+/);
      let chunk = '';
      let n = 0;
      for (const p of parts) {
        if (chunk.length + p.length + 1 > 1900) {
          n++;
          await ch.send(chunk.trim());
          chunk = p;
        } else {
          chunk += (chunk ? '\n' : '') + p;
        }
      }
      if (chunk.trim()) {
        n++;
        await ch.send(chunk.trim());
      }
      console.log(`ОТПРАВЛЕНО ✔ в #${ch.name} (${text.length} символов, ${n} сообщений)`);
    }
  } catch (e) {
    console.error('ОШИБКА ОТПРАВКИ:', e.message);
    process.exitCode = 1;
  } finally {
    client.destroy();
    process.exit(process.exitCode || 0);
  }
});

client.on(Events.Error, (e) => console.error('client error:', e.message));
client.login(config.discord.token).catch((e) => {
  console.error('LOGIN FAILED:', e.message);
  process.exit(1);
});