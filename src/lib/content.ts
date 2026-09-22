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
 * Для переизданий это дата написания, а не переноса на сайт: в «Третьей
 * корзине желаний» тексты десятилетней давности должны идти своей
 * исторической чередой. В ленте «свежее» такая статья всё равно новая —
 * там сортировка по `date`.
 */
const storyDate = (p: Post) => (p.data.original_date ?? p.data.date).getTime();

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

  // 3. Сериал, у которого нет ни одной главы, — скорее всего опечатка в id.
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

  // 4. Порядок глав должен быть определён однозначно.
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
      const day = (p.data.original_date ?? p.data.date).getTime();
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
