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
import exifReader from 'exif-reader';

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

/**
 * Паспорт кадров — данные камеры, снятые с оригиналов.
 *
 * ЗАЧЕМ. Метаданные съёмки до сайта не доезжают ни в одном поле: их срезает
 * пересжатие здесь, а остатки — нарезка srcset в Astro. Замерено 01.10:
 * ноль полей и в копиях, и в том, что отдаётся читателю. Чинить это не надо,
 * и дело не только в весе: в метаданных лежат координаты дома и пасеки,
 * а репозиторий публичный.
 *
 * Но выбрасывать их молча — терять единственный след того, что кадр снят
 * камерой в такой-то день. Доказательством авторства перед сторонним судьёй
 * он не служит (дописывается любым редактором за две минуты), зато служит
 * памятью для нас: когда снято, чем снято, в какой серии кадров стояло.
 * Поэтому данные снимаются при переносе и уходят в кухню проекта, а не на сайт.
 *
 * КООРДИНАТЫ НЕ ПИШЕМ НИКОГДА. Ни в какой форме, ни округлённо: файл лежит
 * в репозитории кухни, а всё, что попало в историю Git, остаётся в ней
 * навсегда. Приватность репозитория — не повод: приватное однажды
 * открывают, пересылают, копируют.
 *
 * ГДЕ ЛЕЖИТ. В справочнике кухни — соседней папке `paceofhoney-docs`,
 * таблицей Markdown, а не служебным JSON: этот файл читают глазами
 * в Obsidian, и единственный его смысл — чтобы однажды можно было открыть
 * и посмотреть. Путь можно перебить переменной окружения HONEY_PHOTOS.
 *
 * ПОЧЕМУ НЕ ВНУТРИ САЙТА. До 05.10.2026 паспорт лежал в `00_Reference`
 * этой папки и прятался от публичного репозитория строкой в .gitignore.
 * Кухня переехала, строку сняли, а скрипт продолжал писать по старому
 * адресу — и сам создавал для этого папку. Копия паспорта лежала
 * в публичном репозитории в одном автокоммите от публикации.
 */
const PHOTOS_FILE =
  process.env.HONEY_PHOTOS ??
  path.resolve(ROOT, '../paceofhoney-docs/00_Reference/pasport-kadrov.md');

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
 * Записать карту «исходное имя → файл в репозитории», но не вслепую.
 *
 * ЗАЧЕМ ПРОВЕРКА. Карта описывает всю папку-архив целиком и перезаписывается
 * на каждом прогоне. Пока папка на месте, это правильно: что в ней лежит —
 * то и едет. Но папка приезжает на эту машину синхронизацией, и бывает
 * видна наполовину — ещё не докачана, подключена не целиком, подменена
 * переменной окружения при отладке. Тогда прогон честно опишет то, что
 * увидел, затрёт прежнюю карту, и ссылки на остальные кадры посыплются
 * все сразу.
 *
 * Найдено 01.10 на себе: отладочный прогон с подменённой папкой схлопнул
 * карту с сорока пяти записей до одной. Чинится командой `git checkout`
 * в одну строку — если заметить. Незамеченным это уехало бы в репозиторий
 * вместе со следующим коммитом.
 *
 * Порог — половина. Не «любое уменьшение»: убрать один-два кадра из архива
 * законно и случается. А вот исчезновение половины архива сразу — это
 * не решение автора, это недокачанная папка.
 */
async function saveMap(map, seen) {
  const before = await fs
    .readFile(MAP_FILE, 'utf8')
    .then((t) => Object.keys(JSON.parse(t)).length)
    .catch(() => 0);

  const now = Object.keys(map).length;

  if (before && now < before / 2) {
    throw new Error(
      `архив виден не полностью — карта кадров не перезаписана.\n` +
        `           Было в карте: ${before}, сейчас видно в папке: ${seen}.\n\n` +
        `           Папка: ${ARCHIVE}\n` +
        '           Похоже, она ещё не докачана синхронизацией либо подключена\n' +
        '           не целиком. Дождитесь синхронизации и повторите.\n\n' +
        '           Если кадры убраны намеренно — удалите файл карты\n' +
        '           src/content/_attachments-map.json и запустите снова:\n' +
        '           он соберётся заново по тому, что есть.',
    );
  }

  await fs.writeFile(MAP_FILE, JSON.stringify(map, null, 2) + '\n', 'utf8');
}

