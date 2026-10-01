/* ==========================================================================
   ui.js — тости, модалки, картки предметів, дрібні хелпери
   ========================================================================== */
(function (RG) {
  'use strict';

  const RARITIES     = RG.DATA.RARITIES;
  const CATEGORIES   = RG.DATA.CATEGORIES;
  const itemIcon     = RG.icons.itemIcon;
  const itemImage    = RG.icons.itemImage;
  const icon         = RG.icons.icon;
  const formatNumber = RG.store.formatNumber;
  const upgradeOdds  = RG.store.upgradeOdds;
  const CUR          = RG.DATA.CURRENCY.code;

  function rarityOf(item) {
    return RARITIES[item.rarity] || RARITIES.common;
  }

  function categoryName(catId) {
    const found = CATEGORIES.filter(function (c) { return c.id === catId; })[0];
    return found ? found.name : '';
  }

  function escapeHtml(str) {
    return String(str === undefined || str === null ? '' : str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* --------------------------------- тости -------------------------------- */

  let toastHost = null;

  function toast(message, kind, ms) {
    if (!toastHost) {
      toastHost = document.createElement('div');
      toastHost.className = 'toast-host';
      document.body.appendChild(toastHost);
    }

    kind = kind || 'info';
    const icons = { success: 'check', error: 'warn', info: 'spark', promo: 'bolt' };
    const el = document.createElement('div');
    el.className = 'toast toast--' + kind;
    el.innerHTML = '<span class="toast__icon">' + icon(icons[kind] || 'spark', 18) +
      '</span><span class="toast__msg"></span>';
    el.querySelector('.toast__msg').textContent = message || '';

    toastHost.appendChild(el);
    requestAnimationFrame(function () { el.classList.add('is-in'); });

    setTimeout(function () {
      el.classList.remove('is-in');
      setTimeout(function () { el.remove(); }, 260);
    }, ms || 4200);
  }

  /* -------------------------------- модалка ------------------------------- */

  /**
   * modal({ title, body, actions, width, onClose })
   * actions: [{ label, variant, onClick(close) }]
   */
  function modal(opts) {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';

    const title = document.createElement('h3');
    title.className = 'modal__title';
    title.textContent = opts.title || '';

    backdrop.innerHTML =
      '<div class="modal" role="dialog" aria-modal="true" style="max-width:' + (opts.width || 460) + 'px">' +
        '<div class="modal__head">' +
          '<h3 class="modal__title"></h3>' +
          '<button class="icon-btn" data-close type="button" aria-label="Закрити">' + icon('close', 18) + '</button>' +
        '</div>' +
        '<div class="modal__body"></div>' +
        '<div class="modal__foot"></div>' +
      '</div>';

    backdrop.querySelector('.modal__title').textContent = opts.title || '';

    const bodyEl = backdrop.querySelector('.modal__body');
    if (typeof opts.body === 'string') bodyEl.innerHTML = opts.body;
    else if (opts.body) bodyEl.appendChild(opts.body);

    const foot = backdrop.querySelector('.modal__foot');
    let closed = false;

    function close() {
      if (closed) return;
      closed = true;
      backdrop.classList.remove('is-in');
      document.removeEventListener('keydown', onKey);
      setTimeout(function () { backdrop.remove(); }, 200);
      if (typeof opts.onClose === 'function') opts.onClose();
    }

    function onKey(e) {
      if (e.key === 'Escape') close();
    }

    if (opts.actions && opts.actions.length) {
      opts.actions.forEach(function (a) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn ' + (a.variant ? 'btn--' + a.variant : 'btn--primary');
        b.textContent = a.label;
        b.addEventListener('click', function () {
          const keep = a.onClick ? a.onClick(close) : undefined;
          if (!keep) close();
        });
        foot.appendChild(b);
      });
    } else {
      foot.remove();
    }

    backdrop.addEventListener('click', function (e) {
      if (e.target === backdrop || e.target.closest('[data-close]')) close();
    });
    document.addEventListener('keydown', onKey);

    document.body.appendChild(backdrop);
    requestAnimationFrame(function () { backdrop.classList.add('is-in'); });

    return { close: close, root: backdrop, body: bodyEl };
  }

  /** Діалог підтвердження. Завжди resolve: true або false. */
  function confirmDialog(opts) {
    return new Promise(function (resolve) {
      let settled = false;
      function settle(value) {
        if (settled) return;
        settled = true;
        resolve(value);
      }

      modal({
        title: opts.title,
        body: '<p class="modal__text">' + (opts.message || '') + '</p>',
        width: opts.width || 440,
        onClose: function () { settle(false); },
        actions: [
          { label: 'Скасувати', variant: 'ghost', onClick: function () { settle(false); } },
          { label: opts.confirmLabel || 'Підтвердити', variant: opts.variant || 'danger', onClick: function () { settle(true); } }
        ]
      });
    });
  }

  /* --------------------------- шанс апгрейду (UI) ------------------------ */

  function oddsClass(odds) {
    if (odds >= 0.45) return 'high';
    if (odds >= 0.18) return 'middle';
    return 'low';
  }

  function oddsBadge(fromItem, toItem) {
    const odds = upgradeOdds(fromItem.price, toItem.price);
    return '<span class="odds odds--' + oddsClass(odds) + '">' + (odds * 100).toFixed(1) + '%</span>';
  }

  /* ---------------------------- картка предмету --------------------------- */

  function itemCard(item, handlers) {
    handlers = handlers || {};
    const r = rarityOf(item);
    const owned = !!handlers.owned;

    const card = document.createElement('article');
    card.className = 'item-card item-card--' + item.rarity;
    card.style.setProperty('--rar', r.color);
    card.style.setProperty('--bg', '#' + (item.bg || '161616'));
    card.tabIndex = 0;
    card.setAttribute('role', 'button');

    card.innerHTML =
      '<div class="item-card__glow"></div>' +
      '<div class="item-card__top">' +
        '<span class="item-card__cat">' + escapeHtml(categoryName(item.cat)) + '</span>' +
        (owned ? '<span class="item-card__owned">В інвентарі</span>' : '') +
      '</div>' +
      '<div class="item-card__art">' + itemImage(item, 88) + '</div>' +
      '<div class="item-card__info">' +
        '<h3 class="item-card__name"></h3>' +
        '<span class="item-card__rarity" style="color:' + r.color + '">' + r.name + '</span>' +
      '</div>' +
      '<div class="item-card__foot">' +
        '<span class="item-card__price">' + formatNumber(item.price) + ' <i>' + CUR + '</i>' +
          (item.usd ? '<em class="item-card__usd">$' + item.usd.toFixed(2) + '</em>' : '') +
        '</span>' +
        '<div class="item-card__btns">' +
          '<button class="btn btn--sm btn--ghost" data-act="open" type="button">Деталі</button>' +
          (handlers.onUpgrade ? '<button class="btn btn--sm btn--primary" data-act="up" type="button">' +
            escapeHtml(handlers.upgradeLabel || 'Грейдити') + '</button>' : '') +
        '</div>' +
      '</div>';

    card.querySelector('.item-card__name').textContent = item.name;

    const openBtn = card.querySelector('[data-act="open"]');
    if (openBtn && handlers.openLabel) openBtn.textContent = handlers.openLabel;

    // Клік по картці = деталі; клік по кнопці апгрейду = вибір для апгрейду
    card.addEventListener('click', function (e) {
      const act = e.target.closest('[data-act]') ? e.target.closest('[data-act]').dataset.act : null;
      if (act === 'up') return;
      if (typeof handlers.onOpen === 'function') handlers.onOpen(item);
    });

    card.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (typeof handlers.onOpen === 'function') handlers.onOpen(item);
      }
    });

    const upBtn = card.querySelector('[data-act="up"]');
    if (upBtn && handlers.onUpgrade) {
      upBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        handlers.onUpgrade(item);
      });
    }

    return card;
  }

  /**
   * Невелике свято: осколки кольору, що розлітаються з центру екрана.
   * Використовується за пасхалок і виграш на колесі. Без зовнішніх
   * картинок — усе на DOM, тож важить нуль байт.
   */
  function celebrate(colors) {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const palette = colors || ['#84b030', '#ffe32c', '#f2f3f2', '#d2290f'];
    const host = document.createElement('div');
    host.className = 'celebrate';
    host.setAttribute('aria-hidden', 'true');

    for (var i = 0; i < 42; i++) {
      const p = document.createElement('i');
      const angle = (i / 42) * Math.PI * 2 + Math.random() * 0.4;
      const dist = 120 + Math.random() * 220;
      p.style.setProperty('--x', Math.round(Math.cos(angle) * dist) + 'px');
      p.style.setProperty('--y', Math.round(Math.sin(angle) * dist) + 'px');
      p.style.setProperty('--r', Math.round(Math.random() * 540 - 270) + 'deg');
      p.style.setProperty('--c', palette[i % palette.length]);
      p.style.animationDelay = (Math.random() * 0.12).toFixed(3) + 's';
      p.style.animationDuration = (0.9 + Math.random() * 0.7).toFixed(2) + 's';
      host.appendChild(p);
    }

    document.body.appendChild(host);
    setTimeout(function () { host.remove(); }, 2200);
  }

  RG.ui = {
    toast: toast,
    celebrate: celebrate,
    modal: modal,
    confirmDialog: confirmDialog,
    rarityOf: rarityOf,
    categoryName: categoryName,
    escapeHtml: escapeHtml,
    oddsClass: oddsClass,
    oddsBadge: oddsBadge,
    itemIcon: itemIcon,
    itemImage: itemImage,
    itemCard: itemCard
  };
})(window.RG = window.RG || {});
