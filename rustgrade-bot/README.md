# RUSTBOT — безкоштовний Discord ⇄ Rust бот

Власний 6-в-1 бот (можна розширювати): **двосторонній чат**, **алерти івентів**,
**трекінг тіми**, **команди в грі**, **жива мапа**, **алерти в Discord**.

Працює через [`@liamcottle/rustplus.js`](https://github.com/liamcottle/rustplus.js)
(той самий Rust+ протокол, що й офіційний мобільний застосунок). Нічого платити не треба.

---

## 1. Що потрібно заздалегідь

1. **Node.js ≥ 20** — https://nodejs.org (у тебе вже є v24).
2. **Сервер Rust із увімкненим Rust+** (на більшості офіційних — увімкнено).
3. Ти маєш бути **в тімі/клані**, щоб бот бачив чат.
4. **Discord-бот** (крок 2) і **Rust+ токен** (крок 3).

> ⚠️ У серпні 2026 Facepunch прибрав з Rust+ маркери **вендінгів та івентів**
> (cargo/heli). Тож алерти івентів працюють лише якщо сервер їх ще віддає —
> код їх підтримує, але гра може їх більше не присилати.

---

## 2. Створити Discord-бота

1. https://discord.com/developers/applications → **New Application**.
2. Вкладка **Bot** → **Reset Token** → скопіюй **token** → у `config.json` в `discord.token`.
3. Там же увімкни **MESSAGE CONTENT INTENT** (потрібно для релею чату).
4. Вкладка **OAuth2 → URL Generator**: scopes `bot` + `applications.commands`,
   permissions: *Read Messages, Send Messages, Embed Links, Add Reactions, Use Application Commands*.
   Відкрий згенероване посилання → запроси бота на свій сервер.
5. (Опційно, швидше) скопіюй **ID сервера** у `discord.guildId` — команди зареєструються одразу.

## 3. Отримати Rust+ токен (парінг)

У папці проєкту:

```
npm.cmd run pair-register
npm.cmd run pair-listen
```

- `pair-register` відкриє Chrome, залогінься Steam.
- `pair-listen` чекає парінг. У грі: **ESC → Rust+ → PAIR WITH SERVER**.
- У консолі з'явиться об'єкт з `ip`, `port`, `playerId`, `playerToken` — встав їх у
  `config.json` у блок `rustplus` (`serverIp`, `appPort`, `playerId`, `playerToken`).

## 4. Налаштувати канали (IDs)

У Discord: правий клік по каналу → **Copy Channel ID** (потрібен Developer Mode:
Settings → Advanced → Developer Mode). Впиши у `config.json → discord.channels`:

| Поле | Призначення |
|------|-------------|
| `teamChat` | двосторонній чат: гра ⇄ Discord |
| `clanChat` | дзеркалення клан-чату |
| `events` | алерти івентів (cargo/heli/chinook/crate) |
| `deaths` | смерті тімейтів |
| `alerts` | зайшов/вийшов тімейт, smart-девайси |
| `status` | підключення/відключення бота |

## 5. Запуск

Двічі клікни `start-bot.bat` — або:

```
npm.cmd install
npm.cmd start
```

Готово. Тепер:
- Пишеш у канал `teamChat` у Discord → з'явиться в командному чаті гри.
- Пишеш у грі → з'явиться в Discord.
- У грі працюють команди: `!pop`, `!time`, `!online`, `!events`, `!map`, `!wipe`, `!devices`, `!switch on|off <назва>`.
- Slash-команди в Discord: `/status`, `/pop`, `/time`, `/team`, `/events`, `/map`.
- **Жива мапа**: http://localhost:8787

---

## Що вміє (функції)

1. **Team chat ⇄ Discord** — двосторонній релей.
2. **Clan chat** — дзеркалення (якщо сервер/гра підтримує).
3. **Алерти івентів** — нові маркери cargo/heli/chinook/crate → у Discord.
4. **Трекінг тіми** — зайшов/вийшов/помер тімейт; склад і онлайн.
5. **Команди в грі** — `!pop !time !online !events !map !wipe !devices !switch`.
6. **Жива мапа** — мапа сервера + позиції тіми + івенти (оновлення кожні 10 c).
7. **Алерти в Discord** — смерті, входи/виходи, smart-девайси.
8. **Smart devices** — керування switches/alarms/storage monitors через `config.settings.devices`.

## Файли

```
src/index.js              — збірка та звʼязування
src/rustplus-manager.js   — підключення до Rust+ і події
src/discord-bot.js        — Discord-клієнт і slash-команди
src/game-commands.js      — команди в чаті гри
src/web-map.js            — веб-сервер живої мапи
public/                   — сторінка мапи
```

## Ліміти, які треба знати

- Командний чат — до **128 символів**.
- **Rate limit** запитів до Rust+: Map = 5 токенів, решта — 1.
- Мапа кешується (статична на вайп), інфо — 20 c.
- Одночасно з ботом **не тримай відкритим Rust+ застосунок** для парінга девайсів — конфлікти.
- Тільки **один** акаунт парінгом підʼєднує бота.

## Проблеми

- **Нічого не пише в Discord** → перевір MESSAGE CONTENT INTENT і права бота в каналі.
- **Пар нотифікації не приходять** → перезапусти `pair-listen`, у грі натисни **RESEND**.
- **Модовий сервер** → може різати team chat / маркери, тоді бот частково не працює.
