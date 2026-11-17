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
 * ОДНИ И ТЕ ЖЕ НАБЛЮДАТЕЛИ НА ВСЁ. Главы, подъехавшие в поток читалки,
 * приходят после запуска и берутся под тот же надзор, что и отрисованные
 * сервером. Раньше им класс `.in-focus` просто проставлялся разом: кадры
 * выходили цветными навсегда, и проявление работало ровно на одной главе —
 * той, с которой читатель начал. Нашёл Тимур: «работает только там».
 *
 * Спецификация: 01_Spec/tz-paceofhoney-v2.md, раздел 2.5.4
 */

const ONCE = [
  ['[data-fade-up]', 'fade-up'],
  ['[data-unfurl]', 'unfurled'],
  ['[data-bookend-slide]', 'bookend-slide-up'],
];

const FRAMES = '[data-focus-frame]';

/** Что показать элементу, когда он въедет в кадр. */
const promised = new WeakMap();

let onceWatcher = null;
let focusWatcher = null;
let nearbyWatcher = null;

/**
 * Запасной путь, если браузер не умеет следить за попаданием в кадр:
 * показываем всё сразу, ничего не пряча.
 */
function showEverythingAtOnce(root = document) {
  for (const [selector, className] of ONCE) {
    root.querySelectorAll(selector).forEach((el) => el.classList.add(className));
  }
  root.querySelectorAll(FRAMES).forEach((el) => el.classList.add('in-focus'));
}

function createWatchers() {
  /* Появление один раз: показали — перестали следить. */
  onceWatcher = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const className = promised.get(entry.target);
        if (className) entry.target.classList.add(className);
        onceWatcher.unobserve(entry.target);
      }
    },
    { rootMargin: '0px 0px -10% 0px', threshold: 0 },
  );

  /*
   * Проявление цвета. В отличие от остального — обратимо: кадр уходит из
   * центра экрана и снова гаснет. Поэтому наблюдение не снимается.
   */
  focusWatcher = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        entry.target.classList.toggle('in-focus', entry.isIntersecting);
      }
    },
    { rootMargin: '-35% 0px -35% 0px', threshold: 0 },
  );

  /*
   * will-change ставится и снимается здесь же. Постоянный will-change на всех
   * фотографиях страницы исчерпывает видеопамять и даёт обратный эффект —
   * подсказка браузеру превращается в тормоз.
   */
  nearbyWatcher = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const img = entry.target.querySelector('img');
        if (img) img.style.willChange = entry.isIntersecting ? 'filter' : '';
      }
    },
    { rootMargin: '100% 0px 100% 0px', threshold: 0 },
  );
}

/** Взять под надзор всё, что объявлено внутри узла. */
function watchWithin(root) {
  if (!onceWatcher) {
    showEverythingAtOnce(root);
    return;
  }

  for (const [selector, className] of ONCE) {
    root.querySelectorAll(selector).forEach((el) => {
      promised.set(el, className);
      onceWatcher.observe(el);
    });
  }

  root.querySelectorAll(FRAMES).forEach((el) => {
    focusWatcher.observe(el);
    nearbyWatcher.observe(el);
  });
}

/** Снять надзор с главы, которую читалка свернула, уводя её из памяти. */
function unwatchWithin(root) {
  if (!onceWatcher) return;

  for (const [selector] of ONCE) {
    root.querySelectorAll(selector).forEach((el) => onceWatcher.unobserve(el));
  }
  root.querySelectorAll(FRAMES).forEach((el) => {
    focusWatcher.unobserve(el);
    nearbyWatcher.unobserve(el);
  });
}

export function startReveal() {
  // Главы приходят и уходят по ходу чтения — слушаем обе вести.
  // Подписываемся до первого обхода: читалка могла успеть раньше.
  document.addEventListener('honey:content-added', (e) => {
    if (e.detail?.el) watchWithin(e.detail.el);
  });
  document.addEventListener('honey:content-removed', (e) => {
    if (e.detail?.el) unwatchWithin(e.detail.el);
  });

  if (!('IntersectionObserver' in window)) {
    showEverythingAtOnce();
    return;
  }

  // Просьбу «поменьше движения» отрабатывает CSS: он оставляет плавное
  // проявление и мгновенно переключает всё, что двигает элемент. Наблюдатель
  // при этом работает как обычно — иначе у таких читателей страница
  // проявлялась бы вся разом, включая то, до чего они не долистали.
  createWatchers();
  watchWithin(document);
}
