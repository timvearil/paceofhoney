/**
 * Доступ к контенту, нумерация глав и проверки целостности.
 *
 * Ключевое отличие от первой редакции: статья принадлежит **нескольким**
 * сериям сразу, и номер главы перестал быть её свойством. Одна и та же
 * статья может быть восьмой главой «НектарАкций» и двенадцатой главой
 * «Ироничной пасеки». Номер вычисляется здесь, на сборке, отдельно внутри
 * каждой серии.
 *
 * Побочная выгода: дыры и повторы в нумерации стали невозможны в принципе.
 * Раньше черновик в середине серии оставлял на сайте разрыв 1 → 3, и поймать
 * это было нечем.
 *
 * Спецификация: 01_Spec/tz-paceofhoney-v2.md, разделы 1.3, 4.4
 */

import { getCollection, type CollectionEntry } from 'astro:content';

export type Post = CollectionEntry<'posts'>;
export type Series = CollectionEntry<'series'>;

/** Черновики видны при разработке и не попадают в опубликованный сайт. */
const isVisible = (draft: boolean) => import.meta.env.DEV || !draft;

/**
 * Дата, по которой статья встаёт в порядок внутри серии.
 *
 * Для архивных статей это дата первой публикации, а не переноса на сайт:
 * в «Третьей корзине желаний» тексты десятилетней давности должны идти своей
 * исторической чередой. В ленте «свежее» такая статья всё равно новая —
 * там сортировка по `date`, иначе постоянный читатель не заметил бы, что
 * на сайте что-то появилось.
 */
const storyDate = (p: Post) => (p.data.origin?.date ?? p.data.date).getTime();

/**
 * Порядок внутри серии: по дате, при совпадении — по явному `order`.
 *
 * Слаг в конце — только чтобы сборка была воспроизводимой. Полагаться на него
 * нельзя: алфавитный порядок к сюжету отношения не имеет. Поэтому случай
 * «одна дата, `order` не расставлен» сборка считает ошибкой, а не догадывается.
 */
const byStory = (a: Post, b: Post) =>
  storyDate(a) - storyDate(b) ||
  (a.data.order ?? 0) - (b.data.order ?? 0) ||
  a.data.slug.localeCompare(b.data.slug);

/* ------------------------------------------------------------------------ */

export async function getPublishedPosts(): Promise<Post[]> {
  const posts = await getCollection('posts', (p) => isVisible(p.data.draft));
  return posts.sort((a, b) => b.data.date.getTime() - a.data.date.getTime());
}

export async function getPublishedSeries(): Promise<Series[]> {
  const series = await getCollection('series', (s) => isVisible(s.data.draft));
  return series.sort((a, b) => a.data.order - b.data.order);
}

/** Ведущая серия статьи: первая в списке. Она ведёт плашку и поток чтения. */
export const leadSeriesId = (post: Post): string | null => post.data.series[0] ?? null;

/** Главы одной серии по порядку, от первой к последней. */
export async function getEpisodes(seriesId: string): Promise<Post[]> {
  const posts = await getPublishedPosts();
  return posts.filter((p) => p.data.series.includes(seriesId)).sort(byStory);
}

/* ------------------------------------------------------------------------
   НИТЬ ЧТЕНИЯ
   --------------------------------------------------------------------- */

/**
 * Одна и та же статья читается по-разному в зависимости от того, откуда
 * читатель пришёл. Первая глава «НектарАкций» — она же вторая глава
 * «Ироничной пасеки», и следующая за ней в каждом случае своя.
 *
 * Эта серия — «нить». Она не свойство статьи, а свойство **пути**, которым
 * идёт читатель, и потому живёт в адресе страницы, а не в метаданных.
 *
 *   /posts/nektar-1                        — ведущая нить статьи
 *   /series/ironichnaya-paseka/nektar-1    — та же глава другой нитью
 *
 * Раньше нить передавалась пометкой `?s=` в адресе. Пометку видел только
 * браузер, сервер о ней не знал — и рисовал страницу по ведущей серии, а
 * браузер потом дописывал правду поверх. Заплаток требовалось по одной на
 * каждый элемент страницы: плашка и поток их получили, блок «также входит
 * в», полка и мост — нет, и врали. Теперь нить известна на сборке, и каждый
 * элемент считает своё сам.
 */

