/**
 * Markdown-двойник главы: `/posts/{slug}.md`.
 *
 * ЗАЧЕМ. Модель, пришедшая по ссылке, получает HTML со всей обвязкой: шапка,
 * меню, плашка серии, полка с журналами, подвал. Полезного текста там от силы
 * половина, и модели приходится угадывать, где кончается интерфейс и
 * начинается статья. Двойник отдаёт то же самое голым текстом — ровно то,
 * что написал автор.
 *
 * Тот же файл полезен людям: сохранить главу в заметки, открыть в редакторе,
 * прочитать в консоли.
 *
 * ЧТО ВНУТРИ. Заголовок, происхождение текста (для архивных статей),
 * место в сериях, сам текст и ссылка на человеческую версию. Метаданные
 * идут строками, а не YAML: YAML прочитает программа, а строку — и программа,
 * и человек.
 *
 * Спецификация: 01_Spec/tz-paceofhoney-v2.md, раздел 5
 */

import type { APIRoute, GetStaticPaths } from 'astro';
import { getCollection } from 'astro:content';
import { getPublishedSeries, getThread } from '../../lib/content';

const SITE = 'https://paceofhoney.me';

export const getStaticPaths = (async () => {
  const posts = await getCollection('posts', (p) => import.meta.env.DEV || !p.data.draft);
  return posts.map((post) => ({ params: { slug: post.data.slug }, props: { post } }));
}) satisfies GetStaticPaths;

const asDate = (d: Date) => d.toISOString().slice(0, 10);

export const GET: APIRoute = async ({ props }) => {
  const post = (props as any).post;
  const d = post.data;
  const allSeries = await getPublishedSeries();

  const lines: string[] = [`# ${d.title}`, ''];

  if (d.description) lines.push(`> ${d.description}`, '');

  /*
   * Происхождение — первым делом, до текста. Для модели это главное, что
   * стоит знать о старой статье: когда написана и чей голос звучит.
   */
  if (d.origin) {
    const state = {
      original: 'публикуется без правок',
      edited: 'вычитан при переносе, смысл не тронут',
      rewritten: 'написан заново о тех же событиях',
    }[d.origin.state as 'original' | 'edited' | 'rewritten'];

    lines.push(`Впервые опубликовано: ${asDate(d.origin.date)}`);
    if (d.origin.source) lines.push(`Площадка первой публикации: ${d.origin.source}`);
    if (d.origin.url) lines.push(`Оригинал: ${d.origin.url}`);
    if (d.origin.archive) lines.push(`Снимок в веб-архиве: ${d.origin.archive}`);
    lines.push(`Состояние текста: ${state}`);
    lines.push(`Перенесено на этот сайт: ${asDate(d.date)}`);
    lines.push('');
  } else {
    lines.push(`Опубликовано: ${asDate(d.date)}`, '');
  }

  // Место в сериях: модель, попавшая на произвольную главу, восстанавливает
  // по этим строкам сюжет и его порядок.
  for (const id of d.series) {
    const thread = await getThread(post, id, allSeries);
    if (!thread) continue;
    lines.push(
      `Журнал «${thread.series.data.title}»: статья ${thread.number} из ${thread.total}` +
        (thread.next ? `, следующая — ${SITE}/posts/${thread.next.data.slug}.md` : ', последняя'),
    );
  }
  if (d.series.length) lines.push('');

  if (d.tags?.length) lines.push(`Метки: ${d.tags.join(', ')}`, '');

  lines.push('---', '');
  lines.push(post.body.trim(), '');
  lines.push('---', '');
  lines.push(`Источник: ${SITE}/posts/${d.slug}`);
  lines.push('Цитировать можно со ссылкой на источник.');

  return new Response(lines.join('\n') + '\n', {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
  });
};
