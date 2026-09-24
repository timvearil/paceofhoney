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
 *   1. прибирает кадры, положенные прямо в папку репозитория, минуя архив;
 *   2. переносит с ужиманием ВСЁ, что лежит в архиве, пропуская повторы;
 *   3. переводит имена в латиницу — иначе адрес превращается в строку процентов;
 *   4. пишет карту соответствий, по ней сборка находит файл по исходному имени;
 *   5. сверяет упоминания в статьях и жалуется на кадр, которого нигде нет.
 *
 * ПОЧЕМУ ВСЮ ПАПКУ, А НЕ ТОЛЬКО УПОМЯНУТОЕ. Разбор упоминаний выглядел
 * бережливее, но давал осечку всякий раз, когда кадр добавляли к уже
 * написанному тексту: перенос идёт один раз, при старте, и новая картинка
 * до папки не доезжала. Выглядело так, будто ссылка верна, а иллюстрации нет.
 * Теперь граница проходит по папке, и она видна глазами.
 *
 * ДВА ЗАКОННЫХ ПУТИ. Основной — положить кадр в архив под любым именем, хоть
 * русским: скрипт переведёт имя и ужмёт. Короткий — сразу в `_attachments`
 * латиницей; тогда архив не нужен, но кадр всё равно надо прибрать, иначе
 * непричёсанный оригинал навсегда осядет в истории Git. Шаг 1 это и делает.
 *
 * Запускается сам перед `npm run dev` и `npm run build`, а в режиме разработки
 * ещё и следит за архивом — см. src/integrations/images.mjs. На сервере (CI)
 * выходит сразу: там лежат готовые копии, и трогать их нечем и незачем.
 *
 * Спецификация: 01_Spec/tz-paceofhoney-v2.md, раздел 4.6
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Архив исходников — отдельная папка внутри вложений vault.
 *
 * Именно подпапка, а не `99_Attachments` целиком. Переносится она целиком,
 * без разбора упоминаний, поэтому граница должна быть видна глазами: что
 * положено сюда — то едет на сайт. В корне вложений лежат аватары, скриншоты
 * и прочее рабочее; репозиторий публичный, и что туда попало — остаётся
 * в истории Git навсегда, даже если потом удалить.
 *
 * Путь можно перебить переменной окружения HONEY_ATTACHMENTS.
 */
const ARCHIVE =
  process.env.HONEY_ATTACHMENTS ?? path.resolve(ROOT, '../../99_Attachments/paceofhoney');

/** Куда кладём подготовленные копии. Общая папка для статей, серий и настроек. */
const TARGET = path.join(ROOT, 'src/content/_attachments');

/** Карта «исходное имя → файл в репозитории». Её читает сборка. */
const MAP_FILE = path.join(ROOT, 'src/content/_attachments-map.json');

const MAX_SIDE = 2560;
const QUALITY = 82;
const IMAGE_EXT = /\.(avif|gif|jpe?g|png|svg|webp)$/i;

/** Вес, выше которого кадр считается непричёсанным, даже если по пикселям мал. */
const HEAVY = 1024 * 1024;

/** Что уже прибрано: имя → вес после обработки. Чтобы не жать дважды. */
const TIDY_FILE = path.join(TARGET, '.tidy.json');

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

/**
 * Ужать кадр до предельной стороны и записать в нужном формате.
 *
 * Формат выбираем по расширению, а не ставим jpeg всему подряд. Иначе PNG
 * с прозрачностью приезжал бы в репозиторий как JPEG внутри файла `.png`:
 * прозрачность залита чёрным, а Astro определяет формат по расширению и
 * работает с ним как с PNG. Ошибка тихая — видна только на готовой странице
 * и только на тех кадрах, у которых есть что терять.
 */
