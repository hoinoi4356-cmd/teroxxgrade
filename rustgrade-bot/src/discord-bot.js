'use strict';

const EventEmitter = require('events');
const {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  SlashCommandBuilder,
  REST,
  Routes,
  EmbedBuilder,
} = require('discord.js');
const log = require('./logger');

class DiscordBot extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.ready = false;
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
      partials: [Partials.Channel],
    });
    this._setup();
  }

  _setup() {
    this.client.once(Events.ClientReady, (c) => {
      this.ready = true;
      log.info(`Discord: вошёл как ${c.user.tag}`);
      this.emit('ready');
      this.registerSlashCommands().catch((err) =>
        log.error('Discord: регистрация slash-команд не удалась:', err.message)
      );
    });

    this.client.on(Events.InteractionCreate, (interaction) => {
      if (!interaction.isChatInputCommand()) return;
      this.emit('slash', interaction);
    });

    this.client.on(Events.MessageCreate, (msg) => {
      if (msg.author.bot || !msg.guild) return;
      const channels = this.config.discord.channels || {};
      if (channels.teamChat && msg.channelId === String(channels.teamChat)) {
        this.emit('discordTeamChat', msg);
      } else if (channels.clanChat && msg.channelId === String(channels.clanChat)) {
        this.emit('discordClanChat', msg);
      }
    });

    this.client.on(Events.Error, (err) => log.error('Discord client error:', err.message));
  }

  async login() {
    await this.client.login(this.config.discord.token);
  }

  // Ждёт, пока Discord-клиент будет готов (чтобы не терять сообщения,
  // которые приходят раньше логина — напр. статус подключения к Rust).
  _waitReady(timeoutMs = 30000) {
    if (this.ready || this.client.isReady()) return Promise.resolve();
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        this.client.off(Events.ClientReady, finish);
        resolve();
      };
      const timer = setTimeout(finish, timeoutMs);
      this.client.once(Events.ClientReady, finish);
    });
  }

  async sendToChannel(channelId, payload) {
    if (!channelId) return null;
    await this._waitReady();
    try {
      const channel = await this.client.channels.fetch(String(channelId));
      if (!channel || !channel.isTextBased()) {
        log.warn(`Discord: канал ${channelId} недоступен`);
        return null;
      }
      return await channel.send(payload);
    } catch (err) {
      log.error(`Discord: отправка в ${channelId} не удалась:`, err.message);
      return null;
    }
  }

  sendEmbed(channelId, embed) {
    return this.sendToChannel(channelId, { embeds: [embed] });
  }

  // Личное сообщение игроку (для лидерки по !leader из игры).
  async sendDM(userId, payload) {
    if (!userId) return null;
    await this._waitReady();
    try {
      const user = await this.client.users.fetch(String(userId));
      if (!user) return null;
      return await user.send(payload);
    } catch (err) {
      log.error(`Discord: DM ${userId} не удалось:`, err.message);
      return null;
    }
  }

  async registerSlashCommands() {
    const body = this.slashDefinition();
    const rest = new REST({ version: '10' }).setToken(this.config.discord.token);
    if (this.config.discord.guildId) {
      await rest.put(
        Routes.applicationGuildCommands(this.client.user.id, String(this.config.discord.guildId)),
        { body }
      );
    } else {
      await rest.put(Routes.applicationCommands(this.client.user.id), { body });
    }
    log.info(`Discord: зарегистрировано ${body.length} slash-команд`);
  }

  slashDefinition() {
    return [
      new SlashCommandBuilder().setName('status').setDescription('Статус бота и подключения к Rust').toJSON(),
      new SlashCommandBuilder().setName('pop').setDescription('Онлайн сервера Rust').toJSON(),
      new SlashCommandBuilder().setName('time').setDescription('Время по МСК (Москва) + сколько до рассвета/заката').toJSON(),
      new SlashCommandBuilder().setName('team').setDescription('Состав команды и статус игроков').toJSON(),
      new SlashCommandBuilder().setName('events').setDescription('Текущие события на карте').toJSON(),
      new SlashCommandBuilder()
        .setName('stats')
        .setDescription('Статистика: наиграно, сессии, смерти')
        .addStringOption((o) =>
          o
            .setName('player')
            .setDescription('Ник из команды или Steam ID')
            .setRequired(false)
        )
        .toJSON(),
      new SlashCommandBuilder()
        .setName('player')
        .setDescription('Карточка игрока: Steam (часы, VAC, аватар) + сервер. Ник, Steam ID или ссылка')
        .addStringOption((o) =>
          o
            .setName('player')
            .setDescription('Ник из команды, Steam ID или ссылка на профиль')
            .setRequired(true)
        )
        .toJSON(),
      new SlashCommandBuilder()
        .setName('say')
        .setDescription('Отправить сообщение в игровой чат команды')
        .addStringOption((o) =>
          o
            .setName('text')
            .setDescription('Текст сообщения (до 128 символов)')
            .setRequired(true)
            .setMaxLength(128)
        )
        .addStringOption((o) =>
          o
            .setName('style')
            .setDescription('Обычное или важное (с пометкой ⚠)')
            .addChoices({ name: 'обычное', value: 'plain' }, { name: 'важное ⚠', value: 'alert' })
        )
        .addStringOption((o) =>
          o.setName('account').setDescription('С какого аккаунта (если их несколько)').setRequired(false)
        )
        .toJSON(),
      new SlashCommandBuilder()
        .setName('track')
        .setDescription('Отслеживание игрока: где сейчас, маршрут, последняя смерть, статистика')
        .addStringOption((o) =>
          o
            .setName('player')
            .setDescription('Ник, Steam ID или ссылка на профиль')
            .setRequired(true)
        )
        .toJSON(),
      new SlashCommandBuilder()
        .setName('players')
        .setDescription('Кого бот видел: кто онлайн и когда заходил')
        .toJSON(),
      new SlashCommandBuilder().setName('map').setDescription('Ссылка на живую карту сервера').toJSON(),
      new SlashCommandBuilder()
        .setName('link')
        .setDescription('Привязать свой ник в Rust — лидерка (!leader) будет приходить тебе в личку')
        .addStringOption((o) =>
          o.setName('nick').setDescription('Твой ник в игре (как в команде)').setRequired(true)
        )
        .toJSON(),
      new SlashCommandBuilder()
        .setName('unlink')
        .setDescription('Отвязать Discord от ника в Rust (лидерка снова в командный чат)')
        .toJSON(),
    ];
  }

  static embed() {
    return new EmbedBuilder();
  }
}

module.exports = DiscordBot;
