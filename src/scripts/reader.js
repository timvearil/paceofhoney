/**
 * Бесшовный книжный поток.
 *
 * Дочитав главу, читатель не кликает — следующая подъезжает снизу сама,
 * а адрес в строке браузера тихо меняется. При этом каждая глава сохраняет
 * свой прямой адрес: для поиска, для ИИ-краулеров, для отправки в мессенджер.
 *
 * Три принципа, которые здесь важнее кода.
 *
 * 1. СТРАНИЦА РАБОТАЕТ БЕЗ ЭТОГО СКРИПТА. Глава открывается, читается, внизу
 *    ссылка на следующую. Поток — надстройка, а не условие.
 *
 * 2. АДРЕС МЕНЯЕТСЯ ЧЕРЕЗ replaceState, НЕ pushState. При pushState кнопка
 *    «назад» шагала бы по главам, через которые читатель проскроллил: чтобы
 *    выйти со страницы, пришлось бы нажать её пятнадцать раз. С replaceState
 *    «назад» работает как ожидается — уводит туда, откуда пришли.
 *
 * 3. ВВЕРХ ПОТОК НЕ РАСТЁТ. Пришёл по прямой ссылке на восьмую главу — она
 *    и есть верх страницы. Дозагрузка предыдущих сверху сдвигала бы уже
 *    прочитанный текст под пальцем (ТЗ 3.1.Б).
 *
 * 4. СКРИПТ НИЧЕГО НЕ ВЫЧИСЛЯЕТ. Какая глава следующая, каким адресом она
 *    зовётся, какой у неё номер — всё посчитано на сборке внутри нити и
 *    лежит готовым в `data-*`. Раньше скрипт считал это сам, по пометке
 *    `?s=` в адресе, и оставался единственным на сайте, кто знал правду:
 *    сервер рисовал страницу по ведущей серии статьи, а половину элементов
 *    исправить было некому. Теперь нить назначает адрес страницы, и знают
 *    её все одинаково.
 *
 * Спецификация: 01_Spec/tz-paceofhoney-v2.md, раздел 3.1.Б
 */

/** За сколько экранов до конца начинать подтягивать следующую главу. */
const LOOKAHEAD = '200% 0px';

/**
 * Сколько прочитанных глав держать над текущей.
 *
 * Не «последние N», а именно «вокруг текущей». Разница принципиальная:
 * при правиле «держим три последние» вернувшийся назад читатель разворачивал
 * бы главу, а обрезчик тут же сворачивал её обратно — она ведь верхняя.
 * Получались качели, и подняться выше было невозможно.
 */
const KEEP_ABOVE = 1;

