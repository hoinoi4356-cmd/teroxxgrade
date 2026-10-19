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
   ========================================================================== */
'use strict';

const http = require('http');
const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const BOARD_FILE = path.join(DATA_DIR, 'board.json');

/** Скільки гравців і рядків тримаємо. Захист від підробки «1 млн гравців». */
const MAX_PLAYERS = 5000;
const MAX_BODY    = 64 * 1024;   // 64 КБ — достатньо для аватара-прев'ю
const DAY_LIMIT   = 14;           // скільки днів зберігаємо

/* ---------------------------------------------------------------- сховище */

/* board = { "0": { pid: row, ... }, "1": { ... } }
   Ключ верхнього рівня — зсув від сьогодні (0 = сьогодні). */
let board = {};

function loadBoard() {
  try {
    board = JSON.parse(fs.readFileSync(BOARD_FILE, 'utf8'));
    if (!board || typeof board !== 'object') board = {};
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
      fs.writeFileSync(BOARD_FILE, JSON.stringify(board));
    } catch (e) {
      console.error('board save failed:', e.message);
    }
  }, 2000);
}

function prune() {
  Object.keys(board).forEach(function (d) {
    if (!/^\d+$/.test(d) || Number(d) > DAY_LIMIT) delete board[d];
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
    name:    str(v.name, 24) || 'Без імені',
    avatar:  str(v.avatar, 9000),       // data-URL прев'ю; далі обрізаємо
    won:     pos(v.won, 1e12),
    spent:   pos(v.spent, 1e12),
    net:     num(v.net, 1e12),          // підсумок може бути від'ємним
    wins:    pos(v.wins, 1e6),
    plays:   pos(v.plays, 1e6),
    balance: pos(v.balance, 1e12),
    items:   pos(v.items, 1e6)
  };

  /* аватар — лише наш data-URL, і не більше 6 КБ, щоб фів не роздувався */
  if (!/^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/.test(row.avatar) || row.avatar.length > 6000) {
    row.avatar = '';
  }
  return row;
}

function dayOf(v) {
  const n = Math.round(Number(v) || 0);
  return Number.isFinite(n) && n >= 0 && n <= DAY_LIMIT ? n : 0;
}

/** Ім'я пристроя: випадкове, не пов'язане з паролем акаунта. */
function cleanPid(v) {
  const s = String(v == null ? '' : v);
  return /^[A-Za-z0-9_-]{8,64}$/.test(s) ? s : null;
}

/* ---------------------------------------------------------------- відповіді */

function sendJSON(res, code, obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

/** Список гравців за добу, відсортований як на сайті. */
function boardRows(day) {
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
  });
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
  let raw = decodeURIComponent(urlPath.split('?')[0]);
  if (raw === '' || raw === '/') raw = '/index.html';

  /* Спершу нормалізуємо, і тільки потім приймаємо рішення.
     Якщо нормалізувати пізніше, то `/assets/../server.js` виглядає
     як «лежить у assets/», хоча насправді віддає файл з кореня. */
  const norm = path.posix.normalize(raw).replace(/\\/g, '/');
  if (!norm.startsWith('/')) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404');
    return;
  }

  const ext = path.extname(norm).toLowerCase();

  /* Сторонні файли віддаємо як відсутні, а не «заборонені»:
     не підтверджуємо, що вони взагалі існують. */
  if (!isAllowed(norm, ext)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404');
    return;
  }

  /* Остаточний захист: зроблений повний шлях має лежати ВСЕРЕДИНІ
     проєкту і на початку після нього має бути розділювач шляху —
     інакше `...\Default Project-evil` пройшов би перевірку. */
  const full = path.join(ROOT, norm.slice(1));
  const within = full === ROOT || full.startsWith(ROOT + path.sep);
  if (!within) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404');
    return;
  }

  fs.stat(full, function (err, st) {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404');
      return;
    }
    const head = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': st.size,
      'Last-Modified': st.mtime.toUTCString()
    };
    /* файли сайту змінюються — кеш на 5 хвилин, щоб Render не віддавав
       стару версію після нового деплою */
    head['Cache-Control'] = ext === '.html' ? 'no-cache' : 'public, max-age=300';

    if (req.method === 'HEAD') { res.writeHead(200, head).end(); return; }

    res.writeHead(200, head);
    fs.createReadStream(full).pipe(res);
  });
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
}

const server = http.createServer(function (req, res) {
  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));

  /* --- GET /api/board?day=0 --- */
  if (req.method === 'GET' && url.pathname === '/api/board') {
    const day = dayOf(url.searchParams.get('day'));
    return sendJSON(res, 200, {
      ok: true,
      day: day,
      online: Object.keys(board[String(day)] || {}).length,
      rows: boardRows(day)
    });
  }

  /* --- POST /api/report --- */
  if (req.method === 'POST' && url.pathname === '/api/report') {
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
    return res.writeHead(405).end('Method Not Allowed');
  }
  serveStatic(req, res, req.url);
});

loadBoard();

server.listen(PORT, function () {
  console.log('rustgrade on http://localhost:' + PORT);
  console.log('board file: ' + BOARD_FILE);
});

/* Render та інші платформи надсилають SIGTERM — завершуємось чемно */
process.on('SIGTERM', function () { server.close(function () { process.exit(0); }); });