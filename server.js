/* ==========================================================================
   server.js — віддача сайту + спільний лідерборд

   Навіщо він, якщо сайт статичний: без сервера акаунт живе в одному
   браузері, і ніхто не бачить нічиєї статистики, крім своєї. Цей файл
   додає рівно дві речі поверх статики:

     GET  /api/board?day=0   -> усі гравці за обрану добу
     POST /api/report        -> гравець надсилає свій рядок

   Решта — звичайна роздача файлів із папки проєкту.

   Без залежностей: тільки вбудований модуль http, тому на Render не треба
   ні npm install, ані збірки. Запуск:  node server.js

   Безпека (коротко):
     * віддаються лише index.html і assets/ з дозволеним розширенням;
     * шлях нормалізується ДО перевірки, `..` і null-байти відсікаються;
     * CSP, nosniff, frame-ancestors, Referrer-Policy та інші заголовки;
     * ліміт тіла запиту, перевірка Content-Type та Origin;
     * rate limit на API і статику (щоб не покласти безкоштовний інстанс);
     * битий URL не валить процес — відповідаємо 400/404.
   ========================================================================== */
'use strict';

const http = require('http');
const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = __dirname;
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(ROOT, 'data');
const BOARD_FILE = path.join(DATA_DIR, 'board.json');

/* Render виставляє NODE_ENV=production і свої RENDER_* змінні. */
const IS_PROD = process.env.NODE_ENV === 'production' || !!process.env.RENDER;
/* Довіряти X-Forwarded-For можна лише за проксі (Render). Інакше клієнт
   підробить IP і обійде rate limit. */
const TRUST_PROXY = process.env.TRUST_PROXY === '1' || IS_PROD;

/** Скільки гравців і рядків тримаємо. Захист від підробки «1 млн гравців». */
const MAX_PLAYERS = 2000;         // на одну добу
const MAX_TOTAL_ROWS = 5000;      // на всі дні разом (обмежує розмір board.json)
const MAX_BODY    = 512 * 1024;   // 512 КБ: 40 рядків з аватарами
const MAX_AVATAR  = 6000;         // байти data-URL одного аватара
const MAX_ROWS    = 100;          // скільки рядків віддаємо в одній відповіді
const DAY_LIMIT   = 14;           // скільки днів зберігаємо

/* ---------------------------------------------------------------- сховище */

/* board = { "0": { pid: row, ... }, "1": { ... } }
   Ключ верхнього рівня — зсув від сьогодні (0 = сьогодні). */
let board = {};

function loadBoard() {
  try {
    const parsed = JSON.parse(fs.readFileSync(BOARD_FILE, 'utf8'));
    board = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (e) {
    board = {};
  }
}

let saveTimer = null;
function saveBoard() {
  /* Пишемо не на кожен запит, а раз на 2 секунди: інакше при
     десятках ігроків файл переписується надто часто. */
  if (saveTimer) return;
  saveTimer = setTimeout(function () {
    saveTimer = null;
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

      /* Пишемо в тимчасовий файл і перейменовуємо: якщо процес упаде
         посеред запису, board.json не залишиться обрізаним. */
      const tmp = BOARD_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(board));
      try {
        fs.renameSync(tmp, BOARD_FILE);
      } catch (e) {
        fs.writeFileSync(BOARD_FILE, JSON.stringify(board));
      }
    } catch (e) {
      console.error('board save failed:', e.message);
    }
  }, 2000);
}

function prune() {
  Object.keys(board).forEach(function (d) {
    if (!/^\d+$/.test(d) || Number(d) > DAY_LIMIT) delete board[d];
  });

  /* Глобальна стеля: спершу прибираємо найстаріші дні, сьогоднішній — останнім. */
  let total = 0;
  Object.keys(board).forEach(function (d) {
    total += Object.keys(board[d] || {}).length;
  });
  if (total <= MAX_TOTAL_ROWS) return;

  Object.keys(board)
    .map(Number)
    .sort(function (a, b) { return b - a; })
    .forEach(function (d) {
      if (total <= MAX_TOTAL_ROWS) return;
      const key = String(d);
      if (!board[key]) return;
      total -= Object.keys(board[key]).length;
      delete board[key];
    });
}

