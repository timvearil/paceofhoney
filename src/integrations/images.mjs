/**
 * Слежение за архивом иллюстраций во время разработки.
 *
 * ЗАЧЕМ. Перенос кадров из архива в репозиторий делает `npm run images`, и он
 * запускается один раз — перед стартом сервера. Пока идёт работа над статьёй,
 * текст подхватывается на лету, а картинки нет: положил кадр в архив, поставил
 * ссылку — и ничего не появилось. Со стороны выглядит как поломка, хотя всё
 * исправно, просто перенос был полчаса назад.
 *
 * Лечится слежением: как только в архиве что-то меняется, перенос повторяется,
 * и Astro сам пересобирает страницу. Перезапускать сервер не нужно.
 *
 * ТОЛЬКО ДЛЯ РАЗРАБОТКИ. При сборке архив трогать незачем: перенос уже прошёл
 * в `npm run build`, а на сервере архива и вовсе нет.
 */

import { syncImages, archivePath } from '../../scripts/sync-images.mjs';

export default function images() {
  return {
    name: 'honey:images',
    hooks: {
      'astro:server:setup': async ({ server, logger }) => {
        // Vite следит только за тем, что внутри проекта. Архив лежит снаружи,
        // в vault, — добавляем его отдельно.
        server.watcher.add(archivePath);

        let busy = false;
        let again = false;

        const run = async (file) => {
          if (!file.startsWith(archivePath)) return;

          // Правка нескольких файлов подряд не должна запускать перенос
          // столько же раз: доделываем текущий и повторяем один раз после.
          if (busy) {
            again = true;
            return;
          }
          busy = true;

          try {
            do {
              again = false;
              await syncImages();
            } while (again);
          } catch (e) {
            // Сервер разработки не роняем: автор поправит имя и продолжит.
            logger.warn(`перенос кадров не удался — ${e.message}`);
          } finally {
            busy = false;
          }
        };

        server.watcher.on('add', run);
        server.watcher.on('change', run);
        server.watcher.on('unlink', run);

        logger.info(`слежу за кадрами: ${archivePath}`);
      },
    },
  };
}
