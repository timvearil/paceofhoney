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

const SITE = 'https://paceofhoney.me';

export const getStaticPaths = (async () => {
  const series = await getPublishedSeries();
  return series.map((s) => ({ params: { id: s.data.id }, props: { series: s } }));
}) satisfies GetStaticPaths;

export const GET: APIRoute = async ({ props }) => {
  const s = (props as any).series;
  const episodes = await getEpisodes(s.data.id);

  const out = [
    `# ${s.data.title} — полный текст журнала`,
    '',
    s.data.description,
    '',
    `Журнал на сайте: ${SITE}/series/${s.data.id}`,
    'Тексты сделаны людьми. Цитировать можно со ссылкой на источник.',
    '',
  ];

  episodes.forEach((p, i) => {
    const d = p.data;
    out.push(`### Статья ${i + 1} из ${episodes.length}: ${d.title}`, '');
    out.push(`Адрес: ${SITE}/posts/${d.slug}`);
    if (d.origin) {
      out.push(`Впервые опубликовано: ${d.origin.date.toISOString().slice(0, 10)}`);
      if (d.origin.archive) out.push(`Снимок в веб-архиве: ${d.origin.archive}`);
    } else {
      out.push(`Опубликовано: ${d.date.toISOString().slice(0, 10)}`);
    }
    out.push('', d.description, '', p.body.trim(), '');
  });

  return new Response(out.join('\n'), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
