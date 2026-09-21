/**
 * Понимание синтаксиса Obsidian при сборке.
 *
 * Тексты пишутся в Obsidian, а он использует свои формы записи, которых нет
 * в обычном Markdown. Этот плагин переводит их в понятное Astro:
 *
 *   ![[фото.jpg]]            →  обычная картинка ./_attachments/фото.jpg
 *   ![[фото.jpg|подпись]]    →  она же, подпись уходит в alt
 *   [[nektar-3]]             →  ссылка /posts/nektar-3 с заголовком главы
 *   [[nektar-3|смотри тут]]  →  та же ссылка с заданным текстом
 *   [[nektar-3#глава]]       →  ссылка с якорем
 *   [[черновик-в-vault]]     →  ОБЫЧНЫЙ ТЕКСТ, не битая ссылка
 *
 * Последняя строка — главная. В vault сотни заметок, которых на сайте нет:
 * атомарные, служебные, черновые. Ссылка на такую в рабочем абзаце — нормальная
 * ситуация, а не ошибка. Читатель не должен получать ссылку в никуда, но и
 * сборку ронять из-за этого незачем: в лог уходит предупреждение.
 *
 * Картинки намеренно превращаются в обычный Markdown, а не в компонент:
 * Astro сам оптимизирует относительные пути в разметке — режет avif и webp,
 * проставляет размеры. Своего кода для этого писать не нужно.
 *
 * Спецификация: 01_Spec/tz-paceofhoney-v2.md, раздел 4.6
 */

import { visit } from 'unist-util-visit';
import fs from 'node:fs';
import path from 'node:path';

const IMAGE_EXT = /\.(avif|gif|jpe?g|png|svg|webp)$/i;

/** [[ссылка]] и ![[вложение]] с необязательной частью после | и после # */
const WIKI = /(!?)\[\[([^\]|#]+)(#[^\]|]+)?(?:\|([^\]]+))?\]\]/g;

/**
 * Карта «адрес → куда ведёт». Собирается один раз за сборку прямым чтением
 * фронтматтера: плагин работает пофайлово и до коллекций Astro не дотягивается.
 */
let registry = null;

function readRegistry(root) {
  if (registry) return registry;
  registry = new Map();

  const sources = [
    { dir: path.join(root, 'src/content/posts'), prefix: '/posts/', key: 'slug' },
    { dir: path.join(root, 'src/content/pages'), prefix: '', key: 'permalink' },
  ];

  for (const { dir, prefix, key } of sources) {
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.md')) continue;
      const raw = fs.readFileSync(path.join(dir, file), 'utf8');
      const front = raw.split(/^---\s*$/m)[1];
      if (!front) continue;

      const value = front.match(new RegExp(`^${key}:\\s*["']?([^"'\\n]+)`, 'm'))?.[1]?.trim();
      const title = front.match(/^title:\s*["']?([^"'\n]+)/m)?.[1]?.trim();
      if (!value) continue;

      const id = value.replace(/^\//, '');
      registry.set(id, { url: prefix ? prefix + id : value, title: title ?? id });
      // Имя файла без расширения — тоже рабочая форма ссылки: в Obsidian
      // ссылаются именно так, по названию заметки.
      registry.set(file.replace(/\.md$/, ''), {
        url: prefix ? prefix + id : value,
        title: title ?? id,
      });
    }
  }
  return registry;
}

export function remarkObsidian({ root = process.cwd(), attachments = './_attachments' } = {}) {
  return function transformer(tree, file) {
    const links = readRegistry(root);
    const source = file?.history?.[0] ?? file?.path ?? 'неизвестный файл';
    const broken = [];

    visit(tree, 'text', (node, index, parent) => {
      if (!parent || index === null || !WIKI.test(node.value)) return;
      WIKI.lastIndex = 0;

      const out = [];
      let cursor = 0;
      let match;

      while ((match = WIKI.exec(node.value)) !== null) {
        const [whole, bang, target, anchor, alias] = match;

        if (match.index > cursor) {
          out.push({ type: 'text', value: node.value.slice(cursor, match.index) });
        }
        cursor = match.index + whole.length;

        const name = target.trim();

        // Вложение: отдаём Astro обычной разметкой, дальше он сам оптимизирует.
        if (bang === '!') {
          if (IMAGE_EXT.test(name)) {
            out.push({
              type: 'image',
              url: `${attachments}/${name}`,
              alt: alias?.trim() ?? '',
              title: null,
            });
          } else {
            out.push({ type: 'text', value: whole });
          }
          continue;
        }

        // Ссылка на страницу сайта.
        const known = links.get(name);
        if (!known) {
          broken.push(name);
          out.push({ type: 'text', value: alias?.trim() ?? name });
          continue;
        }

        out.push({
          type: 'link',
          url: known.url + (anchor ? anchor.toLowerCase().replace(/\s+/g, '-') : ''),
          title: null,
          children: [{ type: 'text', value: alias?.trim() ?? known.title }],
        });
      }

      if (cursor < node.value.length) {
        out.push({ type: 'text', value: node.value.slice(cursor) });
      }

      parent.children.splice(index, 1, ...out);
      return index + out.length;
    });

    if (broken.length) {
      const where = path.basename(source);
      console.warn(
        `[wiki-links] ${where}: ссылки ведут на заметки, которых нет на сайте — ` +
          `${[...new Set(broken)].join(', ')}. Отрисованы обычным текстом.`,
      );
    }
  };
}

export default remarkObsidian;
