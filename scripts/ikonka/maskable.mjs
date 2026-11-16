/**
 * Иконки «под обрезку» для Android: public/icon-maskable-{192,512}.png
 * из maskable.svg. Запуск — из этой папки: `node maskable.mjs`.
 *
 * Зачем: в списке иконок site.webmanifest стояла favicon.svg, и Chrome
 * на Android брал её — векторная, «любого размера». Её сота в тёмной теме
 * светлая на прозрачном фоне, Android подкладывает белый круг — значок
 * пропадал (16.11, тот же случай и та же починка, что у Мастерской).
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const svg = fs.readFileSync(new URL('./maskable.svg', import.meta.url));
for (const s of [192, 512]) {
  // Рисунок в сетке 32 × 32: плотность — чтобы сразу выйти в s пикселей.
  await sharp(svg, { density: (72 * s) / 32 })
    .resize(s, s)
    .png()
    .toFile(fileURLToPath(new URL(`../../public/icon-maskable-${s}.png`, import.meta.url)));
}
