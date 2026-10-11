'use strict';

const log = require('./logger');
const { loadConfig, validateConfig, getAccounts, CONFIG_PATH, EXAMPLE_PATH } = require('./config');
const RustPlusManager = require('./rustplus-manager');
const DiscordBot = require('./discord-bot');
const GameCommands = require('./game-commands');
const WebMap = require('./web-map');
const { EmbedBuilder } = require('discord.js');
const { markerEmoji, markerLabelRu, gridLabel } = require('./markers');
const { describeTime, mskTime } = require('./time-utils');
const Analytics = require('./analytics');
const Steam = require('./steam');
const PlayerRegistry = require('./players');
const chatLog = require('./chat-log');

async function main() {
  const loaded = loadConfig();
  if (!loaded.ok) {
    log.error(loaded.reason);
    console.error(`\nСоздай config.json в:\n  ${CONFIG_PATH}\nСкопируй из образца:\n  ${EXAMPLE_PATH}\n`);
    process.exit(1);
  }
  const config = loaded.config;

  const problems = validateConfig(config);
  const mandatory = problems.filter((p) => p.startsWith('discord.'));
  if (mandatory.length) {
    log.error('Заполни config.json, не хватает:');
    for (const p of mandatory) console.error('  - ' + p);
    process.exit(1);
  }
  if (problems.length) {
    log.warn('Не хватает Rust+ credentials — игра временно недоступна:');
    for (const p of problems) log.warn('  - ' + p);
  }

  const accounts = getAccounts(config);
  const discord = new DiscordBot(config);

  const managers = accounts.map((account) => new RustPlusManager(config, account));
  const primary = managers[0] || null;
  const analytics = new Analytics();
  analytics.start();
  const steam = new Steam();
  const players = new PlayerRegistry();
  players.start();
  const webMap = new WebMap({ manager: primary, config, analytics, steam, players });

  const ch = (name) => (config.discord.channels && config.discord.channels[name]) || '';

  if (!accounts.length) {
    log.warn('Нет ни одного Rust+ аккаунта — запускаю только Discord-часть.');
    log.warn('Чтобы включить игру: npm run pair-register, затем npm run pair-listen,');
    log.warn('и в игре: ESC → Rust+ → PAIR WITH SERVER.');
  } else {
    log.info(`Rust+ аккаунтов: ${accounts.length} (${accounts.map((a) => a.name).join(', ')})`);
  }

  // ------------------------------------------------------------- Rust events
  // У каждого аккаунта СВОЙ Rust+ коннект, поэтому сообщения в игру идут
  // от имени именно этого игрока (его Steam-аккаунта).
  managers.forEach((manager, i) => {
    const account = accounts[i];
    const tag = account.name || `#${i + 1}`;
    const gameCommands = new GameCommands({ manager, config, webMap, analytics, steam, players, discord });

    manager.on('connected', async () => {
      const info = await manager.getInfoAsync();
      discord.sendToChannel(
        ch('status'),
        `🟢 **[${tag}]** подключён к \`${info ? info.name : account.serverIp}\``
      );
    });

    manager.on('disconnected', () => {
      discord.sendToChannel(ch('status'), `🔴 **[${tag}]** отключился от сервера (переподключаюсь…)`);
    });

    manager.on('teamMessage', (msg) => {
      players.seen(msg.steamId, msg.name, { chat: true });
      if (config.settings.relayGameToDiscord && ch('teamChat')) {
        const embed = new EmbedBuilder()
          .setAuthor({ name: msg.name || 'Unknown' })
          .setDescription(msg.text || '*(пусто)*')
          .setColor(0x5865f2)
          .setFooter({ text: `Rust • чат команды • ${tag}` })
          .setTimestamp();
        discord.sendEmbed(ch('teamChat'), embed);
      }
      gameCommands.handle(msg);
    });

    manager.on('clanMessage', (msg) => {
      players.seen(msg.steamId, msg.name, { chat: true });
      if (config.settings.relayClanChat && ch('clanChat')) {
        const embed = new EmbedBuilder()
          .setAuthor({ name: msg.name || 'Unknown' })
          .setDescription(msg.text || '*(пусто)*')
          .setColor(0x9b59b6)
          .setFooter({ text: `Rust • чат клана • ${tag}` })
          .setTimestamp();
        discord.sendEmbed(ch('clanChat'), embed);
      }
    });

    manager.on('markerSpawn', ({ marker }) => {
      const grid = gridLabel(marker.x, marker.y, manager.mapSize);
      const name = marker.name || markerLabelRu(marker.type);
      chatLog.line(`[Событие] ${name} — ${grid}`, manager.accountName);
      if (ch('events')) {
        const embed = new EmbedBuilder()
          .setTitle(`${markerEmoji(marker.type)} ${name}`)
          .setDescription(`Квадрат **${grid}**`)
          .addFields(
            { name: 'X', value: String(Math.round(marker.x)), inline: true },
            { name: 'Y', value: String(Math.round(marker.y)), inline: true }
          )
          .setFooter({ text: tag })
          .setColor(0xff7a18)
          .setTimestamp();
        discord.sendEmbed(ch('events'), embed);
      }
      // автоматически в чат игры (от имени этого аккаунта)
      if (config.settings.notifyEventsToGame !== false) {
        manager.sendTeamMessage(`${name} — ${grid}`);
      }
    });

    manager.on('memberDeath', ({ steamId, name, x, y }) => {
      analytics.death(steamId, name, x, y);
      players.addDeath(steamId, name);
      const grid = gridLabel(x || 0, y || 0, manager.mapSize);
      chatLog.line(`[Смерть] ${name} умер — ${grid}`, manager.accountName);
      if (ch('deaths')) {
        // Если игрок привязал Steam к Discord (/link) — пингуем его.
        const linked = players.get(steamId);
        const mention = linked && linked.discordId ? ` <@${linked.discordId}>` : '';
        const embed = new EmbedBuilder()
          .setTitle('☠️ Смерть тиммейта')
          .setDescription(`**${name}** умер — квадрат **${grid}**${mention}`)
          .setFooter({ text: tag })
          .setColor(0xf85149)
          .setTimestamp();
        discord.sendEmbed(ch('deaths'), embed);
      }
      if (config.settings.notifyDeathsToGame !== false) {
        manager.sendTeamMessage(`[Смерть] ${name} умер — ${grid}`);
      }
    });

    manager.on('teamNote', (note) => {
      const grid = gridLabel(note.x, note.y, manager.mapSize);
      const who = note.by === 'leader' ? 'метка лидера' : 'метка команды';
      // Когда тиммейт умирает, игра САМА ставит командную метку на месте смерти
      // (маркер трупа) — она дублирует «Смерть тиммейта», поэтому не показываем.
      const corpseMarker =
        note.by !== 'leader' &&
        manager
          .recentDeaths()
          .some((d) => Date.now() - d.at < 45000 && gridLabel(d.x, d.y, manager.mapSize) === grid);
      if (corpseMarker) return;
      if (!ch('events')) return;
      const embed = new EmbedBuilder()
        .setTitle('📍 Метка на карте')
        .setDescription(`**${who}** — квадрат **${grid}**`)
        .setFooter({ text: tag })
        .setColor(0x58a6ff)
        .setTimestamp();
      discord.sendEmbed(ch('events'), embed);
    });

    manager.on('memberOnline', ({ steamId, name, online }) => {
      analytics.memberOnline(steamId, name, online);
      players.setOnline(steamId, name, online);
      chatLog.line(`[Статус] ${name} ${online ? 'зашёл на сервер' : 'вышел с сервера'}`, manager.accountName);
      if (!ch('alerts')) return;
      discord.sendToChannel(
        ch('alerts'),
        `${online ? '🟢' : '⚫'} **${name}** ${online ? 'зашёл на сервер' : 'вышел с сервера'} • ${tag}`
      );
    });

    // Тянуть сессии онлайна в аналитику на каждом опросе состава команды.
    manager.on('teamInfo', (team) => {
      for (const m of (team && team.members) || []) {
        analytics.memberOnline(m.steamId, m.name, m.isOnline);
        players.setOnline(m.steamId, m.name, m.isOnline);
        if (m.isOnline && m.isAlive && Number.isFinite(Number(m.x)) && Number.isFinite(Number(m.y))) {
          analytics.position(m.steamId, m.name, m.x, m.y);
        }
        // прогрев кэша Steam-профилей (команда)
        if (m.steamId) steam.get(m.steamId).catch(() => {});
      }
    });

    manager.on('connected', () => {
      // стартовый сэмпл онлайна сервера для графика
      samplePop();
    });

    manager.on('entityChanged', ({ entityId, value, items }) => {
      if (!ch('alerts')) return;
      const name = manager._deviceIds.get(Number(entityId)) || `#${entityId}`;
      if (items && items.length) {
        const list = items.map((i) => `${i.itemId || i.itemid || 'item'} x${i.quantity || i.stackSize || '?'}`).join(', ');
        discord.sendToChannel(ch('alerts'), `📦 **${name}** обновился: ${list} • ${tag}`);
      } else {
        discord.sendToChannel(ch('alerts'), `🔔 **${name}** теперь ${value ? 'ON' : 'OFF'} • ${tag}`);
      }
    });

    manager.on('error', () => {
      /* already logged */
    });
  });

  // Discord-канал логов: каждая строка chat.log дублируется туда.
  // Приоритет канала: свой на акаунт (channelsPerAccount.<имя>.logs)
  // -> общий (channels.logs). Если оба пустые — в Discord ничего не шлём.
  chatLog.on('line', (entry) => {
    if (!entry || !entry.text) return;
    const per = config.discord.channelsPerAccount || {};
    const id =
      (entry.account && per[entry.account] && per[entry.account].logs) ||
      (config.discord.channels && config.discord.channels.logs) ||
      '';
    if (!id) return;
    const who = entry.account ? ` • ${entry.account}` : '';
    discord.sendToChannel(String(id), `\`${entry.at}\` ${entry.text}${who}`);
  });

  // --------------------------------------------------------- Discord events

  discord.on('discordTeamChat', (msg) => {
    if (!config.settings.relayDiscordToGame) return;
    const author = msg.member ? msg.member.displayName : msg.author.username;
    const text = (config.settings.discordToGameFormat || '{author}: {message}')
      .replace('{author}', author)
      .replace('{message}', msg.content);
    chatLog.line(`[Discord→Игра] ${author}: ${msg.content}`);
    for (const m of managers) m.sendTeamMessage(text);
  });

  discord.on('discordClanChat', (msg) => {
    if (!config.settings.relayDiscordToGame) return;
    const author = msg.member ? msg.member.displayName : msg.author.username;
    const text = `[Discord] ${author}: ${msg.content}`;
    chatLog.line(`[Discord→Клан] ${author}: ${msg.content}`);
    for (const m of managers) m.sendClanMessage(text);
  });

  discord.on('slash', (interaction) => handleSlash(interaction, { managers, primary, webMap, discord, config, analytics, steam, players }));

  discord.on('ready', () => {
    discord.sendToChannel(
      ch('status'),
      '🤖 **RustBot запущен.** Команды: `/status` `/pop` `/time` `/team` `/events` `/map`'
    );
  });

  // --------------------------------------------------------------- start-up

  webMap.start();
  for (const m of managers) m.connect();
  if (!managers.length) log.info('Rust+: подключение к игре пропущено — сделайте пейринг (npm run pair-listen).');

  // Сэмпл онлайна сервера для графика в аналитике (раз в минуту).
  const samplePop = async () => {
    if (!primary) return;
    try {
      const info = await primary.getInfoAsync();
      if (info) analytics.sample(info.players, info.wipeTime);
    } catch (_) {
      /* ignore */
    }
  };
  samplePop();
  const sampleTimer = setInterval(samplePop, 60000);
  if (sampleTimer.unref) sampleTimer.unref();

  await discord.login();

  const shutdown = () => {
    log.info('Остановка…');
    clearInterval(sampleTimer);
    analytics.stop();
    players.stop();
    webMap.stop();
    for (const m of managers) m.stop();
    try {
      discord.client.destroy();
    } catch (_) {
      /* ignore */
    }
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

async function handleSlash(interaction, { managers, primary, webMap, discord, config, analytics, steam, players }) {
  // если аккаунтов нет — сообщаем
  const connectedManagers = managers.filter((m) => m.connected);
  const manager = connectedManagers[0] || primary;
  try {
    switch (interaction.commandName) {
      case 'status': {
        const embed = new EmbedBuilder().setTitle('RustBot — статус');
        if (!managers.length) {
          embed.setDescription('Ни один Rust+ аккаунт не настроен.');
        } else {
          for (const m of managers) {
            const info = m.connected ? await m.getInfoAsync() : null;
            embed.addFields({
              name: m.accountName,
              value: `${m.connected ? '🟢 подключён' : '🔴 отключён'}${info && info.name ? ` • ${info.name}` : ''}${info ? ` • ${info.players}/${info.maxPlayers}` : ''}`,
              inline: false,
            });
          }
          embed.addFields({ name: 'Карта', value: webMap.localUrl() || 'выключено', inline: false });
        }
        embed.setColor(connectedManagers.length ? 0x3fb950 : 0xf85149);
        return interaction.reply({ embeds: [embed], ephemeral: true });
      }
      case 'pop': {
        if (!manager) return interaction.reply({ content: 'Нет подключённых аккаунтов.', ephemeral: true });
        const info = await manager.getInfoAsync();
        if (!info) return interaction.reply({ content: 'Онлайн недоступен.', ephemeral: true });
        return interaction.reply({
          content: `Онлайн: **${info.players}/${info.maxPlayers}**${info.queuedPlayers ? ` (очередь ${info.queuedPlayers})` : ''} • ${manager.accountName}`,
          ephemeral: true,
        });
      }
      case 'time': {
        if (!manager) return interaction.reply({ content: 'Нет подключённых аккаунтов.', ephemeral: true });
        const msk = mskTime();
        const t = await manager.getTimeAsync();
        if (!t) {
          return interaction.reply({ content: `🕐 МСК ${msk.clockSec} — ${msk.date} (${msk.weekday})`, ephemeral: true });
        }
        const d = describeTime(t);
        const embed = new EmbedBuilder()
          .setTitle(`🕐 МСК ${msk.clockSec}`)
          .setDescription(`${msk.date}, ${msk.weekday}\n**${d.untilLabel[0].toUpperCase()}${d.untilLabel.slice(1)}: ${d.untilText}**`)
          .addFields(
            { name: 'Игровое время', value: `${d.clock} (${d.phase})`, inline: true },
            { name: 'Рассвет', value: d.sunrise, inline: true },
            { name: 'Закат', value: d.sunset, inline: true }
          )
          .setColor(d.phase === 'день' ? 0xf1c40f : 0x2c3e50)
          .setFooter({ text: manager.accountName });
        return interaction.reply({ embeds: [embed], ephemeral: true });
      }
      case 'team': {
        if (!manager) return interaction.reply({ content: 'Нет подключённых аккаунтов.', ephemeral: true });
        const team = await manager.getTeamInfoAsync();
        if (!team) return interaction.reply({ content: 'Команда недоступна.', ephemeral: true });
        const lines = (team.members || []).map((m) => `${m.isOnline ? '🟢' : '⚫'} ${m.isAlive ? '' : '☠️ '}${m.name}`);
        return interaction.reply({ content: (lines.join('\n') || 'Пусто') + `\n• ${manager.accountName}`, ephemeral: true });
      }
      case 'events': {
        if (!manager) return interaction.reply({ content: 'Нет подключённых аккаунтов.', ephemeral: true });
        const markers = manager.currentEventMarkers();
        if (!markers.length) return interaction.reply({ content: 'Активных событий нет (или сервер не отдаёт маркеры).', ephemeral: true });
        const lines = markers.map((m) => `${markerEmoji(m.type)} ${markerLabelRu(m.type)} — квадрат ${gridLabel(m.x, m.y, manager.mapSize)}`);
        return interaction.reply({ content: lines.join('\n') + `\n• ${manager.accountName}`, ephemeral: true });
      }
      case 'say': {
        const text = (interaction.options.getString('text') || '').trim();
        const style = interaction.options.getString('style') || 'plain';
        const wantAccount = interaction.options.getString('account');
        let target = manager;
        if (wantAccount) {
          target =
            managers.find(
              (x) => (x.accountName || '').toLowerCase() === wantAccount.toLowerCase()
            ) || null;
        }
        if (!target) {
          const who = wantAccount ? `аккаунт «${wantAccount}»` : 'подключённый аккаунт';
          return interaction.reply({ content: `Не найден ${who}.`, ephemeral: true });
        }
        if (!target.connected) {
          return interaction.reply({ content: `Аккаунт ${target.accountName} не подключён к Rust+.`, ephemeral: true });
        }
        if (!text) return interaction.reply({ content: 'Пустой текст.', ephemeral: true });
        const msg = (style === 'alert' ? '[ВАЖНО] ' : '') + text;
        // Чтобы в игровом чате /say выделялось: текстовый префикс «>>> » по
        // умолчанию (эмодзи в чате Rust не рендерятся — показываются как □).
        // Формат меняется в config.json -> settings.sayGameFormat («{message}» — текст).
        const fmt = (config.settings.sayGameFormat || '>>> {message}')
          .replace('{message}', msg)
          .slice(0, 128);
        const ok = target.sendTeamMessage(fmt);
        return interaction.reply({
          content: ok
            ? `✅ Отправлено в игру от **${target.accountName}**: «${fmt}»`
            : '❌ Не удалось отправить в чат игры.',
          ephemeral: true,
        });
      }
      case 'stats': {
        if (!analytics) return interaction.reply({ content: 'Аналитика недоступна.', ephemeral: true });
        const members = analytics.leaderboard();
        if (!members.length) {
          return interaction.reply({ content: 'Пока нет данных — статистика копится по мере игры на сервере.', ephemeral: true });
        }
        const fmt = (s) => {
          s = Math.max(0, Math.round(s));
          const h = Math.floor(s / 3600);
          const mn = Math.floor((s % 3600) / 60);
          if (h) return `${h} ч ${mn} мин`;
          if (mn) return `${mn} мин`;
          return `${s} с`;
        };
        const ago = (ts) => {
          if (!ts) return '—';
          const d = Math.round((Date.now() - ts) / 1000);
          if (d < 60) return 'только что';
          if (d < 3600) return `${Math.floor(d / 60)} мин назад`;
          if (d < 86400) return `${Math.floor(d / 3600)} ч назад`;
          return `${Math.floor(d / 86400)} д назад`;
        };
        const query = (interaction.options.getString('player') || '').trim();
        if (query) {
          const q = query.toLowerCase();
          const found = members.filter(
            (m) => m.steamId === query || (m.name || '').toLowerCase().includes(q)
          );
          if (!found.length) {
            // не из команды — ищем по реестру, затем по Steam ID / ссылке
            const hit = players ? players.find(query)[0] : null;
            const sid = hit ? hit.steamId : /^\d{17}$/.test(query) ? query : steam ? await steam.resolve(query) : null;
            if (sid) {
              await interaction.deferReply({ ephemeral: true });
              const card = await buildPlayerCard(sid, { analytics, steam, manager });
              return interaction.editReply({ embeds: [card] });
            }
            return interaction.reply({
              content: `Не нашёл «${query}». Для чужих игроков нужен Steam ID или ссылка на профиль.`,
              ephemeral: true,
            });
          }
          const embed = new EmbedBuilder().setTitle(`📊 Статистика: ${found[0].name}`).setColor(0x58a6ff);
          for (const m of found.slice(0, 5)) {
            const sp = steam && steam.peek(m.steamId);
            const steamLine =
              sp && sp.rustHours != null ? `\nRust в Steam: **${sp.rustHours.toLocaleString('ru-RU')} ч**` : '';
            embed.addFields({
              name: `${m.online ? '🟢 в игре' : '⚫ офлайн'} — ${m.name}`,
              value:
                `Steam ID: \`${m.steamId}\`\n` +
                `Наиграно: **${fmt(m.onlineSeconds)}**\n` +
                `Сессий: **${m.sessions}** • Смертей: **${m.deaths}**\n` +
                `Последний раз: ${m.online ? 'сейчас' : ago(m.lastSeen)}` +
                steamLine,
              inline: false,
            });
          }
          return interaction.reply({ embeds: [embed], ephemeral: true });
        }
        const sum = analytics.summary();
        const top = members.slice(0, 10);
        const embed = new EmbedBuilder()
          .setTitle('📊 Статистика команды (текущий вайп)')
          .setDescription(
            top
              .map((m, i) => {
                const medal = ['🥇', '🥈', '🥉'][i] || `${i + 1}.`;
                const sp = steam && steam.peek(m.steamId);
                const g = sp && sp.rustHours != null ? ` • 🎮${Math.round(sp.rustHours)}ч` : '';
                return `${medal} **${m.name}** ${m.online ? '🟢' : '⚫'} — ${fmt(m.onlineSeconds)} • ☠️ ${m.deaths}${g}`;
              })
              .join('\n')
          )
          .addFields(
            { name: 'Онлайн сейчас', value: `${sum.current}`, inline: true },
            { name: 'Пик', value: `${sum.peak}`, inline: true },
            { name: 'Игроков в базе', value: `${members.length}`, inline: true }
          )
          .setColor(0x3fb950);
        if (sum.wipeStart) {
          embed.setFooter({ text: `С вайпа: ${new Date(sum.wipeStart).toLocaleString('ru-RU')}` });
        } else {
          embed.setFooter({ text: 'Подсказка: /player <ник|Steam ID|ссылка> — полная карточка игрока' });
        }
        return interaction.reply({ embeds: [embed], ephemeral: true });
      }
      case 'top': {
        if (!analytics) return interaction.reply({ content: 'Аналитика недоступна.', ephemeral: true });
        const period = interaction.options.getString('period') || 'week';
        const isWeek = period !== 'all';
        const sinceMs = isWeek ? Date.now() - 7 * 86400000 : 0;
        const rows = analytics.leaderboardSince(sinceMs).slice(0, 10);
        if (!rows.length) {
          return interaction.reply({ content: 'Статистики за этот период пока нет.', ephemeral: true });
        }
        const fmt = (s) => {
          s = Math.max(0, Math.round(s));
          const h = Math.floor(s / 3600);
          const mn = Math.floor((s % 3600) / 60);
          if (h) return `${h}ч ${mn}м`;
          if (mn) return `${mn}м`;
          return `${s}с`;
        };
        const nameCol = Math.max(6, ...rows.map((m) => (m.name || '').length)) + 2;
        const table = rows
          .map(
            (m, i) =>
              `${i + 1}. ${m.online ? '🟢' : '⚫'} ${(m.name || '?').padEnd(nameCol)}${fmt(m.onlineSeconds)}${m.sessions ? `  · ${m.sessions} сес.` : ''}`
          )
          .join('\n');
        const embed = new EmbedBuilder()
          .setTitle(isWeek ? '🏆 Топ недели (наиграно)' : '🏆 Топ за вайп (наиграно)')
          .setDescription(`\`\`\`\n${table}\n\`\`\``)
          .setFooter({ text: isWeek ? 'за последние 7 дней • топ 10' : 'за текущий вайп • топ 10' })
          .setColor(0xf1c40f)
          .setTimestamp();
        return interaction.reply({ embeds: [embed] });
      }
      case 'player': {
        const query = (interaction.options.getString('player') || '').trim();
        if (!query) {
          return interaction.reply({ content: 'Укажи ник, Steam ID или ссылку на профиль.', ephemeral: true });
        }
        await interaction.deferReply({ ephemeral: true });

        let steamId = null;
        const members = analytics ? analytics.leaderboard() : [];
        const q = query.toLowerCase();
        const found =
          members.find((m) => m.steamId === query) ||
          members.find((m) => (m.name || '').toLowerCase() === q) ||
          members.find((m) => (m.name || '').toLowerCase().includes(q));
        if (found) steamId = found.steamId;
        if (!steamId && players) {
          const hit = players.find(query)[0];
          if (hit) steamId = hit.steamId;
        }
        if (!steamId && steam) steamId = await steam.resolve(query);

        if (!steamId) {
          return interaction.editReply({
            content: `Не нашёл «${query}». Вставь Steam ID (17 цифр) или ссылку на профиль.`,
          });
        }
        const embed = await buildPlayerCard(steamId, { analytics, steam, manager });
        return interaction.editReply({ embeds: [embed] });
      }
      case 'track': {
        const query = (interaction.options.getString('player') || '').trim();
        if (!query) {
          return interaction.reply({ content: 'Укажи ник, Steam ID или ссылку на профиль.', ephemeral: true });
        }
        if (!analytics) return interaction.reply({ content: 'Аналитика недоступна.', ephemeral: true });
        await interaction.deferReply({ ephemeral: true });

        const members = analytics.leaderboard();
        const q = query.toLowerCase();
        let entry =
          members.find((m) => m.steamId === query) ||
          members.find((m) => (m.name || '').toLowerCase() === q) ||
          members.find((m) => (m.name || '').toLowerCase().includes(q));
        let steamId = entry ? entry.steamId : null;
        if (!steamId && players) {
          const hit = players.find(query)[0];
          if (hit) steamId = hit.steamId;
        }
        if (!steamId && steam) steamId = await steam.resolve(query);
        if (!steamId) return interaction.editReply({ content: `Не нашёл «${query}».` });

        if (!entry) entry = members.find((m) => m.steamId === steamId) || null;
        const mapSize = (manager && manager.mapSize) || 0;
        const gridOf = (p) => (p && mapSize ? gridLabel(p.x, p.y, mapSize) : '?');
        const sp = steam ? steam.peek(steamId) : null;
        const name = (sp && sp.name) || (entry && entry.name) || steamId;

        const embed = new EmbedBuilder()
          .setTitle(`📡 Слежение: ${name}`)
          .setURL(`https://steamcommunity.com/profiles/${steamId}`)
          .setColor(entry && entry.online ? 0x3fb950 : 0x8b949e);
        if (sp && sp.avatar) embed.setThumbnail(sp.avatar);

        if (!entry) {
          embed.setDescription('Игрока нет в статистике сервера. Позицию можно отслеживать только для участников команды.');
          embed.setFooter({ text: `Steam ID: ${steamId}` });
          return interaction.editReply({ embeds: [embed] });
        }

        const lines = [
          `${entry.online ? '🟢 **в игре сейчас**' : '⚫ офлайн'}`,
          `Наиграно за вайп: **${fmtDurLong(entry.onlineSeconds)}** • сессий: **${entry.sessions}**`,
          `Смертей: **${entry.deaths}** • последний раз: ${entry.online ? 'сейчас' : agoShort(entry.lastSeen)}`,
        ];
        if (entry.avgSession) lines.push(`Средняя сессия: ${fmtDurLong(entry.avgSession)}`);
        if (entry.lastConnected) lines.push(`Зашёл: ${entry.online ? `сейчас (${shortDT(entry.lastConnected)})` : agoShort(entry.lastConnected)} (${shortDT(entry.lastConnected)})`);
        if (entry.lastDisconnected) lines.push(`Вышел: ${agoShort(entry.lastDisconnected)} (${shortDT(entry.lastDisconnected)})`);
        embed.addFields({ name: 'Статус', value: lines.join('\n'), inline: false });
        embed.addFields({ name: '🕒 Вход → выход', value: sessionLines(entry, 8), inline: false });

        if (entry.online && entry.lastPos) {
          embed.addFields({
            name: '📍 Где сейчас',
            value: `Квадрат **${gridOf(entry.lastPos)}** (${Math.round(entry.lastPos.x)}, ${Math.round(entry.lastPos.y)}) — обновлено ${agoShort(entry.lastPos.t)}`,
            inline: false,
          });
        } else if (entry.lastPos) {
          embed.addFields({
            name: '📍 Последняя точка',
            value: `Квадрат **${gridOf(entry.lastPos)}** — ${agoShort(entry.lastPos.t)}`,
            inline: false,
          });
        }
        if (entry.lastDeath) {
          embed.addFields({
            name: '☠️ Последняя смерть',
            value: `Квадрат **${gridOf(entry.lastDeath)}** — ${agoShort(entry.lastDeath.t)}`,
            inline: false,
          });
        }
        if (entry.path && entry.path.length > 2) {
          const pts = entry.path;
          const step = Math.max(1, Math.floor(pts.length / 10));
          const cells = [];
          for (let i = 0; i < pts.length; i += step) cells.push(gridOf(pts[i]));
          if (cells[cells.length - 1] !== gridOf(pts[pts.length - 1])) cells.push(gridOf(pts[pts.length - 1]));
          const first = pts[0];
          embed.addFields({
            name: `🗺️ Маршрут (${pts.length} точек, с ${agoShort(first.t)})`,
            value: cells.join(' → ').slice(0, 1024),
            inline: false,
          });
        } else {
          embed.setFooter({ text: 'Маршрут появится по мере перемещений (видны только тиммейты).' });
        }
        if (sp && sp.rustHours != null) {
          embed.addFields({ name: '🎮 Rust в Steam', value: `${sp.rustHours.toLocaleString('ru-RU')} ч`, inline: true });
        }
        embed.setFooter({ text: `Steam ID: ${steamId}${entry.online ? '' : ' • маршрут копится по мере игры'}` });
        return interaction.editReply({ embeds: [embed] });
      }
      case 'players': {
        if (!players) return interaction.reply({ content: 'Реестр игроков недоступен.', ephemeral: true });
        const all = players.list();
        if (!all.length) return interaction.reply({ content: 'Пока никого не видел.', ephemeral: true });
        const online = all.filter((e) => e.online);
        const onlineLine = online.length ? online.map((e) => e.name).join(', ') : 'никого';
        const lines = all.slice(0, 15).map((e) => {
          const status = e.online ? '🟢' : '⚫';
          let when = e.online ? 'сейчас' : agoShort(e.lastSeen);
          if (e.online && e.lastIn) when = `в игре с ${shortDT(e.lastIn)}`;
          else if (!e.online && e.lastOut) when = `вышел ${agoShort(e.lastOut)}`;
          const extra = `${e.chats ? ` • 💬${e.chats}` : ''}${e.deaths ? ` • ☠${e.deaths}` : ''}`;
          return `${status} **${e.name}** — ${when}${extra}`;
        });
        const embed = new EmbedBuilder()
          .setTitle(`👥 Игроки в базе: ${all.length}`)
          .setDescription(`🟢 Сейчас в сети: **${onlineLine}**\n\n${lines.join('\n')}`)
          .setFooter({ text: 'Источники: команда • чат • смерти' })
          .setColor(0x3fb950);
        return interaction.reply({ embeds: [embed], ephemeral: true });
      }
      case 'map': {
        const url = webMap.localUrl();
        return interaction.reply({ content: url ? `Живая карта: ${url}` : 'Карта выключена.', ephemeral: true });
      }
      case 'link': {
        const q = (interaction.options.getString('player') || '').trim();
        if (!q) return interaction.reply({ content: 'Укажи ник, Steam ID или ссылку на профиль.', ephemeral: true });
        let steamId = null;
        if (/^\d{17}$/.test(q)) steamId = q;
        if (!steamId && players) {
          const hit = players.find(q)[0];
          if (hit) steamId = hit.steamId;
        }
        if (!steamId && steam) steamId = await steam.resolve(q);
        if (!steamId) {
          return interaction.reply({ content: `Не нашёл «${q}». Вставь Steam ID (17 цифр) или ссылку на профиль.`, ephemeral: true });
        }
        const profile = steam ? await steam.get(steamId) : null;
        const name = (profile && profile.name) || q;
        players.linkDiscord(steamId, interaction.user.id, name);
        return interaction.reply({
          content: `✅ Привязано: **${name}** (Steam ID \`${steamId}\`) к твоему Discord.\nТеперь при его смерти и для «${name}» в статистике бот знает, что это ты.`,
          ephemeral: true,
        });
      }
      case 'unlink': {
        const ok = players.unlinkDiscord(interaction.user.id);
        return interaction.reply({ content: ok ? '✅ Привязка убрана.' : 'У тебя нет привязки.', ephemeral: true });
      }
      case 'who': {
        const q = (interaction.options.getString('player') || '').trim();
        if (!q) return interaction.reply({ content: 'Укажи ник или Steam ID.', ephemeral: true });
        let steamId = null;
        if (/^\d{17}$/.test(q)) steamId = q;
        if (!steamId && analytics) {
          const ql = q.toLowerCase();
          const hit =
            analytics.leaderboard().find((m) => m.steamId === q) ||
            analytics.leaderboard().find((m) => (m.name || '').toLowerCase().includes(ql));
          if (hit) steamId = hit.steamId;
        }
        if (!steamId && players) {
          const hit = players.find(q)[0];
          if (hit) steamId = hit.steamId;
        }
        if (!steamId) return interaction.reply({ content: `Не нашёл «${q}».`, ephemeral: true });
        const e = players.get(steamId);
        const playerName = (e && e.name) || steamId;
        if (!e || !e.discordId) {
          return interaction.reply({ content: `**${playerName}** — пока никто не привязан.`, ephemeral: true });
        }
        const user = await discord.client.users.fetch(e.discordId).catch(() => null);
        return interaction.reply({
          content: `**${playerName}** (${steamId}) — это ${user ? `**${user.username}**` : `<@${e.discordId}>`}.`,
          ephemeral: true,
        });
      }
      default:
        return interaction.reply({ content: 'Неизвестная команда.', ephemeral: true });
    }
  } catch (err) {
    log.error('Slash обработка не удалась:', err.message);
    try {
      if (!interaction.replied) interaction.reply({ content: 'Ошибка выполнения.', ephemeral: true });
    } catch (_) {
      /* ignore */
    }
  }
}

function fmtDurLong(s) {
  s = Math.max(0, Math.round(s || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h) return `${h} ч ${m} мин`;
  if (m) return `${m} мин`;
  return `${s} с`;
}

function agoShort(ts) {
  if (!ts) return '—';
  const d = Math.round((Date.now() - ts) / 1000);
  if (d < 60) return 'только что';
  if (d < 3600) return `${Math.floor(d / 60)} мин назад`;
  if (d < 86400) return `${Math.floor(d / 3600)} ч назад`;
  return `${Math.floor(d / 86400)} д назад`;
}

// «10.10 21:03»
function shortDT(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// Одна сессия: «10.10 21:03 → 23:40 (2 ч 37 мин)» или «… → сейчас».
function sessionLine(s) {
  if (!s || !s.start) return '';
  const open = !s.end;
  const dur = fmtDurLong(Math.round(((s.end || Date.now()) - s.start) / 1000));
  return `${shortDT(s.start)} → ${open ? 'сейчас' : shortDT(s.end)} (${dur})`;
}

// Последние сессии (вход/выход), новые сверху.
function sessionLines(an, limit = 6) {
  const hist = (an && an.history) || [];
  if (!hist.length) return 'Сессий пока нет.';
  return hist
    .slice(-limit)
    .reverse()
    .map((s) => sessionLine(s))
    .filter(Boolean)
    .join('\n');
}

// Полная карточка игрока: Steam (даже если профиль закрыт — имя и аватар видны) + статистика на сервере.
async function buildPlayerCard(steamId, { analytics, steam, manager }) {
  const profile = steam ? await steam.get(steamId) : null;
  const an = analytics ? analytics.leaderboard().find((m) => m.steamId === steamId) : null;

  const name = (profile && profile.name) || (an && an.name) || steamId;
  const embed = new EmbedBuilder()
    .setTitle(`🎮 ${name}`)
    .setURL(`https://steamcommunity.com/profiles/${steamId}`)
    .setColor(profile && profile.vacBanned ? 0xf85149 : 0x58a6ff);

  if (profile) {
    if (profile.avatar) embed.setThumbnail(profile.avatar);
    const steamLines = [];
    if (profile.rustHours != null) steamLines.push(`**Rust: ${profile.rustHours.toLocaleString('ru-RU')} ч** (всего)`);
    if (profile.rustHours2Wk != null) steamLines.push(`Rust за 2 недели: ${profile.rustHours2Wk} ч`);
    if (profile.onlineState) {
      steamLines.push(`Статус: ${profile.onlineState}${profile.stateMessage ? ` — ${profile.stateMessage}` : ''}`);
    }
    if (!steamLines.length) steamLines.push('Часы и детали игр скрыты в настройках приватности.');
    embed.addFields({ name: '🕹️ Steam', value: steamLines.join('\n'), inline: false });

    const meta = [];
    if (profile.location) meta.push(`🌍 Регион: ${profile.location}`);
    if (profile.memberSince) meta.push(`📅 В Steam с ${profile.memberSince}`);
    if (profile.vacBanned) meta.push('🚫 **VAC-бан**');
    if (profile.tradeBanState && profile.tradeBanState !== 'None') meta.push(`🔒 Trade ban: ${profile.tradeBanState}`);
    if (profile.limited) meta.push('⚠️ Limited-аккаунт');
    if (profile.privacyState && profile.privacyState !== 'public') meta.push('🔒 Профиль закрыт');
    if (meta.length) embed.addFields({ name: 'Профиль', value: meta.join('\n'), inline: false });
  } else {
    embed.addFields({ name: '🕹️ Steam', value: 'Steam не ответил. Проверь Steam ID.', inline: false });
  }

  if (an) {
    const mapSize = (manager && manager.mapSize) || 0;
    const gridOf = (p) => (p && mapSize ? gridLabel(p.x, p.y, mapSize) : '?');
    const statsLines = [
      `${an.online ? '🟢 в игре' : '⚫ офлайн'}`,
      `Наиграно (вайп): **${fmtDurLong(an.onlineSeconds)}**`,
      `Сессий: **${an.sessions}** • Смертей: **${an.deaths}**`,
    ];
    if (an.avgSession) statsLines.push(`Средняя сессия: ${fmtDurLong(an.avgSession)}`);
    if (an.lastConnected) statsLines.push(`Последний вход: ${an.online ? 'сейчас' : agoShort(an.lastConnected)}`);
    if (an.lastDisconnected) statsLines.push(`Последний выход: ${agoShort(an.lastDisconnected)}`);
    embed.addFields({ name: '🖥️ На сервере (текущий вайп)', value: statsLines.join('\n'), inline: false });

    // История входов/выходов
    embed.addFields({ name: '🕒 Вход → выход (последние сессии)', value: sessionLines(an, 8), inline: false });

    // Локация: текущая (если в сети) или последняя известная
    const locLines = [];
    if (an.online && Number.isFinite(an.lastPos && an.lastPos.x)) {
      locLines.push(`Сейчас: квадрат **${gridOf(an.lastPos)}** (${Math.round(an.lastPos.x)}, ${Math.round(an.lastPos.y)})`);
    } else if (an.lastPos) {
      locLines.push(`Последняя точка: квадрат **${gridOf(an.lastPos)}** — ${agoShort(an.lastPos.t)}`);
    }
    if (an.lastDeath) locLines.push(`Последняя смерть: квадрат **${gridOf(an.lastDeath)}** — ${agoShort(an.lastDeath.t)}`);
    if (an.path && an.path.length > 2) {
      // маршрут: показываем каждую N-ю точку гридом (компактно)
      const pts = an.path;
      const step = Math.max(1, Math.floor(pts.length / 8));
      const cells = [];
      for (let i = 0; i < pts.length; i += step) cells.push(gridOf(pts[i]));
      if (cells[cells.length - 1] !== gridOf(pts[pts.length - 1])) cells.push(gridOf(pts[pts.length - 1]));
      locLines.push(`Маршрут (${pts.length} точек): ${cells.join(' → ')}`);
    }
    if (locLines.length) embed.addFields({ name: '📍 Отслеживание', value: locLines.join('\n'), inline: false });
  } else {
    embed.addFields({
      name: '🖥️ На сервере',
      value: 'Игрока не видели на этом сервере (или это не тиммейт — позицию видны только для команды).',
      inline: false,
    });
  }
  embed.setFooter({ text: `Steam ID: ${steamId}` });
  return embed;
}

process.on('unhandledRejection', (err) => log.error('unhandledRejection:', err && err.message ? err.message : err));
process.on('uncaughtException', (err) => log.error('uncaughtException:', err && err.message ? err.message : err));

main().catch((err) => {
  log.error('Фатальная ошибка:', err.message);
  process.exit(1);
});
