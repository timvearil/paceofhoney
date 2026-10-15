/**
 * `/zen.xml` — лента для Дзена (P15-14).
 *
 * ЗАЧЕМ ОТДЕЛЬНАЯ. Обычный `/rss.xml` — для людей с читалками: там аннотация
 * и ссылка. Дзену нужен полный текст в своей разметке и служебные пометки
 * в `<category>`, которые читалке ни к чему. Смешивать — значит портить
 * обе ленты.
 *
 * КАК РАБОТАЕТ. В ленту идут только статьи со свойством `zen: true`. Дзен
 * забирает их черновиками (`native-draft`): Тимур через несколько дней
 * доводит выделения и публикует сам — или не публикует. После его правки
 * в Студии, или через 7 дней, Дзен перестаёт брать изменения из ленты.
 *
 * ЧТО МЕНЯЕТСЯ В ТЕКСТЕ. Дзен понимает короткий список тегов: p, a, b, i,
 * h1–h4, blockquote, списки, figure и img. Остальное переводится или
 * снимается:
 *   · `<code>` (машинный язык, Geist Mono) — снимается, слово остаётся.
 *     Моноширинного у Дзена нет, а подменить нечем: курсив занят чужой
 *     речью;
 *   · `<hr>` (смена сцены) — абзацем `* * *`, иначе сцены сольются;
 *   · выделения внутри пунктов списка — снимаются: Дзен их там не берёт;
 *   · ссылки в тексте — снимаются, слово остаётся (см. ниже, у замены);
 *   · кадры — исходные JPEG из `_attachments`, а не WebP страниц: WebP
 *     Дзен не принимает. Копий не делаем: исходник уже ужат и очищен
 *     от данных камеры (`npm run images`), шире 700 px, а обложки сайт
 *     и так публикует для превью в соцсетях.
 *
 * В конце — строка о первоисточнике с датой выхода на сайте и адресом
 * словами: на Дзене статья появится позже, и дата показывает, где она
 * вышла первой (P11-38).
 * У архивного текста перед ней — когда он написан. Подробности о правках
 * и подтверждение возраста остаются на сайте: ссылка ведёт туда.
 *
 * Справка Дзена: https://dzen.ru/help/ru/website/rss-modify.html
 */

import type { APIRoute } from 'astro';
import type { ImageMetadata } from 'astro';
import { getPublishedPosts } from '../lib/content';

const SITE = 'https://paceofhoney.me';
const TITLE = 'Со скоростью мёда';
const DESCRIPTION =
  'Журнал о выходе из цифровой «Карусели»: пчеловодство, кибербезопасность ' +
  'через жизнь улья, финансовые аферы через приключения трутней, ' +
  'созерцательные маршруты.';

/*
 * Кадры статей. В готовом тексте они стоят заготовками Astro с путём
 * относительно папки статей (`../_attachments/23-1.jpg`), поэтому
 * собираем их здесь заранее и ищем по имени файла.
 */
const attachments = import.meta.glob<ImageMetadata>(
  '/src/content/_attachments/*.{jpg,jpeg,png,JPG,JPEG,PNG}',
  { eager: true, import: 'default' },
);
const byName = new Map(
  Object.entries(attachments).map(([path, img]) => [path.split('/').pop()!, img]),
);

