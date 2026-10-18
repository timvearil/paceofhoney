/**
 * Честный `lastmod` для карты сайта (аудит 17.10, задача 13).
 *
 * Дата берётся из самих статей, а не из времени сборки: дата сборки
 * у всех страниц одна и та же и ничего не говорит поисковику.
 *
 *   статья                 — `updated`, иначе `date`;
 *   журнал                 — самая свежая из его статей;
 *   главная, «Все статьи», «Журналы» — самая свежая статья сайта;
 *   страницы без даты («О нас», «Словарь», «Видео») — без `lastmod`:
 *   выдуманная дата хуже никакой.
 *
 * Читается из служебной части файлов простым разбором: настройка сборки
 * выполняется до того, как Astro соберёт коллекции контента. Поля, которые
 * здесь нужны, — `slug`, `date`, `updated`, `draft`, `series` — пишутся
 * всегда в одну строку (или списком под `series:`), так что разбора
 * по строкам достаточно.
 */

import fs from 'node:fs';
import path from 'node:path';

function frontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  return m ? m[1] : '';
}

function field(fm, name) {
  const m = new RegExp(`^${name}:\\s*["']?([^"'\\n]+?)["']?\\s*$`, 'm').exec(fm);
  return m ? m[1].trim() : undefined;
}

function list(fm, name) {
  const block = new RegExp(`^${name}:\\s*\\n((?:\\s+-\\s.*\\n?)+)`, 'm').exec(fm);
  if (!block) return [];
  return [...block[1].matchAll(/-\s*["']?([^"'\n]+?)["']?\s*$/gm)].map((x) => x[1].trim());
}

/** Карта «путь страницы → дата YYYY-MM-DD». */
export function lastmodMap(root) {
  const dir = path.join(root, 'src/content/posts');
  const posts = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.md')) continue;
    const fm = frontmatter(fs.readFileSync(path.join(dir, name), 'utf8'));
    if (field(fm, 'draft') === 'true') continue;
    const slug = field(fm, 'slug');
    const day = field(fm, 'updated') ?? field(fm, 'date');
    if (!slug || !day) continue;
    posts.push({ slug, day: day.slice(0, 10), series: list(fm, 'series') });
  }

  const map = new Map();
  const latest = (days) => days.sort().at(-1);
  for (const p of posts) map.set(`/posts/${p.slug}`, p.day);

  const bySeries = new Map();
  for (const p of posts) for (const s of p.series) bySeries.set(s, [...(bySeries.get(s) ?? []), p.day]);
  for (const [s, days] of bySeries) map.set(`/series/${s}`, latest(days));

  const newest = latest(posts.map((p) => p.day));
  if (newest) for (const p of ['/', '/posts', '/series']) map.set(p, newest);
  return map;
}