/**
 * Снять с оригинала данные съёмки — до того, как их срежет пересжатие.
 *
 * Берём ровно шесть полей: когда, чем, на какой выдержке, диафрагме и ISO.
 * Всё остальное, что пишет камера, — сотни технических тегов, которые
 * ничего не рассказывают и только раздувают таблицу.
 *
 * Геоданные (`gps`) не читаются вовсе: не «читаются и отбрасываются»,
 * а просто не берутся из разбора. Так меньше шансов, что однажды они
 * просочатся в файл через чью-то невнимательную правку — включая мою.
 *
 * Ошибки глотаются молча и намеренно: у кадра из мессенджера или
 * отрисованного моделью метаданных нет и быть не должно, это не поломка.
 */
/*
 * Название камеры из двух полей, которые камеры заполняют как попало.
 *
 * Nikon пишет производителем «NIKON CORPORATION», а моделью «NIKON 1 J5» —
 * склейка давала «NIKON CORPORATION NIKON 1 J5». Pixel у одних кадров
 * указывает производителя, у других нет: «Google Pixel 8a» и «Pixel 8a»
 * в одной таблице. Поэтому сравниваем по первому слову производителя:
 * если модель с него начинается, производителя не приписываем.
 */
/*
 * Строковое поле EXIF без мусора.
 *
 * Камеры добивают текст до фиксированной длины нулевыми байтами: Nikon
 * пишет объектив «1 NIKKOR VR 10-100mm f/4-5.6» и следом десятки `\0`.
 * Попав в паспорт кадров, нули делали его для Git двоичным файлом —
 * изменения таблицы переставали показываться построчно (найдено 07.10.2026).
 */
const tag = (v) => (typeof v === 'string' ? v.replace(/\0/g, '').trim() : '');

function camera(make, model) {
  const a = tag(make);
  const b = tag(model);
  if (!b) return a || undefined;
  if (!a) return b;

  const brand = a.split(/\s+/)[0].toLowerCase();
  return b.toLowerCase().startsWith(brand) ? b : `${a} ${b}`;
}

async function shotData(file) {
  try {
    const { exif } = await sharp(file).metadata();
    if (!exif) return null;

    const { Photo = {}, Image = {} } = exifReader(exif);
    const date = Photo.DateTimeOriginal ?? Image.DateTime;

    const data = {
      date: date instanceof Date ? date.toISOString().slice(0, 10) : undefined,
      // Производителя приписываем только если модель его не содержит:
      // половина камер пишет «Canon» в оба поля, и склейка даёт
      // «Canon Canon EOS R6».
      camera: camera(Image.Make, Image.Model),
      lens: tag(Photo.LensModel) || undefined,
      shutter:
        typeof Photo.ExposureTime === 'number'
          ? Photo.ExposureTime >= 1
            ? `${Photo.ExposureTime} с`
            : `1/${Math.round(1 / Photo.ExposureTime)}`
          : undefined,
      aperture: typeof Photo.FNumber === 'number' ? `f/${Photo.FNumber}` : undefined,
      iso: Array.isArray(Photo.ISOSpeedRatings)
        ? Photo.ISOSpeedRatings[0]
        : Photo.ISOSpeedRatings || undefined,
    };

    return Object.values(data).some(Boolean) ? data : null;
  } catch {
    return null;
  }
}

/**
 * Записать паспорт кадров — таблицей, поверх прежней.
 *
 * Поверх, а не дописывая: таблица и есть текущее состояние архива, а история
 * правок у нас хранится в Git и хранится лучше, чем в накопительном файле.
 */
async function photoRegistry(rows) {
  if (!rows.length) return;

  rows.sort((a, b) => a.file.localeCompare(b.file, 'ru'));
  const withData = rows.filter((r) => r.data);

  const cell = (v) => (v ?? '—');
  const table = [
    '| Кадр | Снято | Камера | Объектив | Выдержка | Диафрагма | ISO |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...rows.map((r) =>
      `| ${r.file} | ${cell(r.data?.date)} | ${cell(r.data?.camera)} | ` +
      `${cell(r.data?.lens)} | ${cell(r.data?.shutter)} | ` +
      `${cell(r.data?.aperture)} | ${cell(r.data?.iso)} |`,
    ),
  ].join('\n');

  const text = `---
tags: ["paceofhoney", "справочник"]
---

# Паспорт кадров

Собирается скриптом \`sync-images.mjs\` при переносе кадров из архива.
Руками не правится: следующий перенос перезапишет файл целиком.

Это снимок данных камеры с **оригиналов** в \`99_Attachments/paceofhoney\`.
На сайт ни одно из этих полей не уезжает — их срезает пересжатие, и это
правильно: вместе с выдержкой камера пишет координаты, а репозиторий
публичный. Координаты здесь не записываются ни в каком виде.

Прочерк означает, что данных в файле нет. Так бывает у кадров, прошедших
через мессенджер или редактор, и у всего, что дорисовано моделью, — это
не поломка, а сведения о том, какой путь кадр прошёл до нас.

Кадров в архиве: **${rows.length}**, из них с данными съёмки: **${withData.length}**.

${table}
`;

  /*
   * Папку не создаём. Нет кухни рядом — значит, это чужая машина или облако,
   * и паспорту там не место: созданная «на всякий случай» папка становится
   * бесхозной полукухней, а внутри сайта — утечкой в публичный репозиторий.
   * Сборку из-за паспорта не останавливаем: сайту он не нужен.
   */
  const dir = path.dirname(PHOTOS_FILE);
  if (!(await fs.stat(dir).catch(() => null))?.isDirectory()) {
    console.log(
      `[картинки] паспорт кадров пропущен: нет папки ${dir}\n` +
        '           Кухня проекта должна лежать рядом с сайтом,\n' +
        '           либо путь задаётся переменной HONEY_PHOTOS.',
    );
    return;
  }

  await fs.writeFile(PHOTOS_FILE, text, 'utf8');
  console.log(
    `[картинки] паспорт кадров: ${withData.length} из ${rows.length} с данными съёмки`,
  );
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