/* ------------------------------------------------------------- валідація */

/** Рядок гравця: лише потрібні поля, числа обрізаємо, рядки чистимо. */
function cleanRow(v) {
  if (!v || typeof v !== 'object') return null;

  const str = function (x, max) {
    return String(x == null ? '' : x).slice(0, max);
  };

  /**
   * Число з обмеженням.
   * `Number(null)` = 0, але `Number(NaN)` = NaN — а Math.min/max із NaN
   * повертають NaN, який потім у JSON перетворюється на `null`. Тому
   * спершу перевіряємо кінцевість.
   */
  const num = function (x, max) {
    const n = Math.round(Number(x));
    if (!Number.isFinite(n)) return 0;
    return Math.min(max, Math.max(-max, n));
  };
  /* Та сама обмеження, але нижня межа — нуль: підсумки й баланс не можуть
     бути від'ємними, інакше клієнт зміг би накрутити таблицю мінусами. */
  const pos = function (x, max) { return Math.max(0, num(x, max)); };

  const row = {
    name:    str(v.name, 24).replace(/[\u0000-\u001F\u007F]/g, '').trim() || 'Без імені',
    avatar:  str(v.avatar, MAX_AVATAR + 1),   // data-URL прев'ю; далі перевіряємо
    won:     pos(v.won, 1e12),
    spent:   pos(v.spent, 1e12),
    net:     num(v.net, 1e12),          // підсумок може бути від'ємним
    wins:    pos(v.wins, 1e6),
    plays:   pos(v.plays, 1e6),
    balance: pos(v.balance, 1e12),
    items:   pos(v.items, 1e6)
  };

  /* аватар — лише наш data-URL, і не більше MAX_AVATAR, щоб JSON не роздувався.
     SVG навмисно не приймаємо: у ньому можна сховати скрипт. */
  if (!/^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/.test(row.avatar) ||
      row.avatar.length > MAX_AVATAR) {
    row.avatar = '';
  }
  return row;
}

function dayOf(v) {
  const n = Math.round(Number(v) || 0);
  return Number.isFinite(n) && n >= 0 && n <= DAY_LIMIT ? n : 0;
}

function limitOf(v) {
  const n = Math.round(Number(v) || 0);
  if (!Number.isFinite(n) || n <= 0) return MAX_ROWS;
  return Math.min(MAX_ROWS, n);
}

/** Ім'я пристроя: випадкове, не пов'язане з паролем акаунта. */
function cleanPid(v) {
  const s = String(v == null ? '' : v);
  return /^[A-Za-z0-9_-]{8,64}$/.test(s) ? s : null;
}

/* ---------------------------------------------------------------- відповіді */

/**
 * Спільні заголовки безпеки. CSP зібраний під те, що реально є на сайті:
 * локальні скрипти/стилі, Google Fonts, data:-картинки (іконки й аватари).
 * Жодних inline-скриптів немає, тому script-src без 'unsafe-inline'.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self'",
  "media-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'"
].join('; ');

function securityHeaders() {
  const h = {
    'Content-Security-Policy': CSP,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin'
  };
  /* HSTS має сенс лише на HTTPS. На localhost його не шлемо, щоб браузер
     не почав вимагати https://localhost. */
  if (IS_PROD) h['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
  return h;
}

function sendJSON(res, code, obj, extra) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  const head = Object.assign({}, securityHeaders(), {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store'
  }, extra || {});
  res.writeHead(code, head);
  res.end(body);
}

function plain(res, code, text, extra) {
  const body = Buffer.from(String(text), 'utf8');
  const head = Object.assign({}, securityHeaders(), {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store'
  }, extra || {});
  res.writeHead(code, head);
  res.end(body);
}

function notFound(res) {
  plain(res, 404, '404');
}

/* ------------------------------------------------------------- rate limit */

const hits = new Map();

function clientIp(req) {
  if (TRUST_PROXY) {
    const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (xff) return xff;
  }
  return req.socket.remoteAddress || 'unknown';
}

