/* ==========================================================================
   board.js — спільний лідерборд

   Сайт лишається статичним: якщо сервера немає (відкрили index.html
   подвійним кліком), модуль просто мовчить і гравець бачить лише свої
   акаунти, як і раніше. Коли сайт відкритий на http(s) — рядок гравця
   надсилається на /api/report, а таблиця показує всіх.

   Важливо: пароль акаунту — це сам ключ, тому він НІКОЛИ не йде на
   сервер. Замість нього надсилається випадковий ід пристрою.
   ========================================================================== */
(function (RG) {
  'use strict';

  const PID_KEY = 'rgx_pid';
  const LAST_SENT = 'rgx_board_sent';
  const OFFLINE = Math.min(1000 * 60 * 5, 1000 * 60);  // не частіше ніж раз на хвилину

  /** Стабільний випадковий ід цього браузера. Не пов'язаний з акаунтом. */
  function pid() {
    let v = null;
    try { v = localStorage.getItem(PID_KEY); } catch (e) { v = null; }
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(v || '')) {
      const buf = new Uint8Array(16);
      (window.crypto || window.msCrypto).getRandomValues(buf);
      v = 'p' + Array.prototype.map.call(buf, function (b) {
        return ('0' + b.toString(36)).slice(-2);
      }).join('').slice(0, 40);
      try { localStorage.setItem(PID_KEY, v); } catch (e) { /* приватний режим */ }
    }
    return v;
  }

  /** Сервер доступний лише коли сайт віддають по http(s), а не з диска. */
  function online() {
    return location.protocol === 'http:' || location.protocol === 'https:';
  }

  /* ------------------------------------------------------------- запити */

  function getBoard(day) {
    return fetch('/api/board?day=' + (day || 0), {
      headers: { 'Accept': 'application/json' },
      cache: 'no-store'
    })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (j) {
        return (j && j.ok && j.rows) ? j.rows : [];
      })
      .catch(function () { return null; });   // null = сервера немає
  }

  /**
   * Надсилає рядки гравців. Мовчки, у фоні: помилка не повинна ламати
   * гру — якщо сервера немає, просто нічого не станеться.
   *
   * @param {Array} rows усі рядки таблиці цього браузера за цю добу
   */
  function report(rows, day) {
    if (!online() || !rows || !rows.length) return Promise.resolve(false);

    const stamp = Date.now();
    try {
      const last = Number(localStorage.getItem(LAST_SENT)) || 0;
      if (stamp - last < OFFLINE) return Promise.resolve(false);
      localStorage.setItem(LAST_SENT, String(stamp));
    } catch (e) { /* ignore */ }

    return fetch('/api/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pid: pid(),
        day: day || 0,
        rows: rows.slice(0, 40).map(rowOf)
      })
    })
      .then(function (r) { return r.ok; })
      .catch(function () { return false; });
  }

  /* ------------------------------------------------------------- злиття */

  /**
   * Місцевий рядок і серверний — це один і той самий гравець (його
   * власний акаунт). Щоб не було двох однакових ніків у таблиці, рядок
   * із `isMe` замінює серверний із тим самим іменем.
   */
  function merge(local, remote) {
    if (!remote) return { rows: local, shared: false };
    if (!remote.length) return { rows: local, shared: true, online: 0 };

    const mine = {};
    local.forEach(function (r) { if (r.isMe) mine[r.name] = true; });

    const seen = {};
    const rows = [];

    /* Якщо ім'я дублюється (та сама людина з двох браузерів чи два гравці
       з однаковим ніком), залишаємо НАЙКРАЩИЙ рядок. Робимо це явним
       порівнянням, а не «перший перемагає»: перший виграє лише коли
       дані вже відсортовані, інакше в таблиці міг би лишитися слабший
       рядок. Критерій збігається з сортуванням сервера. */
    function better(a, b) {
      if (a.won !== b.won) return a.won > b.won;
      if (a.net !== b.net) return a.net > b.net;
      if (a.balance !== b.balance) return a.balance > b.balance;
      return (a.at || 0) > (b.at || 0);
    }

    const best = {};
    remote.forEach(function (r) {
      const prev = best[r.name];
      if (!prev || better(r, prev)) best[r.name] = r;
    });

    Object.keys(best).forEach(function (name) {
      const r = best[name];
      if (seen[name]) return;
      seen[name] = true;
      rows.push({
        /* Поле називається id, а не key, навмисно: у ключі акаунта лежить
           пароль, і в таблиці лідерборду йому не місце. */
        id: r.id,
        name: r.name,
        avatar: r.avatar || '',
        won: r.won, spent: r.spent, net: r.net,
        wins: r.wins, plays: r.plays,
        balance: r.balance, items: r.items,
        isMe: !!mine[r.name],
        createdAt: r.at || 0
      });
    });

    /* локальні акаунти, яких сервер ще не бачить (ще не синхронізувалися) */
    local.forEach(function (r, i) {
      if (!seen[r.name]) {
        rows.push({
          /* локальний рядок отримує такий самий безпечний id */
          id: 'local' + i,
          name: r.name,
          avatar: r.avatar || '',
          won: r.won, spent: r.spent, net: r.net,
          wins: r.wins, plays: r.plays,
          balance: r.balance, items: r.items,
          isMe: r.isMe,
          createdAt: r.createdAt || 0
        });
      }
    });

    rows.sort(function (x, y) {
      if (y.won !== x.won) return y.won - x.won;
      if (y.net !== x.net) return y.net - x.net;
      if (y.balance !== x.balance) return y.balance - x.balance;
      return y.createdAt - x.createdAt;
    });

    return { rows: rows, shared: true, online: remote.length };
  }

  /** Рядок поточного акаунту у форматі, який очікує сервер. */
  function rowOf(r) {
    if (!r) return null;
    return {
      name: r.name,
      avatar: r.avatar || '',
      won: r.won, spent: r.spent, net: r.net,
      wins: r.wins, plays: r.plays,
      balance: r.balance, items: r.items
    };
  }

  RG.board = {
    available: online,
    report: report,
    getBoard: getBoard,
    merge: merge,
    rowOf: rowOf
  };
})(window.RG = window.RG || {});