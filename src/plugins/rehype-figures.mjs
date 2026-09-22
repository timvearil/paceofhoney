/**
 * Иллюстрации в теле статьи: подпись, проявление цвета, честный размер.
 *
 * Ведущий кадр статьи рисует компонент `Frame` — он даёт подпись под
 * фотографией и фирменное проявление цвета при наведении. А картинки внутри
 * текста приходят из Markdown обычным `<img>` и до недавнего времени жили
 * своей жизнью: без подписи, серыми навсегда и с чужими размерами.
 *
 * Плагин приводит их к общему виду уже после того, как Astro посчитал
 * `srcset`: работаем с готовым HTML-деревом, ничего не ломая в оптимизации.
 *
 * ТРИ ВЕЩИ, КОТОРЫЕ ОН ДЕЛАЕТ.
 *
 * 1. Оборачивает картинку в `<figure>`. Абзац, в котором картинка стоит одна,
 *    заменяется целиком: `<p><img></p>` — невалидная обёртка для figure,
 *    и браузер разорвал бы абзац сам, в непредсказуемом месте.
 *
 * 2. Переносит текст после `|` в подпись под кадром. В Obsidian
 *    `![[схема.jpg|Схема движения роя]]` показывает эту строку как подпись —
 *    значит и на сайте она должна быть подписью, а не только alt.
 *
 * 3. Чинит `sizes`. Astro по умолчанию ставит ширину исходника: кадр 1800px
 *    просил бы у браузера полтора мегабайта на колонку шириной 640. Здесь
 *    указана настоящая ширина колонки текста — 40rem.
 *
 * Ориентацию плагин не разбирает намеренно: атрибуты `width` и `height`
 * Astro проставляет позже, чем работает этот код, — проверено, на этом шаге
 * их ещё нет. Вертикальный кадр сужается стилями: у него ограничена высота,
 * а ширину подбирает браузер. См. `.inline-shot` в tokens.css.
 *
 * Спецификация: 01_Spec/tz-paceofhoney-v2.md, раздел 4.6
 */

import { visit } from 'unist-util-visit';

/** Ширина текстовой колонки из EpisodeLayout: `.post-content { max-width: 40rem }`. */
const SIZES = '(min-width: 40rem) 40rem, 100vw';

const isImage = (n) => n?.type === 'element' && n.tagName === 'img';

/** Абзац, в котором нет ничего, кроме одной картинки. */
function loneImage(node) {
  if (node.type !== 'element' || node.tagName !== 'p') return null;
  const meaningful = node.children.filter(
    (c) => !(c.type === 'text' && c.value.trim() === ''),
  );
  return meaningful.length === 1 && isImage(meaningful[0]) ? meaningful[0] : null;
}

export function rehypeFigures() {
  return function transformer(tree) {
    visit(tree, 'element', (node, index, parent) => {
      const img = loneImage(node);
      if (!img || !parent || index === null) return;

      // Ширину колонки браузер знает лучше исходника — см. пункт 3 в шапке.
      img.properties.sizes = SIZES;

      const caption = (img.properties.alt ?? '').trim();

      const figure = {
        type: 'element',
        tagName: 'figure',
        properties: { className: ['inline-shot'] },
        children: [
          {
            type: 'element',
            tagName: 'div',
            // Тот же механизм проявления цвета, что у ведущего кадра:
            // наблюдатель ищет элементы с этим признаком и вешает .in-focus.
            properties: { className: ['shot'], 'data-focus-frame': true },
            children: [img],
          },
        ],
      };

      if (caption) {
        figure.children.push({
          type: 'element',
          tagName: 'figcaption',
          properties: { className: ['mono'] },
          children: [{ type: 'text', value: caption }],
        });
      }

      parent.children.splice(index, 1, figure);
      return index + 1;
    });
  };
}

export default rehypeFigures;
