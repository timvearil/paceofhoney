/**
 * Стенд для читалки.
 *
 * Бесшовный поток — самая сложная часть сайта и единственная, которую нельзя
 * оценить глазами за минуту: ошибки в ней выглядят как «страница иногда
 * дёргается». Поэтому логика проверяется отдельно от физики прокрутки.
 *
 * Как устроено: берём собранную страницу главы, поднимаем её в jsdom,
 * подменяем наблюдатели и сетевые запросы — и дёргаем сценарий руками.
 * Проверяем, что уходит в сеть, что встаёт в поток, как меняется адрес,
 * заголовок и плашка, что происходит со скользящим окном.
 *
 * Запуск:  npm run test:reader   (после npm run build)
 *
 * Стенд поймал качели в скользящем окне: возврат назад разворачивал главу,
 * а обрезчик немедленно сворачивал её обратно. Вручную такое ловится долго.
 *
 * Стенд НЕ ловит вёрстку и не заменяет живой браузер — три дефекта подряд
 * нашёл Тимур глазами на телефоне. И он пропустил замирание потока, потому
 * что дёргал сторожа вручную, то есть сам выдавал событие, которого в жизни
 * не приходило. Заглушка воспроизводила механизм, а не условия.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');

/* ---------------------------------------------------------------------- */

let JSDOM;
try {
  ({ JSDOM } = await import('jsdom'));
} catch {
  console.log('[читалка] нет jsdom — пропускаю. Поставить: npm i -D jsdom');
  process.exit(0);
}

const attr = (html, name) => html.match(new RegExp(`${name}="([^"]*)"`))?.[1] ?? null;

/** Файл собранной страницы по её адресу. */
const fileOf = (url) => path.join(DIST, `${url.replace(/^\//, '')}.html`);

/**
 * Ищем самую длинную цепочку глав, идущих подряд одной нитью.
 *
 * Адреса берём прямо из разметки: с тех пор как нить назначает адрес
 * страницы, `data-next` содержит готовый путь к фрагменту, и стенду
 * не нужно знать ни про серии, ни про то, как складываются адреса.
 */
function findChain() {
  const pages = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.html') && !full.endsWith('partial.html')) pages.push(full);
    }
  };
  if (!fs.existsSync(DIST)) return null;
  walk(DIST);

  let best = null;
  for (const file of pages) {
    const html = fs.readFileSync(file, 'utf8');
    if (!html.includes('data-episode')) continue;

    const chain = [];
    let next = attr(html, 'data-next');
    while (next && chain.length < 2) {
      const f = fileOf(next);
      if (!fs.existsSync(f)) break;
      const body = fs.readFileSync(f, 'utf8');
      chain.push({ url: next, body });
      next = attr(body, 'data-next') || null;
    }

    if (chain.length === 2 && !best) best = { page: html, chain, file };
    // Боковая нить интереснее ведущей: на ней проверяется, что адрес
    // при прокрутке остаётся в своей серии.
    if (chain.length === 2 && file.includes(`${path.sep}series${path.sep}`)) {
      return { page: html, chain, file };
    }
  }
  return best;
}

const found = findChain();
if (!found) {
  console.log(
    '[читалка] в сборке нет цепочки из трёх глав подряд — проверять нечего.\n' +
      '          Стенд заработает, когда появятся опубликованные серии.',
  );
  process.exit(0);
}

const entryHref = attr(found.page, 'data-href');
const entrySlug = attr(found.page, 'data-slug');
const hrefOf = (body) => attr(body, 'data-href');
const canonOf = (body) => attr(body, 'data-canonical');
const slugOf = (body) => attr(body, 'data-slug');

/* --- подменыши ---------------------------------------------------------- */

const dom = new JSDOM(found.page, {
  url: `http://localhost${entryHref}`,
  pretendToBeVisual: true,
});
const { window } = dom;

const observers = [];
const requests = [];

class FakeIO {
  constructor(cb, opts = {}) {
    this.cb = cb;
    this.opts = opts;
    this.targets = new Set();
    observers.push(this);
  }
  observe(el) { this.targets.add(el); }
  unobserve(el) { this.targets.delete(el); }
  disconnect() { this.targets.clear(); }
  fire(el, isIntersecting = true) {
    if (!this.targets.has(el)) return false;
    this.cb([{ target: el, isIntersecting }], this);
    return true;
  }
}

