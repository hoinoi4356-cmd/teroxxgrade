/* ==========================================================================
   app.js — хеш-роутер і сторінки застосунку

   Промокод навмисно НІДЕ не показується: немає банерів, сторінки чи
   згадок у підвалі. Користувач сам вводить код у гаманці.
   Адмінка для створення кодів — на #/admin, без посилань у навігації.
   ========================================================================== */
(function (RG) {
  'use strict';

  const { ITEMS, ITEM_BY_ID, RARITIES, RARITY_ORDER, CATEGORIES, DEMO_KEYS, USD_RATE, SECRET_MIN } = RG.DATA;
  const S = RG.store;
  const { itemIcon, itemImage, icon } = RG.icons;
  const { toast, modal, confirmDialog, itemCard, rarityOf, escapeHtml, oddsClass } = RG.ui;
  const { formatNumber } = S;
  const CUR = RG.DATA.CURRENCY.code;

  const app = document.getElementById('app');
  const PAGE_SIZE = 60;

  let filters = { q: '', cat: 'all', rarity: 'all', sort: 'price-desc' };
  let shown = PAGE_SIZE;
  let upgradeSelection = emptySelection();

  /** Порожній вибір на сторінці апгрейду. */
  function emptySelection() {
    return { sourceUid: null, targetId: null, filter: null };
  }

  /* ==========================================================================
     Аватар
     ========================================================================== */

  /**
   * Кружець з аватаром: картинка, якщо є, інакше перша літера імені.
   * data: рядок екрануємо — у ньому можуть бути лапки.
   */
  function avatarHTML(account, extraClass) {
    const name = (account && account.name) || '?';
    const cls = 'avatar' + (extraClass ? ' ' + extraClass : '');
    const src = account && account.avatar;
    if (src) {
      return `<span class="${cls}"><img src="${escapeHtml(src)}" alt=""></span>`;
    }
    return `<span class="${cls}">${escapeHtml(String(name).slice(0, 1).toUpperCase())}</span>`;
  }

  /* ==========================================================================
     Ефект перемоги
     ========================================================================== */

  /**
   * GIF, який показується при виграші. Завантажується лише в момент
   * перемоги (preload="none"), бо важить 7 МБ.
   */
  const WIN_GIF = 'assets/img/win.gif';

  let fxTimer = null;

  /** Салют на весь екран. Зникає сам або по кліку. */
  function winFx(item) {
    const old = document.querySelector('.win-fx');
    if (old) old.remove();
    clearTimeout(fxTimer);

    const r = rarityOf(item);
    const box = document.createElement('div');
    box.className = 'win-fx';
    box.style.setProperty('--rar', r.color);
    box.innerHTML =
      '<img class="win-fx__gif" src="' + escapeHtml(WIN_GIF) + '" alt="" preload="none">' +
      '<div class="win-fx__card">' +
        '<span class="win-fx__tag">Успіх</span>' +
        '<b>' + escapeHtml(item.name) + '</b>' +
        '<span class="win-fx__rar">' + escapeHtml(r.name) + '</span>' +
      '</div>';
    document.body.appendChild(box);

    const close = function () {
      box.classList.add('is-out');
      setTimeout(function () { box.remove(); }, 320);
    };
    box.addEventListener('click', close);
    fxTimer = setTimeout(close, 2600);
  }

  /* ==========================================================================
     Пасхалки

     Три приховані скарби. Кожен знайдений одразу приносить гроші, а
     ще й видно вам в адмінці — можете нарахувати вдруге від себе.
     ========================================================================== */

  /** Привіт, коли знайдено пасхалок. first — аби не повторюватись. */
  function eggToast(res) {
    if (!res || !res.ok || !res.first) return;
    RG.ui.celebrate();
    toast(
      'Пасхалок знайдено! +' + formatNumber(res.reward) + ' ' + CUR +
      (res.total > 1 ? ' · знайдено ' + res.total : '') +
      ' · скажіть автору, він нарахує бонус',
      'promo', 7000
    );
  }

  /** Лічильник «кліків підряд»: спрацьовує, лише коли паузи менші. */
  function clickStreak(el, need, id, ms) {
    if (!el) return;
    let n = 0, timer = null;
    el.addEventListener('click', function () {
      n++;
      clearTimeout(timer);
      timer = setTimeout(function () { n = 0; }, ms || 900);
      if (n >= need) { n = 0; eggToast(S.findEgg(id)); }
    });
  }

  /* пасхалок 1: клік по логотипу 7 разів */
  function bindEggLogo(root) {
    const logo = root.querySelector('.logo');
    if (logo) clickStreak(logo, 7, 'logo', 900);
  }

  /* пасхалок 2: клік по центру колеса 10 разів */
  function bindEggWheel(host) {
    if (!host) return;
    clickStreak(host.querySelector('.wheel__center'), 10, 'center', 700);
  }

  /* пасхалок 3: утримувати «TX» біля балансу три секунди */
  function bindEggTx(root) {
    const cur = root.querySelector('.balance__cur, [data-egg-tx]');
    if (!cur) return;

    let timer = null, armed = true;
    const start = function () {
      if (!armed) return;
      clearTimeout(timer);
      cur.classList.add('is-holding');
      timer = setTimeout(function () {
        cur.classList.remove('is-holding');
        armed = false;
        eggToast(S.findEgg('tx'));
      }, 3000);
    };
    const stop = function () {
      clearTimeout(timer);
      cur.classList.remove('is-holding');
    };

    cur.addEventListener('pointerdown', start);
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (ev) {
      cur.addEventListener(ev, stop);
    });
    cur.addEventListener('keydown', function (e) {
      if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) start();
    });
    cur.addEventListener('keyup', stop);
    cur.addEventListener('blur', stop);
  }

  /** Навішує всі пасхалки на щойно відмальовану сторінку. */
  function bindEggs(root) {
    if (!root) return;
    bindEggLogo(root);
    bindEggWheel(root.querySelector('#wheel'));
    bindEggTx(root);
  }

  /* ==========================================================================
     Шапка
     ========================================================================== */

  const NAV = [
    { href: '#/home',      label: 'Головна',     key: 'home' },
    { href: '#/market',    label: 'Маркетплейс', key: 'market' },
    { href: '#/upgrade',   label: 'Апгрейд',     key: 'upgrade' },
    { href: '#/inventory', label: 'Інвентар',    key: 'inventory' },
    { href: '#/wallet',    label: 'Гаманець',    key: 'wallet' },
    { href: '#/leaders',   label: 'Лідерборд',   key: 'leaders' }
  ];

  function header() {
    const account = S.getAccount();

    const el = document.createElement('header');
    el.className = 'hdr';
    el.innerHTML = `
      <div class="hdr__inner">
        <a class="logo" href="#/home">
          <span class="logo__mark">${icon('bolt', 20)}</span>
          <span class="logo__text">RUST<em>GRADE</em></span>
        </a>

        <nav class="hdr__nav">
          ${NAV.map(n => `<a class="hdr__link" href="${n.href}" data-nav="${n.href}" data-key="${n.key}">${n.label}</a>`).join('')}
        </nav>

        <div class="hdr__right">
          ${account ? `
            <button class="balance" type="button" data-nav="#/wallet" title="Баланс">
              <span class="balance__coin">${icon('coin', 16)}</span>
              <span class="balance__value">${formatNumber(account.balance)}</span>
              <span class="balance__cur">${CUR}</span>
            </button>
            <button class="user-chip" type="button" data-nav="#/wallet">
              <span class="user-chip__avatar">${avatarHTML(account)}</span>
              <span class="user-chip__name">${escapeHtml(account.name)}</span>
            </button>` : `
            <a class="btn btn--primary btn--sm" href="#/login">${icon('key', 16)} Увійти</a>`}
        </div>
      </div>`;

    return el;
  }

  /* ==========================================================================
     Сторінки
     ========================================================================== */

  const PAGES = {};

  /* ------------------------------- Головна -------------------------------- */

  PAGES.home = () => {
    const account = S.getAccount();

    const wrap = document.createElement('div');
    wrap.className = 'page page--home';

    wrap.innerHTML = `
      <section class="hero">
        <div class="hero__bg"></div>
        <div class="hero__inner">
          <span class="hero__eyebrow">${icon('shield', 14)} Без Steam-логіну</span>
          <h1 class="hero__title">Апгрейдь предмети<br><em>без реєстрації через Steam</em></h1>
          <p class="hero__sub">
            Вхід за власним ключем, валюта ${CUR}, маркетплейс предметів і апгрейдер.
            ${formatNumber(ITEMS.length)} скінів у каталозі.
          </p>
          <div class="hero__actions">
            <a class="btn btn--primary btn--lg" href="#/login">${icon('key', 18)} ${account ? 'Мій профіль' : 'Увійти за ключем'}</a>
            <a class="btn btn--ghost btn--lg" href="#/market">До маркетплейсу ${icon('arrow', 18)}</a>
          </div>
          <div class="hero__stats">
            <div><b>${formatNumber(ITEMS.length)}</b><span>справжніх предметів Rust</span></div>
            <div><b>${formatNumber(ITEMS.reduce(function (m, i) { return i.price > m ? i.price : m; }, 0))}</b><span>${CUR} — найдорожчий</span></div>
            <div><b>${RARITY_ORDER.length}</b><span>рівнів рідкості</span></div>
          </div>
        </div>
      </section>

      ${account ? '' : `
      <section class="cta-panel">
        <div class="cta-panel__body">
          <h2>Почніть з входу за ключем</h2>
          <p>Увійдіть за ключем — і баланс, інвентар та апгрейдер стануть доступні.</p>
        </div>
        <div class="cta-panel__actions">
          <a class="btn btn--primary" href="#/login">Увійти</a>
          <a class="btn btn--ghost" href="#/market">Переглянути каталог</a>
        </div>
      </section>`}

      <section class="section">
        <header class="section__head">
          <h2 class="section__title">Найдорожчі скіни</h2>
          <a class="section__more" href="#/market">Увесь маркетплейс ${icon('arrow', 16)}</a>
        </header>
        <div class="grid grid--items" id="featured"></div>
      </section>

      <section class="section">
        <header class="section__head">
          <h2 class="section__title">Найпопулярніші</h2>
          <a class="section__more" href="#/market">Увесь маркетплейс ${icon('arrow', 16)}</a>
        </header>
        <div class="grid grid--items" id="popular"></div>
      </section>

      <section class="section">
        <header class="section__head"><h2 class="section__title">Як це працює</h2></header>
        <div class="features">
          ${[
            { i: 'key',   t: 'Вхід за ключем',    d: 'Натомість OAuth Steam — звичайний ключ RG-XXXX-XXXX-XXXX-XXXX. Реєстрація сторонніх сервісів не потрібна.' },
            { i: 'coin',  t: 'Валюта ' + CUR,     d: 'Внутрішній баланс. Поповнення, купівля предметів і продаж із комісією 10%.' },
            { i: 'chart', t: 'Апгрейд предметів', d: 'Обери свій предмет і дорожчий цільовий. Шанс виграшу рахується за ціновим розривом.' },
            { i: 'bag',   t: 'Маркетплейс',       d: `${formatNumber(ITEMS.length)} справжніх предметів Rust з іконками скінів і ринковими цінами.` }
          ].map(f => `
            <div class="feature">
              <span class="feature__icon">${icon(f.i, 22)}</span>
              <h3>${f.t}</h3>
              <p>${f.d}</p>
            </div>`).join('')}
        </div>
      </section>

      <p class="disclaimer">
        ${icon('warn', 14)} Назви, іконки та ціни взяті зі Steam Community Market для Rust.
        Ціна в ${CUR} = реальна ціна в USD × ${formatNumber(USD_RATE)}. ${CUR} — ігрова валюта,
        виведення в реальні гроші не реалізовано.
      </p>`;

    const featured = ITEMS
      .filter(function (i) { return ['epic', 'legendary', 'exotic'].includes(i.rarity); })
      .sort(function (a, b) { return b.price - a.price; })
      .slice(0, 8);

    const popular = ITEMS
      .filter(function (i) {
        return i.rarity !== 'common' && i.rarity !== 'uncommon' && i.cat !== 'resource';
      })
      .sort(function (a, b) { return b.listings - a.listings; })
      .slice(0, 8);

    const grid = wrap.querySelector('#featured');
    featured.forEach(function (it) { grid.appendChild(itemCard(it, { onOpen: function () { goItem(it.id); } })); });

    const popGrid = wrap.querySelector('#popular');
    popular.forEach(function (it) { popGrid.appendChild(itemCard(it, { onOpen: function () { goItem(it.id); } })); });

    return wrap;
  };

  /* ----------------------------- Маркетплейс ------------------------------ */

  PAGES.market = () => {
    const wrap = document.createElement('div');
    wrap.className = 'page page--market';

    wrap.innerHTML = `
      <header class="page__head">
        <div>
          <h1 class="page__title">Маркетплейс</h1>
          <p class="page__sub">${formatNumber(ITEMS.length)} справжніх предметів Rust · ціни зі Steam Market · продаж із комісією 10%</p>
        </div>
        <div class="market__count" id="count"></div>
      </header>

      ${flowStrip('market')}

      <div class="toolbar">
        <div class="search">
          ${icon('search', 18)}
          <input type="search" id="q" placeholder="Пошук за назвою…" autocomplete="off" aria-label="Пошук">
        </div>
        <div class="toolbar__selects">
          <select id="cat" class="select" aria-label="Категорія">
            <option value="all">Усі категорії</option>
            ${CATEGORIES.map(c => `<option value="${c.id}">${c.name}</option>`).join('')}
          </select>
          <select id="rarity" class="select" aria-label="Рідкість">
            <option value="all">Уся рідкість</option>
            ${RARITY_ORDER.map(r => `<option value="${r}">${RARITIES[r].name}</option>`).join('')}
          </select>
          <select id="sort" class="select" aria-label="Сортування">
            <option value="popular">Популярніші</option>
            <option value="price-asc">Ціна: за зростанням</option>
            <option value="price-desc">Ціна: за спаданням</option>
            <option value="rarity">Рідкість</option>
            <option value="name">Назва</option>
          </select>
        </div>
      </div>

      <div class="chips" id="chips"></div>
      <div id="list"></div>
      <div class="load-more" id="more"></div>`;

    const list = wrap.querySelector('#list');
    const countEl = wrap.querySelector('#count');
    const chips = wrap.querySelector('#chips');
    const moreBox = wrap.querySelector('#more');

    const sorters = {
      'price-asc':  function (a, b) { return a.price - b.price; },
      'price-desc': function (a, b) { return b.price - a.price; },
      'popular':    function (a, b) { return b.listings - a.listings; },
      'rarity':     function (a, b) { return RARITY_ORDER.indexOf(b.rarity) - RARITY_ORDER.indexOf(a.rarity); },
      'name':       function (a, b) { return a.name.localeCompare(b.name, 'uk'); }
    };

    function render(append) {
      const q = filters.q.trim().toLowerCase();

      const items = ITEMS
        .filter(function (i) {
          if (filters.cat !== 'all' && i.cat !== filters.cat) return false;
          if (filters.rarity !== 'all' && i.rarity !== filters.rarity) return false;
          if (q && i.name.toLowerCase().indexOf(q) === -1) return false;
          return true;
        })
        .sort(sorters[filters.sort]);

      countEl.textContent = formatNumber(items.length) + ' знайдено';

      if (!append) { list.innerHTML = ''; shown = PAGE_SIZE; }

      if (!items.length) {
        list.innerHTML = `
          <div class="empty">
            ${icon('search', 40)}
            <p>Нічого не знайдено</p>
            <button class="btn btn--ghost btn--sm" type="button" data-act="reset">Скинути фільтри</button>
          </div>`;
        list.querySelector('[data-act="reset"]').addEventListener('click', function () {
          filters = { q: '', cat: 'all', rarity: 'all', sort: 'price-desc' };
          syncControls();
          render(false);
        });
        moreBox.innerHTML = '';
        return;
      }

      const slice = items.slice(0, shown);
      const grid = document.createElement('div');
      grid.className = 'grid grid--items';
      slice.forEach(function (it) {
        const owned = S.inventoryHas(it.id);
        grid.appendChild(itemCard(it, {
          owned: owned,
          onOpen: function () { goItem(it.id); },
          // Кнопка грейду лише для предметів, які вже в інвентарі —
          // інакше вона вела б в апгрейд з порожнім слотом.
          onUpgrade: owned ? function () {
            location.hash = '#/upgrade';
            setTimeout(function () { preselectUpgrade(it.id); }, 60);
          } : null
        }));
      });
      if (!append) list.innerHTML = '';
      list.appendChild(grid);

      const left = items.length - slice.length;
      moreBox.innerHTML = left > 0
        ? `<button class="btn btn--ghost" type="button" data-act="more">Показати ще ${Math.min(PAGE_SIZE, left)} (залишилось ${formatNumber(left)})</button>`
        : `<p class="load-more__end">Показано всі ${formatNumber(items.length)}</p>`;

      moreBox.querySelector('[data-act="more"]')?.addEventListener('click', function () {
        shown += PAGE_SIZE;
        render(true);
      });
    }

    function syncControls() {
      wrap.querySelector('#q').value = filters.q;
      wrap.querySelector('#cat').value = filters.cat;
      wrap.querySelector('#rarity').value = filters.rarity;
      wrap.querySelector('#sort').value = filters.sort;
    }

    wrap.querySelector('#q').addEventListener('input', function (e) { filters.q = e.target.value; render(false); });
    wrap.querySelector('#cat').addEventListener('change', function (e) { filters.cat = e.target.value; render(false); });
    wrap.querySelector('#rarity').addEventListener('change', function (e) { filters.rarity = e.target.value; render(false); });
    wrap.querySelector('#sort').addEventListener('change', function (e) { filters.sort = e.target.value; render(false); });

    chips.innerHTML = RARITY_ORDER.map(function (r) {
      return `<button class="chip" type="button" data-rarity="${r}" style="--rar:${RARITIES[r].color}">
        <i class="chip__dot"></i>${RARITIES[r].name}</button>`;
    }).join('');

    chips.addEventListener('click', function (e) {
      const btn = e.target.closest('[data-rarity]');
      if (!btn) return;
      const r = btn.dataset.rarity;
      filters.rarity = filters.rarity === r ? 'all' : r;
      syncControls();
      render(false);
      chips.querySelectorAll('.chip').forEach(function (c) {
        c.classList.toggle('is-on', c.dataset.rarity === filters.rarity);
      });
    });

    render(false);
    return wrap;
  };

  /* ------------------------------- Деталі --------------------------------- */

  function goItem(id) { location.hash = '#/item/' + id; }

  /**
   * Смуга «Інвентар → Магазин → Грейд». Показує весь шлях і підсвічує
   * поточний крок, щоб не треба було здогадуватись, що робити далі.
   */
  const FLOW_STEPS = [
    { id: 'inventory', label: 'Інвентар',  href: '#/inventory', note: 'ваші предмети' },
    { id: 'market',    label: 'Магазин',   href: '#/market',    note: 'купівля скінів' },
    { id: 'upgrade',   label: 'Грейд',     href: '#/upgrade',   note: 'апгрейд на колесі' }
  ];

  function flowStrip(active) {
    const owned = S.getInventory().length;
    return '<nav class="flow" aria-label="Порядок дій">' +
      FLOW_STEPS.map(function (s, n) {
        return '<a class="flow__step' + (s.id === active ? ' is-active' : '') + '" href="' + s.href + '">' +
          '<span class="flow__num">' + (n + 1) + '</span>' +
          '<span class="flow__txt"><b>' + s.label + '</b><i>' +
            (s.id === 'inventory' && owned ? owned + ' предметів' : s.note) + '</i></span>' +
        '</a>';
      }).join('<span class="flow__sep" aria-hidden="true">→</span>') +
    '</nav>';
  }

  const DESCRIPTIONS = {
    rifle:    'Автоматична вогнепальна зброя середньої дальності. Основна зброя для контролю суперперехресть.',
    smg:      'Пистолет-пулемет. Висока скорострільність на ближніх дистанціях.',
    shotgun:  'Дробовик. Максимальний урон у ближньому бою.',
    sniper:   'Снайперська зброя. Високий урон з великої відстані.',
    pistol:   'Пістолет. Порівняно з вогнепальною зброєю має підвищену точність.',
    bow:      'Лук. Безшумна зброя, не залишає слідів пострілів.',
    melee:    'Холодна зброя. Не потребує набоїв.',
    armor:    'Захисний елемент. Знижує вхідний урон.',
    clothing: 'Елемент екіпіровки. Не дає бонусів, але завершує образ.',
    vehicle:  'Транспорт і його комплектуючі.',
    deployable: 'Об’єкт, який можна розставити на сервері.',
    resource: 'Базовий ресурс для крафту та будівництва.',
    misc:     'Різноманітні предмети з маркетплейсу RUSTGRADE.'
  };

  PAGES.item = function (id) {
    const item = ITEM_BY_ID[id];
    if (!item) return PAGES.notFound();

    const r = rarityOf(item);
    const owned = S.getInventory().filter(function (i) { return i.itemId === item.id; }).length;

    const wrap = document.createElement('div');
    wrap.className = 'page page--item';

    wrap.innerHTML = `
      <a class="backlink" href="#/market">${icon('arrow', 16)} Назад до маркетплейсу</a>

      <div class="item-detail">
        <div class="item-detail__art" style="--rar:${r.color};--bg:#${item.bg}">
          <div class="item-card__glow"></div>
          ${itemImage(item, 220)}
          <span class="item-detail__rarity">${r.name}</span>
        </div>

        <div class="item-detail__info">
          <span class="item-detail__cat">${RG.ui.categoryName(item.cat)}</span>
          <h1 class="item-detail__name">${escapeHtml(item.name)}</h1>
          <p class="item-detail__desc">${DESCRIPTIONS[item.cat] || 'Предмет із маркетплейсу RUSTGRADE.'}</p>

          <div class="price-tag">
            <span class="price-tag__label">Вартість</span>
            <span class="price-tag__value">${formatNumber(item.price)} <i>${CUR}</i></span>
            <span class="price-tag__real">Справжня ціна на Steam Market: <b>$${item.usd.toFixed(2)}</b>${
              item.listings ? ` · ${formatNumber(item.listings)} пропозицій` : ''
            }</span>
          </div>

          <div class="item-detail__actions">
            <button class="btn btn--primary btn--lg" type="button" data-act="buy">${icon('coin', 18)} Купити</button>
            <button class="btn btn--ghost btn--lg" type="button" data-act="upgrade">Апгрейд з мого предмета</button>
          </div>

          ${owned ? `<p class="owned-note">${icon('check', 14)} У вас ${owned} шт.</p>` : ''}
        </div>
      </div>

      <section class="section">
        <header class="section__head"><h2 class="section__title">Що можна апгрейдити в цей скін</h2></header>
        <div class="grid grid--items" id="upgrades"></div>
      </section>`;

    wrap.querySelector('[data-act="buy"]').addEventListener('click', function () {
      const res = S.buyItem(item.id);
      res.ok ? toast(res.message, 'success') : toast(res.error, 'error');
      render();
    });

    wrap.querySelector('[data-act="upgrade"]').addEventListener('click', function () {
      location.hash = '#/upgrade';
      setTimeout(function () { preselectUpgrade(null, item.id); }, 60);
    });

    const grid = wrap.querySelector('#upgrades');
    ITEMS
      .filter(function (i) { return i.price < item.price && i.price > item.price * 0.25; })
      .sort(function (a, b) { return b.price - a.price; })
      .slice(0, 6)
      .forEach(function (it) {
        const card = itemCard(it, { onOpen: function () { goItem(it.id); } });
        const odds = S.upgradeOdds(it.price, item.price);
        card.querySelector('.item-card__btns').innerHTML =
          `<span class="odds odds--${oddsClass(odds)}">${(odds * 100).toFixed(1)}%</span>`;
        grid.appendChild(card);
      });

    return wrap;
  };

  /* -------------------------------- Апгрейд -------------------------------- */

  function preselectUpgrade(source, targetId) {
    if (source) {
      const inv = S.getInventory();
      const found = inv.find(function (i) { return i.uid === source; }) ||
                    inv.find(function (i) { return i.itemId === source; });
      upgradeSelection.sourceUid = found ? found.uid : null;
    }
    if (targetId) upgradeSelection.targetId = targetId;
    render();
  }

  PAGES.upgrade = function () {
    if (!S.getAccount()) return needAuth('Апгрейд доступний тільки для акаунтів.');

    const wrap = document.createElement('div');
    wrap.className = 'page page--upgrade';

    wrap.innerHTML = `
      <div class="page__bar">
        <button class="btn btn--ghost btn--sm" type="button" id="t-back">${icon('arrow', 15)}<span>Назад</span></button>
        <button class="btn btn--ghost btn--sm" type="button" id="t-reset" hidden>${icon('close', 15)}<span>Скасувати вибір</span></button>
      </div>

      <header class="page__head">
        <div>
          <h1 class="page__title">Апгрейд</h1>
          <p class="page__sub">Оберіть предмет зліва, вкажіть ціль справа й крутіть шкалу.
            Заливка дуги — це ваш шанс: зелена згори, червона внизу.</p>
        </div>
        <div class="balance balance--lg">
          <span class="balance__coin">${icon('coin', 18)}</span>
          <span class="balance__value">${formatNumber(S.getAccount().balance)}</span>
          <span class="balance__cur">${CUR}</span>
        </div>
      </header>

      ${flowStrip('upgrade')}

      <div class="upgrader">
        <div class="upgrader__controls">
          <div class="upgrader__toggles">
            <button class="toggle" type="button" id="t-fast">${icon('bolt', 14)}<span>Швидко</span></button>
            <button class="toggle" type="button" id="t-sound">${icon('spark', 14)}<span>Звук</span></button>
          </div>
          <button class="upgrader__fair" type="button" id="t-fair">${icon('shield', 14)} Чесний розподіл</button>
        </div>

        <section class="panel panel--source" id="panel-src">
          <div class="panel__labels">
            <span class="panel__title">Ваш предмет</span>
            <span class="panel__sub" id="src-sub"></span>
          </div>
          <div id="src-body"></div>
        </section>

        <div class="upgrader__wheel"><div id="wheel"></div></div>

        <section class="panel panel--target" id="panel-tgt">
          <div class="panel__labels">
            <span class="panel__title">Ціль</span>
            <span class="panel__sub" id="tgt-sub"></span>
          </div>
          <div id="tgt-body"></div>
        </section>

        <div class="upg-balance" id="bal"></div>
        <button class="upg-go" type="button" id="go" disabled>Апгрейд</button>
        <div class="upg-mults" id="mults"></div>
      </div>

      <section class="section">
        <header class="section__head">
          <h2 class="section__title">Чого не вистачає — купити тут</h2>
          <a class="section__more" href="#/market">Увесь магазин ${icon('arrow', 16)}</a>
        </header>
        <div class="grid grid--items" id="shop"></div>
      </section>`;

    const srcBody  = wrap.querySelector('#src-body');
    const srcSub   = wrap.querySelector('#src-sub');
    const tgtBody  = wrap.querySelector('#tgt-body');
    const tgtSub   = wrap.querySelector('#tgt-sub');
    const balBox   = wrap.querySelector('#bal');
    const goBtn    = wrap.querySelector('#go');
    const mults    = wrap.querySelector('#mults');
    const panelTgt = wrap.querySelector('#panel-tgt');
    const wheel    = RG.wheel.mount(wrap.querySelector('#wheel'), 0);

    let last = null;              // результат останнього броску
    const multPicks = {};         // множник -> id предмета

    /* ------------------------------ рядки ------------------------------- */

    function row(item, opts) {
      opts = opts || {};
      const r = rarityOf(item);
      const o = opts.odds;
      // key — це uid екземпляра для інвентаря і id предмета для цілей
      return '<button class="prow' + (opts.cls ? ' ' + opts.cls : '') + '" type="button"' +
          ' data-pick="' + (opts.key || item.id) + '" style="--rar:' + r.color + ';--bg:#' + item.bg + '">' +
          '<span class="prow__art">' + itemImage(item, 40) + '</span>' +
          '<span class="prow__txt"><b>' + escapeHtml(item.name) + '</b><i>' + r.name + '</i></span>' +
          '<span class="prow__right"><b>' + formatNumber(item.price) + '</b><i>' + CUR + '</i></span>' +
          (o == null ? '' :
            '<span class="prow__odds odds odds--' + oddsClass(o) + '">' + (o * 100).toFixed(1) + '%</span>') +
        '</button>';
    }

    function card(item, cls, extra) {
      const r = rarityOf(item);
      return '<div class="fcard' + (cls ? ' ' + cls : '') + '" style="--rar:' + r.color + ';--bg:#' + item.bg + '">' +
          '<div class="fcard__art">' + itemImage(item, 148) + '</div>' +
          '<b>' + escapeHtml(item.name) + '</b>' +
          '<span class="fcard__rar">' + r.name + '</span>' +
          '<span class="fcard__price">' + formatNumber(item.price) + ' ' + CUR + '</span>' +
          '<span class="fcard__usd">$' + item.usd.toFixed(2) + '</span>' +
          (extra || '') +
        '</div>';
    }

    /* ------------------------- логіка вибору ---------------------------- */

    function srcInstance() {
      return S.getInventory().find(function (i) { return i.uid === upgradeSelection.sourceUid; }) || null;
    }

    let candCache = { uid: null, all: [], shown: [] };

    /** Усі предмети дорожчі за вибраний, від найбільшого шансу. */
    function allCandidates() {
      const sel = srcInstance();
      if (!sel) return [];
      if (candCache.uid === sel.uid) return candCache.all;

      const all = ITEMS
        .filter(function (i) { return i.price > sel.item.price; })
        .map(function (i) { return { item: i, odds: S.upgradeOdds(sel.item.price, i.price) }; })
        .sort(function (a, b) { return b.odds - a.odds || a.item.price - b.item.price; });

      candCache = { uid: sel.uid, all: all, shown: spread(all) };
      return all;
    }

    /**
     * Показуємо не лише найдешевші цілі. Шанс падає як (від/до)^0.62,
     * тож перші сотні рядків майже завжди 90% — і множники 35/55/75%
     * впали б у ту саму найдешевшу ціль. Тому беремо рівномірний
     * вибірку з усього діапазону шансів.
     */
    function spread(list) {
      const MAX = 100;
      if (list.length <= MAX) return list;
      const out = [list[0]];
      const hi = list[0].odds;
      const lo = list[list.length - 1].odds;
      let prev = 0;
      for (let i = 1; i < MAX - 1; i++) {
        const want = hi - (hi - lo) * (i / (MAX - 1));
        let a = prev, b = list.length;          // список відсортовано за шансом
        while (a < b) {
          const m = (a + b) >> 1;
          if (list[m].odds > want) a = m + 1; else b = m;
        }
        if (a < list.length && a !== prev) { out.push(list[a]); prev = a; }
      }
      out.push(list[list.length - 1]);
      return out;
    }

    /** Те, що показуємо в панелі без фільтра: вибірка по всьому діапазону. */
    function candidates() { allCandidates(); return candCache.shown; }

    /* ------------------------- фільтр за відсотком ----------------------- */

    /* Кнопки «35% / 55% / 75%» фільтрують цілі за шансом, «X2 / X4 / X8» —
       за відношенням цін. Смуга ±5 відсоткових пунктів для шансу і ±15%
       для множника ціни: вузько, але не порожньо. */
    const ODDS_BAND = 0.05;
    const PRICE_BAND = 0.15;

    /** Чи проходить предмет обраний фільтр. */
    function matches(item, srcPrice) {
      const f = upgradeSelection.filter;
      if (!f) return true;
      if (f.kind === 'odds') {
        const o = S.upgradeOdds(srcPrice, item.price);
        return o >= f.value - ODDS_BAND && o <= f.value + ODDS_BAND;
      }
      if (!srcPrice) return false;
      const ratio = item.price / srcPrice;
      return ratio >= f.value * (1 - PRICE_BAND) && ratio <= f.value * (1 + PRICE_BAND);
    }

    /** Людське назву фільтра для підзаголовка панелі. */
    function filterLabel(f) {
      if (!f) return '';
      if (f.kind === 'odds') return 'шанс ~' + Math.round(f.value * 100) + '%';
      return 'ціна ×' + f.value + ' ±' + Math.round(PRICE_BAND * 100) + '%';
    }

    /**
     * Список цілей під фільтром. list — те, що показуємо (не більше
     * CAP), total — скільки таких скінів у каталозі взагалі.
     */
    function targetView() {
      const all = allCandidates();
      const f = upgradeSelection.filter;

      if (!f) {
        const list = candCache.shown;
        return { list: list, total: all.length, shown: list.length };
      }

      const sel = srcInstance();
      const srcPrice = sel ? sel.item.price : 0;
      const hit = all.filter(function (c) { return matches(c.item, srcPrice); });
      const list = spread(hit);
      return { list: list, total: hit.length, shown: list.length };
    }

    function renderSource() {
      const inv = S.getInventory();
      srcSub.textContent = inv.length + ' у інвентарі — оберіть один';

      if (!inv.length) {
        srcBody.innerHTML =
          '<div class="panel__hint">' + icon('bag', 40) +
            '<p><b>Інвентар порожній</b></p>' +
            '<p>Купіть скін — і він з’явиться тут.</p>' +
            '<a class="btn btn--primary btn--sm" href="#/market">Відкрити магазин</a>' +
          '</div>';
        return;
      }

      const sel = srcInstance();
      if (sel) {
        srcBody.innerHTML = card(sel.item, '',
          '<div class="fcard__unlock"><button class="btn btn--ghost btn--sm" type="button" data-act="unset">Змінити предмет</button></div>');
        return;
      }
      srcBody.innerHTML = '<div class="panel__scroll">' +
        inv.map(function (i) { return row(i.item, { key: i.uid }); }).join('') + '</div>';
    }

    function renderTarget() {
      const sel = srcInstance();
      panelTgt.classList.remove('is-won', 'is-lost');

      // результат броску має лишатися на екрані, поки користувач
      // не обере щось нове — інакше не видно, що власне випало
      if (last) {
        tgtSub.textContent = 'результат броску';
        panelTgt.classList.add(last.win ? 'is-won' : 'is-lost');
        tgtBody.innerHTML = resultCard();
        return;
      }

      if (!sel) {
        tgtSub.textContent = 'чекає на вибір предмета';
        tgtBody.innerHTML =
          '<div class="panel__hint">' + icon('search', 40) +
            '<p>Оберіть предмет у лівій панелі —<br>тут з’явиться список цілей</p>' +
          '</div>';
        return;
      }

      const view = targetView();
      const list = view.list;
      const f = upgradeSelection.filter;
      const cur = upgradeSelection.targetId ? ITEM_BY_ID[upgradeSelection.targetId] : null;
      const total = allCandidates().length;

      /* Головний «глухий кут» гри: у гравця є дорогий скін, а найдешевший
         можливий апгрейд коштує більше, ніж у нього грошей. Раніше це
         виглядало просто як мертва кнопка. Тепер кажемо прямо, скільки
         бракує, і одразу показуємо, де ці гроші взяти. */
      const balance = S.getAccount().balance;
      const srcPrice = sel.item.price;
      // список відсортовано від найбільшого шансу, тож перший рядок —
      // найдешеша доступна ціль, а отже й найдешевший можливий апгрейд
      const cheapestCost = total
        ? Math.max(0, allCandidates()[0].item.price - srcPrice)
        : 0;
      const locked = total > 0 && cheapestCost > balance;
      const lockedHint = locked
        ? '<div class="upg-noway">' + icon('warn', 18) +
            '<span><b>Жодна ціль не по кишенці</b><br>' +
            'Найдешевший апгрейд цього предмета — ' + formatNumber(cheapestCost) + ' ' + CUR +
            ', бракує ' + formatNumber(cheapestCost - balance) + '.<br>' +
            'Гроші: промокод або перегляд ролика — <a href="#/wallet">у гаманці</a>. ' +
            'Або оберіть дешевший предмет ліворуч.</span></div>'
        : '';

      /* найдорожчий предмет у каталозі апгрейдити нікуди: кажуть
         прямо, бо порожня панель виглядає як поломка */
      if (!total) {
        tgtSub.textContent = 'цілей немає';
        tgtBody.innerHTML =
          '<div class="panel__hint">' + icon('warn', 40) +
            '<p><b>Це найдорожчий скін</b><br>Апгрейдити його нікуди.<br>' +
            'Оберіть дешевший предмет ліворуч.</p>' +
            '<button class="btn btn--ghost btn--sm" type="button" data-act="unset">Інший предмет</button>' +
          '</div>';
        return;
      }

      tgtSub.textContent = f
        ? filterLabel(f) + ' · ' + (view.shown < view.total ? view.shown + ' з ' + view.total : view.total) + ' цілей'
        : (view.shown < total
          ? view.shown + ' з ' + total + ' цілей (за шансом)'
          : total + ' доступних цілей');

      // без фільтра вибрана ціль показана великою карткою — так само,
      // як на rustgrade. Фільтр увімкнено? лишаємо список, щоб було
      // видно всі скіни цього шансу і можна було обрати будь-який.
      if (cur && !f) {
        tgtBody.innerHTML = lockedHint + card(cur, '',
          '<div class="fcard__unlock"><button class="btn btn--ghost btn--sm" type="button" data-act="unset">Змінити ціль</button></div>');
        return;
      }

      if (f && !list.length) {
        tgtBody.innerHTML = filterBar(f, view) +
          '<div class="panel__hint">' + icon('search', 40) +
            '<p>Немає скінів з таким шансом.<br>Оберіть інший відсоток — або покажіть усі.</p>' +
          '</div>';
        return;
      }

      tgtBody.innerHTML = (f ? filterBar(f, view) : '') + lockedHint + '<div class="panel__scroll">' + list.map(function (c) {
        const afford = (c.item.price - srcPrice) <= balance;
        const cls = (cur && cur.id === c.item.id ? 'is-on' : '') + (afford ? '' : ' is-off');
        return row(c.item, { odds: c.odds, cls: cls.trim() });
      }).join('') + '</div>';
    }

    /** Плашка фільтра над списком цілей. */
    function filterBar(f, view) {
      return '<div class="upg-filter">' +
        '<span class="upg-filter__tag">' + icon('filter', 13) + escapeHtml(filterLabel(f)) + '</span>' +
        '<span class="upg-filter__n">' + view.shown + ' з ' + view.total + '</span>' +
        '<button class="btn btn--ghost btn--sm" type="button" data-act="nofilter">Показати всі</button>' +
      '</div>';
    }

    /* ----------------------------- множники ---------------------------- */

    const MULT_DEFS = [
      { label: 'X2',  cls: 'low',    kind: 'price', value: 2 },
      { label: 'X4',  cls: 'middle', kind: 'price', value: 4 },
      { label: 'X8',  cls: 'high',   kind: 'price', value: 8 },
      { label: '35%', cls: 'low',    kind: 'odds',  value: 0.35 },
      { label: '55%', cls: 'middle', kind: 'odds',  value: 0.55 },
      { label: '75%', cls: 'high',   kind: 'odds',  value: 0.75 }
    ];

    /** Той самий фільтр, що встановлено наразі? */
    function sameFilter(a, b) {
      if (!a || !b) return false;
      return a.kind === b.kind && Math.abs(a.value - b.value) < 1e-9;
    }

    /**
     * Шість кнопок під колесом. Кожна — це не одна ціль, а фільтр:
     * «55%» показує всі скіни, що випадають з таким шансом, і з
     * відсотка визначає, який саме предмет брати за замовчуванням.
     */
    function renderMults(sel, list) {
      Object.keys(multPicks).forEach(function (k) { delete multPicks[k]; });

      mults.innerHTML = MULT_DEFS.map(function (d) {
        const filter = { kind: d.kind, value: d.value };
        let pick = null;

        if (sel && list.length) {
          const src = sel.item.price;
          const balance = S.getAccount().balance;
          const nominal = d.kind === 'odds' ? d.value / 100 : 0;

          const hit = list.filter(function (c) { return matches(c.item, src); });

          /* Список candidates відсортовано від найдешевшого (шанс найбільший)
             до найдорожчого. Для відсотків беремо предмет, реальний шанс
             якого найближчий до напису на кнопці («35%» → ~35%), для
             множників — найдешевший усередині смуги.

             Раніше тут стояло pool[pool.length - 1], тобто останній
             елемент: найдорожчий предмет каталогу за 12 953 800 TX.
             Кнопка «X4» змушувала платити найдорожчу ціну з усіх можливих
             і ніколи не спрацьовувала. */
          const near = d.kind === 'odds'
            ? hit.slice().sort(function (a, b) {
                return Math.abs(a.odds - nominal) - Math.abs(b.odds - nominal);
              })
            : hit;

          const pool = near.length ? near : list;
          // і навіть якщо смуга дорога — беремо те, що реально по кишенці
          const affordable = pool.filter(function (c) {
            return (c.item.price - src) <= balance;
          });
          pick = (affordable[0] || pool[0]) || null;
        }

        if (!pick) {
          return '<button class="upg-mult upg-mult--' + d.cls + '" type="button" disabled>' +
            '<b>' + d.label + '</b></button>';
        }

        multPicks[d.label] = { filter: filter, id: pick.item.id };
        const on = sameFilter(upgradeSelection.filter, filter) ? ' is-on' : '';
        return '<button class="upg-mult upg-mult--' + d.cls + on + '" type="button" data-mult="' + d.label + '"' +
          ' title="' + escapeHtml(filterLabel(filter)) + '">' +
          '<b>' + d.label + '</b>' +
          '<i>' + (d.kind === 'odds' ? Math.round(pick.odds * 100) + '%' : '×' + d.value) + '</i>' +
        '</button>';
      }).join('');
    }

    /* ------------------------------ оновлення --------------------------- */

    /** Картка результату для панелі цілей. */
    function resultCard() {
      const it = last.item;
      const r = rarityOf(it);
      return '<div class="rcard ' + (last.win ? 'is-win' : 'is-lost') + '" style="--rar:' + r.color + '">' +
          '<span class="rcard__tag">' + (last.win ? 'Успіх' : 'Провал') + '</span>' +
          '<div class="rcard__art">' + itemImage(it, 110) + '</div>' +
          '<b>' + escapeHtml(it.name) + '</b>' +
          '<span class="rcard__rar">' + r.name + '</span>' +
          '<p class="rcard__txt">' + (last.win
            ? 'Предмет тепер ваш. Можна грейдити далі.'
            : 'Предмет втрачено. Оберіть інший.') + '</p>' +
          (last.win
            ? '<button class="btn btn--primary btn--sm" type="button" data-act="chain">Грейдити далі</button>'
            : '<button class="btn btn--ghost btn--sm" type="button" data-act="again">Обрати знову</button>') +
        '</div>';
    }

    function refresh() {
      const acc = S.getAccount();
      const sel = srcInstance();
      const tgt = upgradeSelection.targetId ? ITEM_BY_ID[upgradeSelection.targetId] : null;
      const ok = !!(sel && tgt && tgt.price > sel.item.price);

      renderSource();
      renderTarget();

      // множники шукають по повному списку цілей, а не по тому,
      // що вміщується у панель — інакше 35/55/75% дають одну ціль
      renderMults(sel, allCandidates());

      const odds = ok ? S.upgradeOdds(sel.item.price, tgt.price) : 0;
      if (last) {
        // результат щойно показано — шкас лишається на тому шансі,
          // з яким кидали, а не скидається в нуль
        wheel.showResult({
          win: last.win,
          html:
            '<span class="wheel__result-tag">' + (last.win ? 'Успіх' : 'Провал') + '</span>' +
            '<span class="wheel__result-art" style="--rar:' + rarityOf(last.item).color + '">' +
              itemImage(last.item, 92) + '</span>' +
            '<b class="wheel__result-name">' + escapeHtml(last.item.name) + '</b>' +
            '<span class="wheel__result-rar">' + rarityOf(last.item).name + '</span>' +
            '<span class="wheel__result-hint">' + (last.win ? 'натисніть «далі»' : 'обери знову') + '</span>'
        });
      } else {
        wheel.setChance(odds);
      }

      const cost = ok ? tgt.price - sel.item.price : 0;
      const have = acc.balance;
      const short = ok && have < cost;
      const missing = Math.max(0, cost - have);
      const filled = cost ? Math.min(100, Math.round(have / cost * 100)) : 100;

      balBox.innerHTML =
        '<div class="upg-balance__top"><span>Баланс</span>' +
          '<span class="upg-balance__right"><b>' + formatNumber(have) + '</b><i>' + CUR + '</i></span></div>' +
        '<div class="upg-balance__bar' + (short ? ' is-short' : '') + '"><i style="width:' + filled + '%"></i></div>' +
        (ok
          ? '<div class="upg-balance__need">Потрібно ' + formatNumber(cost) + ' ' + CUR +
            (short
              ? ' · бракує ' + formatNumber(missing) + ' · <a href="#/wallet">де взяти</a>'
              : ' · вистачає') + '</div>'
          : '<div class="upg-balance__need">Оберіть предмет і ціль</div>');

      /* Недостатньо коштів — не «мертва» кнопка, а підказка, де взяти.
         Раніше її просто вимикали, і гравець не розумів, що робити. */
      const chain = !!(last && last.win);
      if (short) {
        goBtn.textContent = 'Бракує ' + formatNumber(missing) + ' ' + CUR;
        goBtn.disabled = false;
        goBtn.classList.add('is-short');
        goBtn.title = 'Натисніть, щоб перейти до гаманця й отримати гроші';
      } else {
        goBtn.textContent = chain ? 'Апгрейд далі' : 'Апгрейд';
        goBtn.disabled = !ok || wheel.isSpinning();
        goBtn.classList.remove('is-short');
        goBtn.title = !ok ? 'Оберіть предмет і ціль' : '';
      }

      resetBtn.hidden = !(sel || tgt || last);
    }

    /* ------------------------------ дії -------------------------------- */

    /** Скидає вибір і результат — повертає сторінку в початковий стан. */
    function reset() {
      upgradeSelection = emptySelection();
      last = null;
      candCache = { uid: null, all: [], shown: [] };
      wheel.clearResult();
    }

    function pick(e) {
      const act = e.target.closest('[data-act]');
      if (act) {
        const a = act.dataset.act;
        if (a === 'unset') {
          if (act.closest('.panel--source')) {
            upgradeSelection.sourceUid = null;
          } else {
            upgradeSelection.targetId = null;
            // фільтр тримаємо: цілі ще потрібні, але без позначки
          }
        } else if (a === 'nofilter') {
          upgradeSelection.filter = null;
        } else if (a === 'again') {
          reset();
        } else if (a === 'chain') {
          // виграний предмет лишається джерелом; добираємо найдешевшу ціль
          last = null;
          wheel.clearResult();
          const list = allCandidates();
          upgradeSelection.filter = null;
          if (list.length) upgradeSelection.targetId = list[0].item.id;
        } else return;
        RG.wheel.tap();
        return refresh();
      }

      const b = e.target.closest('[data-pick]');
      if (!b) return;
      const id = b.dataset.pick;
      if (b.closest('.panel--source')) {
        // нове джерело — смуга цін відносна, тож фільтр теж скидаємо
        upgradeSelection.sourceUid = id;
        upgradeSelection.targetId = null;
        upgradeSelection.filter = null;
      } else {
        upgradeSelection.targetId = id;
      }
      last = null;
      wheel.clearResult();
      RG.wheel.tap();
      refresh();
    }

    srcBody.addEventListener('click', pick);
    tgtBody.addEventListener('click', pick);

    mults.addEventListener('click', function (e) {
      const b = e.target.closest('[data-mult]');
      if (!b || b.disabled) return;
      const p = multPicks[b.dataset.mult];
      if (!p) return;

      // повторний клік по активній кнопці знімає фільтр
      upgradeSelection.filter = sameFilter(upgradeSelection.filter, p.filter) ? null : p.filter;
      upgradeSelection.targetId = p.id;

      last = null;
      wheel.clearResult();
      RG.wheel.tap();
      refresh();
    });

    goBtn.addEventListener('click', function () {
      const acc = S.getAccount();
      const sel = srcInstance();
      const tgt = upgradeSelection.targetId ? ITEM_BY_ID[upgradeSelection.targetId] : null;
      if (!sel || !tgt) return;

      const odds = S.upgradeOdds(sel.item.price, tgt.price);
      const cost = tgt.price - sel.item.price;
      if (acc.balance < cost) {
        /* Не бракує грошей — одразу показуємо, де їх узяти:
           промокод або перегляд ролика. */
        const vb = S.videoBonus();
        toast('Бракує ' + formatNumber(cost - acc.balance) + ' ' + CUR +
          '. Промокод або перегляд ролика — у гаманці.', 'error', 5200);
        location.hash = '#/wallet';
        return;
      }

      goBtn.disabled = true;

      // Колесо і є бросок: стрілка зупиняється саме там, де випало
      // випадкове число, тож ані картинка, ані підсумок не брешуть.
      wheel.spin(odds).then(function (win) {
        const res = S.upgradeItem(sel.uid, tgt.id, win);
        if (!res.ok) {
          toast(res.error, 'error');
          last = null;
          return refresh();
        }
        last = { win: res.win, targetId: tgt.id, item: res.win ? tgt : sel.item };
        if (res.win) { winFx(tgt); RG.ui.celebrate([rarityOf(tgt).color, '#ffe32c', '#f2f3f2']); }
        // виграний предмет стає новим джерелом; ціль скидаємо —
        // користувач сам вирішує, чи грейдити далі
        upgradeSelection.sourceUid = res.win && res.instance ? res.instance.uid : null;
        upgradeSelection.targetId = null;
        upgradeSelection.filter = null;
        candCache = { uid: null, all: [], shown: [] };
        toast(res.message, res.win ? 'success' : 'error');
        refresh();
      });
    });

    /* --------------------------- керування ----------------------------- */

    const tFast = wrap.querySelector('#t-fast');
    const tSound = wrap.querySelector('#t-sound');

    function paintToggles() {
      tFast.classList.toggle('is-on', RG.wheel.isFast());
      tSound.classList.toggle('is-on', RG.wheel.isSound());
    }
    tFast.addEventListener('click', function () { RG.wheel.toggleFast(); paintToggles(); });
    tSound.addEventListener('click', function () { RG.wheel.toggleSound(); paintToggles(); });

    const tBack = wrap.querySelector('#t-back');
    const resetBtn = wrap.querySelector('#t-reset');

    // «Назад» завжди повертає на попередню сторінку
    tBack.addEventListener('click', function () {
      if (history.length > 1) history.back();
      else location.hash = '#/market';
    });

    // «Скасувати вибір» — повертає апгрейдер у початковий стан
    resetBtn.addEventListener('click', function () {
      reset();
      RG.wheel.tap();
      refresh();
    });
    paintToggles();

    wrap.querySelector('#t-fair').addEventListener('click', function () {
      modal({
        title: 'Чесний розподіл',
        width: 480,
        body:
          '<p>Кожен бросок — це випадкове число <code>Math.random()</code>, порівняне з вашим шансом. ' +
          'Перемога рівно тоді, коли воно менше за шанс. Ніякого прихованого «добросовісного» режиму немає.</p>' +
          '<p>Шкала показує той самий шанс, а стрілка зупиняється саме там, де випало число — ' +
          'тому картинка ніколи не суперечить підсумку.</p>' +
          '<p><b>Чесно про обмеження:</b> усе рахується у вашому браузері. Справжнього сервера немає, ' +
          'тому результат технічно можна підмінити в devtools. Для справжньої чесності потрібен сервер ' +
          'із серверним seed, який розкривається після кожного броску.</p>',
        actions: [{ label: 'Зрозуміло', variant: 'primary' }]
      });
    });

    /* --------------------------- «купити тут» -------------------------- */

    const acc = S.getAccount();
    ITEMS
      .filter(function (i) { return i.price <= acc.balance; })
      .sort(function (a, b) { return b.price - a.price; })
      .slice(0, 8)
      .forEach(function (it) {
        const cardEl = itemCard(it, {
          owned: S.inventoryHas(it.id),
          onOpen: function () { goItem(it.id); },
          onUpgrade: S.inventoryHas(it.id) ? function () {
            location.hash = '#/upgrade';
            setTimeout(function () { preselectUpgrade(it.id); }, 60);
          } : null
        });
        wrap.querySelector('#shop').appendChild(cardEl);
      });

    refresh();
    return wrap;
  };

  /* ------------------------------ Інвентар --------------------------------- */

  PAGES.inventory = function () {
    if (!S.getAccount()) return needAuth('Інвентар доступний після входу за ключем');

    const inv = S.getInventory();
    const total = inv.reduce(function (sum, i) { return sum + i.item.price; }, 0);

    const wrap = document.createElement('div');
    wrap.className = 'page page--inventory';

    wrap.innerHTML = `
      <header class="page__head">
        <div>
          <h1 class="page__title">Інвентар</h1>
          <p class="page__sub">${inv.length} предметів на ${formatNumber(total)} ${CUR}</p>
        </div>
        <div class="inventory__actions">
          <button class="btn btn--ghost btn--sm" type="button" data-act="sell-all">Продати все</button>
          <a class="btn btn--primary btn--sm" href="#/market">${icon('plus', 16)} Купити</a>
        </div>
      </header>
      ${flowStrip('inventory')}
      <div class="grid grid--items" id="inv"></div>`;

    const grid = wrap.querySelector('#inv');

    if (!inv.length) {
      grid.outerHTML = `
        <div class="empty">
          ${icon('bag', 44)}
          <h3>Інвентар порожній</h3>
          <p>Купіть скіни на маркетплейсі</p>
          <div class="empty__actions">
            <a class="btn btn--primary" href="#/market">До маркетплейсу</a>
          </div>
        </div>`;
      return wrap;
    }

    inv.forEach(function (inst) {
      const sellPrice = Math.floor(inst.item.price * 0.9);

      const card = itemCard(inst.item, {
        owned: true,
        onOpen: function () { goItem(inst.item.id); },
        openLabel: 'Продати ' + formatNumber(sellPrice),
        upgradeLabel: 'Грейдити',
        onUpgrade: function () {
          location.hash = '#/upgrade';
          setTimeout(function () { preselectUpgrade(inst.uid); }, 60);
        }
      });

      card.querySelector('[data-act="open"]').addEventListener('click', function (e) {
        e.stopPropagation();
        confirmDialog({
          title: 'Підтвердіть продаж',
          message: `Продати <b>${escapeHtml(inst.item.name)}</b> за <b>${formatNumber(sellPrice)} ${CUR}</b>?<br>Комісія маркетплейсу — 10%.`,
          confirmLabel: 'Продати'
        }).then(function (yes) {
          if (!yes) return;
          const res = S.sellItem(inst.uid);
          res.ok ? toast(res.message, 'success') : toast(res.error, 'error');
          render();
        });
      });

      grid.appendChild(card);
    });

    wrap.querySelector('[data-act="sell-all"]').addEventListener('click', function () {
      confirmDialog({
        title: 'Продати весь інвентар',
        message: `Буде продано ${inv.length} предметів на ${formatNumber(Math.floor(total * 0.9))} ${CUR} (комісія 10%).`,
        confirmLabel: 'Продати все'
      }).then(function (yes) {
        if (!yes) return;
        inv.forEach(function (i) { S.sellItem(i.uid); });
        toast('Інвентар продано', 'success');
        render();
      });
    });

    return wrap;
  };

  /* -------------------------------- Гаманець ------------------------------- */

  /**
   * Підказка під балансом: звідки взагалі можна взяти гроші. Кнопки
   * поповнення немає — тільки промокод і перегляд роликів.
   */
  function promoHint(account) {
    const vb = S.videoBonus();
    const parts = ['Промокод — ' + formatNumber(RG.DATA.PROMO_REWARD) + ' ' + CUR + '.'];
    if (vb.videos.length) {
      parts.push(vb.ready
        ? 'Перегляньте ролик — ' + formatNumber(vb.amount) + ' ' + CUR + '.'
        : 'Усі ' + vb.videos.length + ' роликів уже переглянуто.');
    }
    return parts.join(' ');
  }

  /**
   * Блок реклами: ролики й кнопка «подивитися — отримати». Нагорода
   * нараховується один раз на акаунт за кожен ролик, тому список
   * поступово перетворюється на смугу отриманих.
   */
  function adBlockHTML() {
    const vb = S.videoBonus();
    if (!vb.videos.length) return '';
    const signedIn = !!S.getAccount();

    return `
      <section class="section ad-block">
        <header class="section__head">
          <h2 class="section__title">Реклама від автора</h2>
          <span class="section__more">+${formatNumber(vb.amount)} ${CUR} за перегляд</span>
        </header>
        <p class="ad-block__sub">
          ${signedIn
            ? 'Відкрий ролик і натисни кнопку — гроші прийдуть на баланс одразу.'
            : 'Відкрий ролик, потім створи акаунт і натисни кнопку — гроші прийдуть на баланс.'}
          Кожен ролик дає нагороду один раз на акаунт.
        </p>
        <div class="ad-grid">
          ${vb.videos.map(v => `
            <div class="ad-card${v.done ? ' is-done' : ''}">
              <a class="ad-card__thumb" href="${escapeHtml(v.url)}" target="_blank" rel="noopener noreferrer"
                 aria-label="Відкрити ролик: ${escapeHtml(v.title)}">
                ${icon('play', 26)}
              </a>
              <b class="ad-card__title">${escapeHtml(v.title)}</b>
              ${v.done
                ? `<span class="ad-card__state">${icon('check', 14)} Отримано</span>`
                : `<button class="btn btn--primary btn--sm" type="button"
                     data-vid="${escapeHtml(v.id)}" data-watch="${escapeHtml(v.url)}">
                     Подивитися · +${formatNumber(vb.amount)} ${CUR}
                   </button>`}
            </div>`).join('')}
        </div>
      </section>`;
  }

  PAGES.wallet = function () {
    const account = S.getAccount();
    if (!account) return needAuth('Гаманець доступний після входу за ключем');

    const promos = S.redeemedPromos();

    const wrap = document.createElement('div');
    wrap.className = 'page page--wallet';

    wrap.innerHTML = `
      <header class="page__head">
        <div>
          <h1 class="page__title">Гаманець</h1>
          <p class="page__sub">Профіль <b>${escapeHtml(account.name)}</b> · ключ <code>${escapeHtml(account.key)}</code></p>
        </div>
      </header>

      <div class="wallet-grid">
        <div class="wallet-card">
          <span class="wallet-card__label">Баланс</span>
          <span class="wallet-card__value">${formatNumber(account.balance)} <i>${CUR}</i></span>
          <div class="wallet-card__actions">
            <a class="btn btn--primary btn--sm" href="#/market">Витратити</a>
            <a class="btn btn--ghost btn--sm" href="#/upgrade">Апгрейд</a>
          </div>
          <p class="wallet-card__note">${promoHint(account)}</p>
        </div>

        <div class="wallet-card">
          <span class="wallet-card__label">Промокод</span>
          ${promos.length ? `
            <span class="wallet-card__value wallet-card__value--ok">${icon('check', 22)} Активовано</span>
            <p class="wallet-card__note">Активованих промокодів: ${promos.length}</p>`
          : `
            <p class="wallet-card__note">Введіть код, який вам видали. Назва й зміст коду ніде не публікуються.</p>
            <form class="promo-input" id="promo-form" autocomplete="off">
              <input class="input" id="promo-code" placeholder="Промокод" aria-label="Промокод">
              <button class="btn btn--primary" type="submit">Активувати</button>
            </form>`}
        </div>
      </div>

      ${adBlockHTML()}

      ${promos.length ? `
      <section class="section">
        <header class="section__head"><h2 class="section__title">Активовані промокоди</h2></header>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>Промокод</th><th>Нагорода</th><th>Дата</th></tr></thead>
            <tbody>
              ${promos.map(p => `<tr>
                <td><code class="code-chip">${escapeHtml(p.mask)}</code></td>
                <td class="pos">+${formatNumber(p.reward)} ${CUR}</td>
                <td class="muted">${new Date(p.at).toLocaleString('uk-UA')}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </section>` : ''}

      ${account.history.length ? `
      <section class="section">
        <header class="section__head"><h2 class="section__title">Історія операцій</h2></header>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>Операція</th><th>Деталі</th><th>Сума</th><th>Дата</th></tr></thead>
            <tbody>
              ${account.history.map(h => `<tr class="${h.win === false ? 'is-lose' : ''}">
                <td>${escapeHtml(h.title)}</td>
                <td class="muted">${escapeHtml(h.detail || '')}</td>
                <td class="${h.amount > 0 ? 'pos' : 'neg'}">${h.amount > 0 ? '+' : ''}${formatNumber(h.amount)} ${CUR}</td>
                <td class="muted">${new Date(h.at).toLocaleString('uk-UA')}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </section>` : ''}

      <section class="section">
        <header class="section__head">
          <h2 class="section__title">Аватар</h2>
          <p class="section__note">${account.avatar
            ? 'Картинка збережена в цьому браузері'
            : 'Поки що перша літера імені'}</p>
        </header>
        <div class="avatar-row">
          <div class="avatar-row__pic">
            ${avatarHTML(account, 'avatar--lg avatar--ring')}
            <div class="avatar-row__btns">
              <label class="btn btn--primary btn--sm">
                ${icon('camera', 16)} ${account.avatar ? 'Замінити' : 'Завантажити фото'}
                <input type="file" id="avatar-file" class="visually-hidden"
                       accept="image/png,image/jpeg,image/jpg,image/webp,image/gif">
              </label>
              ${account.avatar ? `
                <button class="btn btn--ghost btn--sm btn--danger" type="button" data-act="avatar-del">
                  ${icon('trash', 16)} Прибрати
                </button>` : ''}
            </div>
          </div>
          <div class="avatar-row__body">
            <p class="wallet-card__note">
              Оберіть будь-яку картинку — вона обріжеться по центру в квадрат
              ${S.AVATAR_SIZE}×${S.AVATAR_SIZE} і збережеться разом з акаунтом у цьому браузері.
              Нікуди на сервер не відправляється: сервера тут немає, тому аватар
              не побачать інші гравці з інших комп’ютерів.
            </p>
            <p class="avatar-row__msg" id="avatar-msg" role="status" aria-live="polite"></p>
          </div>
        </div>
      </section>

      <section class="section">
        <header class="section__head"><h2 class="section__title">Профіль</h2></header>
        <div class="profile-row">
          <input class="input" id="name" value="${escapeHtml(account.name)}" maxlength="24" aria-label="Ім'я">
          <button class="btn btn--ghost" type="button" data-act="rename">Зберегти</button>
          ${S.isAdmin(account)
            ? `<a class="btn btn--primary" href="#/admin">${icon('gift', 16)} Адмінка</a>`
            : ''}
          <button class="btn btn--ghost btn--danger" type="button" data-act="logout">${icon('logout', 16)} Вийти</button>
          <button class="btn btn--ghost btn--danger" type="button" data-act="reset">Скинути акаунт</button>
        </div>
        ${S.isAdmin(account)
          ? `<p class="profile-admin">${icon('info', 14)} Ви увійшли як автор. Гравці, пасхалки й ручне нарахування TX — на
             <a href="#/admin">сторінці адмінки</a>.</p>`
          : ''}
      </section>`;

    /* --- Реклама: нагорода за перегляд --- */
    wrap.addEventListener('click', function (e) {
      const b = e.target.closest('[data-watch]');
      if (!b) return;
      const url = b.dataset.watch;
      if (url) window.open(url, '_blank', 'noopener');
      if (!S.getAccount()) {
        toast('Увійдіть або створіть акаунт, щоб отримати нагороду', 'error');
        return;
      }
      const res = S.claimVideoBonus(b.dataset.vid);
      res.ok ? toast(res.message, 'success') : toast(res.error, 'error');
      render();
    });

    /* --- Промокод (назва коду ніде не показується) --- */
    wrap.querySelector('#promo-form')?.addEventListener('submit', function (e) {
      e.preventDefault();
      const input = wrap.querySelector('#promo-code');
      const res = S.redeemPromo(input.value);
      if (!res.ok) return toast(res.error, 'error');
      toast(res.message, 'promo', 5200);
      render();
    });

    /* --- Аватар --- */
    const avatarFile = wrap.querySelector('#avatar-file');
    const avatarMsg = wrap.querySelector('#avatar-msg');

    function avatarError(text) {
      if (!avatarMsg) return;
      avatarMsg.textContent = text;
      avatarMsg.classList.add('is-err');
    }

    avatarFile?.addEventListener('change', function () {
      const file = avatarFile.files && avatarFile.files[0];
      if (!file) return;

      if (avatarMsg) {
        avatarMsg.textContent = 'Обробляю…';
        avatarMsg.classList.remove('is-err');
      }

      S.makeAvatar(file).then(function (dataUrl) {
        const res = S.setAvatar(dataUrl);
        if (avatarFile) avatarFile.value = '';
        if (!res.ok) return avatarError(res.error);
        toast('Аватар оновлено', 'success');
        render();
      }).catch(function (err) {
        if (avatarFile) avatarFile.value = '';
        avatarError((err && err.message) || 'Не вдалося завантажити картинку');
      });
    });

    wrap.querySelector('[data-act="avatar-del"]')?.addEventListener('click', function () {
      const res = S.clearAvatar();
      if (!res.ok) return toast(res.error, 'error');
      toast('Аватар прибрано', 'info');
      render();
    });

    /* --- Профіль --- */
    wrap.querySelector('[data-act="rename"]').addEventListener('click', function () {
      S.rename(wrap.querySelector('#name').value);
      toast('Ім’я оновлено', 'success');
      render();
    });

    wrap.querySelector('[data-act="logout"]').addEventListener('click', function () {
      S.logout();
      toast('Ви вийшли з акаунту', 'info');
      location.hash = '#/home';
      render();
    });

    wrap.querySelector('[data-act="reset"]').addEventListener('click', function () {
      confirmDialog({
        title: 'Скинути акаунт',
        message: 'Баланс, інвентар та активовані промокоди буде видалено. Ключ доведеться ввести знову.',
        confirmLabel: 'Скинути'
      }).then(function (yes) {
        if (!yes) return;
        S.resetAccount();
        location.hash = '#/home';
        render();
      });
    });

    return wrap;
  };

  /* -------------------------------- Адмінка -------------------------------- */
  /* Немає посилань у навігації чи підвалі. Доступ — за входом на #/admin.   */

  PAGES.admin = function () {
    if (!S.getAccount()) return needAuth('Адмінка доступна після входу за ключем');
    if (!S.isAdmin()) return notYourAdmin();

    const wrap = document.createElement('div');
    wrap.className = 'page page--admin';

    wrap.innerHTML = `
      <header class="page__head">
        <div>
          <h1 class="page__title">${icon('gift', 22)} Адмінка автора</h1>
          <p class="page__sub">Тільки для вашого акаунта. Тут видно всіх гравців цього браузера, їхні пасхалки й можна нарахувати ${CUR} вручну.</p>
        </div>
        <a class="btn btn--ghost" href="#/home">${icon('back', 16)} Назад на сайт</a>
      </header>

      <div class="tabs" role="tablist">
        <button class="tabs__btn is-on" type="button" data-tab="players" role="tab">Гравці й нарахування</button>
        <button class="tabs__btn" type="button" data-tab="promos" role="tab">Промокоди</button>
      </div>

      <section class="tabpane" data-pane="players">
        <div id="players"></div>
      </section>

      <section class="tabpane" data-pane="promos" hidden>
        <section class="admin-panel">
          <form class="admin-form" id="create" autocomplete="off">
            <label class="label" for="reward">Нагорода, ${CUR}</label>
            <input class="input" id="reward" type="number" min="1" step="1000" value="25000">

            <label class="label" for="code">Код (порожньо — згенерувати)</label>
            <div class="admin-row">
              <input class="input" id="code" placeholder="ABCDEF12" autocomplete="off" spellcheck="false">
              <button class="btn btn--ghost" type="button" data-act="reroll">${icon('spark', 16)} Інший</button>
            </div>

            <label class="label" for="note">Нотатка (видно тільки тут)</label>
            <input class="input" id="note" placeholder="напр. для Ivan з Discord" maxlength="60">

            <label class="check">
              <input type="checkbox" id="once" checked>
              <span>Один раз на акаунт</span>
            </label>

            <button class="btn btn--primary" type="submit">${icon('plus', 16)} Створити промокод</button>
          </form>
        </section>

        <section class="section">
          <header class="section__head"><h2 class="section__title">Створені промокоди</h2></header>
          <div id="list"></div>
        </section>
      </section>`;

    /* ------------------------------ вкладки ------------------------------- */
    wrap.querySelectorAll('.tabs__btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        wrap.querySelectorAll('.tabs__btn').forEach(function (b) {
          b.classList.toggle('is-on', b === btn);
        });
        wrap.querySelectorAll('.tabpane').forEach(function (p) {
          p.hidden = p.dataset.pane !== btn.dataset.tab;
        });
      });
    });

    /* --------------------------- гравці + TX ------------------------------ */

    /** Підказки до пасхалок — їх видно тільки тут, у адмінці. */
    const eggHints = {};
    (RG.DATA.EASTER_EGGS || []).forEach(function (e) { eggHints[e.id] = e.hint; });

    function drawPlayers() {
      const box = wrap.querySelector('#players');
      const rows = S.adminAccounts();

      if (!rows.length) {
        box.innerHTML = `<div class="empty">${icon('user', 40)}<p>Гравців ще немає</p></div>`;
        return;
      }

      const total = rows.reduce(function (s, a) { return s + a.balance; }, 0);
      const withEggs = rows.filter(function (a) { return a.eggs.length; }).length;

      box.innerHTML = `
        <section class="admin-stats">
          <div class="admin-stat"><b>${rows.length}</b><span>акаунтів</span></div>
          <div class="admin-stat"><b>${formatNumber(total)}</b><span>${CUR} у обігу</span></div>
          <div class="admin-stat"><b>${withEggs}</b><span>знайшли пасхалок</span></div>
        </section>

        <div class="table-wrap">
          <table class="table table--admin">
            <thead><tr>
              <th>Гравець</th><th>Ключ</th><th class="right">Баланс</th>
              <th class="right>Грейдів</th><th>Пасхалки</th><th>Нарахувати</th>
            </tr></thead>
            <tbody>
              ${rows.map(function (a) {
                const eggs = a.eggs.length
                  ? a.eggs.map(function (e) {
                      const title = eggHints[e.id] || e.id;
                      return `<span class="egg-tag" title="${escapeHtml(title)}">${escapeHtml(e.id)} +${formatNumber(e.reward)}</span>`;
                    }).join(' ')
                  : '<span class="muted">—</span>';

                return `<tr data-key="${escapeHtml(a.key)}">
                  <td>
                    <span class="admin-player">
                      ${avatarHTML({ avatar: a.avatar, name: a.name }, 'avatar--sm')}
                      <span class="admin-player__name">${escapeHtml(a.name)}${a.key === S.getAccount().key ? ' <em>(ви)</em>' : ''}</span>
                    </span>
                  </td>
                  <td><code class="code-chip code-chip--sm">${escapeHtml(a.key)}</code></td>
                  <td class="right"><b class="admin-bal">${formatNumber(a.balance)}</b> ${CUR}</td>
                  <td class="right">${a.wins}/${a.plays}</td>
                  <td class="admin-eggs">${eggs}</td>
                  <td>
                    <div class="admin-credit">
                      <input class="input input--sm admin-credit__amount" type="number"
                             step="1000" min="1" placeholder="25000" aria-label="Сума ${CUR}">
                      <button class="btn btn--sm btn--primary" type="button" data-act="credit">${icon('gift', 14)} Нарахувати</button>
                    </div>
                  </td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>

        <p class="admin-hint">
          ${icon('info', 14)}
          Знайшов пасхалок — нарахуйте йому бонус, як домовились.
          Нарахування одразу потрапляє в історію його акаунта.
        </p>`;

      box.querySelectorAll('[data-act="credit"]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          const tr = btn.closest('tr');
          const key = tr.dataset.key;
          const input = tr.querySelector('.admin-credit__amount');
          const amount = Number(input.value) || 0;

          if (!amount) {
            input.focus();
            toast('Впишіть суму, наприклад 10000', 'error');
            return;
          }

          const res = S.adminCredit(key, amount, 'Бонус за пасхалок');
          if (!res.ok) return toast(res.error, 'error');

          toast(res.message, 'promo', 5000);
          input.value = '';
          drawPlayers();
        });
      });
    }

    drawPlayers();

    /* ------------------------------ промокоди ----------------------------- */

    const codeInput = wrap.querySelector('#code');
    const reroll = function () { codeInput.value = S.randomCode(8); };

    wrap.querySelector('[data-act="reroll"]').addEventListener('click', reroll);
    reroll();

    wrap.querySelector('#create').addEventListener('submit', function (e) {
      e.preventDefault();
      const res = S.createPromoCode({
        code: codeInput.value,
        reward: wrap.querySelector('#reward').value,
        note: wrap.querySelector('#note').value,
        oncePerAccount: wrap.querySelector('#once').checked
      });

      if (!res.ok) return toast(res.error, 'error');

      toast('Створено: ' + res.code + ' — ' + formatNumber(res.promo.reward) + ' ' + CUR, 'promo', 6000);
      wrap.querySelector('#note').value = '';
      draw();
      reroll();
    });

    function draw() {
      const box = wrap.querySelector('#list');
      const rows = S.listCustomPromos();

      if (!rows.length) {
        box.innerHTML = `<div class="empty">${icon('bolt', 40)}<p>Промокодів ще немає</p></div>`;
        return;
      }

      box.innerHTML = `
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>Код</th><th>Нагорода</th><th>Нотатка</th><th>Створено</th><th></th></tr></thead>
            <tbody>
              ${rows.map(p => `<tr>
                <td><code class="code-chip">${escapeHtml(p.code)}</code></td>
                <td class="pos">${formatNumber(p.reward)} ${CUR}</td>
                <td class="muted">${escapeHtml(p.note || '—')}</td>
                <td class="muted">${new Date(p.createdAt).toLocaleString('uk-UA')}</td>
                <td><button class="btn btn--sm btn--danger" type="button" data-del="${escapeHtml(p.code)}">Видалити</button></td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>`;

      box.querySelectorAll('[data-del]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          const code = btn.dataset.del;
          confirmDialog({
            title: 'Видалити промокод?',
            message: `Код <b>${escapeHtml(code)}</b> перестане діяти. Вже активовані нарахування залишаться.`,
            confirmLabel: 'Видалити'
          }).then(function (yes) {
            if (!yes) return;
            S.deletePromoCode(code);
            toast('Промокод видалено', 'info');
            draw();
          });
        });
      });
    }

    draw();
    return wrap;
  };

  /* --------------------------------- Вхід --------------------------------- */

  /* Копіювання тексту. На file:// navigator.clipboard часто недоступний,
     тому спершу пробуємо сучасний API, а потім — execCommand. */
  function copyText(text) {
    const done = function () { toast('Скопійовано', 'success'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { legacyCopy(text, done); });
    } else {
      legacyCopy(text, done);
    }
    return false;
  }

  function legacyCopy(text, done) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    if (ok) done();
    else toast('Не вдалося скопіювати — виділіть ключ вручну', 'error');
  }

  function dateOf(ts) {
    try {
      return new Intl.DateTimeFormat('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(ts));
    } catch (e) { return ''; }
  }

  /** Рядки «Мої акаунти». Активний акаунт підсвічується й неактивний. */
  function accListHTML(currentKey) {
    const rows = S.listAccounts();
    if (!rows.length) return '';
    return `<div class="acc-list">
      <span class="acc-list__label">Мої акаунти в цьому браузері</span>
      ${rows.map(function (a) {
        const isCur = a.key === currentKey;
        return `<button class="acc-row${isCur ? ' is-cur' : ''}" type="button"
                        data-acc="${escapeHtml(a.key)}"${isCur ? ' disabled' : ''}>
          ${avatarHTML(a, 'avatar--sm')}
          <span class="acc-row__text">
            <span class="acc-row__name">${escapeHtml(a.name)}</span>
            <code class="acc-row__key">${escapeHtml(a.key)}</code>
            <span class="acc-row__date">${isCur ? 'зараз ви тут' : dateOf(a.createdAt)}</span>
          </span>
        </button>`;
      }).join('')}
      <p class="acc-list__hint">Натисніть на акаунт, щоб перемкнутися на нього — ключ вводити не потрібно.</p>
    </div>`;
  }

  /** Перемикання на інший акаунт із будь-якого екрана. */
  function switchAccount(key) {
    const res = S.login(key);
    if (!res.ok) { toast(res.error, 'error'); return false; }
    toast('Ви перейшли в акаунт «' + res.account.name + '»', 'success');
    location.hash = '#/home';
    render();
    return true;
  }

  PAGES.login = function () {
    const account = S.getAccount();

    if (account) {
      const others = accListHTML(account.key);
      const el = document.createElement('div');
      el.className = 'page page--login page--center';
      el.innerHTML = `
        <div class="login-card">
          <span class="login-card__icon login-card__icon--ok">${avatarHTML(account, 'avatar--lg avatar--ring')}</span>
          <h1>Ви авторизовані</h1>
          <p>${escapeHtml(account.name)} · ${formatNumber(account.balance)} ${CUR}</p>
          <p class="login-card__keylbl">Ваш ключ</p>
          <code class="login-card__key">${escapeHtml(account.key)}</code>
          <div class="login-card__actions">
            <a class="btn btn--primary" href="#/market">Маркетплейс</a>
            <a class="btn btn--ghost" href="#/wallet">Гаманець</a>
            <a class="btn btn--ghost" href="#/upgrade">Апгрейд</a>
            <a class="btn btn--ghost" href="#/leaders">Лідерборд</a>
            <button class="btn btn--ghost" type="button" data-act="logout">Вийти</button>
          </div>
          ${others}
        </div>`;

      el.querySelector('[data-act="logout"]').addEventListener('click', function () {
        S.logout();
        toast('Ви вийшли з акаунту', 'info');
        location.hash = '#/login';
        render();
      });

      const list = el.querySelector('.acc-list');
      if (list) {
        list.addEventListener('click', function (e) {
          const row = e.target.closest('[data-acc]');
          if (!row || row.disabled) return;
          switchAccount(row.dataset.acc);
        });
      }
      return el;
    }

    const wrap = document.createElement('div');
    wrap.className = 'page page--login page--center';

    const demoRows = Object.entries(DEMO_KEYS);

    const demoKeys = demoRows.length ? `
          <div class="demo-keys">
            <span class="demo-keys__label">Демо-ключі</span>
            ${demoRows.map(function (kv) {
              return `<button class="demo-key" type="button" data-key="${escapeHtml(kv[0])}">
                <code>${escapeHtml(kv[0])}</code>
                <span>${escapeHtml(kv[1].name)} · ${formatNumber(kv[1].balance)} ${CUR}</span>
              </button>`;
            }).join('')}
            <p class="demo-keys__hint">Демо-ключі — для прикладу. Свої акаунти створюйте у вкладці праворуч.</p>
          </div>` : '';

    wrap.innerHTML = `
      <div class="login-card">

        <div class="auth-tabs" role="tablist">
          <button class="auth-tab is-on" type="button" role="tab" data-tab="in" aria-selected="true">Увійти</button>
          <button class="auth-tab" type="button" role="tab" data-tab="up" aria-selected="false">Створити акаунт</button>
        </div>

        <!-- ------------------------------ вхід ------------------------------ -->
        <section class="auth-pane" data-pane="in">
          <span class="login-card__icon">${icon('key', 26)}</span>
          <h1>Вхід</h1>
          <p class="login-card__sub">Введіть свій пароль. Якщо акаунта ще немає — створіть його на вкладці праворуч.</p>

          <form class="login-form" id="f-in" autocomplete="off">
            <label class="label" for="key">Пароль або ключ</label>
            <input class="input input--lg" id="key" placeholder="ваш пароль"
                   autocomplete="off" spellcheck="false">
            <div class="login-form__err" id="err-in" hidden></div>
            <button class="btn btn--primary btn--lg btn--block" type="submit">Увійти</button>
          </form>

          ${accListHTML(null)}

          ${demoKeys}
        </section>

        <!-- --------------------------- реєстрація --------------------------- -->
        <section class="auth-pane" data-pane="up" hidden>
          <span class="login-card__icon login-card__icon--new">${icon('spark', 26)}</span>
          <h1>Створити акаунт</h1>
          <p class="login-card__sub">Придумайте ім’я і пароль — який хочете. Без цифр, без «RG-», без Steam.</p>

          <form class="login-form" id="f-up" autocomplete="off">
            <label class="label" for="nick">Ім’я акаунта</label>
            <input class="input input--lg" id="nick" placeholder="Наприклад, Дракон" maxlength="24" autocomplete="off">

            <label class="label label--mt" for="newkey">Пароль</label>
            <div class="key-row">
              <input class="input input--lg" id="newkey" placeholder="наприклад: дракон"
                     autocomplete="off" spellcheck="false" maxlength="32">
              <button class="btn btn--ghost" type="button" id="gen" title="Згенерувати ключ RG-XXXX-XXXX-XXXX-XXXX">
                ${icon('spark', 16)} Ключ
              </button>
            </div>
            <p class="login-form__hint">
              Мінімум ${SECRET_MIN} символи. Можна будь-які літери, цифри, пробіли — «дракон», «Drakon 2010», «12345».
              Натисніть «Ключ», щоб ми згенерували ключ замість пароля.
              <b>Пароль нікуди не відправляється</b> і зберігається лише у вашому браузері — але відновити його неможливо.
            </p>

            <div class="login-form__err" id="err-up" hidden></div>
            <button class="btn btn--primary btn--lg btn--block" type="submit">Створити акаунт</button>
          </form>

          <!-- екран після реєстрації -->
          <div class="key-out" id="key-out" hidden>
            <span class="key-out__badge">${icon('check', 22)}</span>
            <h2>Акаунт створено</h2>
            <p class="key-out__sub" id="key-out-sub"></p>
            <output class="key-out__key" id="key-out-val"></output>
            <div class="key-out__actions">
              <button class="btn btn--primary btn--block" type="button" data-act="copy">Скопіювати пароль</button>
              <a class="btn btn--ghost btn--block" href="#/home">Почати</a>
            </div>
          </div>
        </section>

      </div>`;

    /* ----------------------------- вкладки ------------------------------ */

    const panes = Array.prototype.slice.call(wrap.querySelectorAll('[data-pane]'));
    const tabs = Array.prototype.slice.call(wrap.querySelectorAll('.auth-tab'));

    function showTab(name) {
      tabs.forEach(function (t) {
        const on = t.dataset.tab === name;
        t.classList.toggle('is-on', on);
        t.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      panes.forEach(function (p) { p.hidden = p.dataset.pane !== name; });
    }

    wrap.querySelector('.auth-tabs').addEventListener('click', function (e) {
      const t = e.target.closest('[data-tab]');
      if (t) showTab(t.dataset.tab);
    });

    /* ------------------------------- вхід ------------------------------- */

    const formIn = wrap.querySelector('#f-in');
    const input = wrap.querySelector('#key');
    const errIn = wrap.querySelector('#err-in');

    formIn.addEventListener('submit', function (e) {
      e.preventDefault();
      const res = S.login(input.value);
      if (!res.ok) {
        errIn.hidden = false;
        errIn.textContent = res.error;
        return;
      }
      toast(res.isNew ? 'Акаунт створено. Ласкаво просимо!' : 'Вхід виконано', 'success');
      location.hash = '#/home';
      render();
    });

    input.addEventListener('input', function () { errIn.hidden = true; });

    /* мій акаунт — миттєвий вхід без введення ключа */
    const accList = wrap.querySelector('.acc-list');
    if (accList) {
      accList.addEventListener('click', function (e) {
        const row = e.target.closest('[data-acc]');
        if (!row) return;
        if (!switchAccount(row.dataset.acc)) {
          errIn.hidden = false;
          errIn.textContent = 'Не вдалося увійти цим ключем';
        }
      });
    }

    /* демо-ключі — підставляємо у поле */
    const demoBox = wrap.querySelector('.demo-keys');
    if (demoBox) {
      demoBox.addEventListener('click', function (e) {
        const btn = e.target.closest('[data-key]');
        if (!btn) return;
        showTab('in');
        input.value = btn.dataset.key;
        errIn.hidden = true;
        input.focus();
      });
    }

    /* --------------------------- реєстрація ----------------------------- */

    const formUp = wrap.querySelector('#f-up');
    const nick = wrap.querySelector('#nick');
    const newKey = wrap.querySelector('#newkey');
    const errUp = wrap.querySelector('#err-up');
    const keyOut = wrap.querySelector('#key-out');
    const keyOutVal = wrap.querySelector('#key-out-val');
    const keyOutSub = wrap.querySelector('#key-out-sub');

    formUp.querySelector('#gen').addEventListener('click', function () {
      newKey.value = S.generateKey();
      errUp.hidden = true;
      newKey.focus();
    });

    newKey.addEventListener('input', function () { errUp.hidden = true; });

    formUp.addEventListener('submit', function (e) {
      e.preventDefault();
      const typed = newKey.value.trim();
      const res = S.register(newKey.value, nick.value);
      if (!res.ok) {
        errUp.hidden = false;
        errUp.textContent = res.error;
        return;
      }
      /* показуємо пароль великим блоком: після цього він лишається
         тільки в цьому браузері, тож користувач мусить його зберегти */
      formUp.hidden = true;
      keyOut.hidden = false;
      keyOutVal.textContent = res.account.key;
      keyOutSub.innerHTML = icon('warn', 15) + (typed
        ? ' Це ваш пароль. Запам’ятайте або скопіюйте — відновити його неможливо.'
        : ' Ми згенерували ключ замість пароля. Запам’ятайте або скопіюйте його — відновити неможливо.');
    });

    /* копіювання показаного ключа */
    keyOut.addEventListener('click', function (e) {
      if (!e.target.closest('[data-act="copy"]')) return;
      copyText(keyOutVal.textContent);
    });

    setTimeout(function () { (nick.value ? newKey : input).focus(); }, 80);
    return wrap;
  };

  /* -------------------------------- Службове ------------------------------ */

  /**
   * Сторінка «це не ваш акаунт». Ключі адмінів лежать у data.js, тож
   * іншим гравцям вона нічого не розкриває — лише каже, що зайти не можна.
   */
  function notYourAdmin() {
    const el = document.createElement('div');
    el.className = 'page page--center';
    el.innerHTML = `
      <div class="login-card">
        <span class="login-card__icon">${icon('lock', 26)}</span>
        <h1>Це не для вашого акаунта</h1>
        <p class="login-card__sub">Панель автора доступна тільки власнику сайту.</p>
        <a class="btn btn--primary btn--lg" href="#/home">На головну</a>
      </div>`;
    return el;
  }

  function needAuth(message) {
    const el = document.createElement('div');
    el.className = 'page page--center page--need-auth';
    el.innerHTML = `
      <div class="login-card">
        <span class="login-card__icon">${icon('key', 26)}</span>
        <h1>Потрібен вхід</h1>
        <p class="login-card__sub">${message}</p>
        <a class="btn btn--primary btn--lg" href="#/login">Увійти за ключем</a>
        <a class="btn btn--ghost" href="#/market">Переглянути каталог</a>
      </div>`;
    return el;
  }

  /* ==========================================================================
     Таблиця лідерів за день
     ========================================================================== */

  /** Маска ключа для публічної таблиці: пароль не показуємо повністю. */
  function maskKey(key) {
    const s = String(key || '');
    if (s.length <= 2) return s;
    return s.slice(0, 1) + '•'.repeat(Math.min(8, s.length - 2)) + s.slice(-1);
  }

  const DAY_TABS = [0, 1, 2, 7];

  PAGES.leaders = function (param) {
    const me = S.getAccount();
    const raw = Number(param);
    const offset = DAY_TABS.indexOf(raw) !== -1 ? raw : 0;

    const sum = S.leaderboardSummary(offset);
    const label = S.dayLabel(offset);

    const wrap = document.createElement('div');
    wrap.className = 'page page--leaders';

    const medals = ['🥇', '🥈', '🥉'];

    wrap.innerHTML = `
      <header class="page__head">
        <div>
          <h1 class="page__title">Лідерборд</h1>
          <p class="page__sub">Хто скільки <b>вибив</b> за ${escapeHtml(label)} — за цю добу рахуються всі надходження на акаунти</p>
        </div>
      </header>

      <div class="lead-tabs">
        ${DAY_TABS.map(function (d) {
          return `<button class="lead-tab${d === offset ? ' is-on' : ''}" type="button" data-day="${d}">
            ${escapeHtml(S.dayLabel(d))}
          </button>`;
        }).join('')}
      </div>

      <div class="lead-cards">
        <div class="lead-card">
          <span class="lead-card__label">Вибито за ${escapeHtml(label)}</span>
          <span class="lead-card__value">${formatNumber(sum.total)} <i>${CUR}</i></span>
        </div>
        <div class="lead-card">
          <span class="lead-card__label">Гравців сьогодні</span>
          <span class="lead-card__value">${sum.active} <i>з ${sum.players}</i></span>
        </div>
      </div>

      ${sum.rows.length ? `
      <div class="table-wrap">
        <table class="table table--lead">
          <thead>
            <tr>
              <th class="lead-num">#</th>
              <th>Нік</th>
              <th class="lead-money">Вибито</th>
              <th class="lead-money">Витрачено</th>
              <th class="lead-money">Підсумок</th>
              <th>Виграно</th>
              <th class="lead-money">Баланс</th>
              <th>Предметів</th>
            </tr>
          </thead>
          <tbody>
            ${sum.rows.map(function (r, i) {
              const isMe = me && r.key === me.key;
              return `<tr class="${isMe ? 'is-me' : ''}">
                <td class="lead-num">${medals[i] || (i + 1)}</td>
                <td class="lead-name">
                  <span class="lead-who">
                    ${avatarHTML(r, 'avatar--sm')}
                    <span class="lead-who__text">
                      ${escapeHtml(r.name)}
                      ${isMe ? '<span class="lead-tag">це ви</span>' : ''}
                      <code class="lead-key">${escapeHtml(maskKey(r.key))}</code>
                    </span>
                  </span>
                </td>
                <td class="lead-money pos">${r.won ? '+' + formatNumber(r.won) : '—'}</td>
                <td class="lead-money neg">${r.spent ? '−' + formatNumber(r.spent) : '—'}</td>
                <td class="lead-money ${r.net > 0 ? 'pos' : r.net < 0 ? 'neg' : 'muted'}">
                  ${r.net ? (r.net > 0 ? '+' : '−') + formatNumber(Math.abs(r.net)) : '0'}
                </td>
                <td class="muted">${r.wins}${r.plays ? ` <span class="muted">/ ${r.plays}</span>` : ''}</td>
                <td class="lead-money">${formatNumber(r.balance)}</td>
                <td class="muted">${r.items}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>` : `
      <div class="panel"><p class="panel__hint">${icon('warn', 16)} Акаунтів поки немає. Створіть перший на сторінці
        <a href="#/login">входу</a> — і він з’явиться в таблиці.</p></div>`}

      <!-- Чесна відмова: без сервера чужих акаунтів не існує. -->
      ${sum.rows.length > 1 ? '' : `
      <div class="lead-note">
        ${icon('info', 16)}
        <div>
          <b>Чому тут лише свої акаунти</b><br>
          Сайт працює без сервера: кожен акаунт лежить у пам’яті того браузера,
          де його створили. Ваш комп’ютер не бачить акаунтів інших людей —
          так само, як інші не бачать ваших. Спільний лідерборд потребує сервера
          з базою даних, а це вже не статичний сайт.
          ${sum.rows.length > 1
            ? ''
            : '<br>Створіть тут кілька акаунтів через <a href="#/login">вхід</a> — тоді таблиця покаже їх усі.'}
        </div>
      </div>`}

      <p class="lead-note">
        ${icon('warn', 15)}
        Рахується з історії операцій акаунтів, створених <b>у цьому браузері</b>.
        Гравець на іншому комп’ютері сюди не потрапить — сервера немає, тому спільної
        таблиці на всіх не існує. Якщо потрібна одна таблиця для всіх — треба
        бекенд.
      </p>`;

    wrap.querySelector('.lead-tabs').addEventListener('click', function (e) {
      const b = e.target.closest('[data-day]');
      if (!b) return;
      location.hash = '#/leaders/' + b.dataset.day;
    });

    return wrap;
  };

  PAGES.notFound = function () {
    const el = document.createElement('div');
    el.className = 'page page--center page--404';
    el.innerHTML = `
      <div class="login-card">
        <span class="login-card__icon">${icon('search', 26)}</span>
        <h1>404</h1>
        <p class="login-card__sub">Сторінку не знайдено</p>
        <a class="btn btn--primary" href="#/home">На головну</a>
      </div>`;
    return el;
  };

  /* ==========================================================================
     Підвал
     ========================================================================== */

  function footer() {
    const el = document.createElement('footer');
    el.className = 'ftr';
    el.innerHTML = `
      <div class="ftr__inner">
        <div class="ftr__brand">
          <span class="logo__mark">${icon('bolt', 18)}</span>
          <span class="logo__text">RUST<em>GRADE</em></span>
          <p>Маркетплейс предметів та апгрейд. Вхід за власним ключем — без Steam.</p>
        </div>
        <div class="ftr__col">
          <h4>Розділи</h4>
          <a href="#/market">Маркетплейс</a>
          <a href="#/upgrade">Апгрейд</a>
          <a href="#/inventory">Інвентар</a>
          <a href="#/wallet">Гаманець</a>
          <a href="#/leaders">Лідерборд</a>
        </div>
        <div class="ftr__col">
          <h4>Каталог</h4>
          ${CATEGORIES.slice(0, 4).map(c => `<a href="#/market">${c.name}</a>`).join('')}
        </div>
      </div>
      <div class="ftr__bottom">
        <span>© ${new Date().getFullYear()} RUSTGRADE</span>
        <span>${CUR} — ігрова валюта. Ціни модельні, не підлягають виводу в реальні гроші</span>
      </div>`;
    return el;
  }

  /* ==========================================================================
     Роутер
     ========================================================================== */

  const TITLES = {
    home: 'Головна', market: 'Маркетплейс', upgrade: 'Апгрейд',
    inventory: 'Інвентар', wallet: 'Гаманець', login: 'Вхід',
    leaders: 'Лідерборд', admin: 'Промокоди'
  };

  function resolveRoute() {
    const raw = location.hash.replace(/^#\/?/, '');
    const parts = raw.split('/');
    return { name: parts[0] || 'home', param: parts[1] };
  }

  function render() {
    const route = resolveRoute();
    const page = PAGES[route.name] || PAGES.notFound;
    const content = page(route.param);

    document.title = `${TITLES[route.name] || 'RUSTGRADE'} — RUSTGRADE`;

    app.innerHTML = '';
    app.appendChild(header());

    const main = document.createElement('main');
    main.id = 'view';
    if (typeof content === 'string') main.innerHTML = content;
    else main.appendChild(content);
    app.appendChild(main);
    app.appendChild(footer());

    document.querySelectorAll('[data-nav]').forEach(function (el) {
      el.addEventListener('click', function (e) {
        e.preventDefault();
        location.hash = el.dataset.nav;
      });
    });

    document.querySelectorAll('.hdr__link').forEach(function (el) {
      el.classList.toggle('is-active', el.dataset.key === route.name);
    });

    document.querySelector('[data-act="logout"]')?.addEventListener('click', function () {
      S.logout();
      location.hash = '#/home';
      render();
    });

    bindEggs(main);
  }

  window.addEventListener('hashchange', function () {
    upgradeSelection = emptySelection();
    shown = PAGE_SIZE;
    render();
    window.scrollTo({ top: 0 });
  });

  render();
})(window.RG = window.RG || {});
