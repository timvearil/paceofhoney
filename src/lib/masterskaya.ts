/**
 * Связь Журнала с Мастерской — третьей витриной проекта (P16-08).
 *
 * Всё за одним выключателем: `vkl` в src/content/settings/masterskaya.md.
 * Выключено (по умолчанию) — `getMasterskaya()` отдаёт null, и ни меню,
 * ни llms, ни разметка, ни лента Дзена о Мастерской не знают: сайт
 * собирается ровно так же, как без этого файла.
 */

import { getEntry } from 'astro:content';

export interface Masterskaya {
  url: string;
  zenItems: string;
  menuTitle: string;
  imya: string;
}

/** Настройки Мастерской, если связь включена; иначе null. */
export async function getMasterskaya(): Promise<Masterskaya | null> {
  const e = await getEntry('masterskaya', 'masterskaya');
  if (!e?.data.vkl) return null;
  return { url: e.data.url.replace(/\/+$/, ''), zenItems: e.data.zen_items, menuTitle: e.data.menu_title, imya: e.data.imya };
}

/**
 * Статьи Мастерской для ленты Дзена Журнала — `<item>` из её /zen-items.xml.
 *
 * Мастерская своей ленты Дзена не держит: она отдаёт `<item>` в том же виде,
 * что и лента Журнала, а Журнал вставляет их в свою /zen.xml при сборке.
 *
 * Недоступна, ответила не 200, файл пустой или чужой — предупреждение
 * в журнал сборки и пустой список: лента соберётся из статей Журнала,
 * сборка не падает. Берутся только <item> со ссылкой на адрес Мастерской
 * из настроек — чужое в ленту Журнала не попадёт.
 *
 * Возвращает пары «дата — готовый XML элемента»: Журнал ставит их в общий
 * порядок по дате, как свои.
 */
export async function zenItemsMasterskoj(m: Masterskaya): Promise<{ date: Date; xml: string }[]> {
  // Пробный файл для проверки (README): MASTERSKAYA_ZEN_ITEMS=путь/к/файлу.xml
  const proba = process.env.MASTERSKAYA_ZEN_ITEMS;
  let text: string;
  try {
    if (proba) {
      const fs = await import('node:fs/promises');
      text = await fs.readFile(proba, 'utf8');
    } else {
      const res = await fetch(m.zenItems, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`ответ ${res.status}`);
      text = await res.text();
    }
  } catch (e) {
    console.warn(`[zen.xml] предупреждение: статьи Мастерской не взяты (${m.zenItems}): ${(e as Error).message}. Лента — из статей Журнала.`);
    return [];
  }

  const items = [...text.matchAll(/<item>[\s\S]*?<\/item>/g)].map((x) => x[0]);
  const out: { date: Date; xml: string }[] = [];
  for (const xml of items) {
    const link = xml.match(/<link>([^<]+)<\/link>/)?.[1]?.trim() ?? '';
    const date = new Date(xml.match(/<pubDate>([^<]+)<\/pubDate>/)?.[1] ?? '');
    if (!link.startsWith(m.url + '/') || Number.isNaN(date.getTime())) {
      console.warn(`[zen.xml] предупреждение: пропущен элемент Мастерской без своей ссылки или даты (${link || 'нет <link>'}).`);
      continue;
    }
    // Отступ — как у элементов Журнала.
    out.push({ date, xml: '    ' + xml.trim() });
  }
  if (!out.length) console.warn(`[zen.xml] предупреждение: в ${m.zenItems} нет статей для Дзена. Лента — из статей Журнала.`);
  return out;
}
