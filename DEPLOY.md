# Деплой Discord бота тикетів + сайту

Бот лежить у `discord-ticket-bot/ticket-bot.js` (команди `/setup-tickets`, `/ркон`).
Сайт/лідерборд — `server.js`. обидва можна_hostити на одному репозиторії.

---

## 1. Discord Developer Portal (разове)

1. https://discord.com/developers/applications → **New Application**.
2. **Bot** → **Reset token** → скопіюй токен (це `DISCORD_BOT_TOKEN`).
3. Увімкни привілейовані інтенти (Privileged Gateway Intents):
   - **SERVER MEMBERS INTENT** — ON
   - **MESSAGE CONTENT INTENT** — ON
4. Запросити бота на сервер: **OAuth2 → URL Generator** → scopes `bot`, `applications.commands` → права: `View Channels`, `Send Messages`, `Manage Channels`, `Read Message History`, `Use Slash Commands`.
5. У Discord увімкни **Режим розробника** (Налаштування → Розширений) і скопіюй:
   - ID сервера → `DISCORD_GUILD_ID`
   - ID ролі модераторів/адмінів → `STAFF_ROLE_ID`

---

## 2. Локальний запуск (тест)

```bash
# у корені проєкту
cp .env.example .env
# заповни DISCORD_BOT_TOKEN, DISCORD_GUILD_ID, STAFF_ROLE_ID у .env

cd discord-ticket-bot
npm install
npm start
```

У консолі повинно бути: `Вхід як / Logged in as ...` і `Слаш-команди зареєстровано / Slash commands registered`.

### 2.1 Опублікувати панель тикетів (разово на сервері)

У вашому Discord-сервері, в каналі, де треба кнопку, введіть слаш-команду:

```
/setup-tickets
```

Бот оприлюднить повідомлення з кнопкою **Создать тикет / Create ticket**. Гравці натимають її — бот створює приватний канал тикета. Команду може виконати лише персонал (роль `STAFF_ROLE_ID` або права Manage_channels).

---

## 3. Деплой на хостинг (щоб працювало постійно)

Дискорд-бот — це **не** веб-сервер (він не відповідає на HTTP), тому його треба запускати як **background worker** (працює постійно), а не як сайт.

### Варіант А — Render (уже є render.yaml)

Файл `render.yaml` містить два сервіси:
- `teroxxgrade` — веб-сервіс сайту (`node server.js`)
- `discord-ticket-bot` — воркер бота (`node ticket-bot.js`)

**Важливо:** на безкоштовному плану Render доступні лише веб-сервіси (вони "засинають" через 15 хвилин без відвідувань). Для бота потрібен план **Starter** або інший хост (дивись варіант Б/В).

Щоб увімкнути бота на Render:
1. Відкрий https://dashboard.render.com → **Blueprint** →import цей репозиторій.
2. Створи сервіс `discord-ticket-bot` (тип **Worker**).
3. У **Environment variables** сервіса додай **(секретні, не у репозиторії)**:
   - `DISCORD_BOT_TOKEN` — токен бота
   - `DISCORD_GUILD_ID` — ID сервера
   - `STAFF_ROLE_ID` — ID ролі персоналу
   - `RCON_URL` — повний WebSocket-URL RCON **разом із паролем**
4. Несекретні уже у `render.yaml`: `NODE_ENV=production`, `TICKET_CATEGORY_NAME`.
5. Збереги → бот запуститься.

### Варіант Б — Railway (простіше з ботом)

1. Підключ GitHub-репозиторій у Railway.
2. Створи сервіс із папки `discord-ticket-bot` (start command: `node ticket-bot.js`).
3. Додай змінні оточення: `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID`, `STAFF_ROLE_ID`, `TICKET_CATEGORY_NAME`, `RCON_URL`.
4. Деплой — бот працює постійно.

### Варіант В — власний VPS (Hetzner, DigitalOcean і т. д.)

```bash
ssh user@твій-vps
git clone <твій-репозиторій>
cd проєкт/discord-ticket-bot
cp ../.env.example .env   # заповни токени
npm install

# через pm2 (після npm i -g pm2)
pm2 start ticket-bot.js --name discord-ticket-bot
pm2 save
pm2 startup
```

Бот підключиться до Discord і буде працювати постійно.

---

## 4. Змінні оточення (.env / хостинг)

| Змінная | Де брати | Приклад |
|---------|----------|---------|
| `DISCORD_BOT_TOKEN` | Discord Developer Portal → Bot → Reset token | `MTIz...Gxxxx.abc...` |
| `DISCORD_GUILD_ID` | ID сервера Discord (Режим розробника) | `123456789012345678` |
| `STAFF_ROLE_ID` | ID ролі модераторів/адмінів | `123456789012345678` |
| `TICKET_CATEGORY_NAME` | Категорія для каналів тикетів | `Тикеты / Tickets` |
| `RCON_URL` | RCON WebSocket сервера Rust (містить пароль — тільки в Environment Variables, не в git) | `ws://127.0.0.1:28016/...` |
| `NODE_ENV` | Режим роботи | `production` |
| `PORT` / `HOST` | Для сайту `server.js` | `3000` / `0.0.0.0` |

**.env не комітиться** (додано у `.gitignore`). На хостингу змінні задаються у панелі керування сервісом (Environment Variables), а не у файлі.
