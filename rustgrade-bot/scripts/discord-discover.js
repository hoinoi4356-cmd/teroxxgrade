'use strict';

// Розвідка: підключається ботом і показує сервери + текстові канали.
// Запуск:  node scripts/discord-discover.js
// Або з надсиланням тесту:  node scripts/discord-discover.js "<частина назви каналу>"
const { Client, GatewayIntentBits, ChannelType, Events } = require('discord.js');
const config = require('../config.json');

const target = (process.argv[2] || '').toLowerCase();
const token = config.discord.token;

if (!token) {
  console.error('discord.token пустой в config.json');
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, async () => {
  console.log(`\nВошёл как: ${client.user.tag} (id ${client.user.id})`);
  console.log(`Серверов: ${client.guilds.cache.size}\n`);

  let sent = false;
  for (const g of client.guilds.cache.values()) {
    console.log(`GUILD  ${g.name}  (${g.id})`);
    let chans;
    try {
      chans = await g.channels.fetch();
    } catch (e) {
      console.log('  (нет доступа к каналам)');
      continue;
    }
    for (const c of chans.values()) {
      if (!c) continue;
      const isText = c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement;
      if (isText) {
        console.log(`   #${c.name}  (${c.id})`);
        if (target && !sent && c.name.toLowerCase().includes(target)) {
          try {
            await c.send('👋 Тест: **RustBot** на связи. Это проверка подключения.');
            console.log(`   >>> Отправил тест в #${c.name}`);
            sent = true;
          } catch (e) {
            console.log(`   !!! Не смог написать в #${c.name}: ${e.message}`);
          }
        }
      }
    }
    console.log('');
  }

  if (target) console.log(sent ? 'ТЕСТ ОТПРАВЛЕН ✔' : `Канал со словом "${target}" не найден.`);
  client.destroy();
  process.exit(0);
});

client.on(Events.Error, (e) => console.error('client error:', e.message));
client.login(token).catch((e) => {
  console.error('LOGIN FAILED:', e.message);
  process.exit(1);
});
