'use strict';

// Утилиты для игрового времени Rust+ (AppTime: time, sunrise, sunset, dayLengthMinutes).
// Робота з цими значеннями: показуємо поточний час і скільки лишилось до ранку/ночі.

function clampHour(v) {
  const n = Number(v);
  if (!isFinite(n)) return 0;
  return ((n % 24) + 24) % 24;
}

// 14.5 -> "14:30"
function fmtClock(value) {
  const v = clampHour(value);
  const h = Math.floor(v);
  const m = Math.floor((v - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// длительность в игровых часах -> "2 ч 15 мин" (или "45 мин", если меньше часа)
function fmtDuration(hours) {
  const total = Math.max(0, Number(hours) || 0) * 60; // в игровых минутах
  const h = Math.floor(total / 60);
  const m = Math.round(total - h * 60);
  if (h <= 0) return `${m} мин`;
  if (m <= 0) return `${h} ч`;
  return `${h} ч ${m} мин`;
}

/**
 * Описывает состояние игрового времени.
 * Возвращает { clock, phase, untilLabel, untilText, sunrise, sunset } или null.
 */
function describeTime(t) {
  if (!t) return null;
  const time = clampHour(t.time);
  const sunrise = clampHour(t.sunrise);
  const sunset = clampHour(t.sunset);

  const isDay = time >= sunrise && time < sunset;
  let untilHours;
  let untilLabel;
  if (isDay) {
    untilHours = sunset - time;
    untilLabel = 'до заката';
  } else {
    untilHours = time < sunrise ? sunrise - time : 24 - time + sunrise;
    untilLabel = 'до рассвета';
  }

  return {
    clock: fmtClock(time),
    phase: isDay ? 'день' : 'ночь',
    untilLabel,
    untilText: fmtDuration(untilHours),
    sunrise: fmtClock(sunrise),
    sunset: fmtClock(sunset),
  };
}

/**
 * Реальное время по Москве (МСК, UTC+3 круглый год).
 * Возвращает { clock, clockSec, date, weekday }.
 */
function mskTime(date = new Date()) {
  const tz = 'Europe/Moscow';
  let parts;
  try {
    parts = new Intl.DateTimeFormat('ru-RU', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      weekday: 'short',
    }).formatToParts(date);
  } catch (_) {
    // fallback: UTC+3 без учета летнего времени (в РФ его нет)
    const d = new Date(date.getTime() + 3 * 3600 * 1000);
    const p = (n) => String(n).padStart(2, '0');
    return {
      clock: `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`,
      clockSec: `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`,
      date: `${p(d.getUTCDate())}.${p(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`,
      weekday: '',
    };
  }
  const get = (type) => {
    const part = parts.find((p) => p.type === type);
    return part ? part.value : '';
  };
  const hh = get('hour');
  const mm = get('minute');
  const ss = get('second');
  const dd = get('day');
  const mo = get('month');
  const yy = get('year');
  return {
    clock: `${hh}:${mm}`,
    clockSec: `${hh}:${mm}:${ss}`,
    date: `${dd}.${mo}.${yy}`,
    weekday: get('weekday'),
  };
}

module.exports = { describeTime, fmtClock, fmtDuration, mskTime };
