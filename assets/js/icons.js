/* ==========================================================================
   icons.js — набір SVG-іконок предметів та інтерфейсу (viewBox 0 0 24 24)
   ========================================================================== */
(function (RG) {
  'use strict';

  const PATHS = {
    rifle:   '<path d="M2 9h13v2H2zm13 0h7v3h-7zM4 11l-2 5h4l1-5zm7 1 2 6h4l-2-6z"/>',
    smg:     '<path d="M4 9h12v3H4zm12 1h5v2h-5zM6 12l1 6h4l-1-6z"/>',
    shotgun: '<path d="M1 9h21v3H1zM5 12h6v5H5zm9 0h5v4h-5z"/>',
    sniper:  '<path d="M1 10h15v2H1zm15-1h7v3h-7zM5 12h4v5H5zM9 8h5v2H9z"/>',
    pistol:  '<path d="M5 8h14v3H5zm2 3 1 8h4l-1-8zm10 0v4h3v-4z"/>',
    bow:     '<path d="M6 2a13 13 0 0 1 0 20v-2.4A10.6 10.6 0 0 0 6 4.4zM6 3.2v17.6h1.2V3.2zM2 11.4h19v1.2H2z"/><path d="M18.2 9.2 21.6 11.4l-3.4 2.2z"/>',
    melee:   '<path d="M3 14.5 10 8l11 3-4.5 6L8 15zM3 14.5 1 22l6.5-2.6z"/>',
    vest:    '<path d="M7 5l5-2 5 2 2 4v10H5V9zM10 9h4v6h-4z"/>',
    helmet:  '<path d="M4 15a8 8 0 0 1 16 0v2.5H4zM2 17.5h20V20H2z"/>',
    backpack:'<path d="M7 7h10v14H7zM10 4h4v3h-4zM9 11h6v2H9z"/>',
    resource:'<path d="m12 2.5 9 5.2v9.6l-9 5.2-9-5.2V7.7zM8.5 11h7v2h-7z"/>',
    clothing: '<path d="M9 3 4 6v5l3-1v11h10V10l3 1V6l-5-3zM9 5.2 12 7l3-1.8-1.2-.8-1.8 1.1-1.8-1.1z"/>',
    vehicle: '<path d="M3 16v-3l2-5h12l3 5v3h-2a2 2 0 0 1-4 0H9a2 2 0 0 1-4 0zm4-6-1 3h12l-1-3z"/>',
    box:     '<path d="M3 8h18v12H3zm2 2v8h14v-8zM9 8V5h6v3z"/>',
    misc:    '<path d="M12 2.8 21 8v8l-9 5.2L3 16V8zm0 2.3L6 8.6l6 3.5 6-3.5zM5 10.4v4.3l6 3.5v-4.3zm14 0-6 3.5v4.3l6-3.5z"/>'
  };

  const STROKE = {
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    plus:   '<path d="M12 5v14M5 12h14"/>',
    check:  '<path d="m4 12.5 5 5L20 6.5"/>',
    close:  '<path d="M6 6l12 12M18 6 6 18"/>',
    arrow:  '<path d="M5 12h14m-5-5 5 5-5 5"/>',
    coin:   '<circle cx="12" cy="12" r="9"/><path d="M12 7v10M9.5 9.5h5M9.5 14.5h5"/>',
    key:    '<circle cx="8" cy="12" r="4"/><path d="M12 12h9m-3 0v3m-2-3v2"/>',
    spark:  '<path d="M12 3v6m0 6v6M3 12h6m6 0h6M6 6l3 3m6 6 3 3M18 6l-3 3M9 15l-3 3"/>',
    shield: '<path d="M12 3 5 6v6c0 4 3 7 7 9 4-2 7-5 7-9V6z"/>',
    bag:    '<path d="M5 8h14l-1 12H6zM9 8V6a3 3 0 0 1 6 0v2"/>',
    bolt:   '<path d="M13 2 5 13h6l-1 9 8-11h-6z"/>',
    chart:  '<path d="M4 20V10m5 10V4m5 16v-7m5 7V8"/>',
    logout: '<path d="M15 5H6v14h9M11 12h10m-3-3 3 3-3 3"/>',
    filter: '<path d="M3 5h18l-7 8v6l-4 2v-8z"/>',
    warn:   '<path d="M12 3 2 20h20zM12 9v5m0 3v.5"/>',
    camera: '<path d="M3 8h4l1.6-2.4h6.8L17 8h4v11H3z"/><circle cx="12" cy="13" r="3.6"/>',
    image:  '<rect x="3" y="4.5" width="18" height="15" rx="2"/><circle cx="8.6" cy="9.6" r="1.6"/><path d="m4 17 4.8-4.6L13 16.6l3.2-2.8L20 17.4"/>',
    trash:  '<path d="M4 7h16M9 7V4.5h6V7M6 7l1 13h10l1-13M10 11v6M14 11v6"/>',
    play:   '<circle cx="12" cy="12" r="9"/><path d="M10.2 8.6 15.6 12l-5.4 3.4z"/>',
    back:   '<path d="M19 12H5m5-5-5 5 5 5"/>',
    info:   '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-9v.5"/>',
    user:   '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    lock:   '<rect x="4.5" y="10" width="15" height="10.5" rx="2"/><path d="M8 10V7.5a4 4 0 0 1 8 0V10"/>',
    gift:   '<rect x="3.5" y="9" width="17" height="11" rx="1.5"/><path d="M2.5 9h19M12 9v11M12 9S9.5 4 7.6 5.4 9.8 9 12 9Zm0 0s2.5-5 4.4-3.6S14.2 9 12 9Z"/>'
  };

  function strokeSvg(body, size) {
    return '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size +
      '" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"' +
      ' stroke-linejoin="round" aria-hidden="true" focusable="false">' + body + '</svg>';
  }

  /** Іконка предмету за категорією — заливається кольором рідкості. */
  function itemIcon(iconName, size) {
    const body = PATHS[iconName] || PATHS.resource;
    const s = size || 40;
    return '<svg viewBox="0 0 24 24" width="' + s + '" height="' + s +
      '" fill="currentColor" aria-hidden="true" focusable="false">' + body + '</svg>';
  }

  /**
   * Зображення предмета: справжня іконка скіна з assets/img/skins,
   * якщо вона є, інакше — схематична іконка категорії.
   */
  function itemImage(item, size) {
    if (!item) return '';
    if (item.img) {
      return '<img class="item-img" src="' + item.img + '" alt="" loading="lazy" decoding="async"' +
        ' width="' + size + '" height="' + size + '" data-fb="' + (item.icon || 'misc') + '"' +
        ' draggable="false">';
    }
    return itemIcon(item.icon, size);
  }

  // Якщо іконка скіна не завантажилась — підставляємо схематичну іконку
  // категорії, щоб картка ніколи не показувала «биту картинку».
  document.addEventListener('error', function (e) {
    const img = e.target;
    if (!img || img.tagName !== 'IMG') return;
    const fb = img.getAttribute && img.getAttribute('data-fb');
    if (!fb) return;
    const s = img.getAttribute('width') || 64;
    const svg = itemIcon(fb, s);
    if (img.parentNode) img.parentNode.innerHTML = svg;
  }, true);

  /** Іконка інтерфейсу (обведення). */
  function icon(name, size) {
    const body = STROKE[name];
    if (!body) return '';
    return strokeSvg(body, size || 20);
  }

  RG.icons = { itemIcon: itemIcon, itemImage: itemImage, icon: icon };
})(window.RG = window.RG || {});