export function startReader() {
  const stream = document.getElementById('stream');
  if (!stream) return;

  const shelf = document.querySelector('[data-shelf]');
  const plateCount = document.querySelector('[data-plate-count]');
  const canonical = document.querySelector('link[rel="canonical"]');

  const episodes = () => [...stream.querySelectorAll('[data-episode]')];

  /** Что грузить следом за этой главой. Пусто — нить дочитана. */
  const nextOf = (el) => el?.dataset.next || '';

  let loading = false;
  let exhausted = !nextOf(episodes().at(-1));

  /* --------------------------------------------------------------------
     Подгрузка следующей главы
     ----------------------------------------------------------------- */

  async function loadNext() {
    if (loading || exhausted) return;

    // Адрес фрагмента посчитан на сборке внутри нити — здесь он уже готов.
    const url = nextOf(episodes().at(-1));
    if (!url) {
      exhausted = true;
      finish();
      return;
    }

    loading = true;
    try {
      const res = await fetch(url, { headers: { Accept: 'text/html' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const html = await res.text();
      const frag = document.createRange().createContextualFragment(html);
      const added = frag.querySelector('[data-episode]');
      if (!added) throw new Error('в ответе нет главы');

      stream.append(frag);
      watch(added);

      if (!nextOf(added)) {
        exhausted = true;
        finish();
      } else {
        // Через кадр — чтобы браузер успел разместить новую главу и высота
        // сторожа стала настоящей, а не нулевой.
        requestAnimationFrame(() => {
          if (nearEnd()) loadNext();
        });
      }
    } catch (e) {
      // Молча сдаёмся к ссылкам: внизу страницы есть переход на следующую
      // главу, читатель не остаётся в тупике.
      console.warn('[читалка] не получилось подтянуть главу:', e.message);
      exhausted = true;
      finish();
    } finally {
      loading = false;
    }
  }

  /** Поток исчерпан: показываем финал серии и переход к другим журналам. */
  function finish() {
    shelf?.querySelector('[data-shelf-final]')?.removeAttribute('hidden');
  }

  /* --------------------------------------------------------------------
     Сторож в конце потока: тянет следующую главу за два экрана до конца
     ----------------------------------------------------------------- */

  const sentinel = document.createElement('div');
  sentinel.setAttribute('aria-hidden', 'true');
  sentinel.style.cssText = 'height:1px;pointer-events:none';
  stream.after(sentinel);

  new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) loadNext();
    },
    { rootMargin: LOOKAHEAD },
  ).observe(sentinel);

  /**
   * Не пора ли тянуть следующую главу.
   *
   * Наблюдатель сообщает только о СМЕНЕ состояния: вошёл в зону — событие,
   * вышел — событие. Пока сторож остаётся в зоне, он молчит. А короткая глава
   * сдвигает его всего на пол-экрана, и он из зоны не выходит — поток замирал
   * после первой же подгрузки.
   *
   * Поэтому после каждой подгрузки положение проверяется вручную, не дожидаясь
   * события. Три экрана — примерно та же зона, что у наблюдателя.
   */
  function nearEnd() {
    return sentinel.getBoundingClientRect().top < window.innerHeight * 3;
  }

  /* --------------------------------------------------------------------
     Кто сейчас перед глазами: смена адреса, заголовка и плашки
     ----------------------------------------------------------------- */

  let current = episodes()[0]?.dataset.slug ?? null;

  function becomeCurrent(el) {
    const d = el.dataset;
    if (!d.slug || d.slug === current) return;
    current = d.slug;

    // Адрес главы в этой нити. Пришёл готовым: боковая нить зовёт главу
    // через свою серию, ведущая — коротким каноническим адресом.
    // replaceState, не pushState — см. принцип 2 в шапке файла.
    if (d.href) history.replaceState(history.state, '', d.href);

    document.title = `${d.title} — Со скоростью мёда`;

    // Канонический адрес один на все нити: текст-то один, серия лишь
    // говорит, каким путём к нему пришли. Поисковику знать не о чем.
    if (canonical && d.canonical) {
      canonical.href = new URL(d.canonical, location.origin).href;
    }
    if (plateCount) plateCount.textContent = `Глава ${d.number} из ${d.total}`;

    // Читатель сместился — пересчитываем, что держать в памяти.
    trim();
  }

  /*
   * Текущей считается глава, занимающая середину экрана. Узкая полоса, а не
   * момент появления заголовка: глава длиннее экрана, и её заголовок давно
   * уехал вверх, пока читатель ещё в середине текста.
   */
  const focus = new IntersectionObserver(
    (entries) => {
      for (const e of entries) if (e.isIntersecting) becomeCurrent(e.target);
    },
    { rootMargin: '-45% 0px -45% 0px', threshold: 0 },
  );

  /*
   * Отметка «глава рядом с экраном».
   *
   * Обрезчик её не трогает, даже если формально она вышла за окно. Без этой
   * защиты возврат наверх превращался в качели: читатель разворачивает главу,
   * а обрезчик немедленно сворачивает её обратно — центр экрана ведь ещё
   * не успел сместиться.
   */
  const nearby = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) e.target.dataset.near = '';
        else delete e.target.dataset.near;
      }
    },
    // Зона защиты шире зоны восстановления — так развёрнутая глава заведомо
    // оказывается внутри неё и не попадает под обрезку в ту же секунду.
    { rootMargin: '200% 0px' },
  );

  function watch(el) {
    focus.observe(el);
    nearby.observe(el);
    // Проявление кадров и всплытие блоков внутри новой главы.
    document.dispatchEvent(new CustomEvent('honey:content-added', { detail: { el } }));
  }

  episodes().forEach(watch);

  /* --------------------------------------------------------------------
     Скользящее окно: держим в памяти не больше трёх глав
     ----------------------------------------------------------------- */

  const cache = new WeakMap();

  /** Убирает главу, оставляя распорку её высоты: прокрутка не дёргается. */
  function unload(el) {
    const height = el.getBoundingClientRect().height;
    const spacer = document.createElement('div');
    spacer.dataset.spacer = el.dataset.slug ?? '';
    spacer.setAttribute('aria-hidden', 'true');
    spacer.style.height = `${height}px`;
    cache.set(spacer, el.outerHTML);

    focus.unobserve(el);
    nearby.unobserve(el);

    // Проявление цвета следит за кадрами внутри главы через свои наблюдатели.
    // Без этой вести они держали бы ссылки на выброшенные элементы: к концу
    // длинной серии — десятки мёртвых кадров в памяти.
    document.dispatchEvent(new CustomEvent('honey:content-removed', { detail: { el } }));

    el.replaceWith(spacer);
    restorer.observe(spacer);
  }

  /*
   * Читатель может вернуться назад — и не должен упереться в пустоту.
   * Распорка, подъехавшая к экрану, разворачивается обратно в главу из кэша.
   */
  const restorer = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const html = cache.get(e.target);
        if (!html) continue;

        const frag = document.createRange().createContextualFragment(html);
        const back = frag.querySelector('[data-episode]');
        restorer.unobserve(e.target);
        e.target.replaceWith(frag);
        if (back) {
          // Раз распорка доехала до зоны восстановления, глава заведомо рядом.
          // Ставим отметку сразу, не дожидаясь наблюдателя: иначе обрезчик
          // успеет свернуть её обратно в ту же секунду.
          back.dataset.near = '';
          watch(back);
        }
      }
    },
    { rootMargin: '150% 0px' },
  );

  /**
   * Сворачиваем то, что ушло далеко вверх ОТ ТЕКУЩЕЙ главы.
   *
   * Отсчёт именно от текущей, а не от конца потока: иначе восстановленная
   * при возврате глава сворачивалась бы немедленно, как самая верхняя.
   * Всё, что ниже текущей, не трогаем вовсе — читатель туда идёт.
   */
  function trim() {
    const live = episodes();
    const here = live.findIndex((e) => e.dataset.slug === current);
    if (here < 0) return;

    const keepFrom = Math.max(0, here - KEEP_ABOVE);
    live
      .slice(0, keepFrom)
      .filter((el) => el.dataset.near === undefined)
      .forEach(unload);
  }

  const trimmer = new MutationObserver(trim);
  trimmer.observe(stream, { childList: true });
}