async function squeeze(from, to) {
  const ext = path.extname(to).toLowerCase();

  if (ext === '.svg' || ext === '.gif') {
    // Вектор ужимать нечем, анимацию — незачем: sharp оставил бы один кадр.
    if (from !== to) await fs.copyFile(from, to);
    return;
  }

  const pipeline = sharp(from)
    .rotate() // учесть поворот из данных камеры, иначе кадр ляжет боком
    .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true });

  const out =
    ext === '.png' ? pipeline.png({ compressionLevel: 9 })
    : ext === '.webp' ? pipeline.webp({ quality: QUALITY })
    : ext === '.avif' ? pipeline.avif({ quality: QUALITY })
    : pipeline.jpeg({ quality: QUALITY, mozjpeg: true });

  /*
   * Пишем через временный файл и переименование.
   *
   * Переименование внутри одной папки — операция неделимая: сторонний
   * наблюдатель видит либо старый файл целиком, либо новый целиком, и никогда
   * промежуточное состояние. Прямая запись такой гарантии не даёт, и это уже
   * стоило одной поломки: сервер разработки пересобирал список изображений
   * ровно в тот момент, когда сюда писались перенесённые кадры, и собрал его
   * пустым. Снаружи это выглядело как «local images must be imported» на
   * совершенно постороннем файле.
   *
   * Заодно решается и то, что sharp не пишет в файл, который сам же читает.
   */
  const tmp = `${to}.tmp-${process.pid}`;
  try {
    await fs.writeFile(tmp, await out.toBuffer());
    await fs.rename(tmp, to);
  } catch (e) {
    await fs.rm(tmp, { force: true });
    throw e;
  }
}

/**
 * Прибрать кадры, положенные прямо в папку репозитория, минуя архив.
 *
 * Так можно: имя латиницей, кинул в `_attachments` — и всё работает. Но
 * тогда никто не ужал файл, а Git хранит каждую версию навсегда: один
 * восьмимегабайтный экспорт из редактора останется в истории, даже если
 * потом его заменить.
 *
 * Признак непричёсанного кадра — сторона больше предельной или вес больше
 * мегабайта. Что уже прибрано, помним в `.tidy.json`: иначе тяжёлый кадр,
 * не похудевший ниже порога, пережимался бы при каждом запуске, теряя
 * качество по кругу.
 */
async function tidyTarget() {
  let done = {};
  try {
    done = JSON.parse(await fs.readFile(TIDY_FILE, 'utf8'));
  } catch { /* первого запуска ещё не было */ }

  let files;
  try {
    files = await fs.readdir(TARGET);
  } catch {
    return;
  }

  let tidied = 0;
  for (const name of files) {
    if (!IMAGE_EXT.test(name) || name.startsWith('.')) continue;

    const file = path.join(TARGET, name);
    const { size } = await fs.stat(file);
    if (done[name] === size) continue; // это наш выход, трогать нечего

    const ext = path.extname(name).toLowerCase();
    if (ext === '.svg' || ext === '.gif') continue;

    const meta = await sharp(file).metadata().catch(() => null);
    if (!meta) continue;

    const oversized = Math.max(meta.width ?? 0, meta.height ?? 0) > MAX_SIDE;
    if (!oversized && size <= HEAVY) {
      done[name] = size; // уже лёгкий — запомним, чтобы не мерить снова
      continue;
    }

    await squeeze(file, file);
    const after = await fs.stat(file);
    done[name] = after.size;
    const kb = (n) => Math.round(n / 1024);
    console.log(`  прибрано на месте: ${name}  (${kb(size)} → ${kb(after.size)} КБ)`);
    tidied++;
  }

  await fs.writeFile(TIDY_FILE, JSON.stringify(done, null, 2) + '\n', 'utf8');
  if (tidied) console.log(`[картинки] прибрано в репозитории: ${tidied}`);
}

/**
 * Номер в имени статьи и номер её кадров — одно и то же число.
 *
 * Файлы статей названы «09 Космический городок.md», кадры к ним —
 * «9-lead-image.jpg», «9-1.jpg». Связь держится на договорённости, а не
 * на коде: адрес статьи берётся из `slug`, имя файла сайт нигде не
 * показывает. Ради этой договорённости всё и затевалось — найти статью
 * по номеру кадра и наоборот, не открывая файлы.
 *
 * Проверка живёт здесь, а не в `assertContentIsSound`: там у статьи `id`
 * равен её `slug`, и до имени файла не дотянуться. Здесь файлы видны
 * как есть.
 *
 * Это предупреждение, а не ошибка. Ронять сборку из-за имени файла,
 * которого нет на сайте, — чересчур.
 */