/**
 * Адрес главы внутри нити.
 *
 * Ведущая нить живёт по короткому адресу: он же канонический, его видит
 * поисковик и его копируют в мессенджер. Остальные нити — с серией впереди.
 */
export function chapterHref(post: Post, seriesId: string): string {
  return seriesId === leadSeriesId(post)
    ? `/posts/${post.data.slug}`
    : `/series/${seriesId}/${post.data.slug}`;
}

/** Канонический адрес главы — один на все нити. */
export const canonicalHref = (post: Post) => `/posts/${post.data.slug}`;

/**
 * Адрес фрагмента для бесшовного потока — всегда адрес главы плюс `/partial`.
 * Единое правило, чтобы не заводить второй способ считать адреса.
 */
export const partialHref = (post: Post, seriesId: string) => `${chapterHref(post, seriesId)}/partial`;

export interface Thread {
  /** Серия, по которой читают. */
  series: Series;
  number: number;
  total: number;
  prev: Post | null;
  next: Post | null;
  /** Первая глава нити — для ссылки «начать сначала». */
  first: Post | null;
}

/** Место статьи в нити и её соседи. Единственный источник этих чисел. */
export async function getThread(
  post: Post,
  seriesId: string,
  all?: Series[],
): Promise<Thread | null> {
  const series = (all ?? (await getPublishedSeries())).find((s) => s.data.id === seriesId);
  if (!series) return null;

  const episodes = await getEpisodes(seriesId);
  const i = episodes.findIndex((e) => e.data.slug === post.data.slug);
  if (i < 0) return null;

  return {
    series,
    number: i + 1,
    total: episodes.length,
    prev: i > 0 ? episodes[i - 1] : null,
    next: i < episodes.length - 1 ? episodes[i + 1] : null,
    first: episodes[0] ?? null,
  };
}

/**
 * Пары «статья × неведущая серия» — маршруты `/series/{id}/{slug}`.
 *
 * Ведущая нить сюда не попадает: она уже обслужена коротким адресом
 * `/posts/{slug}`, и второй маршрут на тот же текст был бы лишним.
 */
export async function getSideThreads(): Promise<{ post: Post; seriesId: string }[]> {
  const posts = await getPublishedPosts();
  const known = new Set((await getPublishedSeries()).map((s) => s.data.id));

  return posts.flatMap((post) =>
    post.data.series
      .slice(1)
      .filter((id) => known.has(id))
      .map((seriesId) => ({ post, seriesId })),
  );
}

/**
 * Серии для витрины и каталога: сколько глав и куда ведёт кнопка «читать».
 *
 * Считается здесь, а не на страницах: адрес первой главы зависит от того,
 * ведущая ли это серия для неё, и расходиться такой расчёт по двум страницам
 * не должен.
 */
export async function getSeriesCards() {
  const series = await getPublishedSeries();
  return Promise.all(
    series.map(async (s) => {
      const eps = await getEpisodes(s.data.id);
      return {
        data: s.data,
        episodes: eps.length,
        readHref: eps[0] ? chapterHref(eps[0], s.data.id) : undefined,
      };
    }),
  );
}

/* ------------------------------------------------------------------------
   Проверки целостности. Вызывать из getStaticPaths — тогда ошибка
   останавливает сборку до публикации.
   --------------------------------------------------------------------- */

/** Предупреждение об отсутствующих снимках показывается один раз за сборку. */
let warnedAboutArchive = false;


