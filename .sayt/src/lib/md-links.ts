/**
 * Ссылки на свои статьи в машинных текстах (`.md`-двойники, `llms-full`).
 *
 * В исходнике ссылка записана по-обсидиановски: `[[pernaty-apt|Пернатый APT]]`.
 * На странице её переводит `remark-obsidian`, а двойник собирается из сырого
 * текста и отдавал её как есть (P16-05, 29.10) — для агента это не ссылка.
 * Здесь она становится обычной: `[Пернатый APT](https://paceofhoney.me/posts/pernaty-apt)`.
 *
 * Адрес полный, а не `/posts/…`: двойник читают вне сайта — сохраняют
 * в заметки, отдают модели текстом, — и относительный адрес там никуда не ведёт.
 *
 * Правила те же, что на странице, и берутся оттуда же: тот же разбор
 * `[[…]]`, та же карта адресов, тот же якорь. Ссылка на заметку, которой
 * на сайте нет, становится простым текстом — как и на странице.
 */

import { WIKI, anchorSlug, readRegistry } from '../plugins/remark-obsidian.mjs';

const SITE = 'https://paceofhoney.me';

/** Квадратные скобки в тексте ссылки сломали бы разметку. */
const escapeText = (s: string) => s.replace(/[[\]]/g, '\\$&');

export function mdLinks(body: string): string {
  const links = readRegistry();
  return body.replace(new RegExp(WIKI.source, 'g'), (whole, bang: string, target: string, anchor?: string, alias?: string) => {
    // Кадры — забота `mdImages`.
    if (bang) return whole;
    const known = links.get(target.trim());
    const text = alias?.trim() ?? known?.title ?? target.trim();
    if (!known) return text;
    return `[${escapeText(text)}](${SITE}${known.url}${anchorSlug(anchor)})`;
  });
}
