/* ==========================================================================
   data.js — валюта, рідкості, категорії, промокоди, демо-ключі

   КАТАЛОГ предметів НЕ будується в цьому файсі. Він приходить із
   assets/data/catalog.js — це справжні предмети Rust зі Steam Community
   Market (appid 252490): реальні назви, реальні ринкові ціни, реальні
   іконки скінів у assets/img/skins/.

   Формат запису в RG.CATALOG_RAW (короткий, щоб файл був легким):
     [ id, назва, ціна_у_USD, категорія, рідкість, колір_тла, пропозицій ]
   де id — це ім'я файлу іконки без розширення (hash з Steam CDN).
   ========================================================================== */
(function (RG) {
  'use strict';

  /* ------------------------------- валюта -------------------------------- */

  /** Єдине місце, де міняється назва валюти — вона підставляється всюди. */
  const CURRENCY = {
    code: 'TX',                 // тікен, показується поруч із сумою
    name: 'TX',                 // повна назва для підписів
    decimals: 0
  };

  /**
   * Курс: 1 USD = 10 000 TX.
   * Справжня ціна предмета — у доларах, вона ж стає ціною в ігровій валюті.
   * Наприклад $10.09 -> 100 900 TX.
   */
  const USD_RATE = 10000;

  /**
   * Стартовий баланс нового акаунту. Без нього свіжий гравець не може
   * жодного разу покрутити колесо — іsite виглядає зламаним. 10 000 TX
   * вистачає на кілька спроб із найдешевших скінів ($0.47 — $0.70).
   * Решту грошей — промокод (25 000) і ролики (5 000 кожен).
   */
  const START_BALANCE = 10000;

  /* ------------------------------ рідкості -------------------------------- */
  /* Рідкість визначається за справжньою ринковою ціною, див. rarityFor(). */

  const RARITIES = {
    common:    { id: 'common',    name: 'Звичайний',   short: 'Common',    color: '#939893' },
    uncommon:  { id: 'uncommon',  name: 'Непоширений', short: 'Uncommon',  color: '#5d9c4a' },
    rare:      { id: 'rare',      name: 'Рідкісний',   short: 'Rare',      color: '#467edf' },
    unusual:   { id: 'unusual',   name: 'Незвичайний', short: 'Unusual',   color: '#ae6eee' },
    epic:      { id: 'epic',      name: 'Епічний',     short: 'Epic',      color: '#b43ec8' },
    legendary: { id: 'legendary', name: 'Легендарний', short: 'Legendary', color: '#ffdd59' },
    exotic:    { id: 'exotic',    name: 'Екзотичний',  short: 'Exotic',    color: '#ff8a3d' }
  };

  const RARITY_ORDER = ['common', 'uncommon', 'rare', 'unusual', 'epic', 'legendary', 'exotic'];

  /** Межі рідкості за реальною ціною в USD. */
  const RARITY_BY_USD = [0.30, 1, 5, 20, 75, 250];

  function rarityFor(usd) {
    for (let i = 0; i < RARITY_BY_USD.length; i++) {
      if (usd < RARITY_BY_USD[i]) return RARITY_ORDER[i];
    }
    return 'exotic';
  }

  /* ----------------------------- категорії -------------------------------- */

  const CATEGORIES = [
    { id: 'rifle',      name: 'Автомати' },
    { id: 'smg',        name: 'ПП' },
    { id: 'shotgun',    name: 'Дробовики' },
    { id: 'sniper',     name: 'Снайперські' },
    { id: 'pistol',     name: 'Пістолети' },
    { id: 'bow',        name: 'Луки' },
    { id: 'melee',      name: 'Ближній бій' },
    { id: 'armor',      name: 'Захист' },
    { id: 'clothing',   name: 'Одяг' },
    { id: 'vehicle',    name: 'Транспорт' },
    { id: 'deployable', name: 'Розкладні' },
    { id: 'resource',   name: 'Ресурси' },
    { id: 'misc',       name: 'Інше' }
  ];

  const ICON_BY_CAT = {
    rifle: 'rifle', smg: 'smg', shotgun: 'shotgun', sniper: 'sniper',
    pistol: 'pistol', bow: 'bow', melee: 'melee', armor: 'vest',
    clothing: 'clothing', vehicle: 'vehicle', deployable: 'box',
    resource: 'resource', misc: 'misc'
  };

  const IMG_DIR = './assets/img/skins/';
  const IMG_EXT = '.jpg';

  /* ------------------------------- каталог -------------------------------- */

  const RAW = Array.isArray(RG.CATALOG_RAW) ? RG.CATALOG_RAW : [];

  const ITEMS = RAW.map(function (r) {
    const usd = r[2];
    return {
      id: r[0],
      name: r[1],
      usd: usd,
      price: Math.round(usd * USD_RATE),
      cat: r[3],
      rarity: r[4] || rarityFor(usd),
      icon: ICON_BY_CAT[r[3]] || 'misc',
      bg: r[5] || '161616',
      listings: r[6] || 0,      // кількість пропозицій на Steam Market
      img: IMG_DIR + r[0] + IMG_EXT,
      // реальні дані з Steam Community Market
      real: true
    };
  });

  const ITEM_BY_ID = Object.create(null);
  for (let i = 0; i < ITEMS.length; i++) ITEM_BY_ID[ITEMS[i].id] = ITEMS[i];

  /**
   * Ручне перекриття цін: { 'id предмета': ціна_у_TX }.
   * Потрібне лише якщо хочеш відірвати ціни від Steam Market.
   */
  const REAL_PRICES = {};
  for (const id in REAL_PRICES) {
    if (ITEM_BY_ID[id]) ITEM_BY_ID[id].price = REAL_PRICES[id];
  }

  /* ------------------------------ промокоди ------------------------------- */

  const PROMO_REWARD = 25000;

  /** Вбудований промокод. Назва НІКОМУ не показується — лише введення. */
  const PROMO_CODES = {
    TEROX: {
      code: 'TEROX',
      reward: PROMO_REWARD,
      oncePerAccount: true,
      active: true,
      builtIn: true
    }
  };

  /* ------------------------------- ключі ---------------------------------- */

  /* Тестових акаунтів немає — перед деплоєм вони непотрібні: у кожного
     у кожного були мільйони вигаданих грошей, які ніхто не заробив.

     Якщо треба знову (наприклад, щоб показати гостям), додайте рядок:
       'RG-XXXX-XXXX-XXXX-XXXX': { name: 'Гість', balance: 0 }
     або просто зареєструйте акаунт через вкладку «Створити акаунт». */
  const DEMO_KEYS = {};

  /* Згенерований ключ має вигляд RG-XXXX-XXXX-XXXX-XXXX, але це лише
     один із способів увійти: користувач може задати будь-який власний
     пароль, хоча «дракон», хоча «12345». */
  const KEY_FORMAT = /^RG-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;
  const SECRET_MIN = 3;
  const SECRET_MAX = 32;
  /* ці слова не можна використати як пароль — вони ламають об'єкт сховища */
  const RESERVED_SECRETS = ['__proto__', 'prototype', 'constructor'];

  function formatKey(raw) {
    const clean = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);
    if (!clean) return '';
    return 'RG-' + (clean.match(/.{1,4}/g) || []).join('-');
  }

  /** Канонічний вигляд пароля: без краївніх пробілів, внутрішні пробіли
      згорнуті в один, довжина обмежена. Регістр зберігається.
      Лапки на краях знімаються — їх часто лишається при копіюванні
      ключа з JSON або з чату, і через них вхід «зникав». */
  function formatSecret(raw) {
    let s = String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim();
    for (let i = 0; i < 2; i++) {
      if (s.length > 1 && (s[0] === '"' || s[0] === "'") && s[s.length - 1] === s[0]) {
        s = s.slice(1, -1).trim();
      }
    }
    return s.slice(0, SECRET_MAX);
  }

  /* --------------------------- допоміжне ---------------------------------- */

  function byCat(cat) {
    return ITEMS.filter(function (i) { return i.cat === cat; });
  }

  function cheapest(n) {
    return ITEMS.slice().sort(function (a, b) { return a.price - b.price; }).slice(0, n);
  }

  function priciest(n) {
    return ITEMS.slice().sort(function (a, b) { return b.price - a.price; }).slice(0, n);
  }

  /* --------------------------- бонус за відео --------------------------- */

  /**
   * Нагорода за перегляд ролика. Один ролик — одна нагорода на акаунт,
   * тому суму можна підняти, додавши нові ролики у `videos`.
   * Поки список порожній — картка з бонусом ховається.
   */
  const VIDEO_BONUS = {
    amount: 5000,
    perAccount: true,
    videos: [
      { id: 'v1', title: 'TEROXX', url: 'https://www.tiktok.com/@teroxx303/photo/7690488948254100756' },
      { id: 'v2', title: 'TEROXX', url: 'https://www.tiktok.com/@teroxx303/video/7688809696391597333' },
      { id: 'v3', title: 'JI Neu', url: 'https://www.tiktok.com/@jineujerkin/video/7556979247051443467' },
      { id: 'v4', title: 'EVAKA', url: 'https://www.tiktok.com/@evaka115/video/7633759705881529620' }
    ]
  };

  /* ------------------------------- пасхалки ------------------------------- */

  /**
   * Приховані скарби. Кожен пасхалок має підказку — її видно тільки вам
   * в адмінці. Знайдений пасхалок записується в акаунт і одразу
   * приносить EGG_REWARD, а далі ви можете нарахувати ще й своє.
   *
   * Щоб додати свій: допишіть рядок у `EASTER_EGGS` і викличте
   * S.findEgg('ваш-id') з будь-якого місця.
   */
  const EASTER_EGGS = [
    { id: 'logo',   reward: 1000, hint: 'Клікни по логотипу 7 разів підряд.' },
    { id: 'center', reward: 1000, hint: 'Клікни по центру колеса на апгрейді 10 разів.' },
    { id: 'tx',     reward: 1000, hint: 'Утримуй «TX» біля балансу три секунди.' }
  ];

  /**
   * Ключі з правом адміністратора. Тільки цей акаунт бачить панель
   * на #/admin: список гравців, нарахування TX і знайдені пасхалки.
   * Впишіть тут свій ключ доступу.
   */
  const ADMIN_KEYS = ['RG-QCUE-5YP3-Q93Y-R2MN'];

  RG.DATA = {
    CURRENCY: CURRENCY,
    USD_RATE: USD_RATE,
    START_BALANCE: START_BALANCE,
    RARITIES: RARITIES,
    RARITY_ORDER: RARITY_ORDER,
    rarityFor: rarityFor,
    CATEGORIES: CATEGORIES,
    ITEMS: ITEMS,
    ITEM_BY_ID: ITEM_BY_ID,
    byCat: byCat,
    cheapest: cheapest,
    priciest: priciest,
    PROMO_REWARD: PROMO_REWARD,
    PROMO_CODES: PROMO_CODES,
    VIDEO_BONUS: VIDEO_BONUS,
    EASTER_EGGS: EASTER_EGGS,
    ADMIN_KEYS: ADMIN_KEYS,
    DEMO_KEYS: DEMO_KEYS,
    KEY_FORMAT: KEY_FORMAT,
    SECRET_MIN: SECRET_MIN,
    SECRET_MAX: SECRET_MAX,
    RESERVED_SECRETS: RESERVED_SECRETS,
    formatKey: formatKey,
    formatSecret: formatSecret
  };
})(window.RG = window.RG || {});