Object.assign(globalThis, {
  window,
  document: window.document,
  history: window.history,
  location: window.location,
  CustomEvent: window.CustomEvent,
  MutationObserver: window.MutationObserver,
  IntersectionObserver: FakeIO,
  requestAnimationFrame: (fn) => setTimeout(fn, 0),
  matchMedia: () => ({ matches: false, addEventListener() {} }),
});
window.matchMedia = globalThis.matchMedia;

const bodies = Object.fromEntries(found.chain.map((c) => [c.url, c.body]));

globalThis.fetch = async (url) => {
  requests.push(url);
  const body = bodies[url];
  return body
    ? { ok: true, status: 200, text: async () => body }
    : { ok: false, status: 404, text: async () => '' };
};

/*
 * jsdom всегда отдаёт нулевую высоту, а распорке нужна измеренная.
 *
 * Сторож нарочно помещён далеко от экрана: в этой части стенда проверяется
 * пошаговое поведение, по одной главе за шаг. Цепная подгрузка — когда сторож
 * остаётся рядом и главы едут одна за другой — проверяется отдельно, ниже.
 */
window.Element.prototype.getBoundingClientRect = function () {
  const isEpisode = this.dataset && this.dataset.episode !== undefined;
  return { height: isEpisode ? 2000 : 0, width: 800, top: isEpisode ? 0 : 99999, left: 0 };
};

/* --- запуск -------------------------------------------------------------- */

const { startReader } = await import(path.join(ROOT, 'src/scripts/reader.js'));
startReader();

const doc = window.document;
const stream = doc.getElementById('stream');
const eps = () => [...stream.querySelectorAll('[data-episode]')];
const slugs = () => eps().map((e) => e.dataset.slug);
const spacers = () => [...stream.querySelectorAll('[data-spacer]')].map((s) => s.dataset.spacer);

// Опознаём наблюдателей по зоне срабатывания, а не по порядку создания:
// порядок меняется от любой правки, и стенд ломался бы на ровном месте.
const byMargin = (m) => observers.find((o) => o.opts.rootMargin === m);
const watchdog = byMargin('200% 0px');
const focus = byMargin('-45% 0px -45% 0px');
const restorer = byMargin('150% 0px');

const sentinel = [...watchdog.targets][0];
const wait = () => new Promise((r) => setTimeout(r, 40));

/*
 * Вести о приходе и уходе глав.
 *
 * По ним проявление цвета берёт кадры подгруженной главы под наблюдение и
 * снимает его, когда глава уходит из памяти. Пропавшая весть выглядит для
 * читателя так: фотографии в подгруженных главах не оживают. Проверить это
 * глазами трудно — эффект тонкий, и Тимур заметил его только на четвёртый
 * день. Поэтому проверяем здесь.
 */
const told = { added: 0, removed: 0 };
window.document.addEventListener('honey:content-added', () => told.added++);
window.document.addEventListener('honey:content-removed', () => told.removed++);

let bad = 0;
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) bad++;
  console.log(`  ${ok ? '✓' : '✗'} ${name}`);
  if (!ok) {
    console.log(`      ждали:  ${JSON.stringify(expected)}`);
    console.log(`      вышло:  ${JSON.stringify(actual)}`);
  }
};

const [one, two] = found.chain;

console.log(`\nнить: ${entryHref} → ${hrefOf(one.body)} → ${hrefOf(two.body)}\n`);

console.log('-- исходное состояние --');
check('в потоке одна глава', slugs(), [entrySlug]);
// Блок «следующая глава» живёт только в <noscript>: при непрерывной ленте
// он врал бы почти сразу. Проверяем, что в обычной разметке его нет.
check('ссылки «следующая глава» в разметке нет',
  doc.querySelector('[data-shelf] > .onward'), null);
check('финал серии скрыт', doc.querySelector('[data-shelf-final]')?.hasAttribute('hidden'), true);

console.log('\n-- дочитали: подтягивается следующая --');
watchdog.fire(sentinel);
await wait();
check('ушёл запрос за фрагментом', requests, [one.url]);
check('глава встала в поток', slugs(), [entrySlug, slugOf(one.body)]);

