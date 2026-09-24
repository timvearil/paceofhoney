/**
 * Диалог из дефисов — в диалог по-русски.
 *
 * ЗАЧЕМ. Реплики набираются дефисом в начале строки: так пишут в Дзене,
 * так подсказывает клавиатура, так привык автор. Но для Markdown дефис
 * в начале строки — маркер списка, и страница получает не разговор,
 * а маркированный перечень: точки слева, сжатые отступы, реплики
 * слипаются с повествованием.
 *
 * Хуже того, абзац, написанный сразу под репликой без пустой строки,
 * Markdown считает продолжением пункта списка и втягивает внутрь. Именно
 * так «После истории с космическим городком…» оказалось внутри реплики
 * Тимура: авторский текст никуда не делся, но читается как его слова.
 *
 * ЧТО ДЕЛАЕМ. В статьях настоящих перечней нет — есть только диалоги.
 * Поэтому правило простое и проверяемое: любой маркированный список
 * внутри главы разворачивается обратно в абзацы.
 *
 *   - Что ты делаешь?       →  <p class="replica">— Что ты делаешь?</p>
 *
 * Каждая реплика получает настоящее длинное тире вместо дефиса, а строки,
 * втянутые в пункт по ошибке, выходят наружу обычными абзацами.
 * Заодно дефис-разделитель внутри реплики («- сказал Тимур. - Слайды»)
 * тоже становится тире: типографика делается один раз здесь, а не
 * семнадцать раз руками в текстах.
 *
 * ЧЕГО НЕ ДЕЛАЕМ. Нумерованные списки не трогаем: они изредка нужны
 * по делу, и спутать их с диалогом нельзя.
 *
 * Если когда-нибудь в главе понадобится настоящий перечень — его нужно
 * будет написать нумерованным или вынести в цитату. Это сознательный
 * размен: диалогов в текстах сотни, перечней не было ни одного.
 *
 * Спецификация: 01_Spec/razmetka-statey.md
 */

import { visit } from 'unist-util-visit';

const DASH = '—';

/** Дефис между пробелами — это тире, набранное на скорую руку. */
function typographize(node) {
  visit(node, 'text', (t) => {
    t.value = t.value.replace(/ - /g, ` ${DASH} `);
  });
  return node;
}

/**
 * Разрезает содержимое абзаца по переводам строки.
 *
 * Мягкий перенос внутри абзаца — это и есть след «прилипшей» строки:
 * автор писал новый абзац, Markdown приклеил его к предыдущему.
 * Возвращает массив массивов — по одному на будущий абзац.
 */
function splitOnBreaks(children) {
  const parts = [[]];

  for (const child of children) {
    if (child.type === 'break') {
      parts.push([]);
      continue;
    }

    if (child.type === 'text' && child.value.includes('\n')) {
      const pieces = child.value.split('\n');
      pieces.forEach((piece, i) => {
        if (i > 0) parts.push([]);
        if (piece.trim()) {
          parts[parts.length - 1].push({ ...child, value: piece });
        }
      });
      continue;
    }

    parts[parts.length - 1].push(child);
  }

  return parts.filter((p) => p.length);
}

/** Пункт списка → абзацы: первый реплика, остальные — освобождённый текст. */
function unwrapItem(item) {
  const out = [];

  for (const block of item.children) {
    /*
     * Вложенный список — это лишний дефис в исходнике: «- - Вы ещё
     * предложите…». Автор такого не задумывал, и реплика от опечатки
     * пропадать не должна — разворачиваем так же, как внешний.
     */
    if (block.type === 'list' && !block.ordered) {
      out.push(...block.children.flatMap(unwrapItem));
      continue;
    }

    if (block.type !== 'paragraph') {
      out.push(block);
      continue;
    }

    splitOnBreaks(block.children).forEach((children, i) => {
      const isReplica = i === 0 && out.length === 0;
      const paragraph = { type: 'paragraph', children };

      if (isReplica) {
        paragraph.data = { hProperties: { class: 'replica' } };
        children.unshift({ type: 'text', value: `${DASH} ` });
      }

      out.push(typographize(paragraph));
    });
  }

  return out;
}

export function remarkDialogue() {
  return (tree) => {
    visit(tree, 'list', (node, index, parent) => {
      if (node.ordered || !parent || index === null) return;

      const paragraphs = node.children.flatMap(unwrapItem);
      parent.children.splice(index, 1, ...paragraphs);

      // Продолжаем обход с того места, куда встали абзацы: внутри них
      // списков уже нет, а пропустить соседний блок нельзя.
      return index + paragraphs.length;
    });
  };
}
