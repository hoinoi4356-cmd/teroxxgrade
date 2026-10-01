/* ==========================================================================
   wheel.js — шкала апгрейду в стилі rustgrade.com

   Колесо — це не прикраса, а сама ймовірність. Заливка дуги дорівнює
   вашому шансу: вона зелена згори (шанс великий) і червона внизу
   (шанс малий). Стрілка обертається 4 кола і зупиняється або всередині
   заливки (перемога), або поза нею (поразка). Саме її кут і є
   результатом, тому картинка ніколи не суперечить підсумку.

   Усі звуки синтезуються через Web Audio — жодних зовнішніх файлів,
   тому колесо важить 0 байт і працює офлайн.
   ========================================================================== */
(function (RG) {
  'use strict';

  const CUR = RG.DATA.CURRENCY.code;

  /* Геометрія — знята з оригінального rustgrade (їхній bundle):
     svg шкали займає 90.28% обгортки, внутрішня маска 78.06%,
     дуга — обведення r=81.25 товщиною 162.5, тобто вона йде
     від самого центру до краю, а центр ховає маска. */
  const GAUGE_PCT = 90.28;   // ширина svg-шкали, % від обгортки
  const MASK_PCT = 78.06;    // діаметр маски, % від обгортки
  const ARROW_W = 32.22;     // ширина стрілки, % від обгортки
  const ARROW_TOP = 6.67;    // центр стрілки, % згори

  const SIZE = 325;          // viewBox шкали
  const C = SIZE / 2;        // 162.5
  const R_DISC = C;          // базовий диск
  const R_ARC = C / 2;       // 81.25 — радіус обведення
  const W_ARC = C;           // 162.5 — товщина: дуга від центру до краю
  const R_MASK = MASK_PCT / GAUGE_PCT * R_DISC;   // ≈140.5 — радіус маски

  let mountId = 0;           // щоб id градієнтів не дублювались
  const SPIN_MS = 9000;     // повний оберталь
  const SPIN_FAST = 1800;
  const TURNS = 4;          // повних кіл за оберталь
  const TURNS_FAST = 2;
  const EASE = [0.25, 1, 0.5, 1];   // cubic-bezier(0.25, 1, 0.5, 1)

  const RISK_HIGH = 0.25;   // нижче — «дуже ризикований»
  const RISK_MID = 0.5;     // нижче — «ризиковий»
  const RISK_SAFE = 0.65;   // вище — «безпечний»

  const SOUND_KEY = 'rgx_sound';
  const FAST_KEY = 'rgx_fast';

  /* ============================== утиліти ================================ */

  const clamp = function (v, a, b) { return Math.min(b, Math.max(a, v)); };
  const mod360 = function (d) { return ((d % 360) + 360) % 360; };

  /**
   * Розв'язує cubic-bezier. Потрібен, щоб клацання храповика йшли
   * в такт із самим обертанням, а не приблизно.
   */
  function bezier(x1, y1, x2, y2) {
    const A = function (a, b) { return 1 - 3 * b + 3 * a; };
    const B = function (a, b) { return 3 * b - 6 * a; };
    const Cc = function (a) { return 3 * a; };
    const calc = function (t, a, b) { return ((A(a, b) * t + B(a, b)) * t + Cc(a)) * t; };
    const slope = function (t, a, b) { return 3 * A(a, b) * t * t + 2 * B(a, b) * t + Cc(a); };

    return function (x) {
      if (x <= 0) return 0;
      if (x >= 1) return 1;
      let t = x;
      for (let i = 0; i < 8; i++) {          // Ньютон
        const s = slope(t, x1, x2);
        if (Math.abs(s) < 1e-6) break;
        const e = calc(t, x1, x2) - x;
        if (Math.abs(e) < 1e-6) return calc(t, y1, y2);
        t -= e / s;
      }
      let lo = 0, hi = 1;                     // бісекція
      t = x;
      for (let i = 0; i < 20; i++) {
        const v = calc(t, x1, x2);
        if (Math.abs(v - x) < 1e-6) break;
        if (v < x) lo = t; else hi = t;
        t = (lo + hi) / 2;
      }
      return calc(t, y1, y2);
    };
  }

  const easeSpin = bezier(EASE[0], EASE[1], EASE[2], EASE[3]);

  /* ================================ звук =================================

   Все синтезується на льоту, але навмисно м'яко: короткі м'які клацання
   замість різкого «гавкоту», без баса і без трикутного писка. Гучність
   навмисно нижча за стандартну — фон, а не музика.
   ========================================================================== */

  let ctx = null, master = null, noise = null;
  const state = {
    sound: readFlag(SOUND_KEY, true),
    fast: readFlag(FAST_KEY, false)
  };

  /* Гучність загалом. Кожен ефект має свою частку, сума лишається тихою. */
  const VOL = 0.22;
  const MIX = { tick: 0.10, hum: 0.030, launch: 0.05, win: 0.10, lose: 0.055, click: 0.05 };

  function readFlag(key, dflt) {
    try { return localStorage.getItem(key) === null ? dflt : localStorage.getItem(key) === '1'; }
    catch (e) { return dflt; }
  }
  function saveFlag(key, v) {
    try { localStorage.setItem(key, v ? '1' : '0'); } catch (e) { /* приватний режим */ }
  }

  /** Створює/відновлює аудіоконтекст. Викликається з кліка — це жест. */
  function ac() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try { ctx = new AC(); } catch (e) { return null; }
      master = ctx.createGain();
      master.gain.value = VOL;
      master.connect(ctx.destination);

      const len = Math.floor(ctx.sampleRate * 0.4);
      noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const ch = noise.getChannelData(0);
      for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function env(g, t, peak, attack, hold, release) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.setValueAtTime(peak, t + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
  }

  /**
   * Клацання храповика. Наскільки голосніше на початку обертання.
   * Смуга 1500 Гц і Q 2.2 дають приємне «тук» замість свисту.
   */
  function tick(loud) {
    const c = ac(); if (!c || !state.sound) return;
    const t = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = noise;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1500;
    bp.Q.value = 2.2;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 5200;          // зрізаємо різкі верхні шпильки
    const g = c.createGain();
    env(g, t, MIX.tick * loud, 0.0015, 0.003, 0.028);
    src.connect(bp).connect(lp).connect(g).connect(master);
    src.start(t);
    src.stop(t + 0.06);
  }

  /**
   * Ледь чутний «повітряний» шум замість гулу мотора: саме він
   * дратував. Низька смуга + плавне наростання і спад.
   */
  function hum(ms) {
    const c = ac(); if (!c || !state.sound) return;
    const t = c.currentTime, d = ms / 1000;
    const src = c.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(360, t);
    bp.frequency.linearRampToValueAtTime(620, t + d);
    bp.Q.value = 0.7;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(MIX.hum, t + Math.min(0.35, d * 0.3));
    g.gain.setValueAtTime(MIX.hum, t + d - 0.5);
    g.gain.linearRampToValueAtTime(0.0001, t + d);
    src.connect(bp).connect(lp).connect(g).connect(master);
    src.start(t);
    src.stop(t + d + 0.05);
  }

  /** Короткий «пуск»: м'який повітряний свист, а не електронний бзік. */
  function launch() {
    const c = ac(); if (!c || !state.sound) return;
    const t = c.currentTime;
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(330, t);
    o.frequency.exponentialRampToValueAtTime(660, t + 0.22);
    const g = c.createGain();
    env(g, t, MIX.launch, 0.03, 0.03, 0.22);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1800;         // без різкого верху
    o.connect(lp).connect(g).connect(master);
    o.start(t);
    o.stop(t + 0.4);
  }

  /**
   * Акорд із кількох нот. `f0` — базова частота, `steps` — інтервали
   * у напівтонах (вгору або вниз), `detune` — розкидання, щоб не було
   * «електронного» звучання.
   */
  function arpeggio(f0, steps, step, peak, wave) {
    const c = ac(); if (!c || !state.sound) return;
    const t0 = c.currentTime;
    steps.forEach(function (semi, i) {
      const t = t0 + i * step;
      const f = f0 * Math.pow(2, semi / 12);
      const g = c.createGain();
      env(g, t, peak * (1 - i * 0.1), 0.02, step * 0.4, step * 1.1);
      g.connect(master);

      /* дві трохи розстроєні копії — живіше, ніж чистий синус */
      [-3, 3].forEach(function (cents, k) {
        const o = c.createOscillator();
        o.type = wave;
        o.frequency.setValueAtTime(f * Math.pow(2, cents / 1200), t);
        const lp = c.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 3200;      // прибираємо різкість синуса/трикутника
        o.connect(lp).connect(g);
        o.start(t);
        o.stop(t + step * 1.8);
      });
    });
  }

  /* мажорне арпеджо вгору — перемога */
  function sfxWin() { arpeggio(523.25, [0, 4, 7, 12, 16], 0.085, MIX.win, 'triangle'); }
  /* м'яке падіння на два ступені — поразка */
  function sfxLose() { arpeggio(392.00, [0, -2, -5], 0.16, MIX.lose, 'sine'); }
  function sfxClick() { tick(0.4); }

  /* ============================== розмітка =============================== */

  function esc(s) { return RG.ui.escapeHtml(s); }
  function num(n) { return new Intl.NumberFormat('uk-UA').format(Math.round(n)); }

  /**
   * Підпис ризику. В оригіналі текст і колір мають РІЗНІ пороги:
   * текст міняється на 0.25 і 0.5, а зелений колір — лише від 0.65,
   * між ними підпис лишається білого кольору.
   */
  function riskLabel(t) {
    const text = t < RISK_HIGH ? 'Високий ризик'
               : t < RISK_MID ? 'Ризиковано'
               : 'Безпечно';
    const cls = t < RISK_HIGH ? 'is-high' : t >= RISK_SAFE ? 'is-safe' : '';
    return { text: text, cls: cls };
  }

  /** Обрамлення: металеве кільце з поділками навколо шкали. */
  function frame(id) {
    const OUT = 180;              // радіус обгортки (100%)
    const R0 = R_DISC + 2;        // 164.5 — одразу за краєм шкали
    let ticks = '';
    for (let i = 0; i < 72; i++) {
      const a = (i / 72) * Math.PI * 2;
      const major = i % 6 === 0;
      const r2 = major ? OUT - 1.5 : OUT - 6;
      ticks += '<line class="wheel__tick' + (major ? ' wheel__tick--major' : '') + '"' +
        ' x1="' + (180 + R0 * Math.cos(a)).toFixed(2) + '" y1="' + (180 + R0 * Math.sin(a)).toFixed(2) + '"' +
        ' x2="' + (180 + r2 * Math.cos(a)).toFixed(2) + '" y2="' + (180 + r2 * Math.sin(a)).toFixed(2) + '"/>';
    }
    return '<svg class="wheel__frame" viewBox="0 0 360 360" aria-hidden="true" focusable="false">' +
      '<defs>' +
        '<linearGradient id="' + id + '-steel" x1="0" y1="0" x2="0" y2="360" gradientUnits="userSpaceOnUse">' +
          '<stop offset="0%" stop-color="#8d8880"></stop>' +
          '<stop offset="18%" stop-color="#2a2825"></stop>' +
          '<stop offset="50%" stop-color="#5d574f"></stop>' +
          '<stop offset="82%" stop-color="#232120"></stop>' +
          '<stop offset="100%" stop-color="#78726b"></stop>' +
        '</linearGradient>' +
        '<radialGradient id="' + id + '-dish" cx="50%" cy="30%" r="78%">' +
          '<stop offset="0%" stop-color="#2e2a25"></stop>' +
          '<stop offset="55%" stop-color="#211e1a"></stop>' +
          '<stop offset="100%" stop-color="#0d0c0b"></stop>' +
        '</radialGradient>' +
      '</defs>' +
      '<circle cx="180" cy="180" r="' + OUT + '" fill="url(#' + id + '-steel)"></circle>' +
      '<circle cx="180" cy="180" r="' + OUT + '" fill="none" stroke="#000" stroke-opacity=".65" stroke-width="2"></circle>' +
      '<g class="wheel__ticks">' + ticks + '</g>' +
      '<circle cx="180" cy="180" r="' + R0 + '" fill="url(#' + id + '-dish)"></circle>' +
    '</svg>';
  }

  /**
   * Один гудзир. Розмітка повторює оригінальну: обрамлення, диск
   * #25221D, дуга-обведення (заливка = шанс), маска, що ховає центр,
   * трикутна стрілка й шанс у центрі.
   * @param {HTMLElement} host
   * @param {number} initialChance
   */
  function mount(host, initialChance) {
    const id = 'rgw' + (++mountId);
    host.classList.add('wheel');
    host.innerHTML =
      '<div class="wheel__wrap">' +

        frame(id) +

        /* шкала: диск + дуга, заливка дуги = шанс */
        '<svg class="wheel__gauge" viewBox="0 0 ' + SIZE + ' ' + SIZE + '" aria-hidden="true" focusable="false">' +
          '<defs>' +
            '<linearGradient id="' + id + '-fill" x1="0" y1="' + SIZE + '" x2="0" y2="0" gradientUnits="userSpaceOnUse">' +
              '<stop offset="0%" stop-color="#D2290F"></stop>' +
              '<stop offset="50%" stop-color="#FFE32C"></stop>' +
              '<stop offset="100%" stop-color="#84B030"></stop>' +
            '</linearGradient>' +
          '</defs>' +
          '<circle class="wheel__disc" cx="' + C + '" cy="' + C + '" r="' + R_DISC + '" fill="#25221D"></circle>' +
          '<circle class="wheel__fill" cx="' + C + '" cy="' + C + '" r="' + R_ARC + '" fill="none" ' +
                  'stroke="url(#' + id + '-fill)" stroke-width="' + W_ARC + '" pathLength="1" ' +
                  'stroke-dasharray="0 1" stroke-dashoffset="-0.25"></circle>' +
        '</svg>' +

        /* маска — ховає центр дуги, лишаючи тонкий колірний обід */
        '<svg class="wheel__mask" viewBox="0 0 ' + SIZE + ' ' + SIZE + '" aria-hidden="true" focusable="false">' +
          '<defs>' +
            '<radialGradient id="' + id + '-mask" cx="50%" cy="32%" r="76%">' +
              '<stop offset="0%" stop-color="#2b2723"></stop>' +
              '<stop offset="58%" stop-color="#1e1b18"></stop>' +
              '<stop offset="100%" stop-color="#0a0a09"></stop>' +
            '</radialGradient>' +
          '</defs>' +
          '<circle class="wheel__mask-fill" cx="' + C + '" cy="' + C + '" r="' + R_MASK + '" fill="url(#' + id + '-mask)"></circle>' +
          '<circle class="wheel__mask-rim" cx="' + C + '" cy="' + C + '" r="' + (R_MASK - 1) + '" fill="none" ' +
                  'stroke="#000" stroke-opacity=".7" stroke-width="2"></circle>' +
          '<circle class="wheel__mask-bevel" cx="' + C + '" cy="' + C + '" r="' + (R_MASK - 5) + '" fill="none" ' +
                  'stroke="#ffffff" stroke-opacity=".07" stroke-width="3"></circle>' +
        '</svg>' +

        /* стрілка: трикутник донизу, вістря вказує на колірний обід */
        '<div class="wheel__arrow">' +
          '<svg viewBox="0 0 100 97" aria-hidden="true" focusable="false">' +
            '<defs>' +
              '<linearGradient id="' + id + '-tip" x1="0" y1="0" x2="0" y2="1">' +
                '<stop offset="0%" stop-color="#ffffff"></stop>' +
                '<stop offset="55%" stop-color="#f2f3f2"></stop>' +
                '<stop offset="100%" stop-color="#c9ccc9"></stop>' +
              '</linearGradient>' +
            '</defs>' +
            '<path class="wheel__blade" fill="url(#' + id + '-tip)" d="M50 54 L72.8 9.3 L27.2 9.3 Z"></path>' +
            '<path class="wheel__blade-shine" d="M50 54 L72.8 9.3 L50 9.3 Z"></path>' +
          '</svg>' +
        '</div>' +

        /* шанс */
        '<div class="wheel__center">' +
          '<span class="wheel__pct">0.00 %</span>' +
          '<span class="wheel__label">Оберіть предмет</span>' +
        '</div>' +

        /* результат броску */
        '<div class="wheel__result" hidden></div>' +
      '</div>';

    const fill = host.querySelector('.wheel__fill');
    const arrow = host.querySelector('.wheel__arrow');
    const pct = host.querySelector('.wheel__pct');
    const label = host.querySelector('.wheel__label');
    const result = host.querySelector('.wheel__result');

    let spinning = false;
    let locked = false;          // поки показуємо результат, шанс не скидаємо
    let pctShown = initialChance || 0;

    /**
     * Дуга = шанс. pathLength=1, тож довжина дуги просто t.
     * dashoffset зміщує її так, щоб вона була симетрична відносно низу
     * колеса — саме туди влучає стрілка при перемозі.
     */
    function paint(t) {
      t = clamp(t, 0, 1);
      /* округлюємо, щоб у DOM не залишалось хвостів виду 0.44999999999999996 */
      const t4 = t.toFixed(4);
      fill.setAttribute('stroke-dasharray', t4 + ' ' + (1 - t).toFixed(4));
      fill.setAttribute('stroke-dashoffset', (t / 2 - 0.25).toFixed(4));
      pctShown = t;
      pct.textContent = (t * 100).toFixed(2) + ' %';
      const r = riskLabel(t);
      label.textContent = t > 0 ? r.text : 'Оберіть предмет';
      label.className = 'wheel__label' + (t > 0 && r.cls ? ' ' + r.cls : '');
      host.style.setProperty('--chance', t.toFixed(4));
    }

    /**
     * Кут, на якому зупиниться стрілка. Перемога = всередині заливки
     * (центр — 180°, тобто вниз), поразка = поза нею. Розподіл рівномірний,
     * тож стрілка ніколи не « піддається » частіше, ніж показує шанс.
     */
    function landingAngle(win, chance) {
      const n = 180 * clamp(chance, 0, 1);
      if (win) {
        const e = Math.max(n - 1, 0);
        return 180 + (Math.random() * 2 - 1) * e;
      }
      const r = Math.max(180 - n - 1, 0);
      const i = Math.random() * r * 2;
      return i < r ? i : 180 + n + 1 + (i - r);
    }

    const ctl = {
      /** Малює новий шанс. Ігнорується, поки показано результат. */
      setChance: function (t) { if (!spinning && !locked) paint(t); },
      chance: function () { return pctShown; },
      isSpinning: function () { return spinning; },
      hasResult: function () { return locked; },

      /**
       * Показує результат броску поверх шкали. Поки result показано,
       * setChance ігнорується — шкас лишається на тому шансі, який
       * щойно був викинуто, а не скидається в нуль.
       * @param {{win:boolean, html?:string}} res
       */
      showResult: function (res) {
        locked = true;
        host.classList.add('has-result');
        result.hidden = false;
        result.className = 'wheel__result ' + (res.win ? 'is-win' : 'is-lose');
        result.innerHTML = res.html || (res.win ? 'Успіх' : 'Провал');
        // перезапускаємо анімацію появи
        result.style.animation = 'none';
        void result.offsetWidth;
        result.style.animation = '';
      },

      /** Ховає результат і відпускає шкалу. */
      clearResult: function () {
        locked = false;
        host.classList.remove('has-result');
        result.hidden = true;
        result.innerHTML = '';
        host.classList.remove('is-win', 'is-lose');
        ctl.anim && ctl.anim.cancel();
        arrow.style.transform = '';
        ctl.anim = null;
        ctl.angle = 0;
      },

      /**
       * Обертає стрілку й повертає результат.
       * @param {number} chance 0..1
       * @returns {Promise<boolean>} true = перемога
       */
      spin: function (chance) {
        if (spinning) return Promise.resolve(false);
        spinning = true;
        host.classList.add('is-spinning');
        host.classList.remove('is-win', 'is-lose');

        const willWin = Math.random() < clamp(chance, 0, 1);
        const final = landingAngle(willWin, chance);
        const dur = state.fast ? SPIN_FAST : SPIN_MS;
        const to = TURNS * 360 + final;
        const from = mod360(ctl.angle);

        // клацання: рахуємо кут у тих самих координатах, що й анімація
        let lastDeg = from, ticked = false;
        const t0 = performance.now();
        launch();
        hum(dur);

        const ticker = setInterval(function () {
          const t = Math.min(1, (performance.now() - t0) / dur);
          const deg = from + (to - from) * easeSpin(t);
          if (!ticked) { ticked = true; lastDeg = deg; return; }
          /* ближче до кінця — тихіше: клацання не набридає */
          if (Math.abs(deg - lastDeg) >= 8) {
            lastDeg = deg;
            tick(0.25 + 0.55 * (1 - t));
          }
        }, 16);

        if (ctl.anim) ctl.anim.cancel();
        arrow.style.transform = '';
        ctl.anim = arrow.animate(
          [{ transform: 'rotate(' + from + 'deg)' }, { transform: 'rotate(' + to + 'deg)' }],
          { duration: dur, easing: 'cubic-bezier(' + EASE.join(', ') + ')', fill: 'forwards' }
        );

        return new Promise(function (resolve) {
          let settled = false;
          function land() {
            if (settled) return;
            settled = true;
            clearInterval(ticker);
            ctl.angle = final;
            spinning = false;
            host.classList.remove('is-spinning');
            host.classList.add(willWin ? 'is-win' : 'is-lose');
            if (willWin) sfxWin(); else sfxLose();
            resolve(willWin);
          }
          ctl.anim.onfinish = land;
          // страховка: якщо браузер призупинить анімацію (фонова вкладка),
          // результат все одно настане вчасно
          setTimeout(land, dur + 150);
        });
      },

      angle: 0,
      anim: null
    };

    paint(initialChance || 0);
    return ctl;
  }

  /* ============================== експорт ================================ */

  RG.wheel = {
    mount: mount,
    riskLabel: riskLabel,
    RISK: { HIGH: RISK_HIGH, MID: RISK_MID, SAFE: RISK_SAFE },
    CUR: CUR,
    num: num,
    esc: esc,

    isFast: function () { return state.fast; },
    isSound: function () { return state.sound; },

    toggleFast: function () { state.fast = !state.fast; saveFlag(FAST_KEY, state.fast); return state.fast; },
    toggleSound: function () {
      state.sound = !state.sound;
      saveFlag(SOUND_KEY, state.sound);
      if (state.sound) sfxClick();
      return state.sound;
    },
    click: sfxClick,
    /* кліки по меню не мають звукати: лише вибір предмета чи цілі */
    tap: function () { if (state.sound) launch(); }
  };
})(window.RG = window.RG || {});