console.log('\n-- вторая вошла в центр экрана --');
focus.fire(eps()[1]);
check('адрес сменился и остался в своей нити',
  window.location.pathname, hrefOf(one.body));
check('заголовок вкладки сменился', doc.title.includes('Со скоростью мёда'), true);
check('плашка обновилась',
  /Глава \d+ из \d+/.test(doc.querySelector('[data-plate-count]')?.textContent ?? ''), true);
check('canonical показывает один адрес текста, без серии',
  doc.querySelector('link[rel=canonical]')?.getAttribute('href'),
  `http://localhost${canonOf(one.body)}`);

console.log('\n-- стрелки в плашке переехали вместе с читателем --');
const step = (side) => doc.querySelector(`[data-step="${side}"]`);
check('«назад» ведёт на главу, с которой пришли',
  step('prev')?.getAttribute('href'), entryHref);
check('«вперёд» ведёт на третью главу, а не на вторую',
  step('next')?.getAttribute('href'), attr(one.body, 'data-next-href'));
check('«назад» знает, кого искать в ленте',
  step('prev')?.dataset.target, entrySlug);

console.log('\n-- клик по «назад»: сосед уже в ленте --');
let scrolledTo = null;
for (const el of eps()) el.scrollIntoView = function () { scrolledTo = this.dataset.slug; };
const clicked = new window.MouseEvent('click', { bubbles: true, cancelable: true });
step('prev').dispatchEvent(clicked);
check('переход отменён — остаёмся на странице', clicked.defaultPrevented, true);
check('прокрутили к нужной главе', scrolledTo, entrySlug);
check('новых запросов в сеть не ушло', requests.length, 1);

console.log('\n-- подтягивается третья --');
watchdog.fire(sentinel);
await wait();
check('запрошена третья', requests.at(-1), two.url);
check('в потоке три главы', slugs(), [entrySlug, slugOf(one.body), slugOf(two.body)]);

console.log('\n-- скользящее окно --');
check('текущая вторая — первую держим', slugs().length, 3);
focus.fire(eps()[2]);
await wait();
check('первая свернулась', slugs(), [slugOf(one.body), slugOf(two.body)]);
check('на её месте распорка', spacers(), [entrySlug]);

console.log('\n-- вернулись назад --');
restorer.fire(stream.querySelector('[data-spacer]'));
await wait();
check('глава вернулась', slugs().length, 3);
check('распорок не осталось', spacers(), []);

console.log('\n-- качели: не сворачивается обратно --');
await wait();
await wait();
check('глава осталась на месте', slugs().includes(entrySlug), true);
check('распорка не появилась снова', spacers(), []);

console.log('\n-- вести для проявления цвета --');
check('о каждой пришедшей главе сообщено', told.added >= 2, true);
check('об уходе свёрнутой главы тоже', told.removed >= 1, true);

console.log('\n-- история браузера --');
check('ни одной новой записи (replaceState, не pushState)', window.history.length, 1);

/* ------------------------------------------------------------------------
   Цепная подгрузка.

   Наблюдатель сообщает только о СМЕНЕ состояния. Короткая глава сдвигает
   сторожа всего на пол-экрана, и он из зоны ожидания не выходит — значит
   события больше не будет, и поток замирает после первой подгрузки.
   Ровно это и случилось на живом сайте: серия из четырёх глав показывала одну.

   Проверяем, что после подгрузки положение сторожа перепроверяется вручную.
   --------------------------------------------------------------------- */