/* =========================================================================
   Обложки журналов, нарезанные по месту показа

   ЗАЧЕМ. Обложка показывается в двух формах: карточкой на витрине (4:3)
   и полосой в шапке журнала (21:9). Обрезку до сих пор делал браузер —
   `object-fit: cover` плюс `object-position` из `cover_position`. Выглядит
   правильно, но означает, что телефон скачивает кадр целиком и показывает
   из него четверть.

   PageSpeed 28.09 поймал это на «Ироничной пасеке»: 166 КБ в карточке
   размером с ладонь. У «Философии жизни» шапка тянула 932 КБ — и она
   грузится `eager`, то есть прямо в LCP. Понижение качества тут не лечит:
   даже на 50 оставалось 220 КБ, потому что дело не в сжатии, а в том, что
   высота кадра втрое больше показанной.

   КАК. Режем заранее, здесь, рядом с остальной подготовкой кадров: два
   производных файла на обложку, точно в тех пропорциях, в которых её
   покажут, и с тем же смещением, что задано в `cover_position`. Браузеру
   остаётся показать готовое — `object-position` производным уже не нужен.

   Проценты в `cover_position` считаются ровно так же, как их понимает CSS:
   0% — окно прижато к верху кадра, 100% — к низу. Иначе подобранное глазом
   значение поехало бы, и обрезка «оптимизации ради» испортила бы кадры.

   Производные лежат отдельной папкой и коммитятся: на сервере этот скрипт
   не работает (см. `CI` в `main`), там всё должно быть готовым. Если файла
   почему-то нет, компоненты берут оригинал — сайт не ломается, просто
   кадр снова тяжёлый.
   ========================================================================= */

/** Куда складываем нарезанное. Рядом с кадрами, но отдельной папкой. */
const COVERS = path.join(ROOT, 'src/content/_covers');

/** Что уже нарезано и из чего — чтобы не пережимать на каждом запуске. */
const COVERS_FILE = path.join(COVERS, '.covers.json');

/** Формы показа: имя производной и её пропорции. */
const COVER_SHAPES = [
  { suffix: 'card', ratio: 4 / 3 },
  { suffix: 'wide', ratio: 21 / 9 },
];

/**
 * Смещение окна из `cover_position` — доли от 0 до 1 по обеим осям.
 *
 * Пишется так же, как в CSS, и читается так же: сначала по горизонтали,
 * потом по вертикали. `center 30%` → по ширине центр, по высоте 0.3;
 * `30% 30%` → по обеим осям 0.3. Слова `left`, `center`, `right`, `top`
 * и `bottom` тоже понимаем — автор вправе написать их, раз это CSS.
 *
 * Вторая ось нужна не для красоты: у «Пчелиного файрволла» стоит `30% 30%`,
 * и обрезка только по высоте увела бы кадр вбок — ровно та ошибка, ради
 * которой эти проценты когда-то и подбирались глазами.
 */
function coverOffset(value) {
  const WORDS = { left: 0, top: 0, center: 0.5, centre: 0.5, right: 1, bottom: 1 };
  const parts = String(value ?? '').trim().split(/\s+/).filter(Boolean);

  const one = (token, fallback) => {
    if (token === undefined) return fallback;
    if (token in WORDS) return WORDS[token];
    const m = /^(\d+(?:\.\d+)?)\s*%$/.exec(token);
    return m ? Math.min(100, Math.max(0, Number(m[1]))) / 100 : fallback;
  };

  // Одно значение в CSS задаёт горизонталь, вертикаль остаётся посередине.
  return { x: one(parts[0], 0.5), y: one(parts[1], 0.5) };
}