/**
 * Простий ковзний лічильник у пам'яті. Для одного інстансу Render цього
 * достатньо; після рестарту ліміти скидаються — це нормально.
 */
function rateLimit(req, key, limit) {
  const now = Date.now();
  const id = key + '|' + clientIp(req);
  let b = hits.get(id);
  if (!b || now - b.start >= 60 * 1000) {
    b = { start: now, count: 0 };
    hits.set(id, b);
  }
  b.count++;
  return b.count <= limit;
}

/* Прибираємо старі записи, щоб Map не ріс безкінечно. */
setInterval(function () {
  const now = Date.now();
  hits.forEach(function (b, id) {
    if (now - b.start >= 2 * 60 * 1000) hits.delete(id);
  });
}, 60 * 1000).unref();

/** POST /api/report приймає лише same-origin JSON. Це відсікає CSRF. */
function sameOrigin(req) {
  if (req.headers['sec-fetch-site'] === 'cross-site') return false;

  const origin = req.headers.origin;
  if (!origin) return true;                 // curl, серверні клієнти
  try {
    return new URL(origin).host === req.headers.host;
  } catch (e) {
    return false;
  }
}

/** Список гравців за добу, відсортований як на сайті. */
function boardRows(day, limit) {
  const bucket = board[String(day)] || {};
  return Object.keys(bucket).map(function (pid) {
    const r = bucket[pid];
    return {
      id: crypto.createHash('sha1').update(pid).digest('hex').slice(0, 8),
      name: r.name,
      avatar: r.avatar,
      won: r.won,
      spent: r.spent,
      net: r.net,
      wins: r.wins,
      plays: r.plays,
      balance: r.balance,
      items: r.items,
      at: r.at || 0
    };
  }).sort(function (x, y) {
    if (y.won !== x.won) return y.won - x.won;
    if (y.net !== x.net) return y.net - x.net;
    if (y.balance !== x.balance) return y.balance - x.balance;
    return y.at - x.at;
  }).slice(0, limit);
}

/* ------------------------------------------------------------- статика */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.webp': 'image/webp',
  '.ico':  'image/x-icon',
  '.woff2':'font/woff2'
};

/**
 * Що взагалі можна віддавати.
 *
 * У тій самій папці лежать сторонні проєкти (папка `discord/`, папка
 * `rustgrade-bot/`, різні `.bat`, `package.json`, `server.js`, `README.md`).
 * Вони не є частиною сайту. Якби віддавалося «будь-який файл із папки»,
 * усе це стало б публічно завантажуваним по прямому посиланню.
 *
 * Тому тут whitelist, а не blacklist: окрім кореневого `index.html`,
 * підлягає лише `assets/` з дозволеним розширенням.
 */
function isAllowed(norm, ext) {
  if (norm === '/index.html') return true;
  if (norm.startsWith('/assets/')) return !!MIME[ext];
  return false;
}