export async function assertContentIsSound(): Promise<void> {
  const posts = await getCollection('posts');
  const series = await getCollection('series');
  const pages = await getCollection('pages');
  const problems: string[] = [];

  // 1. Адреса не повторяются. Иначе одна страница молча затрёт другую.
  const seen = new Map<string, string>();
  for (const entry of [...posts, ...pages]) {
    const slug = 'slug' in entry.data ? entry.data.slug : entry.data.permalink;
    const previous = seen.get(slug);
    if (previous) problems.push(`Адрес «${slug}» занят дважды: ${previous} и ${entry.id}`);
    seen.set(slug, entry.id);
  }

  /*
   * 1б. Картинка внутри текста стоит отдельной строкой.
   *
   * `![[кадр.jpg]]`, приклеенный к концу абзаца, Markdown считает частью
   * этого абзаца — и кадр выходит голым `<img>` внутри текста, без рамки
   * и без подписи. На странице это выглядит как «подписи пропали», а причина
   * в одном отсутствующем переводе строки.
   *
   * Ловилось уже трижды, каждый раз глазами и каждый раз не сразу: один раз
   * так пришли тексты из Obsidian, второй раз склеила моя же чистка пробелов,
   * где `!` попал в список знаков препинания. Пусть теперь ругается сборка.
   */
  for (const post of posts) {
    for (const line of post.body?.split('\n') ?? []) {
      const at = line.indexOf('![[');
      if (at > 0) {
        problems.push(
          `${post.id}: картинка приклеена к тексту — «${line.slice(Math.max(0, at - 30), at + 20)}». ` +
            'Кадр ставится отдельной строкой, с пустыми строками до и после.',
        );
      }
    }
  }

  // 2. Каждая серия, на которую ссылается статья, существует.
  const known = new Set(series.map((s) => s.data.id));
  for (const post of posts) {
    for (const id of post.data.series) {
      if (!known.has(id)) {
        problems.push(
          `Статья ${post.id} ссылается на серию «${id}», которой нет в src/content/series/`,
        );
      }
    }
  }

  // 3. Идентификатор серии не повторяется.
  //
  // Имя файла тут ни при чём: серию опознаёт поле `id`, и два разных файла
  // могут объявить одно и то же. Тогда маршрут `/series/{id}` соберётся
  // дважды, одна страница молча затрёт другую, а главы обеих серий
  // перемешаются в одну нить — причём порядок будет зависеть от того,
  // в каком порядке файлы прочитались с диска.
  const takenIds = new Map<string, string>();
  for (const s of series) {
    const previous = takenIds.get(s.data.id);
    if (previous) {
      problems.push(
        `Идентификатор серии «${s.data.id}» занят дважды: ${previous} и ${s.id}`,
      );
    }
    takenIds.set(s.data.id, s.id);
  }

  /*
   * 3б. Порядок на витрине задан однозначно.
   *
   * `order` решает, в каком порядке журналы стоят на столике. Два одинаковых
   * числа — и порядок между ними определяет сортировка, то есть случай:
   * сегодня один сверху, завтра другой. Та же беда, что с двумя статьями
   * на одну дату, и лечится так же — назвать порядок явно.
   */
  const byOrder = new Map<number, string>();
  for (const s of series) {
    if (s.data.draft) continue;
    const taken = byOrder.get(s.data.order);
    if (taken) {
      problems.push(
        `Журналы «${taken}» и «${s.data.id}» стоят на одном месте витрины ` +
          `(order: ${s.data.order}) — порядок между ними не определён.`,
      );
    }
    byOrder.set(s.data.order, s.data.id);
  }

  // 4. Сериал, у которого нет ни одной главы, — скорее всего опечатка в id.
  for (const s of series) {
    if (s.data.draft) continue;
    const count = posts.filter((p) => !p.data.draft && p.data.series.includes(s.data.id)).length;
    if (count === 0) {
      problems.push(
        `В серии «${s.data.id}» нет ни одной опубликованной статьи. ` +
          'Либо это опечатка в идентификаторе, либо серию стоит пометить черновиком.',
      );
    }
  }

  // 5. Архивные статьи: блок `origin` должен быть непротиворечив.
  for (const post of posts) {
    const o = post.data.origin;
    if (!o) continue;

    // Текст не может выйти впервые позже, чем появился здесь. Обычно это
    // описка в годе — и она тихо сломала бы порядок глав в серии.
    if (o.date.getTime() > post.data.date.getTime()) {
      problems.push(
        `Статья ${post.id}: первая публикация (${o.date.toISOString().slice(0, 10)}) ` +
          `позже переноса на сайт (${post.data.date.toISOString().slice(0, 10)}). ` +
          'Похоже на описку в годе.',
      );
    }

    /*
     * Блок рассчитан на давние тексты: он говорит про возраст словами
     * и про «текст тех лет». На статье двухмесячной давности это нелепо,
     * а доказывать ею нечего — недавний год сам по себе ничего не значит.
     * Скорее всего, автор просто перепутал блок с чем-то другим.
     */
    const years = (Date.now() - o.date.getTime()) / (365.25 * 24 * 3600 * 1000);
    if (years < 2) {
      console.warn(
        `[архив] ${post.id}: блок origin заполнен, но тексту меньше двух лет ` +
          `(${o.date.toISOString().slice(0, 10)}).\n` +
          '        Он рассчитан на давние публикации и скажет «текст тех лет». ' +
          'Для недавних перепубликаций блок не нужен.',
      );
    }

    // Переписанный текст обязан назвать оригинал. Иначе утверждение
    // «написано заново» повисает без второй точки отсчёта.
    if (o.state === 'rewritten' && !o.url && !o.archive) {
      problems.push(
        `Статья ${post.id}: помечена как переписанная, но ссылки на оригинал нет. ` +
          'Дайте `origin.url` или `origin.archive` — иначе читателю не с чем сравнить.',
      );
    }
  }

  /*
   * Отдельно — не ошибка, а предупреждение.
   *
   * Живая ссылка на заброшенную площадку умрёт вместе с ней, и с ней пропадёт
   * единственное подтверждение возраста текста. Снимок в веб-архиве датирован
   * и переживёт площадку: именно он доказывает, что текст написан до эпохи
   * генеративных моделей. Останавливать сборку из-за этого нельзя — снимка
   * может не существовать, — но промолчать значит дать ему потеряться.
   */
  const noArchive = posts.filter((p) => p.data.origin?.url && !p.data.origin.archive);
  if (noArchive.length && !warnedAboutArchive) {
    // Проверки вызываются из каждого маршрута, а предупреждение нужно одно:
    // иначе при двух десятках архивных статей в консоль уедут три одинаковые
    // простыни, и настоящие сообщения потеряются между ними.
    warnedAboutArchive = true;
    console.warn(
      '[архив] у этих статей есть ссылка на первую публикацию, но нет снимка ' +
        'в веб-архиве:\n' +
        noArchive.map((p) => `        · ${p.id}`).join('\n') +
        '\n        Площадка может закрыться. Сохраните страницу на web.archive.org ' +
        'и впишите `origin.archive`.',
    );
  }

  // 6. Порядок глав должен быть определён однозначно.
  //
  // Если две статьи одной серии стоят на одну дату и ни у одной не задан
  // `order`, порядок решится алфавитом слага — то есть случайно. Для серии
  // с причинной связью между главами это тихо ломает сюжет: третья глава
  // может оказаться раньше второй, на которую опирается.
  //
  // Сборка такой случай не угадывает, а останавливается.
  const visible = posts.filter((p) => !p.data.draft);
  for (const s of series) {
    const byDay = new Map<number, typeof visible>();
    for (const p of visible) {
      if (!p.data.series.includes(s.data.id)) continue;
      const day = (p.data.origin?.date ?? p.data.date).getTime();
      byDay.set(day, [...(byDay.get(day) ?? []), p]);
    }

    for (const [day, group] of byDay) {
      if (group.length < 2) continue;
      const unset = group.filter((p) => p.data.order === undefined);
      if (unset.length < 2) continue;
      problems.push(
        `Серия «${s.data.id}»: на ${new Date(day).toISOString().slice(0, 10)} стоят ` +
          `${group.length} статьи (${group.map((p) => p.data.slug).join(', ')}), ` +
          'и порядок между ними не определён. Поставьте разные даты или добавьте ' +
          'поле order хотя бы всем, кроме одной.',
      );
    }
  }

  // Проверки сплошной нумерации нет: номера считаются сами,
  // пропустить или повторить номер физически невозможно.

  if (problems.length) {
    throw new Error(
      'Контент не прошёл проверку:\n\n' +
        problems.map((p) => `  · ${p}`).join('\n') +
        '\n\nСборка остановлена намеренно.\n',
    );
  }
}
