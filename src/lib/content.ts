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

/**
 * Место статьи в серии и её соседи.
 *
 * Серию можно указать явно — для будущего режима «читаю через ту серию,
 * из которой пришёл». По умолчанию берётся ведущая.
 */
export async function getPlacement(post: Post, seriesId?: string) {
  const id = seriesId ?? leadSeriesId(post);
  if (!id) return null;

  const episodes = await getEpisodes(id);
  const i = episodes.findIndex((e) => e.data.slug === post.data.slug);
  if (i < 0) return null;

  return {
    seriesId: id,
    number: i + 1,
    total: episodes.length,
    prev: i > 0 ? episodes[i - 1] : null,
    next: i < episodes.length - 1 ? episodes[i + 1] : null,
  };
}

/** Все серии статьи с их данными — для блока «Эта глава также входит в…». */
export async function getSeriesOf(post: Post): Promise<Series[]> {
  const all = await getPublishedSeries();
  return post.data.series
    .map((id) => all.find((s) => s.data.id === id))
    .filter((s): s is Series => Boolean(s));
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