function serveStatic(req, res, urlPath) {
  let raw;
  try {
    raw = decodeURIComponent(urlPath.split('?')[0]);
  } catch (e) {
    /* Битий percent-encoding не має валити процес (раніше це був
       необроблений URIError — достатньо було одного запиту). */
    return notFound(res);
  }
  if (raw === '' || raw === '/') raw = '/index.html';
  if (raw.indexOf('\u0000') !== -1) return notFound(res);

  /* Спершу нормалізуємо, і тільки потім приймаємо рішення.
     Якщо нормалізувати пізніше, то `/assets/../server.js` виглядає
     як «лежить у assets/», хоча насправді віддає файл з кореня. */
  const norm = path.posix.normalize(raw).replace(/\\/g, '/');
  if (!norm.startsWith('/')) return notFound(res);

  const ext = path.extname(norm).toLowerCase();

  /* Сторонні файли віддаємо як відсутні, а не «заборонені»:
     не підтверджуємо, що вони взагалі існують. */
  if (!isAllowed(norm, ext)) return notFound(res);

  /* Остаточний захист: зроблений повний шлях має лежати ВСЕРЕДИНІ
     проєкту і на початку після нього має бути розділювач шляху —
     інакше `...\Default Project-evil` пройшов би перевірку. */
  const full = path.join(ROOT, norm.slice(1));
  const within = full === ROOT || full.startsWith(ROOT + path.sep);
  if (!within) return notFound(res);

  try {
    fs.stat(full, function (err, st) {
      if (err || !st.isFile()) return notFound(res);

      const head = Object.assign({}, securityHeaders(), {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Content-Length': st.size,
        'Last-Modified': st.mtime.toUTCString()
      });
      /* файли сайту змінюються — кеш на 5 хвилин, щоб Render не віддавав
         стару версію після нового деплою */
      head['Cache-Control'] = ext === '.html' ? 'no-cache' : 'public, max-age=300';

      if (req.method === 'HEAD') { res.writeHead(200, head).end(); return; }

      res.writeHead(200, head);
      const stream = fs.createReadStream(full);
      stream.on('error', function () { res.destroy(); });
      stream.pipe(res);
    });
  } catch (e) {
    /* Наприклад, занадто довгий шлях — краще 404, ніж падіння процесу. */
    return notFound(res);
  }
}

/* ------------------------------------------------------------------ роути */

