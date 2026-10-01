/* ==========================================================================
   store.js — стан застосунку, збереження в localStorage, бізнес-логіка
   ========================================================================== */
(function (RG) {
  'use strict';

  const D = RG.DATA;
  const ITEM_BY_ID  = D.ITEM_BY_ID;
  const PROMO_CODES = D.PROMO_CODES;
  const DEMO_KEYS   = D.DEMO_KEYS;
  const KEY_FORMAT  = D.KEY_FORMAT;
  const formatKey   = D.formatKey;
  const formatSecret = D.formatSecret;
  const SECRET_MIN  = D.SECRET_MIN;
  const RESERVED_SECRETS = D.RESERVED_SECRETS;
  const CUR         = D.CURRENCY.code;

  const NS = 'rgx_';
  const K = {
    session:  NS + 'session',
    accounts: NS + 'accounts',
    promos:   NS + 'promos'      // промокоди, створені в адмінці
  };

  /* ----------------------------- утиліти -------------------------------- */

  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.warn('Не вдалося зберегти стан:', e);
    }
  }

  function uid(prefix) {
    return (prefix || 'u') + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  }

  function formatNumber(n) {
    return new Intl.NumberFormat('uk-UA').format(Math.round(n));
  }

  function formatMoney(n) {
    return formatNumber(n) + ' ' + CUR;
  }

  /* --------------------------- сховище акаунтів -------------------------- */

  function loadAccounts() { return read(K.accounts, {}); }
  function saveAccounts(accounts) { write(K.accounts, accounts); }

  /**
   * Стартовий інвентар. ID беруться з реального каталогу — найдешевші
   * предмети відповідних категорій, щоб новому акаунту було з чим апгрейдити.
   */
  const SEED_CATS = ['rifle', 'smg', 'pistol', 'shotgun', 'sniper', 'melee', 'armor', 'bow'];

  function seedInventory() {
    const picked = [];
    for (let i = 0; i < SEED_CATS.length; i++) {
      const cheapest = D.byCat(SEED_CATS[i]).slice().sort(function (a, b) { return a.price - b.price; })[0];
      if (cheapest && picked.indexOf(cheapest.id) === -1) picked.push(cheapest.id);
    }
    return picked.map(function (id) {
      return { uid: uid('i'), itemId: id, acquiredAt: Date.now(), source: 'start' };
    });
  }

  function createAccount(key, name) {
    const demo = DEMO_KEYS[key];
    const account = {
      key: key,
      name: String(name || '').trim().slice(0, 24) || (demo && demo.name) || 'Player',
      balance: demo ? (Number(demo.balance) || 0) : (Number(D.START_BALANCE) || 0),
      inventory: seedInventory(),
      redemptions: {},
      videoBonuses: {},
      eggs: {},
      history: [],
      avatar: '',
      createdAt: Date.now()
    };
    const accounts = loadAccounts();
    accounts[key] = account;
    saveAccounts(accounts);
    return account;
  }

  /** Генерація нового ключа доступу (без символів 0/O та 1/I). */
  function generateKey() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const block = function () {
      let s = '';
      for (let i = 0; i < 4; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
      return s;
    };
    const accounts = loadAccounts();
    let candidate;
    do {
      candidate = 'RG-' + block() + '-' + block() + '-' + block() + '-' + block();
    } while (accounts[candidate]);
    return candidate;
  }

  /**
   * Канонічний вигляд пароля/ключа або '' , якщо такий не прийнятний.
   * Згенеровані клюги приводяться до верхнього регістру, щоб
   * «rg-aaaa-…» і «RG-AAAA-…» були одним акаунтом; власні паролі
   * лишаються з тим регістром, який написав користувач.
   */
  function canonSecret(raw) {
    let s = formatSecret(raw);
    if (!s) return '';
    if (KEY_FORMAT.test(s.toUpperCase())) s = s.toUpperCase();
    if (s.length < SECRET_MIN) return '';
    if (RESERVED_SECRETS.indexOf(s.toLowerCase()) !== -1) return '';
    return s;
  }

  function accountExists(rawKey) {
    const key = canonSecret(rawKey);
    if (!key) return false;
    return !!loadAccounts()[key] || !!DEMO_KEYS[key];
  }

  /**
   * Реєстрація нового акаунта. Пароль може бути будь-яким — від «дракон»
   * до згенерованого RG-XXXX-XXXX-XXXX-XXXX. Якщо порожньо, ключ
   * генерується. Акаунт одразу пишеться у сховище браузера, тому наступного
   * разу можна увійти тим самим паролем.
   */
  function register(rawKey, name) {
    const typed = formatSecret(rawKey);
    const key = typed ? canonSecret(typed) : generateKey();

    if (!key) {
      return { ok: false, error: typed
        ? 'Пароль задовгий або зарезервований — мінімум ' + SECRET_MIN + ' символи'
        : 'Не вдалося згенерувати ключ' };
    }
    if (DEMO_KEYS[key]) {
      return { ok: false, error: 'Цей ключ демонстраційний — увійдіть ним у вкладці «Увійти»' };
    }
    if (loadAccounts()[key]) {
      return { ok: false, error: 'Такий пароль уже зайнятий — увійдіть ним або придумайте інший' };
    }
    if (!String(name || '').trim()) {
      return { ok: false, error: 'Вкажіть ім’я акаунта' };
    }

    const account = createAccount(key, name);
    write(K.session, key);
    return { ok: true, account: account, isNew: true };
  }

  /** Список акаунтів, збережених у цьому браузері. */
  function listAccounts() {
    const accounts = loadAccounts();
    return Object.keys(accounts)
      .map(function (k) {
        return {
          key: k,
          name: accounts[k].name,
          avatar: accounts[k].avatar || '',
          createdAt: accounts[k].createdAt
        };
      })
      .sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
  }

  /* --------------------------- таблиця лідерів --------------------------- */

  /** Межі доби у мілісекундах. offset 0 = сьогодні, 1 = вчора, 2 = позавчора. */
  function dayBounds(offset) {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (offset || 0));
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
    return { start: start.getTime(), end: end.getTime(), date: start };
  }

  function dayLabel(offset) {
    const d = dayBounds(offset).date;
    if (!offset) return 'сьогодні';
    if (offset === 1) return 'вчора';
    try {
      return d.toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit' });
    } catch (e) {
      return String(offset) + ' дн. тому';
    }
  }

  /**
   * Денна таблиця лідерів: хто скільки «вибив» за добу.
   * Рахується з історії операцій усіх акаунтів цього браузера —
   * won = усі надходження, spent = усі витрати, net = підсумок.
   */
  function leaderboard(offset) {
    const span = dayBounds(offset);
    const accounts = loadAccounts();

    const rows = Object.keys(accounts).map(function (k) {
      const a = accounts[k];
      let won = 0, spent = 0, wins = 0, plays = 0;

      (a.history || []).forEach(function (h) {
        const t = Number(h.at) || 0;
        if (t < span.start || t >= span.end) return;
        plays++;
        const amt = Number(h.amount) || 0;
        if (amt > 0) { won += amt; if (h.type === 'upgrade') wins++; }
        else if (amt < 0) spent -= amt;
      });

      return {
        key: k,
        name: a.name || 'Без імені',
        avatar: a.avatar || '',
        won: won,
        spent: spent,
        net: won - spent,
        wins: wins,
        plays: plays,
        balance: Number(a.balance) || 0,
        items: (a.inventory || []).length,
        createdAt: a.createdAt || 0
      };
    });

    /* спершу за вибитим, потім за підсумком, потім за балансом */
    rows.sort(function (x, y) {
      if (y.won !== x.won) return y.won - x.won;
      if (y.net !== x.net) return y.net - x.net;
      if (y.balance !== x.balance) return y.balance - x.balance;
      return y.createdAt - x.createdAt;
    });

    return rows;
  }

  /** Коротко: скільки акаунтів узагалі і скільки активних цього дня. */
  function leaderboardSummary(offset) {
    const rows = leaderboard(offset);
    let total = 0;
    rows.forEach(function (r) { total += r.won; });
    return {
      rows: rows,
      total: total,
      active: rows.filter(function (r) { return r.plays > 0; }).length,
      players: rows.length
    };
  }

  /* -------------------------------- аватар -------------------------------- */

  /* Аватар лежить у тому ж localStorage, що й акаунт, тому картинку
     доводиться зменшити: сире фото на 5 МБ у сховище не влізе.
     160×160 JPEG — це приблизно 20–40 КБ, а виглядає добре і в шапці,
     і в таблиці лідерів. */
  const AVATAR_SIZE     = 160;            // сторона квадрата у пікселях
  const AVATAR_IN_MAX   = 8 * 1024 * 1024;  // межа для файлу, який обрав користувач
  const AVATAR_OUT_MAX  = 120 * 1024;       // межа для рядка, який пишемо в сховище
  const AVATAR_STORE_MAX = 400 * 1024;      // вища межа, вище якої точно не зберігаємо

  /**
   * Обрізає фото по центру в квадрат і стискає в JPEG → рядок data:,
   * який можна покласти в localStorage. Повертає Promise.
   *
   * Картинку читаємо через FileReader (а не blob:), щоб полотно
   * не вважалося «підмішаним» — інакше toDataURL у браузері
   * віддає порожній рядок навіть на file://.
   */
  function makeAvatar(file) {
    return new Promise(function (resolve, reject) {
      if (!file) return reject(new Error('Файл не вибрано'));
      if (file.type && file.type.indexOf('image/') !== 0) {
        return reject(new Error('Це має бути картинка: png, jpg, webp або gif'));
      }
      if (file.size > AVATAR_IN_MAX) {
        return reject(new Error('Файл завеликий — максимум 8 МБ'));
      }

      const reader = new FileReader();

      reader.onerror = function () { reject(new Error('Не вдалося прочитати файл')); };
      reader.onload = function () {
        const img = new Image();
        img.onerror = function () { reject(new Error('Не вдалося відкрити картинку')); };
        img.onload = function () {
          const w = img.naturalWidth || img.width;
          const h = img.naturalHeight || img.height;
          if (!w || !h) return reject(new Error('Картинка без розміру'));

          const cv = document.createElement('canvas');
          cv.width = cv.height = AVATAR_SIZE;
          const ctx = cv.getContext && cv.getContext('2d');
          if (!ctx) return reject(new Error('Браузер не дозволив обробити картинку'));

          /* cover: з прямокутника беремо центровий квадрат */
          const side = Math.min(w, h);
          ctx.imageSmoothingEnabled = true;
          if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, (w - side) / 2, (h - side) / 2, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);

          /* спершу пробуємо добру якість, потім знижуємо, поки влізе у сховище */
          const steps = [0.86, 0.72, 0.58, 0.44, 0.32];
          let out = '';
          for (let i = 0; i < steps.length; i++) {
            try {
              out = cv.toDataURL('image/jpeg', steps[i]);
            } catch (e) {
              return reject(new Error('Браузер заблокував збереження картинки'));
            }
            if (out.length <= AVATAR_OUT_MAX) break;
          }
          if (out.indexOf('data:image/') !== 0) {
            return reject(new Error('Браузер не зміг перетворити картинку на JPEG'));
          }
          resolve(out);
        };
        img.src = reader.result;
      };

      reader.readAsDataURL(file);
    });
  }

  /**
   * Записує аватар у акаунт. '' — прибрати. Перевіряємо результат
   * повторним читанням: localStorage може бути переповнений, а write()
   * ковтає помилку, і тоді аватар здався б збереженим, хоч не збережено.
   */
  function setAvatar(dataUrl) {
    const account = getAccount();
    if (!account) return { ok: false, error: 'Потрібно увійти в акаунт' };

    const value = String(dataUrl || '');
    if (value && value.length > AVATAR_STORE_MAX) {
      return { ok: false, error: 'Картинка завелика — оберіть файл меншого розміру' };
    }

    const previous = account.avatar || '';
    const accounts = loadAccounts();
    account.avatar = value;
    accounts[account.key] = account;
    saveAccounts(accounts);

    const saved = loadAccounts()[account.key];
    if (!saved || saved.avatar !== value) {
      /* відкочуємо, щоб не лишити акаунт у напівзаписаному стані */
      account.avatar = previous;
      const back = loadAccounts();
      back[account.key] = account;
      saveAccounts(back);
      return {
        ok: false,
        error: 'Браузер не зміг зберегти картинку — сховище переповнене. Скиньте інший аватар або видаліть предмети з інвентаря.'
      };
    }

    return { ok: true, avatar: value, bytes: value.length };
  }

  function clearAvatar() { return setAvatar(''); }

  /* ------------------------------- сесія --------------------------------- */

  /**
   * Ключ активної сесії. Значення зберігається як JSON, тож стара або
   * пошкоджена сесія може лишатися з лапками навколо ключа — тоді
   * getAccount() не знаходить акаунт і сайт «забуває» вхід. Тому
   * читаємо через canonSecret і одразу перезаписуємо виправлене значення.
   */
  function getSessionKey() {
    const raw = read(K.session, null);
    if (typeof raw !== 'string' || !raw) return null;
    const key = canonSecret(raw);
    if (key && key !== raw) write(K.session, key);
    return key || null;
  }

  function getAccount() {
    const key = getSessionKey();
    if (!key) return null;
    const accounts = loadAccounts();
    return accounts[key] || null;
  }

  function login(rawKey) {
    const key = canonSecret(rawKey);
    if (!key) {
      return { ok: false, error: 'Введіть пароль або ключ — щонайменше ' + SECRET_MIN + ' символи' };
    }

    const accounts = loadAccounts();
    if (accounts[key]) {
      write(K.session, key);
      return { ok: true, account: accounts[key], isNew: false };
    }

    /* Невірний пароль не створює акаунт мовчки — інакше помилка в
       великій літері тихо подарувала б порожній акаунт. Створення
       можливе лише для згенерованого ключа вигляду RG-XXXX-... або
       через вкладку «Створити акаунт». */
    if (!KEY_FORMAT.test(key)) {
      return { ok: false, error: 'Пароль не підходить. Якщо це новий акаунт — створіть його у вкладці «Створити акаунт»' };
    }

    const account = createAccount(key);
    write(K.session, key);
    return { ok: true, account: account, isNew: true };
  }

  function logout() { localStorage.removeItem(K.session); }

  function rename(name) {
    const account = getAccount();
    if (!account) return false;
    account.name = String(name || '').trim().slice(0, 24) || account.name;
    const accounts = loadAccounts();
    accounts[account.key] = account;
    saveAccounts(accounts);
    return true;
  }

  /* --------------------------- транзакції -------------------------------- */

  function mutate(fn) {
    const account = getAccount();
    if (!account) return { ok: false, error: 'Потрібно увійти за ключем' };

    const result = fn(account) || {};
    if (result.error) return { ok: false, error: result.error };

    const accounts = loadAccounts();
    accounts[account.key] = account;
    saveAccounts(accounts);

    return Object.assign({ ok: true, account: account }, result);
  }

  function pushHistory(account, entry) {
    entry.uid = uid('h');
    entry.at = Date.now();
    account.history.unshift(entry);
    account.history = account.history.slice(0, 50);
  }

  /* ------------------------------ промокоди ------------------------------- */

  /** Вбудовані + створені в адмінці. */
  function allPromoCodes() {
    const custom = read(K.promos, {});
    return Object.assign({}, PROMO_CODES, custom);
  }

  /**
   * Активація промокоду.
   * Назва коду ніде не показується — користувач сам вводить його.
   */
  function redeemPromo(rawCode) {
    const code = String(rawCode || '').toUpperCase().replace(/[^A-Z0-9]/g, '').trim();

    if (!code) return { ok: false, error: 'Введіть промокод' };

    const all = allPromoCodes();
    const promo = all[code];

    if (!promo) return { ok: false, error: 'Промокод не знайдено' };
    if (promo.active === false) return { ok: false, error: 'Промокод більше не активний' };

    const result = mutate(function (account) {
      const once = promo.oncePerAccount !== false;
      if (once && account.redemptions[code]) {
        return { error: 'Цей промокод вже активовано на цьому акаунті' };
      }

      account.balance += promo.reward;
      account.redemptions[code] = { at: Date.now(), reward: promo.reward };

      pushHistory(account, {
        type: 'promo',
        title: 'Активація промокоду',
        detail: 'Нараховано ' + formatMoney(promo.reward),
        amount: promo.reward
      });

      return {
        reward: promo.reward,
        message: 'Активація успішна — нараховано ' + formatMoney(promo.reward)
      };
    });

    return result;
  }

  /* --------------------------- бонус за відео --------------------------- */

  /**
   * Стан нагород за ролики: кожен ролик можна забрати один раз на
   * акаунт. ready — скільки ще можна отримати.
   */
  function videoBonus() {
    const account = getAccount();
    const def = D.VIDEO_BONUS || { amount: 0, videos: [] };
    const taken = (account && account.videoBonuses) || {};
    const list = (def.videos || []).map(function (v) {
      return {
        id: v.id,
        title: v.title || 'Ролик',
        url: v.url,
        done: !!taken[v.id]
      };
    });
    return {
      amount: def.amount,
      videos: list,
      ready: list.filter(function (v) { return !v.done; }).length,
      earned: list.reduce(function (s, v) { return s + (v.done ? def.amount : 0); }, 0)
    };
  }

  /** Забрати нагороду за конкретний ролик. */
  function claimVideoBonus(videoId) {
    const def = D.VIDEO_BONUS || { amount: 0, videos: [] };
    const video = (def.videos || []).find(function (v) { return v.id === videoId; });
    if (!video) return { ok: false, error: 'Ролик не знайдено' };
    if (!def.amount) return { ok: false, error: 'Нагорода не налаштована' };

    return mutate(function (account) {
      account.videoBonuses = account.videoBonuses || {};
      if (account.videoBonuses[videoId]) {
        return { error: 'Нагороду за цей ролик уже отримано' };
      }
      account.videoBonuses[videoId] = { at: Date.now(), reward: def.amount };
      account.balance += def.amount;
      pushHistory(account, {
        type: 'video',
        title: 'Бонус за ролик',
        detail: video.title || 'Ролик',
        amount: def.amount
      });
      return {
        reward: def.amount,
        message: 'Нараховано ' + formatMoney(def.amount) + ' за перегляд'
      };
    });
  }

  function isPromoRedeemed(code) {
    const account = getAccount();
    return !!(account && account.redemptions && account.redemptions[code]);
  }

  /**
   * Маска промокоду для показу. Промокод не повинен з’являтися аніде
   * повністю — навіть у власному гаманці видно тільки першу літеру,
   * а довжина теж приховується (стала кількість крапок).
   */
  function maskPromoCode(code) {
    const s = String(code || '');
    return s ? s.slice(0, 1) + '•••••' : '';
  }

  /**
   * Активовані промокоди акаунта. Повертаємо саму маску: сирий код
   * сторінці не дістається, тож випадково його не показує.
   */
  function redeemedPromos() {
    const account = getAccount();
    const map = (account && account.redemptions) || {};
    return Object.keys(map).map(function (code) {
      return { mask: maskPromoCode(code), at: map[code].at, reward: map[code].reward };
    });
  }

  /* --------------------------- адмінка промокодів ------------------------ */

  /** Генерація випадкового коду. */
  function randomCode(len) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // без I, O, 0, 1
    const n = len || 8;
    let out = '';
    const buf = new Uint8Array(n);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(buf);
    for (let i = 0; i < n; i++) out += chars[buf[i] % chars.length];
    return out;
  }

  /** Створює промокод. limitPerAccount = 1 → один раз на акаунт. */
  function createPromoCode(opts) {
    const custom = read(K.promos, {});
    const reward = Math.max(0, Math.round(Number(opts.reward) || 0));
    if (!reward) return { ok: false, error: 'Вкажи суму нагороди' };

    let code = String(opts.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!code) code = randomCode(opts.length || 8);

    if (allPromoCodes()[code]) return { ok: false, error: 'Такий код уже існує' };

    custom[code] = {
      code: code,
      reward: reward,
      oncePerAccount: opts.oncePerAccount !== false,
      active: true,
      createdAt: Date.now(),
      note: opts.note || '',
      uses: 0
    };
    write(K.promos, custom);
    return { ok: true, code: code, promo: custom[code] };
  }

  function deletePromoCode(code) {
    const custom = read(K.promos, {});
    delete custom[code];
    write(K.promos, custom);
  }

  function listCustomPromos() {
    const custom = read(K.promos, {});
    return Object.keys(custom).map(function (k) { return custom[k]; })
      .sort(function (a, b) { return b.createdAt - a.createdAt; });
  }

  /* ------------------------------ інвентар ------------------------------- */

  function getInventory() {
    const account = getAccount();
    if (!account) return [];
    return account.inventory
      .map(function (inst) {
        return {
          uid: inst.uid,
          itemId: inst.itemId,
          acquiredAt: inst.acquiredAt,
          source: inst.source,
          item: ITEM_BY_ID[inst.itemId]
        };
      })
      .filter(function (inst) { return !!inst.item; })
      .sort(function (a, b) { return b.item.price - a.item.price; });
  }

  function inventoryHas(itemId) {
    return getInventory().some(function (i) { return i.itemId === itemId; });
  }

  /* ------------------------------- покупка ------------------------------- */

  function buyItem(itemId, qty) {
    qty = qty || 1;
    const item = ITEM_BY_ID[itemId];
    if (!item) return { ok: false, error: 'Предмет не знайдено' };
    const cost = item.price * qty;

    return mutate(function (account) {
      if (account.balance < cost) {
        return { error: 'Недостатньо коштів. Потрібно ' + formatMoney(cost) };
      }
      account.balance -= cost;
      for (let i = 0; i < qty; i++) {
        account.inventory.push({ uid: uid('i'), itemId: itemId, acquiredAt: Date.now(), source: 'market' });
      }
      pushHistory(account, {
        type: 'buy',
        title: 'Куплено ' + item.name,
        detail: RARITY_NAME(item.rarity),
        amount: -cost
      });
      return { message: 'Придбано ' + item.name + (qty > 1 ? ' × ' + qty : '') };
    });
  }

  /* -------------------------------- продаж ------------------------------- */

  function sellItem(instanceUid) {
    return mutate(function (account) {
      const idx = account.inventory.findIndex(function (i) { return i.uid === instanceUid; });
      if (idx === -1) return { error: 'Предмет не знайдено в інвентарі' };

      const item = ITEM_BY_ID[account.inventory[idx].itemId];
      if (!item) return { error: 'Предмет не знайдено' };

      const price = Math.floor(item.price * 0.9); // комісія 10%

      account.inventory.splice(idx, 1);
      account.balance += price;

      pushHistory(account, {
        type: 'sell',
        title: 'Продано ' + item.name,
        detail: 'Комісія 10%',
        amount: price
      });

      return { message: 'Продано за ' + formatMoney(price), price: price };
    });
  }

  /* ------------------------------- апгрейд ------------------------------- */

  function upgradeOdds(fromPrice, toPrice) {
    if (!(toPrice > fromPrice)) return 0;
    const raw = Math.pow(fromPrice / toPrice, 0.62);
    return Math.min(0.9, Math.max(0.03, raw));
  }

  /**
   * @param {boolean|null} forcedWin null -> бросок випадковості сам.
   *        Колесо передає сюди той сектор, на якому зупинилося,
   *        тому картинка і результат завжди збігаються.
   */
  function upgradeItem(instanceUid, targetItemId, forcedWin) {
    const target = ITEM_BY_ID[targetItemId];
    if (!target) return { ok: false, error: 'Цільовий предмет не знайдено' };

    return mutate(function (account) {
      const idx = account.inventory.findIndex(function (i) { return i.uid === instanceUid; });
      if (idx === -1) return { error: 'Предмет не знайдено в інвентарі' };

      const source = ITEM_BY_ID[account.inventory[idx].itemId];
      if (!source) return { error: 'Предмет не знайдено' };
      if (target.price <= source.price) {
        return { error: 'Цільовий предмет має бути дорожчим за вихідний' };
      }

      const cost = target.price - source.price;
      if (account.balance < cost) {
        return { error: 'Недостатньо коштів для доплати. Потрібно ' + formatMoney(cost) };
      }

      const odds = upgradeOdds(source.price, target.price);
      const win = (forcedWin === null || forcedWin === undefined) ? Math.random() < odds : !!forcedWin;
      let won = null;

      account.balance -= cost;
      account.inventory.splice(idx, 1);

      if (win) {
        won = { uid: uid('i'), itemId: target.id, acquiredAt: Date.now(), source: 'upgrade' };
        account.inventory.push(won);
      }

      pushHistory(account, {
        type: 'upgrade',
        title: source.name + ' → ' + target.name,
        detail: (win ? 'Успіх' : 'Провал') + ' · шанс ' + (odds * 100).toFixed(1) + '%',
        amount: -cost,
        win: win
      });

      return {
        win: win,
        odds: odds,
        cost: cost,
        source: source,
        target: win ? target : null,
        instance: won,
        message: win
          ? 'Апгрейд успішний — отримано ' + target.name
          : 'Апгрейд не вдався — ' + source.name + ' втрачено'
      };
    });
  }

  /* -------------------------------- баланс -------------------------------- */

  function deposit(amount) {
    amount = amount || 100000;
    return mutate(function (account) {
      account.balance += amount;
      pushHistory(account, { type: 'deposit', title: 'Поповнення балансу', detail: 'Демо-операція', amount: amount });
      return { message: 'Баланс поповнено на ' + formatMoney(amount) };
    });
  }

  function resetAccount() {
    const account = getAccount();
    if (!account) return;
    const accounts = loadAccounts();
    delete accounts[account.key];
    saveAccounts(accounts);
    logout();
  }

  function RARITY_NAME(r) {
    return (D.RARITIES[r] || D.RARITIES.common).name;
  }

  /* ------------------------------- адмінка --------------------------------- */

  /** Чи в акаунта є права адміністратора (список ключів — у data.js). */
  function isAdmin(account) {
    const a = account === undefined ? getAccount() : account;
    return !!(a && (D.ADMIN_KEYS || []).indexOf(a.key) !== -1);
  }

  /** Список усіх акаунтів браузера — для панелі адміністратора. */
  function adminAccounts() {
    const accounts = loadAccounts();
    return Object.keys(accounts).map(function (k) {
      const a = accounts[k];
      const hist = a.history || [];
      return {
        key: k,
        name: a.name,
        balance: Number(a.balance) || 0,
        createdAt: a.createdAt,
        avatar: a.avatar || '',
        eggs: Object.keys(a.eggs || {}).map(function (id) {
          const e = a.eggs[id] || {};
          return { id: id, at: e.at || 0, reward: Number(e.reward) || 0 };
        }),
        plays: hist.filter(function (h) { return h.type === 'upgrade'; }).length,
        wins: hist.filter(function (h) { return h.type === 'upgrade' && h.win; }).length
      };
    }).sort(function (x, y) { return y.createdAt - x.createdAt; });
  }

  /** Дописує запис в історію акаунта, який зараз не в сесії. */
  function writeHistoryFor(key, entry) {
    const accounts = loadAccounts();
    if (!accounts[key]) return;
    accounts[key].history = accounts[key].history || [];
    pushHistory(accounts[key], entry);
    saveAccounts(accounts);
  }

  /** Нарахувати або зняти TX конкретному гравцеві. */
  function adminCredit(key, amount, note) {
    const value = Math.round(Number(amount) || 0);
    if (!value) return { ok: false, error: 'Вкажіть суму' };
    const accounts = loadAccounts();
    if (!accounts[key]) return { ok: false, error: 'Акаунт не знайдено' };

    accounts[key].balance = Math.max(0, (Number(accounts[key].balance) || 0) + value);
    saveAccounts(accounts);
    writeHistoryFor(key, {
      type: 'admin',
      title: value > 0 ? 'Нараховано від автора' : 'Списано від автора',
      detail: (note || '').trim().slice(0, 80),
      amount: value
    });

    return {
      ok: true,
      balance: accounts[key].balance,
      message: (value > 0 ? 'Нараховано ' : 'Списано ') + formatMoney(Math.abs(value)) +
        ' — ' + accounts[key].name + '. Баланс: ' + formatMoney(accounts[key].balance)
    };
  }

  /* ------------------------------ пасхалки -------------------------------- */

  /** Знайдені пасхалки поточного акаунта. */
  function foundEggs() {
    const account = getAccount();
    return Object.keys((account && account.eggs) || {});
  }

  /**
   * Відмітити пасхалок. first — знайдено вперше, тож можна
   * привітати гравця. Повторно не рахуємо.
   */
  function findEgg(id) {
    const def = (D.EASTER_EGGS || []).find(function (e) { return e.id === id; });
    if (!def) return { ok: false };

    const reward = Number(def.reward) || 0;
    const result = mutate(function (account) {
      account.eggs = account.eggs || {};
      if (account.eggs[id]) return { error: 'duplicate' };
      account.eggs[id] = { at: Date.now(), reward: reward };
      account.balance += reward;
      pushHistory(account, {
        type: 'egg',
        title: 'Знайдено пасхалок',
        detail: def.hint,
        amount: reward
      });
      return { id: id, reward: reward };
    });

    if (result.ok) {
      return { ok: true, first: true, reward: reward, total: foundEggs().length };
    }
    return { ok: false, already: true };
  }

  RG.store = {
    CURRENCY: CUR,
    formatNumber: formatNumber,
    formatMoney: formatMoney,

    isAdmin: isAdmin,
    adminAccounts: adminAccounts,
    adminCredit: adminCredit,
    findEgg: findEgg,
    foundEggs: foundEggs,

    getSessionKey: getSessionKey,
    getAccount: getAccount,
    login: login,
    register: register,
    generateKey: generateKey,
    leaderboard: leaderboard,
    leaderboardSummary: leaderboardSummary,
    dayBounds: dayBounds,
    dayLabel: dayLabel,
    makeAvatar: makeAvatar,
    setAvatar: setAvatar,
    clearAvatar: clearAvatar,
    AVATAR_SIZE: AVATAR_SIZE,
    accountExists: accountExists,
    listAccounts: listAccounts,
    logout: logout,
    rename: rename,

    redeemPromo: redeemPromo,
    isPromoRedeemed: isPromoRedeemed,
    redeemedPromos: redeemedPromos,
    videoBonus: videoBonus,
    claimVideoBonus: claimVideoBonus,
    allPromoCodes: allPromoCodes,
    createPromoCode: createPromoCode,
    deletePromoCode: deletePromoCode,
    listCustomPromos: listCustomPromos,
    randomCode: randomCode,

    getInventory: getInventory,
    inventoryHas: inventoryHas,
    buyItem: buyItem,
    sellItem: sellItem,
    upgradeItem: upgradeItem,
    upgradeOdds: upgradeOdds,

    deposit: deposit,
    resetAccount: resetAccount
  };
})(window.RG = window.RG || {});
