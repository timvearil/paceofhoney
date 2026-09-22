/**
 * Подготовка графического цоколя подвала.
 *
 * Разовая операция: из одной фотографии получаются два кадра — под светлую
 * и под тёмную тему. Монохром и приглушённость зашиваются в сами файлы,
 * а не наводятся фильтром в браузере: так точнее по тону и не создаётся
 * лишний слой отрисовки внизу каждой страницы (ТЗ 4.5.2).
 *
 * Запуск:  npm run bookend
 *
 * Настройки через переменные окружения:
 *   HONEY_BENCH        имя файла в архиве
 *   HONEY_BENCH_FOCUS  где резать полосу по высоте, 0 — верх, 1 — низ
 *   HONEY_BENCH_RATIO  пропорции полосы, по умолчанию 3.7 к 1
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARCHIVE = process.env.HONEY_ATTACHMENTS ?? path.resolve(ROOT, '../../99_Attachments');
const TARGET = path.join(ROOT, 'src/content/_attachments');

const SOURCE = process.env.HONEY_BENCH ?? 'Со скоростью мёда.jpg';

/**
 * Значения выверены по кадру «Со скоростью мёда.jpg» (3024×3213).
 *
 * Скамейка занимает 71–88% высоты кадра. Полоса берётся так, чтобы она попала
 * целиком и под ней осталась трава: 65–93%. Сверху в кадр заходит край луга —
 * он растворяется маской в подвале и служит переходом к странице.
 *
 * Река и дальний берег остаются выше полосы намеренно: они всё равно попали бы
 * в зону растворения и проявились бы лишь призраком, зато полоса стала бы
 * вдвое выше и подвал перевесил бы страницу.
 */
const FOCUS = Number(process.env.HONEY_BENCH_FOCUS ?? 0.79);
const RATIO = Number(process.env.HONEY_BENCH_RATIO ?? 3.4);
const WIDTH = 2400;

/**
 * Тональные вилки.
 *
 * Светлая тема: светлые места кадра подтягиваются к цвету страницы, тёмные
 * остаются различимыми — рисунок читается, но не спорит с текстом.
 * Тёмная: то же самое, только отсчёт от графита.
 *
 * Полярность сохраняется: небо светлее земли в обоих случаях.
 */
const TONE = {
  light: { from: 140, to: 250 },
  dark: { from: 18, to: 95 },
};

const linear = ({ from, to }) => [(to - from) / 255, from];

async function main() {
  const file = path.join(ARCHIVE, SOURCE);
  try {
    await fs.access(file);
  } catch {
    console.error(`[цоколь] не нашёл ${SOURCE} в ${ARCHIVE}`);
    process.exit(1);
  }

  await fs.mkdir(TARGET, { recursive: true });

  const meta = await sharp(file).metadata();
  console.log(`[цоколь] исходник ${meta.width}×${meta.height}`);

  // Полоса нужной пропорции, вырезанная на заданной высоте кадра.
  const bandH = Math.round(meta.width / RATIO);
  const top = Math.max(0, Math.min(meta.height - bandH, Math.round(meta.height * FOCUS - bandH / 2)));

  // Два прохода намеренно.
  //
  // sharp выполняет операции в своём внутреннем порядке, а не в том, в каком
  // они записаны: normalise применяется ПОСЛЕ linear и растягивает диапазон
  // обратно на весь размах, сводя на нет всю тональную вилку. Поэтому сначала
  // растягиваем и забираем результат в память, и только потом укладываем
  // его в нужный диапазон.
  const base = await sharp(file)
    .rotate()
    .extract({ left: 0, top, width: meta.width, height: Math.min(bandH, meta.height) })
    .resize({ width: WIDTH, withoutEnlargement: true })
    .grayscale()
    .normalise()
    .toBuffer();

  for (const [theme, tone] of Object.entries(TONE)) {
    const out = path.join(TARGET, `bench-${theme}.jpg`);
    await sharp(base)
      .linear(...linear(tone))
      .jpeg({ quality: 86, mozjpeg: true })
      .toFile(out);

    // Показываем средний тон: он говорит о том, куда легла основная масса
    // кадра. Крайние значения смотреть бесполезно — сжатие JPEG выносит
    // отдельные пиксели за границы вилки на десяток единиц, и это нормально.
    const { mean } = (await sharp(out).stats()).channels[0];
    const target = Math.round((tone.from + tone.to) / 2);
    const { size } = await fs.stat(out);
    console.log(
      `  bench-${theme}.jpg  ${Math.round(size / 1024)} КБ  ` +
        `средний тон ${Math.round(mean)} (вилка ${tone.from}…${tone.to}, середина ${target})`,
    );
  }

  // Уменьшенная копия целого кадра — чтобы было по чему судить о кадрировании.
  const preview = path.join(TARGET, '_bench-preview.jpg');
  await sharp(file).rotate().resize({ width: 1200 }).jpeg({ quality: 78 }).toFile(preview);
  console.log(`  _bench-preview.jpg  (весь кадр, для выбора кадрирования)`);

  console.log(
    `\n[цоколь] полоса взята на высоте ${Math.round(FOCUS * 100)}% кадра.\n` +
      '         Не туда — запустите с другим HONEY_BENCH_FOCUS, например 0.8.',
  );
}

main().catch((e) => {
  console.error('[цоколь] сорвалось:', e.message);
  process.exit(1);
});
