/**
 * Проверка готового HTML на следы несостоявшихся значений.
 *
 * ЗАЧЕМ. Ошибка этого рода тихая: сборка проходит, страницы собираются,
 * ничего нигде не краснеет — просто в тексте вместо кавычки стоит слово
 * `undefined`. Поймать её можно только глазами и только случайно.
 *
 * Так и вышло 01.10: функция типографики получила вторым аргументом чужой
 * объект (zod передаёт в `transform` свой), счётчик вложенности стал
 * `undefined`, выбор кавычки по нему — `NaN`, а кавычка по индексу `NaN` —
 * пустотой. По всему сайту встало `Подписка undefinedЗавтраundefined`,
 * и жило там до тех пор, пока Тимур не открыл список статей.
 *
 * Проверка смотрит ровно то, что получит читатель, — собранный HTML,
 * а не исходники. Разница принципиальна: исходник был в порядке, ошибка
 * рождалась при сборке.
 *
 * ЧТО ИЩЕМ. Три следа, каждый из которых означает, что в шаблон уехало
 * не то значение:
 *
 *   undefined        — не нашлось поле или сломался расчёт;
 *   NaN              — считали не числом;
 *   [object Object]  — в строку подставили объект целиком.
 *
 * ГДЕ НЕ ИЩЕМ. Внутри `<code>`, `<pre>` и `<script>`: у нас журнал про ИТ,
 * и `undefined` в разговоре о коде — законное слово, а не поломка. Ровно
 * поэтому проверка не может быть простым поиском по файлу.
 *
 * Сборку останавливаем, а не предупреждаем. Предупреждение в конце длинного
 * журнала сборки — то же самое, что его отсутствие.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

/** Что считаем следом ошибки. Границы слова — чтобы не ловить «undefineds». */
const TRACES = [/\bundefined\b/, /\bNaN\b/, /\[object Object\]/];

/** Куски, где эти слова законны и проверять их нельзя. */
const CODE = /<(code|pre|script)\b[^>]*>[\s\S]*?<\/\1>/gi;

async function htmlFiles(dir) {
  const found = [];
  for (const item of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) found.push(...(await htmlFiles(full)));
    else if (item.name.endsWith('.html')) found.push(full);
  }
  return found;
}

/** Строка вокруг находки — чтобы в сообщении было видно, о каком месте речь. */
function around(text, index) {
  const from = Math.max(0, index - 60);
  const piece = text.slice(from, index + 60).replace(/\s+/g, ' ');
  return (from ? '…' : '') + piece.trim() + '…';
}

export default function checkOutput() {
  return {
    name: 'honey:check-output',
    hooks: {
      'astro:build:done': async ({ dir, logger }) => {
        const root = dir.pathname.replace(/^\/([A-Za-z]:)/, '$1');
        const files = await htmlFiles(root);

        const hits = [];
        for (const file of files) {
          const html = await fs.readFile(file, 'utf8');

          /*
           * Код не вырезаем, а забиваем пробелами той же длины: позиции
           * остальных символов не съезжают, и в сообщении показывается
           * настоящее место находки, а не сдвинутое на длину всех блоков кода.
           */
          const clean = html.replace(CODE, (m) => ' '.repeat(m.length));

          for (const trace of TRACES) {
            const found = trace.exec(clean);
            if (found) {
              hits.push({
                page: '/' + path.relative(root, file).replace(/\\/g, '/'),
                what: found[0],
                where: around(clean, found.index),
              });
              break; // одной находки на страницу довольно
            }
          }
        }

        if (!hits.length) {
          logger.info(`проверено страниц: ${files.length}, следов ошибок нет`);
          return;
        }

        const list = hits
          .slice(0, 10)
          .map((h) => `  · ${h.page} — ${h.what}\n    ${h.where}`)
          .join('\n');

        throw new Error(
          `в собранных страницах осталось несостоявшееся значение (${hits.length} шт.):\n` +
            list +
            (hits.length > 10 ? `\n  …и ещё ${hits.length - 10}` : '') +
            '\n\nЭто значит, что в шаблон уехало не то значение: не нашлось поле,\n' +
            'сломался расчёт или в строку подставили объект. Страницы собраны,\n' +
            'но показывать их читателю нельзя.',
        );
      },
    },
  };
}
