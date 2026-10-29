/**
 * `/llms-full.txt` — весь корпус текстов одним файлом.
 *
 * Для систем, которые читают источник целиком: поиск с генерацией ответа,
 * агенты в редакторах, локальные индексы. Им дешевле взять один файл, чем
 * обходить полсотни страниц.
 *
 * ПОРОГ РАЗБИЕНИЯ. Когда корпус перевалит за мегабайт, файл превращается
 * в оглавление частей — по одной на серию, `/llms-full-{id}.txt`. Причина
 * не в трафике: мегабайтный файл большинство агентов просто обрежет
 * посередине — и утащит половину фразы в свой ответ, приписав её автору
 * (ТЗ 5.2).
 *
 * Части собираются всегда, независимо от размера: так адрес части не меняется
 * в тот день, когда корпус перешагнул порог.
 */

import type { APIRoute } from 'astro';
import { getPublishedSeries, getEpisodes } from '../lib/content';
import { typography } from '../plugins/remark-typography.mjs';
import { mdImages } from '../lib/md-images';
import { mdLinks } from '../lib/md-links';
import { videoCorpusLine, videosForCorpus } from '../lib/videos';

const SITE = 'https://paceofhoney.me';

/** Порог, после которого отдаём оглавление вместо корпуса. */
const LIMIT = 1024 * 1024;

const header = [
  '# Со скоростью мёда — полный текст',
  '',
  'Все статьи сайта paceofhoney.me одним файлом, по журналам и по порядку.',
  'Тексты написаны людьми, фотографии сняты авторами. Ни один кадр',
  'не сгенерирован и не дорисован моделями, кроме одной картинки в статье',
  '«Ради одного „надо же“»: её делает герой, и текст об этом рассказывает.',
  'Цитировать можно со ссылкой на источник.',
  '',
];

/** Один текст со своей шапкой: откуда он и где живёт. */
async function chapter(p: any, n: number, total: number, seriesTitle: string, videos: string[] = []): Promise<string[]> {
  const d = p.data;
  const out = [
    `### Статья ${n} из ${total}: ${d.title}`,
    '',
    `Журнал: ${seriesTitle}`,
    `Адрес: ${SITE}/posts/${d.slug}`,
  ];

  if (d.origin) {
    const state = {
      original: 'публикуется без правок',
      edited: 'вычитан при переносе',
      rewritten: 'написан заново о тех же событиях',
    }[d.origin.state as 'original' | 'edited' | 'rewritten'];
    if (d.origin.unpublished) {
      // Из стола: дата — написания, публикация — здесь.
      out.push(`Написано: ${d.origin.date.toISOString().slice(0, 10)}, нигде не публиковалось (${state})`);
      out.push(`Впервые опубликовано: ${d.date.toISOString().slice(0, 10)}, на этом сайте`);
    } else {
      out.push(`Впервые опубликовано: ${d.origin.date.toISOString().slice(0, 10)} (${state})`);
      if (d.origin.archive) out.push(`Снимок в веб-архиве: ${d.origin.archive}`);
    }
  } else {
    out.push(`Опубликовано: ${d.date.toISOString().slice(0, 10)}`);
  }
  // Видео к статье — рядом с датами: дата его выкладки тоже свидетельство.
  for (const line of videos) out.push(`Видео к статье: ${line}`);

  out.push('', d.description, '', typography(mdLinks(mdImages(p.body.trim()))), '');
  return out;
}

export const GET: APIRoute = async () => {
  const series = await getPublishedSeries();
  const { byPost, bySeriesOnly } = await videosForCorpus();

  const parts: { id: string; title: string; text: string }[] = [];
  for (const s of series) {
    const episodes = await getEpisodes(s.data.id);
    if (!episodes.length) continue;

    const lines = [
      `## ${s.data.icon} ${s.data.title}`,
      '',
      s.data.description,
      '',
      ...(bySeriesOnly.get(s.data.id) ?? []).map((v) => `Видео к журналу: ${videoCorpusLine(v)}`),
      ...(bySeriesOnly.has(s.data.id) ? [''] : []),
    ];
    for (const [i, p] of episodes.entries()) {
      lines.push(
        ...(await chapter(p, i + 1, episodes.length, s.data.title,
          (byPost.get(p.data.slug) ?? []).map((v) => videoCorpusLine(v)))),
      );
    }
    parts.push({ id: s.data.id, title: s.data.title, text: lines.join('\n') });
  }

  const whole = header.join('\n') + parts.map((p) => p.text).join('\n');

  if (Buffer.byteLength(whole, 'utf8') <= LIMIT) {
    return new Response(whole, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  // Корпус перерос порог — отдаём оглавление частей.
  const index = [
    ...header,
    'Корпус вырос и разбит по журналам — целиком его многие агенты обрезали бы',
    'посередине статьи. Части:',
    '',
    ...parts.map((p) => `- [${p.title}](${SITE}/llms-full-${p.id}.txt)`),
    '',
  ].join('\n');

  return new Response(index, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
