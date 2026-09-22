/**
 * Перенос иллюстраций из архива vault в репозиторий.
 *
 * ЗАЧЕМ. Исходники лежат в `99_Attachments` в корне vault — то есть снаружи
 * папки проекта. Git отслеживает только то, что внутри его корня, поэтому на
 * GitHub такие файлы не уедут, и сборка в облаке не найдёт ни одной картинки.
 * Копии в репозитории нужны обязательно.
 *
 * ПОЧЕМУ С УЖИМАНИЕМ. Git хранит каждую версию файла навсегда: заменил кадр —
 * в истории осталось оба, удалил — всё равно остался. Отмотать это можно
 * только переписав всю историю. Девятнадцать статей с несжатыми фотографиями
 * дали бы полгигабайта, из которых читателю уходит от силы десятая часть:
 * самый крупный размер, который мы отдаём, — 2400 пикселей.
 * Поэтому на входе в репозиторий кадр ужимается до 2560 — с запасом.
 *
 * ЧТО ДЕЛАЕТ:
 *   1. собирает имена картинок, упомянутых в статьях и настройках;
 *   2. находит их в архиве;
 *   3. переводит имя в латиницу — иначе адрес превращается в строку процентов;
 *   4. копирует с ужиманием, пропуская уже перенесённое;
 *   5. пишет карту соответствий, по ней сборка находит файл по исходному имени.
 *
 * Запускается сам перед `npm run dev` и `npm run build`. Если архива рядом нет
 * (сборка на сервере), молча выходит: там работают уже перенесённые копии.
 *
 * Спецификация: 01_Spec/tz-paceofhoney-v2.md, раздел 4.6
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Архив исходников. Путь можно перебить переменной окружения. */
const ARCHIVE = process.env.HONEY_ATTACHMENTS ?? path.resolve(ROOT, '../../99_Attachments');

/** Куда кладём подготовленные копии. Общая папка для статей, серий и настроек. */
const TARGET = path.join(ROOT, 'src/content/_attachments');

/** Карта «исходное имя → файл в репозитории». Её читает сборка. */
const MAP_FILE = path.join(ROOT, 'src/content/_attachments-map.json');

const MAX_SIDE = 2560;
const QUALITY = 82;
const IMAGE_EXT = /\.(avif|gif|jpe?g|png|svg|webp)$/i;

/* ------------------------------------------------------------------------ */

const CYR = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

function latinize(name) {
  const ext = path.extname(name).toLowerCase();
  const base = path
    .basename(name, path.extname(name))
    .toLowerCase()
    .split('')
    .map((ch) => CYR[ch] ?? ch)
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return (base || 'image') + ext;
}

/** Все файлы контента, где могут встретиться ссылки на картинки. */
async function contentFiles() {
  const dirs = ['posts', 'pages', 'series', 'settings'].map((d) =>
    path.join(ROOT, 'src/content', d),
  );
  const out = [];
  for (const dir of dirs) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.isFile() && e.name.endsWith('.md')) out.push(path.join(dir, e.name));
    }
  }
  return out;
}

/**
 * Имена картинок, упомянутых в тексте.
 *
 * Ловим и обсидиановское ![[кадр.jpg]], и обычное указание имени файла
 * в метаданных: lead_image, cover_image, bookend_light и подобные.
 */
function mentionedImages(text) {
  const names = new Set();

  for (const m of text.matchAll(/!\[\[([^\]|#]+)/g)) {
    const n = m[1].trim();
    if (IMAGE_EXT.test(n)) names.add(n);
  }
  for (const m of text.matchAll(/^\s*\w*(?:image|art|cover|bookend\w*):\s*["']?([^"'\n]+)/gim)) {
    const n = path.basename(m[1].trim());
    if (IMAGE_EXT.test(n)) names.add(n);
  }
  return names;
}

/* ------------------------------------------------------------------------ */

async function main() {
  try {
    await fs.access(ARCHIVE);
  } catch {
    // На сервере архива нет по замыслу: там работают перенесённые копии.
    // А на машине автора это опечатка в пути, и молчать о ней нельзя.
    if (!process.env.CI) {
      console.warn(
        `[картинки] архив не найден: ${ARCHIVE}\n` +
          '           Если он лежит в другом месте, задайте HONEY_ATTACHMENTS.',
      );
    }
    return;
  }

  // Помним не только имя кадра, но и где он упомянут: если файла не окажется,
  // сообщение должно называть статью, а не оставлять искать её руками.
  const wanted = new Map(); // имя → набор файлов, где встретилось
  for (const file of await contentFiles()) {
    for (const name of mentionedImages(await fs.readFile(file, 'utf8'))) {
      wanted.set(name, (wanted.get(name) ?? new Set()).add(path.basename(file)));
    }
  }
  if (wanted.size === 0) {
    console.log('[картинки] в статьях пока нет ссылок на иллюстрации');
    return;
  }

  await fs.mkdir(TARGET, { recursive: true });

  const archive = await fs.readdir(ARCHIVE);
  const map = {};
  let copied = 0;
  const missing = [];

  for (const [name, mentionedIn] of wanted) {
    // Сопоставление без учёта регистра: в тексте и в архиве имя может
    // отличаться заглавной буквой, и это не повод считать кадр потерянным.
    const source = archive.find((f) => f.toLowerCase() === name.toLowerCase());
    if (!source) {
      // Кадр мог быть перенесён раньше, а из архива потом убран — это не потеря.
      const already = await fs.stat(path.join(TARGET, name)).catch(() => null);
      if (!already) missing.push(`«${name}» — упомянут в ${[...mentionedIn].join(', ')}`);
      continue;
    }

    const flat = latinize(source);
    map[name] = flat;

    const from = path.join(ARCHIVE, source);
    const to = path.join(TARGET, flat);

    const src = await fs.stat(from);
    const dst = await fs.stat(to).catch(() => null);
    if (dst && dst.mtimeMs >= src.mtimeMs) continue; // уже перенесён и не менялся

    if (path.extname(flat) === '.svg') {
      await fs.copyFile(from, to); // вектор ужимать нечем и незачем
    } else {
      await sharp(from)
        .rotate() // учесть поворот из данных камеры, иначе кадр ляжет боком
        .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: QUALITY, mozjpeg: true })
        .toFile(to);
    }

    const after = await fs.stat(to);
    const kb = (n) => Math.round(n / 1024);
    console.log(`  ${source} → ${flat}  (${kb(src.size)} → ${kb(after.size)} КБ)`);
    copied++;
  }

  await fs.writeFile(MAP_FILE, JSON.stringify(map, null, 2) + '\n', 'utf8');

  console.log(
    copied
      ? `[картинки] перенесено: ${copied} из ${wanted.size}`
      : `[картинки] все ${wanted.size} кадров уже на месте`,
  );

  // Ненайденный кадр — не мелочь: автор рассчитывал его показать.
  // Останавливаемся здесь, своими словами и с указанием статьи. Иначе сборка
  // всё равно упадёт, но уже внутри Astro и без намёка, где искать.
  if (missing.length) {
    throw new Error(
      `не найдены в ${path.basename(ARCHIVE)}:\n` +
        missing.map((m) => `           · ${m}`).join('\n') +
        '\n\n           Положите файлы в архив или уберите ссылки из текста.',
    );
  }
}

main().catch((e) => {
  console.error('[картинки] сорвалось:', e.message);
  process.exit(1);
});