console.log('\n-- цепная подгрузка при коротких главах --');
{
  const dom2 = new JSDOM(found.page, {
    url: `http://localhost${entryHref}`,
    runScripts: 'dangerously',
  });
  const w2 = dom2.window;
  const asked = [];

  class AlwaysNear {
    constructor(cb) { this.cb = cb; }
    observe(el) { this.cb([{ target: el, isIntersecting: true }], this); }
    unobserve() {} disconnect() {}
  }

  Object.assign(globalThis, {
    window: w2, document: w2.document, history: w2.history, location: w2.location,
    CustomEvent: w2.CustomEvent, MutationObserver: w2.MutationObserver,
    IntersectionObserver: AlwaysNear, requestAnimationFrame: (fn) => setTimeout(fn, 0),
  });
  w2.matchMedia = () => ({ matches: false, addEventListener() {} });
  globalThis.matchMedia = w2.matchMedia;
  Object.defineProperty(w2, 'innerHeight', { value: 800, configurable: true });

  globalThis.fetch = async (url) => {
    asked.push(url);
    const body = bodies[url];
    return body
      ? { ok: true, status: 200, text: async () => body }
      : { ok: false, status: 404, text: async () => '' };
  };

  // Сторож остаётся рядом с экраном: короткие главы его не выталкивают.
  w2.Element.prototype.getBoundingClientRect = function () {
    const ep = this.dataset && this.dataset.episode !== undefined;
    return { height: ep ? 300 : 0, width: 800, top: ep ? 0 : 100, left: 0 };
  };

  const fresh = await import(`${path.join(ROOT, 'src/scripts/reader.js')}?v=${Date.now()}`);
  fresh.startReader();
  await new Promise((r) => setTimeout(r, 200));

  /*
   * Сравниваем начало списка, а не весь список целиком.
   *
   * Заглушка знает только три главы цепочки, а настоящая серия может быть
   * длиннее — и поток честно попросит четвёртую. Она вернёт 404, поток
   * корректно остановится, но строгое равенство объявило бы это провалом.
   * Проверяем то, что проверяем: что глав подтянулось больше одной.
   */
  check(
    'подтянулись обе следующие главы, а не одна',
    asked.slice(0, found.chain.length),
    found.chain.map((c) => c.url),
  );
}

/* ------------------------------------------------------------------------
   Нить не теряется.

   Статья входит в несколько серий, и в каждой у неё свой номер главы и своя
   следующая. Раньше нить передавалась пометкой `?s=`, которую видел только
   браузер: сервер рисовал страницу по ведущей серии статьи, а исправлял её
   скрипт — и только в двух местах из восьми. Теперь нить назначает адрес
   страницы, и всё считается на сборке.

   Проверяем по собранным файлам, что вся цепочка идёт одной серией и что
   каждая глава знает свой единственный канонический адрес.
   --------------------------------------------------------------------- */

const inThread = (url) => url.startsWith('/series/') ? url.split('/')[2] : null;
const threadId = inThread(entryHref);

if (threadId) {
  console.log('\n-- нить не теряется при прокрутке --');
  /*
   * Ни одна глава цепочки не уходит в ЧУЖУЮ серию.
   *
   * Раньше здесь стояло «все адреса вида /series/{id}/…», и это было верно
   * случайно: в нити, на которой шёл стенд, не попадалось статьи, для которой
   * эта же серия — ведущая. У такой статьи адрес короткий, канонический
   * (`/posts/{slug}`), и проверка честно падала, хотя поведение правильное.
   *
   * Правильный инвариант мягче: адрес либо короткий, либо принадлежит
   * той же серии, что и вся нить. Чужой серии в цепочке быть не должно.
   */
  const threads = [entryHref, ...found.chain.map((c) => hrefOf(c.body))].map(inThread);
  check('ни одна глава не уходит в чужую серию',
    threads.filter((t) => t !== null && t !== threadId),
    []);
  check('канонические адреса — короткие, без серии',
    [found.page, ...found.chain.map((c) => c.body)]
      .map(canonOf)
      .every((c) => c.startsWith('/posts/')),
    true);
  check('в нити своя нумерация, а не ведущей серии',
    attr(found.page, 'data-total') === attr(fs.readFileSync(
      fileOf(`/posts/${entrySlug}`), 'utf8'), 'data-total'),
    false);

  console.log('\n-- блок «также входит в» не повторяет текущую нить --');
  const aside = found.page.match(/<aside class="also"[^>]*>(.*?)<\/aside>/s)?.[1] ?? '';
  const named = [...aside.matchAll(/«([^»]+)»/g)].map((m) => m[1]);
  const here = fs
    .readFileSync(fileOf(`/series/${threadId}`), 'utf8')
    .match(/<h1[^>]*>.*?<\/span>([^<]+)</s)?.[1]
    ?.trim();
  check('текущая серия в списке не названа', named.includes(here), false);
  check('другие серии главы названы', named.length > 0, true);
}

console.log(bad === 0 ? '\nВсё сошлось.\n' : `\nНе сошлось: ${bad}\n`);
process.exit(bad === 0 ? 0 : 1);
