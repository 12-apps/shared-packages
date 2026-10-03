import type { JSX } from 'react';

import { attentionKind, defineAttention, type AttentionItem } from '@12-apps/notifications/attention';
import {
  attentionView,
  createAttentionPreferences,
  defineAttentionViews,
  type AttentionMessages,
} from '@12-apps/notifications/attention/react';

/**
 * THIS HOST'S ATTENTION WIRING — a hardware shop's, in its own words, the way
 * `notification-copy.ts` states its inbox sentences.
 *
 * Two categories, most important first, and one kind each. Packing is measured
 * per order (the item carries its promised minutes); a return in review has a
 * fixed half hour. Packing opens a sheet the BUTTON draws (`renderSheet`) —
 * the other way a host can answer a tap, beside `onOpen`, which the origin host
 * uses to open a sheet it already has.
 */
export interface PackingItem extends AttentionItem {
  readonly order: string;
  readonly promisedMs: number;
}

export interface ReturnItem extends AttentionItem {
  readonly order: string;
}

export const HARNESS_ATTENTION = defineAttention({
  categories: ['pedidos', 'devolucoes'],
  kinds: [
    attentionKind<PackingItem>({
      id: 'pedidos.separar',
      category: 'pedidos',
      budgetMs: (item) => item.promisedMs,
    }),
    attentionKind<ReturnItem>({ id: 'devolucoes.analisar', category: 'devolucoes', budgetMs: 30 * 60_000 }),
  ],
});

function Glyph({ letter }: { readonly letter: string }): JSX.Element {
  return <span style={{ fontWeight: 700 }}>{letter}</span>;
}

export const HARNESS_ATTENTION_VIEWS = defineAttentionViews(HARNESS_ATTENTION, {
  'pedidos.separar': attentionView<PackingItem>({
    icon: <Glyph letter="P" />,
    describe: (item) => ({ title: item.order, what: 'Separar pedido', spoken: `Pedido ${item.order}` }),
    renderSheet: ({ item, close }) => (
      <div role="dialog" aria-label={`Pedido ${item.order}`} data-testid="harness-attention-sheet">
        <p>Separar o pedido {item.order}</p>
        <button type="button" onClick={close}>
          Fechar
        </button>
      </div>
    ),
  }),
  'devolucoes.analisar': attentionView<ReturnItem>({
    icon: <Glyph letter="D" />,
    describe: (item) => ({ title: item.order, what: 'Analisar devolução', spoken: `Pedido ${item.order}` }),
  }),
});

export const HARNESS_ATTENTION_PREFERENCES = createAttentionPreferences({ storageKey: 'harness:attention' });

const levels = { off: 'Desligado', late: 'Só atrasados', all: 'Tudo' } as const;
const hints = { off: 'Nada avisa', late: 'Só o que atrasou', all: 'Tudo que chega' } as const;

export const HARNESS_ATTENTION_MESSAGES: AttentionMessages = {
  waited: (minutes) => `${minutes} min`,
  button: ({ title, what, waited, others }) =>
    `Próximo: ${title}, ${what}, há ${waited}${others > 0 ? `. Mais ${others}` : ''}`,
  others: (count) => `Ver mais ${count}`,
  severity: { calm: 'no prazo', late: 'atrasado', spent: 'esgotado' },
  othersTitle: 'Outros avisos',
  preferences: {
    quickLabel: 'Som e vibração dos avisos',
    sound: {
      title: 'Som',
      shortTitle: 'Som',
      description: 'Toca quando algo chega.',
      levels,
      hints,
      test: 'Tocar',
    },
    vibration: {
      title: 'Vibração',
      shortTitle: 'Vibração',
      description: 'Vibra quando algo chega.',
      levels,
      hints,
      test: 'Vibrar',
      unavailable: 'Este aparelho não vibra.',
      unavailableShort: 'Não vibra aqui.',
    },
    push: {
      title: 'Notificações',
      shortTitle: 'Notificações',
      description: 'Avisa com o app fechado.',
      levels,
      hints,
      enable: 'Permitir',
      test: 'Testar',
      unavailable: 'Sem notificações aqui.',
    },
    position: {
      title: 'Botão',
      moved: 'Você moveu o botão.',
      resting: 'No canto.',
      reset: 'Voltar ao canto',
    },
  },
};
