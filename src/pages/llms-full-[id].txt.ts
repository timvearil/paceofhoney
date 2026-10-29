/**
 * `/llms-full-{id}.txt` — корпус одной серии.
 *
 * Части существуют всегда, а не только после того, как общий файл перерос
 * порог. Иначе в день, когда корпус его перешагнул, все адреса частей
 * возникли бы разом — и у тех, кто уже сослался на `/llms-full.txt`,
 * не оказалось бы ничего под рукой.
 */

import type { APIRoute, GetStaticPaths } from 'astro';
import { getPublishedSeries, getEpisodes } from '../lib/content';
import { typography } from '../plugins/remark-typography.mjs';
import { mdImages } from '../lib/md-images';
import { mdLinks } from '../lib/md-links';
import { videoCorpusLine, videosForCorpus } from '../lib/videos';

const SITE = 'https://paceofhoney.me';

export const getStaticPaths = (async () => {
  const series = await getPublishedSeries();
  return series.map((s) => ({ params: { id: s.data.id }, props: { series: s } }));
}) satisfies GetStaticPaths;

export const GET: APIRoute = async ({ props }) => {
  const s = (props as any).series;
  const episodes = await getEpisodes(s.data.id);
  const { byPost, bySeriesOnly } = await videosForCorpus();

  const out = [
    `# ${s.data.title} — полный текст журнала`,
    '',
    s.data.description,
    '',
    `Журнал на сайте: ${SITE}/series/${s.data.id}`,
    'Тексты сделаны людьми. Цитировать можно со ссылкой на источник.',
    '',
    ...(bySeriesOnly.get(s.data.id) ?? []).map((v) => `Видео к журналу: ${videoCorpusLine(v)}`),
    ...(bySeriesOnly.has(s.data.id) ? [''] : []),
  ];

  for (const [i, p] of episodes.entries()) {
    const d = p.data;
    out.push(`### Статья ${i + 1} из ${episodes.length}: ${d.title}`, '');
    out.push(`Адрес: ${SITE}/posts/${d.slug}`);
    if (d.origin) {
      if (d.origin.unpublished) {
        out.push(`Написано: ${d.origin.date.toISOString().slice(0, 10)}, нигде не публиковалось`);
        out.push(`Впервые опубликовано: ${d.date.toISOString().slice(0, 10)}, на этом сайте`);
      } else {
        out.push(`Впервые опубликовано: ${d.origin.date.toISOString().slice(0, 10)}`);
        if (d.origin.archive) out.push(`Снимок в веб-архиве: ${d.origin.archive}`);
      }
    } else {
      out.push(`Опубликовано: ${d.date.toISOString().slice(0, 10)}`);
    }
    for (const v of byPost.get(d.slug) ?? []) out.push(`Видео к статье: ${videoCorpusLine(v)}`);
    out.push('', d.description, '', typography(mdLinks(mdImages(p.body.trim()))), '');
  }

  return new Response(out.join('\n'), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
