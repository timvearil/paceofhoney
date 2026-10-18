/**
 * Настоящие адреса кадров в машинных текстах — после сборки.
 *
 * `.md`-двойники и `llms-full` ставят на месте кадра метку `/_img/кадр.jpg`
 * (см. `src/lib/md-images.ts`). Здесь, когда страницы уже собраны, метка
 * заменяется адресом файла, который страница отдаёт читателю: WebP шириной
 * до 1280 px из её же `srcset`. Нового файла в сайте при этом не возникает —
 * ссылка ведёт ровно на то, что уже лежит на хостинге.
 *
 * Не нашёлся адрес — метка не остаётся висеть: сборка останавливается
 * и называет кадр, как она делает с кадром без описания.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

const SITE = 'https://paceofhoney.me';
const MARK = /\/_img\/([^)\s]+)/g;

async function walk(dir, exts) {
  const out = [];
  for (const item of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) out.push(...(await walk(full, exts)));
    else if (exts.some((e) => item.name.endsWith(e))) out.push(full);
  }
  return out;
}

/** «23-lead-image.DlrrJo5z.jpg?…» и «23-lead-image.jpg» → «23-lead-image». */
const base = (name) => name.split('?')[0].split('/').pop().split('.')[0];

export default function mdImageLinks() {
  return {
    name: 'honey:md-image-links',
    hooks: {
      'astro:build:done': async ({ dir, logger }) => {
        const root = dir.pathname.replace(/^\/([A-Za-z]:)/, '$1');

        // Все варианты WebP со страниц: имя исходника → { ширина → адрес }.
        const variants = new Map();
        for (const file of await walk(root, ['.html'])) {
          const html = await fs.readFile(file, 'utf8');
          for (const m of html.matchAll(/(\/_astro\/([^\s"',]+?\.webp))\s+(\d+)w/g)) {
            const key = base(m[2]);
            if (!variants.has(key)) variants.set(key, new Map());
            variants.get(key).set(Number(m[3]), m[1]);
          }
        }

        const pick = (name) => {
          const v = variants.get(base(name));
          if (!v) return null;
          const widths = [...v.keys()].sort((a, b) => a - b);
          const w = widths.filter((x) => x <= 1280).pop() ?? widths[0];
          return SITE + v.get(w);
        };

        const missing = new Set();
        let replaced = 0;
        for (const file of await walk(root, ['.md', '.txt'])) {
          const text = await fs.readFile(file, 'utf8');
          if (!text.includes('/_img/')) continue;
          const next = text.replace(MARK, (whole, name) => {
            const url = pick(name);
            if (!url) { missing.add(name); return whole; }
            replaced++;
            return url;
          });
          if (next !== text) await fs.writeFile(file, next);
        }

        if (missing.size) {
          throw new Error(
            'Кадр в .md / llms-full без адреса — его нет ни на одной странице: ' + [...missing].join(', '),
          );
        }
        logger.info(`адреса кадров в машинных текстах: ${replaced}`);
      },
    },
  };
}
