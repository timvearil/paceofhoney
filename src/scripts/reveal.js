/**
 * Проявление элементов при попадании в кадр.
 *
 * Один наблюдатель на документ вместо наблюдателя на каждый элемент:
 * так дешевле и так сделано на каноне. Разметка объявляет, что с ней делать,
 * атрибутом; скрипт только вешает класс, вся анимация живёт в CSS.
 *
 *   data-fade-up       → .fade-up            всплытие снизу
 *   data-unfurl        → .unfurled           разворачивание линейки
 *   data-bookend-slide → .bookend-slide-up   подъём графического цоколя
 *   data-focus-frame   → .in-focus           проявление цвета в кадре
 *
 * У кадров своя зона срабатывания — средняя треть экрана (ТЗ 2.5.2).
 * Остальное проявляется, едва показавшись снизу.
 *
 * Спецификация: 01_Spec/tz-paceofhoney-v2.md, раздел 2.5.4
 */

const ONCE = [
  ['[data-fade-up]', 'fade-up'],
  ['[data-unfurl]', 'unfurled'],
  ['[data-bookend-slide]', 'bookend-slide-up'],
];

/** Кому анимация противопоказана — тому сразу конечное состояние. */
const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function showEverythingAtOnce() {
  for (const [selector, className] of ONCE) {
    document.querySelectorAll(selector).forEach((el) => el.classList.add(className));
  }
  document.querySelectorAll('[data-focus-frame]').forEach((el) => el.classList.add('in-focus'));
}

/* Появление один раз: показали — перестали следить. */
function watchOnce() {
  const seen = new WeakMap();

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const className = seen.get(entry.target);
        if (className) entry.target.classList.add(className);
        observer.unobserve(entry.target);
      }
    },
    { rootMargin: '0px 0px -10% 0px', threshold: 0 },
  );

  for (const [selector, className] of ONCE) {
    document.querySelectorAll(selector).forEach((el) => {
      seen.set(el, className);
      observer.observe(el);
    });
  }
}

/*
 * Проявление цвета. В отличие от остального — обратимо: кадр уходит из
 * центра экрана и снова гаснет. Поэтому наблюдение не снимается.
 *
 * will-change ставится и снимается здесь же. Постоянный will-change на всех
 * фотографиях страницы исчерпывает видеопамять и даёт обратный эффект —
 * подсказка браузеру превращается в тормоз.
 */
function watchFrames() {
  const frames = document.querySelectorAll('[data-focus-frame]');
  if (!frames.length) return;

  const focus = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        entry.target.classList.toggle('in-focus', entry.isIntersecting);
      }
    },
    { rootMargin: '-35% 0px -35% 0px', threshold: 0 },
  );

  const nearby = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const img = entry.target.querySelector('img');
        if (img) img.style.willChange = entry.isIntersecting ? 'filter' : '';
      }
    },
    { rootMargin: '100% 0px 100% 0px', threshold: 0 },
  );

  frames.forEach((el) => {
    focus.observe(el);
    nearby.observe(el);
  });
}

export function startReveal() {
  if (calm) {
    showEverythingAtOnce();
    return;
  }
  watchOnce();
  watchFrames();
}
