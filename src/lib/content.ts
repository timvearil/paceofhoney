/**
 * Доступ к контенту и проверки целостности.
 *
 * Схема в `content.config.ts` проверяет каждый файл поодиночке. Здесь —
 * проверки, которые видны только на всём корпусе сразу: повторяющиеся адреса,
 * дыры в нумерации глав, ссылка на несуществующую серию.
 *
 * Любая из них роняет сборку с внятным сообщением. Лучше не собраться,
 * чем выложить сериал, в котором седьмая глава ведёт в никуда.
 *
 * Спецификация: 01_Spec/tz-paceofhoney-v2.md, разделы 1.3, 4.4.5
 */

import { getCollection, type CollectionEntry } from 'astro:content';

export type Post = CollectionEntry<'posts'>;
export type Series = CollectionEntry<'series'>;

/** Черновики видны при разработке и не попадают в опубликованный сайт. */
const isVisible = (draft: boolean) => import.meta.env.DEV || !draft;

/* ------------------------------------------------------------------------ */

export async function getPublishedPosts(): Promise<Post[]> {
  const posts = await getCollection('posts', (p) => isVisible(p.data.draft));
  return posts.sort((a, b) => b.data.date.getTime() - a.data.date.getTime());
}

export async function getPublishedSeries(): Promise<Series[]> {
  const series = await getCollection('series', (s) => isVisible(s.data.draft));
  return series.sort((a, b) => a.data.order - b.data.order);
}

/** Главы одной серии по порядку, от первой к последней. */
export async function getEpisodes(seriesId: string): Promise<Post[]> {
  const posts = await getPublishedPosts();
  return posts
    .filter((p) => p.data.series_id === seriesId)
    .sort((a, b) => a.data.episode_number! - b.data.episode_number!);
}

/** Соседи главы в потоке чтения. Основа «Бесшовного книжного потока». */
export async function getNeighbours(post: Post) {
  if (!post.data.series_id) return { prev: null, next: null, total: 0, index: 0 };

  const episodes = await getEpisodes(post.data.series_id);
  const i = episodes.findIndex((e) => e.data.slug === post.data.slug);

  return {
    prev: i > 0 ? episodes[i - 1] : null,
    next: i >= 0 && i < episodes.length - 1 ? episodes[i + 1] : null,
    total: episodes.length,
    index: i + 1,
  };
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
    if (previous) {
      problems.push(`Адрес «${slug}» занят дважды: ${previous} и ${entry.id}`);
    }
    seen.set(slug, entry.id);
  }

  // 2. Каждая глава ссылается на существующую серию.
  const knownSeries = new Set(series.map((s) => s.data.id));
  for (const post of posts) {
    const id = post.data.series_id;
    if (id && !knownSeries.has(id)) {
      problems.push(
        `Глава ${post.id} ссылается на серию «${id}», которой нет в src/content/series/`,
      );
    }
  }

  // 3. Нумерация глав сплошная, от первой, без повторов.
  for (const s of series) {
    const numbers = posts
      .filter((p) => p.data.series_id === s.data.id)
      .map((p) => p.data.episode_number!)
      .sort((a, b) => a - b);

    if (numbers.length === 0) continue;

    const duplicates = numbers.filter((n, i) => numbers[i - 1] === n);
    if (duplicates.length) {
      problems.push(`Серия «${s.data.id}»: номер главы повторяется — ${[...new Set(duplicates)].join(', ')}`);
    }

    const expected = Array.from({ length: numbers.length }, (_, i) => i + 1);
    const missing = expected.filter((n) => !numbers.includes(n));
    if (missing.length) {
      problems.push(
        `Серия «${s.data.id}»: пропущены главы ${missing.join(', ')}. ` +
          'Нумерация должна идти подряд от первой, иначе «Глава N из M» соврёт читателю.',
      );
    }
  }

  if (problems.length) {
    throw new Error(
      'Контент не прошёл проверку:\n\n' +
        problems.map((p) => `  · ${p}`).join('\n') +
        '\n\nСборка остановлена намеренно.\n',
    );
  }
}
