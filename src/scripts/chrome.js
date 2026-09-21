/**
 * Поведение верхней плашки.
 *
 * Листаешь вперёд — меню уезжает вверх, освобождая экран под чтение.
 * Малейшее движение назад — возвращается. Отъехали от верха — плашка
 * сжимается в округлую «таблетку» с размытием подложки.
 *
 * Скрипт только переключает два класса на одном контейнере, вся анимация
 * в CSS. Отсюда плавность: браузер анимирует transform на видеокарте,
 * не пересчитывая раскладку.
 *
 *   scrolled    страница отъехала от верха
 *   nav-hidden  последнее движение было вперёд
 *
 * Контейнер один намеренно. Два независимых fixed-элемента — меню и плашка
 * серии — и создают то наложение, которого просило избежать ТЗ, не объясняя как.
 *
 * Спецификация: 01_Spec/tz-paceofhoney-v2.md, раздел 2.6
 */

const SHRINK_AT = 24;   // px от верха, после которых плашка сжимается
const DEADZONE = 6;     // мелкие дёргания пальца движением не считаются
const FREE_TOP = 120;   // у самого верха меню не прячем никогда

export function startChrome() {
  const header = document.getElementById('site-header');
  if (!header) return;

  let last = window.scrollY;
  let ticking = false;

  function apply() {
    const y = window.scrollY;
    const delta = y - last;

    header.classList.toggle('scrolled', y > SHRINK_AT);

    if (Math.abs(delta) > DEADZONE) {
      // Вперёд и уже отъехали от верха — прячем. Назад — показываем.
      header.classList.toggle('nav-hidden', delta > 0 && y > FREE_TOP);
      last = y;
    }
    ticking = false;
  }

  // Слушатель пассивный: обещаем не отменять прокрутку, и браузер за это
  // не ждёт наш код перед тем как двигать страницу.
  window.addEventListener(
    'scroll',
    () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(apply);
    },
    { passive: true },
  );

  apply();
}

/** Боковая шторка меню на узких экранах. */
export function startDrawer() {
  const drawer = document.getElementById('drawer');
  const open = document.getElementById('menuButton');
  const close = document.getElementById('drawerClose');
  const overlay = document.getElementById('drawerOverlay');
  if (!drawer || !open) return;

  const setOpen = (state) => {
    drawer.classList.toggle('open', state);
    overlay?.classList.toggle('show', state);
    open.setAttribute('aria-expanded', String(state));

    // Закрытая шторка полностью выключена: её ссылки не ловят фокус
    // с клавиатуры и не читаются вслух — иначе они «висят» за краем экрана.
    if (state) drawer.removeAttribute('inert');
    else drawer.setAttribute('inert', '');

    // Пока шторка открыта, страница под ней не прокручивается —
    // иначе палец листает фон вместо меню.
    document.body.style.overflow = state ? 'hidden' : '';

    if (state) drawer.querySelector('a, button')?.focus();
    else open.focus();
  };

  open.addEventListener('click', () => setOpen(!drawer.classList.contains('open')));
  close?.addEventListener('click', () => setOpen(false));
  overlay?.addEventListener('click', () => setOpen(false));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && drawer.classList.contains('open')) setOpen(false);
  });
}