function readBody(req, res, cb) {
  let size = 0;
  /* Викликати cb рівно один раз: раніше на перевищенні ліміту ми
     рвали з'єднання і ніколи не відповідали — запит просто зависав. */
  let done = false;
  const once = function (arg) { if (!done) { done = true; cb(arg); } };
  const chunks = [];
  req.on('data', function (c) {
    size += c.length;
    if (size > MAX_BODY) {
      /* Спершу відповідаємо (cb відсилає 413), і тільки після того
         викидаємо решту тіла.
         Раніше ми спочатку рвали сокет — клієнт отримував обривок запиту
         без відповіді, а наступний запит того самого з'єднання падав. */
      once({ __tooBig: true });
      req.resume();
      return;
    }
    chunks.push(c);
  });
  req.on('end', function () {
    if (done) return;
    try { once(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
    catch (e) { once(null); }
  });
  req.on('error', function () { once(null); });
  req.on('aborted', function () { once(null); });
}

const server = http.createServer(function (req, res) {
  let url;
  try {
    url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  } catch (e) {
    /* Кривий Host або абсолютна форма запиту не мають валити процес. */
    return plain(res, 400, 'Bad Request');
  }

  const pathname = url.pathname;

  /* --- rate limit: спершу дешева перевірка, потім усе інше --- */
  if (pathname === '/api/report') {
    if (!rateLimit(req, 'report', 30)) {
      return sendJSON(res, 429, { ok: false, error: 'too many requests' },
        { 'Retry-After': '60' });
    }
  } else if (pathname === '/api/board') {
    if (!rateLimit(req, 'board', 120)) {
      return sendJSON(res, 429, { ok: false, error: 'too many requests' },
        { 'Retry-After': '60' });
    }
  } else if (pathname !== '/healthz') {
    if (!rateLimit(req, 'static', 600)) {
      return plain(res, 429, 'Too Many Requests', { 'Retry-After': '60' });
    }
  }

  /* --- GET /healthz --- */
  if (pathname === '/healthz') {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return plain(res, 405, 'Method Not Allowed', { Allow: 'GET, HEAD' });
    }
    return sendJSON(res, 200, { ok: true, uptime: Math.round(process.uptime()) });
  }

  /* --- GET /api/board?day=0&limit=100 --- */
  if (pathname === '/api/board') {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return plain(res, 405, 'Method Not Allowed', { Allow: 'GET, HEAD' });
    }
    const day = dayOf(url.searchParams.get('day'));
    const limit = limitOf(url.searchParams.get('limit'));
    return sendJSON(res, 200, {
      ok: true,
      day: day,
      online: Object.keys(board[String(day)] || {}).length,
      limit: limit,
      rows: boardRows(day, limit)
    });
  }

  /* --- POST /api/report --- */
  if (pathname === '/api/report') {
    if (req.method !== 'POST') {
      return plain(res, 405, 'Method Not Allowed', { Allow: 'POST' });
    }

    if (!sameOrigin(req)) {
      return sendJSON(res, 403, { ok: false, error: 'cross-origin request' });
    }

    const ct = String(req.headers['content-type'] || '').toLowerCase();
    if (!/^application\/json\b/.test(ct)) {
      return sendJSON(res, 415, { ok: false, error: 'expected application/json' });
    }

    const len = Number(req.headers['content-length']);
    if (Number.isFinite(len) && len > MAX_BODY) {
      req.resume();
      return sendJSON(res, 413, { ok: false, error: 'body too large' });
    }

    return readBody(req, res, function (body) {
      if (body && body.__tooBig) {
        return sendJSON(res, 413, { ok: false, error: 'body too large' });
      }
      const pid = cleanPid(body && body.pid);
      if (!pid) return sendJSON(res, 400, { ok: false, error: 'bad pid' });

      const day = dayOf(body.day);
      const list = Array.isArray(body.rows) ? body.rows : [];
      if (!list.length) return sendJSON(res, 400, { ok: false, error: 'no rows' });

      const bucket = board[String(day)] || (board[String(day)] = {});
      let stored = 0;

      /* Спершу прибираємо всі старі рядки цього пристрою.
         Раніше ключем було `pid|нік|індекс`, тож після видалення акаунта
         або перейменування старий рядок лишався б у таблиці назавжди —
         і гравець з'являвся б двічі. */
      const prefix = pid + '|';
      Object.keys(bucket).forEach(function (k) {
        if (k.indexOf(prefix) === 0) delete bucket[k];
      });

      /* Надсилаємо ВСІ акаунти браузера, а не лише поточний: так у таблиці
         з'являються й ті, що створювали раніше. */
      list.slice(0, 40).forEach(function (v, i) {
        const row = cleanRow(v);
        if (!row) return;

        const id = pid + '|' + row.name + '|' + i;
        if (!bucket[id] && Object.keys(bucket).length >= MAX_PLAYERS) return;

        row.at = Date.now();
        bucket[id] = row;
        stored++;
      });

      /* Нічого не прийняли — і на диск не пишемо, і відповідь — помилка. */
      if (!stored) return sendJSON(res, 400, { ok: false, error: 'nothing stored' });

      prune();
      saveBoard();
      return sendJSON(res, 200, {
        ok: true, day: day, stored: stored, online: Object.keys(bucket).length
      });
    });
  }

  /* Був баг: req.pathname не існує у node:http, тому ця умова завжди
     істинна і кожен запит на файл закінчувався мовчки, без відповіді —
     браузер просто чекав і ніколи не отримував відповіді. */
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    /* req.resume() — викинути непрочитане тіло запиту, інакше клієнт,
       що надіслав POST, отримає обривок з'єднання замість відповіді. */
    req.resume();
    return plain(res, 405, 'Method Not Allowed', { Allow: 'GET, HEAD' });
  }
  serveStatic(req, res, pathname);
});

/* Таймаути, щоб повільний клієнт не тримав з'єднання вічно. */
server.headersTimeout = 20 * 1000;
server.requestTimeout = 30 * 1000;
server.keepAliveTimeout = 5 * 1000;

/* Битий HTTP від клієнта — це 400, а не необроблена помилка. */
server.on('clientError', function (err, socket) {
  if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  else socket.destroy();
});

loadBoard();
prune();

server.listen(PORT, HOST, function () {
  console.log('rustgrade on http://localhost:' + PORT);
  console.log('board file: ' + BOARD_FILE);
  console.log('mode: ' + (IS_PROD ? 'production' : 'development') +
              ', trust proxy: ' + (TRUST_PROXY ? 'yes' : 'no'));
});

/* Render та інші платформи надсилають SIGTERM — завершуємось чемно */
function shutdown() {
  server.close(function () { process.exit(0); });
  if (server.closeIdleConnections) server.closeIdleConnections();
  setTimeout(function () { process.exit(0); }, 10 * 1000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
