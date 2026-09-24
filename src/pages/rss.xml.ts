/**
 * `/rss.xml` — лента для читалок.
 *
 * Написана руками, без `@astrojs/rss`. Причина не в принципиальности:
 * генерация ленты — это три десятка строк XML, а каждая зависимость требует
 * установки, обновлений и когда-нибудь ломается на ровном месте. Для проекта,
 * который весь смысл видит в независимости от чужой инфраструктуры, тащить
 * пакет ради такого — странно.
 *
 * ДАТА В ЛЕНТЕ — день появления на сайте, а не написания. Лента отвечает
 * на вопрос «что нового», и архивный текст в ней новый: его только что
 * опубликовали здесь. Возраст указан в описании, чтобы подписчик не думал,
 * будто автор вчера съездил на Халкидики.
 */

import type { APIRoute } from 'astro';
import { getPublishedPosts, getPublishedSeries } from '../lib/content';

const SITE = 'https://paceofhoney.me';
const TITLE = 'Со скоростью мёда';
const DESCRIPTION =
  'Журнал о выходе из цифровой «Карусели»: пчеловодство, кибербезопасность ' +
  'через жизнь улья, финансовые аферы через приключения трутней, ' +
  'созерцательные маршруты.';

/** Экранирование для XML. Пять символов, которые ломают документ. */
const esc = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

/** RFC 822 — формат, которого требует спецификация RSS. */
const rfc822 = (d: Date) => d.toUTCString();

export const GET: APIRoute = async () => {
  const posts = await getPublishedPosts();
  const series = await getPublishedSeries();
  const titleOf = new Map(series.map((s) => [s.data.id, s.data.title]));

  const items = posts.map((p) => {
    const d = p.data;
    const url = `${SITE}/posts/${d.slug}`;

    /*
     * Описание: аннотация плюс пояснения, без которых подписчик поймёт
     * запись неверно. Возраст — чтобы архивный текст не выглядел свежей
     * поездкой; серии — чтобы было видно, куда эта глава встаёт.
     */
    const parts = [d.description];
    if (d.origin) {
      const year = d.origin.date.getFullYear();
      const state = {
        original: 'публикуется без правок',
        edited: 'вычитан при переносе',
        rewritten: 'переписан заново',
      }[d.origin.state as 'original' | 'edited' | 'rewritten'];
      parts.push(`Архивный текст ${year} года, ${state}.`);
    }
    const names = d.series.map((id) => titleOf.get(id)).filter(Boolean);
    if (names.length) parts.push(`Журнал: ${names.join(', ')}.`);

    return [
      '    <item>',
      `      <title>${esc(d.title)}</title>`,
      `      <link>${url}</link>`,
      `      <guid isPermaLink="true">${url}</guid>`,
      `      <pubDate>${rfc822(d.date)}</pubDate>`,
      `      <description>${esc(parts.join(' '))}</description>`,
      ...d.tags.map((t: string) => `      <category>${esc(t)}</category>`),
      '    </item>',
    ].join('\n');
  });

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    '  <channel>',
    `    <title>${esc(TITLE)}</title>`,
    `    <link>${SITE}/</link>`,
    `    <description>${esc(DESCRIPTION)}</description>`,
    '    <language>ru</language>',
    `    <atom:link href="${SITE}/rss.xml" rel="self" type="application/rss+xml" />`,
    posts.length ? `    <lastBuildDate>${rfc822(posts[0].data.date)}</lastBuildDate>` : '',
    ...items,
    '  </channel>',
    '</rss>',
    '',
  ]
    .filter((l) => l !== '')
    .join('\n');

  return new Response(xml, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
};