async function checkNumbering(files) {
  const off = [];

  for (const file of files) {
    const name = path.basename(file);
    const inName = name.match(/^(\d+)/)?.[1];
    if (!inName) continue;

    const text = await fs.readFile(file, 'utf8');
    const inImage = text.match(/^lead_image:.*?[/"']?(\d+)-lead-image/m)?.[1];
    if (inImage && Number(inName) !== Number(inImage)) {
      off.push(`  · ${name} — кадры названы по номеру ${inImage}`);
    }
  }

  if (off.length) {
    console.warn('[нумерация] имя файла и номер кадров разошлись:\n' + off.join('\n'));
  }
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
 * Имена картинок, упомянутых в тексте, и откуда именно.
 *
 * Различать источник обязательно, потому что правила у них разные.
 *
 * Форма `![[кадр.jpg]]` — обсидиановская, её разбирает наш плагин разметки.
 * Имя можно писать по-русски: плагин переведёт его в латиницу по карте
 * соответствий.
 *
 * Остальные две формы — обычная картинка `![](../_attachments/кадр.jpg)`
 * и метаданные (`lead_image`, `cover_image`, `bookend_*`) — содержат путь,
 * который Astro открывает буквально, никакой карты не читая. Значит имя там
 * должно быть уже латинским, тем самым, под которым файл лёг в репозиторий.
 * Русское имя обрушило бы сборку сообщением «файл не найден», и автор искал
 * бы причину сам.
 *
 * Возвращаем `Map: имя → 'wiki' | 'literal'`.
 */
function mentionedImages(text) {
  const found = new Map();

  for (const m of text.matchAll(/!\[\[([^\]|#]+)/g)) {
    const n = m[1].trim();
    if (IMAGE_EXT.test(n)) found.set(n, 'wiki');
  }
  // ![подпись](../_attachments/кадр.jpg) — обычная разметка Markdown.
  for (const m of text.matchAll(/!\[[^\]]*\]\(\s*<?([^)\s>]+)/g)) {
    const n = path.basename(m[1].trim());
    if (IMAGE_EXT.test(n)) found.set(n, 'literal');
  }
  for (const m of text.matchAll(/^\s*\w*(?:image|art|cover|bookend\w*):\s*["']?([^"'\n]+)/gim)) {
    const n = path.basename(m[1].trim());
    if (IMAGE_EXT.test(n)) found.set(n, 'literal');
  }
  return found;
}

/* ------------------------------------------------------------------------ */

async function main() {
  // На сервере ничего не переносим и не прибираем: там уже лежат готовые
  // копии, а лишняя обработка только пережала бы их ещё раз.
  if (process.env.CI) return;

  let hasArchive = true;
  try {
    await fs.access(ARCHIVE);
  } catch {
    hasArchive = false;
  }

  // Нумерация проверяется первой: она не зависит ни от архива кадров,
  // ни от переноса, а без архива скрипт дальше не идёт.
  await checkNumbering(await contentFiles());

  // Кадры могли положить прямо в папку репозитория, минуя архив. Это законный
  // путь, но тогда их никто не ужал — прибираем здесь, до всего остального.
  await tidyTarget();

  if (!hasArchive) {
    console.warn(
      `[картинки] папки с кадрами нет: ${ARCHIVE}\n` +
        '           Заведите её и складывайте туда иллюстрации для сайта.\n' +
        '           Всё, что в ней лежит, переносится и ужимается само.\n' +
        '           Если папка в другом месте, задайте HONEY_ATTACHMENTS.',
    );
    return;
  }

  /*
   * ПЕРЕНОСИМ ВСЮ ПАПКУ, а не только упомянутое.
   *
   * Раньше скрипт собирал имена из статей и тащил ровно их. Выглядело
   * бережливо, но давало осечку каждый раз, когда кадр добавляли к уже
   * написанному тексту: перенос идёт один раз, при старте `npm run dev`,
   * и новая картинка до папки не доезжала. Со стороны — «ссылка правильная,
   * а иллюстрации нет».
   *
   * Теперь граница проходит не по упоминаниям, а по папке: что в ней лежит,
   * то и едет. Решать, нужен ли кадр, — дело автора, а не разбора текста.
   */
  await fs.mkdir(TARGET, { recursive: true });

  const archive = (await fs.readdir(ARCHIVE)).filter(
    (f) => IMAGE_EXT.test(f) && !f.startsWith('.'),
  );

  const map = {};
  let copied = 0;

  for (const source of archive) {
    const flat = latinize(source);
    map[source] = flat;

    const from = path.join(ARCHIVE, source);
    const to = path.join(TARGET, flat);

    const src = await fs.stat(from);
    if (!src.isFile()) continue;

    // Повтор не переносим: копия на месте и с тех пор исходник не менялся.
    const dst = await fs.stat(to).catch(() => null);
    if (dst && dst.mtimeMs >= src.mtimeMs) continue;

    await squeeze(from, to);

    const after = await fs.stat(to);
    const kb = (n) => Math.round(n / 1024);
    console.log(`  ${source} → ${flat}  (${kb(src.size)} → ${kb(after.size)} КБ)`);
    copied++;
  }

  /*
   * Упоминания в статьях теперь нужны не для переноса, а для проверки.
   * Ссылка на кадр, которого нет ни в архиве, ни в репозитории, — опечатка
   * в имени, и сказать о ней надо своими словами, назвав статью.
   */
  const files = await contentFiles();
  const wanted = new Map(); // имя → { откуда, где встретилось }
  for (const file of files) {
    for (const [name, kind] of mentionedImages(await fs.readFile(file, 'utf8'))) {
      const seen = wanted.get(name) ?? { kind, where: new Set() };
      seen.where.add(path.basename(file));
      wanted.set(name, seen);
    }
  }

  const missing = [];
  for (const [name, { where }] of wanted) {
    const known =
      map[name] !== undefined ||
      Object.values(map).includes(latinize(name)) ||
      (await fs.stat(path.join(TARGET, latinize(name))).catch(() => null)) !== null;
    if (!known) missing.push(`«${name}» — упомянут в ${[...where].join(', ')}`);
  }

  await fs.writeFile(MAP_FILE, JSON.stringify(map, null, 2) + '\n', 'utf8');

  /*
   * Русское имя в пути Astro не откроет — там он берётся буквально. Ловим это
   * здесь и сразу показываем готовую строку замены: иначе сборка упадёт позже,
   * внутри Astro, сообщением «file not found» и без подсказки, что имя всего
   * лишь надо перевести в латиницу.
   */
  const toRename = [...wanted]
    .filter(([name, { kind }]) => kind === 'literal' && name !== latinize(name))
    .map(([name, { where }]) =>
      `           · в ${[...where].join(', ')}: ` +
      `"../_attachments/${name}" → "../_attachments/${latinize(name)}"`,
    );

  if (toRename.length) {
    // Имя из первой жалобы — чтобы подсказать на его же примере.
    const sample = toRename.length
      ? [...wanted].find(([n, { kind }]) => kind === 'literal' && n !== latinize(n))?.[0]
      : 'кадр.jpg';

    throw new Error(
      'кадр назван по-русски там, где путь берётся буквально,\n' +
        '           а в репозитории он лежит латиницей. Поправьте так:\n' +
        toRename.join('\n') +
        `\n\n           Либо, если это картинка в тексте, запишите её как ![[${sample}]]:\n` +
        '           в такой форме имя переводится само, и русское писать можно.',
    );
  }

  console.log(
    copied
      ? `[картинки] перенесено: ${copied}, всего в архиве ${archive.length}`
      : `[картинки] все ${archive.length} кадров уже на месте`,
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

/**
 * Тот же перенос, вызываемый из кода, а не из командной строки.
 *
 * Нужен интеграции, которая следит за архивом во время разработки: там
 * сорвавшийся перенос не должен ронять сервер, о нём достаточно сказать.
 */
export async function syncImages() {
  await main();
}

/** Где лежит архив — интеграции нужно знать, за чем следить. */
export const archivePath = ARCHIVE;

// Прямой запуск из npm-скрипта: ошибка останавливает сборку.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error('[картинки] сорвалось:', e.message);
    process.exit(1);
  });
}
