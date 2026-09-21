/**
 * Описание коллекций контента.
 *
 * Здесь задано, из каких полей состоит глава, серия, статическая страница и
 * файлы настроек. Astro проверяет каждый файл по этой схеме на сборке и
 * **роняет сборку** при несоответствии: опечатка в `series_id`, забытая
 * `description`, кириллица в `slug`.
 *
 * Это не бюрократия, а страховка конвейера. Ошибка ловится за двадцать секунд
 * в GitHub Actions, а не обнаруживается через неделю битой карточкой на сайте.
 *
 * Спецификация: 01_Spec/tz-paceofhoney-v2.md, разделы 1.3, 4.1, 4.4
 */

import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

/** Латинский слаг: строчные буквы, цифры, дефис-разделитель. */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const slugField = z
  .string()
  .regex(
    SLUG,
    'Слаг пишется латиницей в нижнем регистре, слова через дефис: "nektar-8". ' +
      'Кириллица в адресе превращается в нечитаемую мешанину процентов ' +
      'и ломается при вставке в мессенджеры.',
  );

/* ---------------------------------------------------------------------------
   Главы сериалов и одиночные материалы
   ------------------------------------------------------------------------ */

const posts = defineCollection({
  loader: glob({ base: './src/content/posts', pattern: '**/*.md' }),
  schema: ({ image }) =>
    z
      .object({
        title: z.string().min(1),
        slug: slugField,
        description: z
          .string()
          .min(1, 'Без описания превью ссылки в Telegram и MAX приходит пустым.'),

        // Принадлежность к сериалу. Оба поля либо есть вместе, либо нет вовсе —
        // проверка ниже. Отсутствие series_id означает одиночный материал,
        // который рендерится классическим шаблоном (ТЗ 3.3.2).
        series_id: z.string().optional(),
        episode_number: z.number().int().positive().optional(),

        lead_image: image().optional(),
        lead_caption: z.string().optional(),
        lead_alt: z.string().optional(),

        date: z.coerce.date(),
        updated: z.coerce.date().optional(),

        draft: z.boolean().default(false),
        tags: z.array(z.string()).default([]),
      })
      .refine((d) => !d.series_id || d.episode_number !== undefined, {
        message: 'У главы сериала должен быть episode_number.',
        path: ['episode_number'],
      })
      .refine((d) => d.episode_number === undefined || !!d.series_id, {
        message: 'episode_number без series_id не имеет смысла: непонятно, глава чего это.',
        path: ['series_id'],
      })
      .refine((d) => !d.lead_image || !!d.lead_alt, {
        message:
          'У ведущего кадра обязательно текстовое описание lead_alt: ' +
          'без него фотографию не «увидит» тот, кто слушает страницу.',
        path: ['lead_alt'],
      }),
});

/* ---------------------------------------------------------------------------
   Сериалы
   ------------------------------------------------------------------------ */

const series = defineCollection({
  loader: glob({ base: './src/content/series', pattern: '**/*.md' }),
  schema: ({ image }) =>
    z.object({
      id: slugField,
      title: z.string().min(1),
      description: z.string().min(1),
      icon: z.string().min(1),
      cover_image: image().optional(),
      cover_alt: z.string().optional(),
      order: z.number().int().nonnegative(),
      draft: z.boolean().default(false),
    }),
});

/* ---------------------------------------------------------------------------
   Статические страницы: манифест, о нас, будущая библиотека
   ------------------------------------------------------------------------ */

const pages = defineCollection({
  loader: glob({ base: './src/content/pages', pattern: '**/*.md' }),
  schema: z.object({
    title: z.string().min(1),
    description: z.string().min(1),
    // Канонический адрес. Astro маршрутизирует по файлам, поэтому адрес
    // из метаданных разбирает один общий маршрут (ТЗ 4.3.4).
    permalink: z
      .string()
      .regex(/^\/[a-z0-9\-/]*$/, 'Адрес начинается с косой черты и пишется латиницей: "/about".'),
    draft: z.boolean().default(false),
    updated: z.coerce.date().optional(),
  }),
});

/* ---------------------------------------------------------------------------
   Настройки сайта. Три отдельных файла — три отдельные коллекции,
   потому что схемы у них разные, а Astro допускает одну схему на коллекцию.
   ------------------------------------------------------------------------ */

const menu = defineCollection({
  loader: glob({ base: './src/content/settings', pattern: 'menu.md' }),
  schema: z.object({
    items: z
      .array(
        z.object({
          title: z.string().min(1), // отображается как есть, включая индекс «00: »
          url: z.string().startsWith('/'),
        }),
      )
      .min(1),
  }),
});

const footer = defineCollection({
  loader: glob({ base: './src/content/settings', pattern: 'footer.md' }),
  schema: ({ image }) =>
    z.object({
      slogan: z.string().min(1),
      copyright: z.string().min(1),
      // Цоколь: два подготовленных кадра под светлую и тёмную тему.
      // Монохром зашит в сами файлы, а не наводится фильтром (ТЗ 4.5.2).
      bookend_light: image().optional(),
      bookend_dark: image().optional(),
      social_links: z
        .array(z.object({ title: z.string().min(1), url: z.string().url() }))
        .default([]),
      ai_endpoints: z
        .array(z.object({ title: z.string().min(1), url: z.string().startsWith('/') }))
        .default([]),
    }),
});

const passport = defineCollection({
  loader: glob({ base: './src/content/settings', pattern: 'passport.md' }),
  schema: z.object({
    title: z.string().default('Когнитивный паспорт'),
  }),
});

export const collections = { posts, series, pages, menu, footer, passport };
