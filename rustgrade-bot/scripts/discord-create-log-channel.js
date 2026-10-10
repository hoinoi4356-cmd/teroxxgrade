'use strict';

// Створює приватний канал #bot-logs у вказаному сервері:
// - @everyone НЕ бачить канал
// - бачать ролі з правом Administrator + ролі-модератори (за назвою)
// - бот бачить/пише
// Запуск: node scripts/discord-create-log-channel.js <guildId> [channelName]
const { Client, GatewayIntentBits, Events, ChannelType, PermissionFlagsBits } = require('discord.js');
const config = require('../config.json');

const guildId = process.argv[2];
const channelName = (process.argv[3] || 'bot-logs').toLowerCase().replace(/\s+/g, '-');

if (!guildId) {
  console.error('Использование: node scripts/discord-create-log-channel.js <guildId>');
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, async () => {
  try {
    const guild = await client.guilds.fetch(guildId);
    console.log(`Сервер: ${guild.name} (${guild.id})`);

    const roles = await guild.roles.fetch();
    const adminRoles = [...roles.values()].filter((r) =>
      r.permissions.has(PermissionFlagsBits.Administrator)
    );
    const modRoles = [...roles.values()].filter((r) => {
      if (r.permissions.has(PermissionFlagsBits.Administrator)) return false;
      const n = r.name.toLowerCase();
      return (
        n.includes('admin') ||
        n.includes('админ') ||
        n.includes('адмін') ||
        n.includes('mod') ||
        n.includes('модератор') ||
        n.includes('модер') ||
        n.includes('стаф') ||
        n.includes('staff') ||
        n.includes('команда')
      );
    });

    console.log('Админ-роли (право Administrator):');
    for (const r of adminRoles) console.log(`  ${r.name} (${r.id})`);
    console.log('Модератор-роли (по названию):');
    for (const r of modRoles) console.log(`  ${r.name} (${r.id})`);

    const overwrites = [
      { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] }, // @everyone
      { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }, // бот
    ];
    const visibleRoles = new Map();
    for (const r of [...adminRoles, ...modRoles]) {
      if (!visibleRoles.has(r.id)) {
        visibleRoles.set(r.id, r);
        overwrites.push({
          id: r.id,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
        });
      }
    }

    const channel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      permissionOverwrites: overwrites,
      reason: 'RustBot: приватный канал логов',
    });

    console.log('');
    console.log(`✅ Канал создан: #${channel.name} (${channel.id})`);
    console.log(`   https://discord.com/channels/${guild.id}/${channel.id}`);
    console.log(`   Видно: ${visibleRoles.size > 0 ? [...visibleRoles.values()].map((r) => r.name).join(', ') : 'только админы (Administrator)'}`);
  } catch (e) {
    console.error('ОШИБКА:', e.message);
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