/** Имя производной: `live-filosofy.jpg` + `wide` → `live-filosofy--wide.jpg`. */
function coverName(file, suffix) {
  const ext = path.extname(file);
  return `${path.basename(file, ext)}--${suffix}${ext}`;
}

/**
 * Нарезать обложки журналов под обе формы показа.
 *
 * Пропускаем кадр, который и так почти нужной формы: если высота выше
 * требуемой меньше чем на десятую часть, обрезка сэкономит единицы процентов,
 * а лишний файл в репозитории останется навсегда.
 */
async function cropCovers(files) {
  let done = {};
  try {
    done = JSON.parse(await fs.readFile(COVERS_FILE, 'utf8'));
  } catch { /* первого запуска ещё не было */ }

  await fs.mkdir(COVERS, { recursive: true });

  let made = 0;
  const fresh = {};
  const sheet = [];   // что показать на контрольном листе
  const blind = [];   // обложки, у которых процент не задан

  for (const file of files.filter((f) => f.includes(`${path.sep}series${path.sep}`))) {
    const text = await fs.readFile(file, 'utf8');
    const cover = /^cover_image:\s*["']?(.+?)["']?\s*$/m.exec(text);
    if (!cover) continue;

    const source = path.join(TARGET, path.basename(cover[1]));
    let meta;
    try {
      meta = await sharp(source).metadata();
    } catch {
      continue; // кадра ещё нет — о нём скажет общая проверка ниже
    }

    const told = /^cover_position:\s*["']?(.+?)["']?\s*$/m.exec(text)?.[1];
    const position = told ?? 'center 50%';
    const offset = coverOffset(position);
    const stat = await fs.stat(source);
    const stamp = `${stat.size}:${Math.round(stat.mtimeMs)}:${position}`;

    const title = /^title:\s*["']?(.+?)["']?\s*$/m.exec(text)?.[1] ?? path.basename(file, '.md');
    if (!told) blind.push(title);
    sheet.push({ title, position: told ?? 'по умолчанию, центр', file: cover[1], source });

    for (const { suffix, ratio } of COVER_SHAPES) {
      // Исходник ужимаем по длинной стороне, дальше считаем от этого размера.
      const scale = Math.min(1, MAX_SIDE / Math.max(meta.width, meta.height));
      const fullWidth = Math.round(meta.width * scale);
      const fullHeight = Math.round(meta.height * scale);

      /*
       * Наибольший прямоугольник нужной формы внутри кадра.
       *
       * Лишней бывает любая сторона. У вертикального снимка лишняя высота,
       * у горизонтального под карточку 4:3 — ширина. Обе режем по своему
       * проценту из `cover_position`, ровно как это сделал бы браузер.
       */
      const wide = fullWidth / fullHeight > ratio;
      const width = wide ? Math.round(fullHeight * ratio) : fullWidth;
      const height = wide ? fullHeight : Math.round(fullWidth / ratio);

      // Обрезать меньше десятой части — не стоит лишнего файла в репозитории.
      const gain = 1 - (width * height) / (fullWidth * fullHeight);
      if (gain < 0.1) continue;

      const out = path.join(COVERS, coverName(cover[1], suffix));
      fresh[path.basename(out)] = stamp;

      if (done[path.basename(out)] === stamp) {
        try {
          await fs.access(out);
          continue; // уже нарезано из этого же исходника
        } catch { /* файл потеряли — нарежем заново */ }
      }

      const left = Math.round((fullWidth - width) * offset.x);
      const top = Math.round((fullHeight - height) * offset.y);
      const buffer = await sharp(source)
        .rotate()
        .resize({ width: fullWidth, height: fullHeight })
        .extract({ left, top, width, height })
        .jpeg({ quality: QUALITY, mozjpeg: true })
        .toBuffer();

      const tmp = `${out}.tmp-${process.pid}`;
      try {
        await fs.writeFile(tmp, buffer);
        await fs.rename(tmp, out);
      } catch (e) {
        await fs.rm(tmp, { force: true });
        throw e;
      }
      made += 1;
    }
  }

  // Производные обложек, которым больше нечего соответствовать, убираем:
  // сменилась обложка журнала — старая нарезка осталась бы в репозитории.
  for (const name of await fs.readdir(COVERS).catch(() => [])) {
    if (name.startsWith('.') || fresh[name]) continue;
    await fs.rm(path.join(COVERS, name), { force: true });
  }

  await fs.writeFile(COVERS_FILE, JSON.stringify(fresh, null, 2) + '\n', 'utf8');
  if (made) console.log(`[картинки] обложек нарезано: ${made}`);

  await coverSheet(sheet);

  /*
   * Обложка без `cover_position` режется вслепую — по центру.
   *
   * Сборку из-за этого не останавливаем: бывает, что кадр положили на пробу
   * и центр устраивает. Но сказать надо, потому что молча срезанная макушка
   * обнаруживается месяцем позже и только если посмотреть на витрину.
   */
  if (blind.length) {
    console.warn(
      `[картинки] режется по центру, процент не задан: ${blind.join(', ')}\n` +
        '           Посмотрите контрольный лист и, если кадр просится выше\n' +
        '           или ниже, добавьте в файл журнала cover_position: center NN%',
    );
  }
}

/**
 * Контрольный лист: что увидит читатель.
 *
 * Обрезку задаёт один процент, а показывается она в двух формах сразу —
 * держать обе в голове тяжело, а смотреть их на сайте значит обойти шесть
 * страниц витрины и шесть шапок. Здесь всё сведено на одну картинку:
 * строка на журнал, слева карточка, справа полоса, рядом название и процент.
 *
 * Важное правило, которое лист делает наглядным: **полоса 21:9 всегда лежит
 * внутри карточки 4:3** при одном и том же проценте — это следует из того,
 * что окна отсчитываются от одной доли. Значит проверять достаточно полосу:
 * что попало в неё, попадёт и в карточку.
 */
async function coverSheet(items) {
  if (!items.length) return;

  const W = 900;          // ширина листа
  const CARD = 380;       // ширина карточки на листе
  const GAP = 12;
  const cardH = Math.round((CARD * 3) / 4);
  const wideH = Math.round((CARD * 9) / 21);
  const rowH = cardH + 34;

  const rows = [];
  for (const it of items) {
    const parts = [];
    for (const { suffix, ratio } of COVER_SHAPES) {
      const cut = path.join(COVERS, coverName(it.file, suffix));
      const from = await fs.access(cut).then(() => cut, () => it.source);
      parts.push(
        await sharp(from)
          .resize({
            width: CARD,
            height: suffix === 'card' ? cardH : wideH,
            fit: 'cover',
            position: 'centre',
          })
          .toBuffer(),
      );
    }
    rows.push({ ...it, parts });
  }

  const H = rows.length * rowH + GAP;
  const label = (text, y) =>
    Buffer.from(
      `<svg width="${W}" height="26"><text x="0" y="18" font-family="sans-serif" ` +
        `font-size="15" fill="#111">${text.replace(/[<&]/g, '')}</text></svg>`,
    );

  const layers = [];
  rows.forEach((r, i) => {
    const y = i * rowH + GAP;
    layers.push({ input: r.parts[0], left: 0, top: y });
    layers.push({ input: r.parts[1], left: CARD + GAP, top: y + cardH - wideH });
    layers.push({ input: label(`${r.title} — ${r.position}`), left: 0, top: y + cardH + 4 });
  });

  const out = path.join(COVERS, '_kontrolnyy-list.jpg');
  await sharp({ create: { width: W, height: H, channels: 3, background: '#fff' } })
    .composite(layers)
    .jpeg({ quality: 86 })
    .toFile(out);

  console.log(`[картинки] контрольный лист обложек: ${path.relative(ROOT, out)}`);
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

  // Обложки журналов режем под их формы показа — после того, как кадры
  // прибраны, чтобы резать уже ужатый исходник, а не восьмимегабайтный.
  await cropCovers(await contentFiles());

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
  const shots = [];
  let copied = 0;

  for (const source of archive) {
    const flat = latinize(source);
    map[source] = flat;

    const from = path.join(ARCHIVE, source);
    const to = path.join(TARGET, flat);

    const src = await fs.stat(from);
    if (!src.isFile()) continue;

    /*
     * Данные съёмки читаем у каждого кадра на каждом проходе, а не только
     * у новых. Разбор метаданных — чтение первых килобайт файла, дешевле
     * любой другой операции в этом скрипте; зато таблица всегда описывает
     * весь архив, а не то, что переносилось в последний раз.
     */
    shots.push({ file: flat, data: await shotData(from) });

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

  // Карта пишется раньше паспорта кадров намеренно: если архив виден
  // не полностью, прогон остановится здесь — и неполный паспорт не затрёт
  // полный. Оба файла описывают весь архив, и схлопнуться им нельзя обоим.
  await saveMap(map, archive.length);
  await photoRegistry(shots);

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
