// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { unified } from '@astrojs/markdown-remark';
import { remarkObsidian } from './src/plugins/remark-obsidian.mjs';

// Канонический домен. Без него неверно соберутся sitemap и абсолютные og:image.
const SITE = 'https://paceofhoney.me';

export default defineConfig({
  site: SITE,

  // Статическая генерация: на выходе только готовый HTML, сервер не нужен.
  output: 'static',

  // Локальный сервер разработки. Касается только команды npm run dev,
  // на опубликованный сайт не влияет никак.
  server: {
    // Явно привязываемся к IPv4-адресу. Без этой строки Node 17+ на Windows
    // поднимает сервер только на IPv6 ([::1]), тогда как браузер по адресу
    // localhost идёт на IPv4 (127.0.0.1) — и получает ERR_CONNECTION_REFUSED.
    host: '127.0.0.1',
    port: 4321,
  },

  integrations: [
    sitemap({
      // Черновики и служебные адреса в карту сайта не попадают.
      filter: (page) => !page.includes('/_'),
    }),
  ],

  image: {
    // Адаптивные изображения по умолчанию: Astro сам режет несколько размеров
    // и проставляет srcset с sizes. Для проекта, где фотография — главный
    // носитель смысла, это принципиально: макроснимок мёда на 4 МБ не должен
    // уезжать целиком на телефон.
    layout: 'constrained',
    objectFit: 'cover',
    objectPosition: 'center',
  },

  markdown: {
    // Обработчик Markdown выбирается явно.
    //
    // По умолчанию в Astro 7 стоит новый быстрый Sätteri, но наш переводчик
    // синтаксиса Obsidian ([[ссылки]] и ![[вложения]]) написан под remark.
    // Поэтому переключаемся на unified — осознанный размен: теряем скорость
    // нового обработчика, получаем зрелую экосистему. Сборка сайта на два
    // десятка страниц занимает полторы секунды, экономить тут нечего.
    processor: unified({
      remarkPlugins: [[remarkObsidian, { root: process.cwd() }]],
    }),
    // Подсветку кода настроим, когда появятся технические статьи.
    shikiConfig: { theme: 'github-dark', wrap: true },
  },

  build: {
    // Адреса без завершающего слэша: /posts/nektar-8, а не /posts/nektar-8/
    format: 'file',
  },
});
