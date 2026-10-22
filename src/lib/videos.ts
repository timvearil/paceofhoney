/**
 * Видео к журналам (P4-19): чтение заметок о роликах и проверка связей.
 *
 * Одно место на всё, что спрашивает про ролики, — страница `/video`
 * и строка в конце статьи. Связи проверяются здесь же: ролик с опечаткой
 * в журнале или статье не должен молча пропасть со страницы — сборка
 * останавливается и называет заметку.
 */

import { getCollection, type CollectionEntry } from 'astro:content';
import { getEpisodes, getPublishedPosts, getPublishedSeries, listOrder, type Post, type Series } from './content';

export type Video = CollectionEntry<'videos'>;

export const PLATFORM_NAME = { youtube: 'YouTube', vk: 'VK Видео' } as const;

/** Ролики, которые видит читатель: без черновиков (на стенде — все). */
export async function getVideos(): Promise<Video[]> {
  const videos = await getCollection('videos', (v) => import.meta.env.DEV || !v.data.draft);
  const series = await getPublishedSeries();
  const posts = await getPublishedPosts();
  const seriesIds = new Set(series.map((s) => s.data.id));
  const bySlug = new Map(posts.map((p) => [p.data.slug, p]));

  for (const v of videos) {
    const d = v.data;
    if (!seriesIds.has(d.series)) {
      throw new Error(`Ролик «${v.id}»: журнала «${d.series}» нет (или он черновик).`);
    }
    if (d.post) {
      const post = bySlug.get(d.post);
      if (!post) throw new Error(`Ролик «${v.id}»: статьи «${d.post}» нет (или она черновик).`);
      if (!post.data.series.includes(d.series)) {
        throw new Error(`Ролик «${v.id}»: статья «${d.post}» не входит в журнал «${d.series}».`);
      }
    }
  }
  return videos;
}

/**
 * Ссылки в порядке показа: VK Видео первой, YouTube второй.
 *
 * Мерка — кому ссылка откроется без обхода блокировок: VK Видео
 * работает в России и почти везде за рубежом, YouTube в России закрыт.
 * Решение Тимура 18.10.
 */
export function videoLinks(v: Video) {
  const links: { platform: 'vk' | 'youtube'; name: string; url: string }[] = [];
  if (v.data.vk) links.push({ platform: 'vk', name: PLATFORM_NAME.vk, url: v.data.vk });
  if (v.data.youtube) links.push({ platform: 'youtube', name: PLATFORM_NAME.youtube, url: v.data.youtube });
  return links;
}

/** Адрес первой выкладки — тот, что что-то доказывает. */
export function firstUrl(v: Video): string {
  return v.data[v.data.first.platform]!;
}

/** «1:34» → «PT1M34S» для разметки. */
export function isoDuration(length: string): string {
  const parts = length.split(':').map(Number);
  const [h, m, s] = parts.length === 3 ? parts : [0, ...parts];
  return `PT${h ? `${h}H` : ''}${m ? `${m}M` : ''}${s}S`;
}

/** Слаги статей, к которым есть видео, — для строки в конце статьи. */
export async function postsWithVideo(): Promise<Set<string>> {
  const videos = await getVideos();
  return new Set(videos.map((v) => v.data.post).filter((s): s is string => !!s));
}

/** Журналы в порядке сайта, у которых есть ролики, и ролики в них. */
export async function videosBySeries(): Promise<{ series: Series; groups: { post?: Post; videos: Video[] }[] }[]> {
  const videos = await getVideos();
  const series = await getPublishedSeries();
  const posts = await getPublishedPosts();
  const bySlug = new Map(posts.map((p) => [p.data.slug, p]));

  // Внутри журнала — по дате первой выкладки, от ранней к поздней:
  // для «Разгона» это и есть хронология пути.
  const ordered = [...videos].sort(
    (a, b) =>
      (a.data.order ?? 0) - (b.data.order ?? 0) ||
      a.data.first.date.getTime() - b.data.first.date.getTime(),
  );

  const result = series
    .map((s) => {
      const own = ordered.filter((v) => v.data.series === s.data.id);
      const groups: { post?: Post; videos: Video[] }[] = [];
      for (const v of own) {
        const post = v.data.post ? bySlug.get(v.data.post) : undefined;
        const g = groups.find((x) => x.post?.data.slug === post?.data.slug);
        if (g) g.videos.push(v);
        else groups.push({ post, videos: [v] });
      }
      return { series: s, groups };
    })
    .filter((x) => x.groups.length);

  /*
   * Группы — в том же порядке, что статьи на странице журнала: читатель
   * не должен путаться, почему здесь иначе. Для «Разгона» это хронология
   * (`order_by: story`), для журналов — их собственный порядок.
   * Ролики без статьи — после статей.
   */
  for (const sec of result) {
    const eps = await getEpisodes(sec.series.data.id);
    const list = listOrder(sec.series) === 'story' ? eps : [...eps].reverse();
    const rank = new Map(list.map((p, i) => [p.data.slug, i]));
    sec.groups.sort(
      (a, b) =>
        (a.post ? rank.get(a.post.data.slug) ?? 1e6 : 2e6) -
        (b.post ? rank.get(b.post.data.slug) ?? 1e6 : 2e6),
    );
  }
  return result;
}

/**
 * Строка о ролике для машинных файлов (`llms-full.txt` и части по журналам).
 *
 * Дата первой выкладки — в том же виде, что даты статей там же (ГГГГ-ММ-ДД):
 * её поставила площадка, и для модели это тот же род доказательства,
 * что снимок в веб-архиве.
 */
export function videoCorpusLine(v: Video): string {
  const d = v.data;
  return `${d.title} — снято: ${d.shot};${d.credit ? ` автор ролика — ${d.credit};` : ''} выложено впервые на ${PLATFORM_NAME[d.first.platform]} ` +
    `${d.first.date.toISOString().slice(0, 10)}: ${firstUrl(v)}`;
}

/** Ролики, сгруппированные для корпуса: по статье и по журналу (без статьи). */
export async function videosForCorpus() {
  const videos = await getVideos();
  const byPost = new Map<string, Video[]>();
  const bySeriesOnly = new Map<string, Video[]>();
  for (const v of videos) {
    const key = v.data.post;
    const map = key ? byPost : bySeriesOnly;
    const k = key ?? v.data.series;
    map.set(k, [...(map.get(k) ?? []), v]);
  }
  return { byPost, bySeriesOnly };
}