const esc = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const unescapeAttr = (s: string) =>
  s.replace(/&#x22;/g, '"').replace(/&quot;/g, '"').replace(/&amp;/g, '&');

/** RFC 822 — формат, которого требует спецификация RSS. */
const rfc822 = (d: Date) => d.toUTCString();

const MONTHS = ['января','февраля','марта','апреля','мая','июня',
                'июля','августа','сентября','октября','ноября','декабря'];
/*
 * Дата словами. Берётся UTC: даты статей записаны без времени и в сборке
 * встают на полночь UTC, а локальное время сборщика могло бы сдвинуть день.
 */
const dateWords = (d: Date) =>
  `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} года`;

/*
 * Откуда брать кадры. На сайте — с домена. На стенде (`npm run dev`) кадры
 * лежат по служебным адресам, которых на домене нет, — поэтому там адрес
 * стенда, иначе картинки в ленте не откроются.
 */
let base = SITE;

/** Адрес исходного кадра — его и забирает Дзен. */
const jpeg = (img: ImageMetadata) => base + img.src;

/*
 * Адрес кадра экранируется всегда: на стенде в нём параметры через `&`,
 * а голый `&` ломает XML (поймано 15.10 — лента на стенде не открывалась).
 */
const figure = (src: string, caption?: string) =>
  caption
    ? `<figure><img src="${esc(src)}"><figcaption>${esc(caption)}</figcaption></figure>`
    : `<figure><img src="${esc(src)}"></figure>`;

/** Готовый HTML статьи → разметка, которую понимает Дзен. */
async function toZen(html: string, slug: string): Promise<string> {
  // Кадры: обёртку сайта (figure.inline-shot > div.shot > img + figcaption)
  // заменяем простой figure с JPEG.
  const shots = [...html.matchAll(/<figure class="inline-shot">[\s\S]*?<\/figure>/g)];
  for (const [block] of shots) {
    const raw = block.match(/__ASTRO_IMAGE_="([^"]*)"/)?.[1];
    if (!raw) throw new Error(`zen.xml: кадр без исходника в «${slug}»`);
    const meta = JSON.parse(unescapeAttr(raw));
    const name = String(meta.src).split('/').pop()!;
    const img = byName.get(name);
    if (!img) throw new Error(`zen.xml: кадр ${name} из «${slug}» не найден в _attachments`);
    const caption = block.match(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/)?.[1];
    html = html.replace(block, figure(jpeg(img), caption && caption.trim()));
  }

  // Выделения внутри пунктов списка Дзен не берёт — оставляем текст.
  html = html.replace(/<li>([\s\S]*?)<\/li>/g, (_, inner) =>
    `<li>${inner.replace(/<\/?(strong|em|code|b|i)>/g, '')}</li>`,
  );

  return html
    .replace(/<p class="[^"]*">/g, '<p>')
    .replace(/<\/?code>/g, '')
    .replace(/<strong>/g, '<b>').replace(/<\/strong>/g, '</b>')
    .replace(/<em>/g, '<i>').replace(/<\/em>/g, '</i>')
    .replace(/<hr\s*\/?>/g, '<p>* * *</p>')
    // Ссылки в тексте снимаются, слово остаётся: на Дзене любая из них —
    // внешняя, а внешняя ссылка в теле статьи, по опыту, обнуляет охват
    // (решение 15.10). Нужную Тимур вернёт руками при доводке черновика.
    .replace(/<a\b[^>]*>([\s\S]*?)<\/a>/g, '$1');
}

export const GET: APIRoute = async ({ url }) => {
  base = import.meta.env.DEV ? url.origin : SITE;
  const posts = (await getPublishedPosts()).filter((p) => p.data.zen);

  const items = await Promise.all(
    posts.map(async (p) => {
      const d = p.data;
      const url = `${SITE}/posts/${d.slug}`;
      const html = p.rendered?.html;
      if (!html) throw new Error(`zen.xml: у «${d.slug}» нет готового текста`);

      const parts: string[] = [];
      let cover = '';
      if (d.lead_image) {
        cover = jpeg(d.lead_image);
        parts.push(figure(cover, d.lead_caption ?? undefined));
      }
      parts.push(await toZen(html, d.slug));

      // Когда написан архивный текст — только это; остальное на сайте.
      if (d.origin) {
        parts.push(
          d.origin.unpublished
            ? `<p>Текст написан ${dateWords(d.origin.date)} и до сайта нигде не публиковался.</p>`
            : `<p>Текст впервые вышел ${dateWords(d.origin.date)}${d.origin.source ? ` на ${esc(d.origin.source)}` : ''}.</p>`,
        );
      }
      /*
       * Адрес — словами, не ссылкой: кликабельная внешняя ссылка в теле
       * статьи, по опыту Тимура, обнуляет охват на Дзене, а нулевой охват
       * плох и для следа. Связь с сайтом и без неё держится на привязке
       * канала к домену и на `<link>` в ленте; кликабельная ссылка уходит
       * первым комментарием (решение 15.10, `razmetka-statey.md`).
       */
      parts.push(
        `<p>Впервые опубликовано ${dateWords(d.date)} на сайте «${TITLE}» — ` +
          `paceofhoney.me/posts/${d.slug}</p>`,
      );

      const content = parts.join('\n').replace(/]]>/g, ']]]]><![CDATA[>');

      return [
        '    <item>',
        `      <title>${esc(d.title)}</title>`,
        `      <link>${url}</link>`,
        `      <guid isPermaLink="true">${url}</guid>`,
        `      <pubDate>${rfc822(d.date)}</pubDate>`,
        `      <description>${esc(d.description)}</description>`,
        // Черновиком в Студию, статьёй, с индексацией поисковиками.
        '      <category>native-draft</category>',
        '      <category>format-article</category>',
        '      <category>index</category>',
        cover ? `      <enclosure url="${esc(cover)}" type="${/\.png(\?|$)/i.test(cover) ? 'image/png' : 'image/jpeg'}"/>` : '',
        `      <content:encoded><![CDATA[${content}]]></content:encoded>`,
        '    </item>',
      ]
        .filter((l) => l !== '')
        .join('\n');
    }),
  );

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" ' +
      'xmlns:atom="http://www.w3.org/2005/Atom">',
    '  <channel>',
    `    <title>${esc(TITLE)}</title>`,
    `    <link>${SITE}/</link>`,
    `    <description>${esc(DESCRIPTION)}</description>`,
    '    <language>ru</language>',
    `    <atom:link href="${SITE}/zen.xml" rel="self" type="application/rss+xml" />`,
    ...items,
    '  </channel>',
    '</rss>',
    '',
  ].join('\n');

  return new Response(xml, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
};
