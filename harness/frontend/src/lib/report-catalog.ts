/**
 * The harness's field catalog — the SEVEN entities the product's own catalog
 * declares, in the product's own words.
 *
 * It used to declare one, `orders`, which made most of the builder
 * unexercisable: "Coleção" was a dropdown with a single choice, `id` was the
 * only spare dimension to split a chart by (hence legends reading `o1 o2 o3`),
 * and five of the eight block templates named an entity that did not exist
 * here — so the picker offered "Horas trabalhadas por estação" and the block it
 * created came back *Acesso negado*, because an entity absent from the catalog
 * is an entity nobody has permission to query.
 *
 * A FAITHFUL SUBSET, not a copy. Labels, types, roles, `ordered`, closed value
 * sets and `identityMinSample` are lifted field for field from
 * `server/catalog.ts`, because the point of a harness is that the two halves of
 * one contract meet — a fixture that models a different world tests nothing.
 * What is left out is listed per entity below; nothing is renamed.
 *
 * The one thing that cannot be imported is the value sets: `catalog-values.ts`
 * is internal to the package, so `ORDER_STATUS_VALUES` and friends are restated
 * here verbatim rather than paraphrased.
 */
import { defineCatalog } from '@12-apps/report-builder';

/** `orders.status` — the webhook-owned payment lifecycle of an order. */
const ORDER_STATUS_VALUES = [
  { value: 'PAID', label: 'Pago' },
  { value: 'AWAITING_PAYMENT', label: 'Aguardando pagamento' },
  { value: 'FAILED', label: 'Falhou' },
  { value: 'EXPIRED', label: 'Expirado' },
];

/** `orders.method` — includes WAITER, which settles an order but takes no charge. */
const ORDER_METHOD_VALUES = [
  { value: 'PIX', label: 'PIX' },
  { value: 'CARD', label: 'Cartão' },
  { value: 'WAITER', label: 'Com o garçom' },
];

/** `payments.method` — a charge is only ever online. */
const PAYMENT_METHOD_VALUES = [
  { value: 'PIX', label: 'PIX' },
  { value: 'CARD', label: 'Cartão' },
];

/** `payments.status` — the gateway's lifecycle, deliberately NOT the order's. */
const PAYMENT_STATUS_VALUES = [
  { value: 'PAID', label: 'Pago' },
  { value: 'AUTHORIZED', label: 'Autorizado' },
  { value: 'PENDING', label: 'Pendente' },
  { value: 'DECLINED', label: 'Recusado' },
];

/**
 * The per-cook suppression floor. The package exports the constant
 * (`KITCHEN_CHEF_MIN_SAMPLE`) and the harness could import it — it is restated
 * with the import beside it in `memory-backend`, so the fixture's own row
 * counts and this number stay visibly related.
 */
const KITCHEN_MIN_SAMPLE = 20;

export const HARNESS_CATALOG = defineCatalog({
  entities: {
    orders: {
      label: 'Pedidos',
      description:
        'Um registro por pedido. Filtre status = PAID para análises de receita.',
      // Every field of the real entity.
      fields: {
        id: { label: 'Pedido', type: 'string', role: 'dimension' },
        createdAt: { label: 'Data', type: 'date', role: 'dimension' },
        // The two ORDERED string dimensions (FUT-755). They are what a line or
        // an area chart may use as an axis; `method` and `status` are not, and
        // the picker refuses those with a reason. Both encodings sort
        // lexicographically on purpose — "09" never "9", "1-seg" never "seg".
        hourOfDay: {
          label: 'Hora do dia',
          type: 'string',
          role: 'dimension',
          ordered: true,
          description: "Hora local (America/Sao_Paulo), '00' a '23'.",
        },
        dayOfWeek: {
          label: 'Dia da semana',
          type: 'string',
          role: 'dimension',
          ordered: true,
          description: "Dia local (America/Sao_Paulo), '1-seg' a '7-dom'.",
        },
        status: {
          label: 'Status',
          type: 'string',
          role: 'dimension',
          values: ORDER_STATUS_VALUES,
        },
        method: {
          label: 'Forma de pagamento',
          type: 'string',
          role: 'dimension',
          values: ORDER_METHOD_VALUES,
        },
        revenueCents: { label: 'Receita', type: 'money', role: 'measure' },
      },
    },
    order_items: {
      label: 'Itens vendidos',
      description: 'Linhas de pedidos PAGOS (somente vendas concretizadas).',
      // Every field of the real entity.
      fields: {
        id: { label: 'Linha', type: 'string', role: 'dimension' },
        createdAt: { label: 'Data', type: 'date', role: 'dimension' },
        productName: { label: 'Produto', type: 'string', role: 'dimension' },
        categoryName: { label: 'Categoria', type: 'string', role: 'dimension' },
        quantity: { label: 'Quantidade', type: 'number', role: 'measure' },
        revenueCents: { label: 'Receita', type: 'money', role: 'measure' },
        costCents: { label: 'Custo (CMV)', type: 'money', role: 'measure' },
      },
    },
    payments: {
      label: 'Pagamentos',
      description: 'Cobranças por pedido. Filtre status = PAID para receita liquidada.',
      // Every field of the real entity.
      fields: {
        id: { label: 'Pagamento', type: 'string', role: 'dimension' },
        createdAt: { label: 'Data', type: 'date', role: 'dimension' },
        method: {
          label: 'Forma de pagamento',
          type: 'string',
          role: 'dimension',
          values: PAYMENT_METHOD_VALUES,
        },
        status: {
          label: 'Status',
          type: 'string',
          role: 'dimension',
          values: PAYMENT_STATUS_VALUES,
        },
        amountCents: { label: 'Valor', type: 'money', role: 'measure' },
      },
    },
    stock_movements: {
      label: 'Movimentações de estoque',
      description: 'Ledger de estoque (movimentos cancelados são excluídos).',
      // LEFT OUT: `fromLocationName` / `toLocationName` — per-location reporting
      // needs a second location dimension on every row to say anything, and the
      // entity is explorable by type and insumo without it.
      fields: {
        id: { label: 'Movimentação', type: 'string', role: 'dimension' },
        createdAt: { label: 'Data', type: 'date', role: 'dimension' },
        type: { label: 'Tipo', type: 'string', role: 'dimension' },
        itemName: { label: 'Insumo', type: 'string', role: 'dimension' },
        quantityDelta: { label: 'Quantidade (delta)', type: 'number', role: 'measure' },
        costCents: { label: 'Custo', type: 'money', role: 'measure' },
      },
    },
    loss_events: {
      label: 'Perdas',
      description:
        'Baixas de estoque atribuídas a um motivo de perda, lidas do ledger. ' +
        'Baixas negativas SEM motivo atribuído — conciliação, estoque inicial — ficam de fora.',
      // Every field of the real entity.
      fields: {
        id: { label: 'Perda', type: 'string', role: 'dimension' },
        occurredAt: { label: 'Data', type: 'date', role: 'dimension' },
        reasonName: { label: 'Motivo', type: 'string', role: 'dimension' },
        itemName: { label: 'Insumo', type: 'string', role: 'dimension' },
        quantity: { label: 'Quantidade perdida', type: 'number', role: 'measure' },
        lossValueCents: { label: 'Valor perdido', type: 'money', role: 'measure' },
      },
    },
    kitchen_ticket_items: {
      label: 'Cozinha — linhas',
      description:
        'Uma linha de cozinha CONCLUÍDA, no período em que ficou pronta. Medidas de tempo ' +
        `são individuais por natureza: um recorte com menos de ${KITCHEN_MIN_SAMPLE} linhas ` +
        'elegíveis não exibe esses números.',
      // No `id`, exactly as in the real catalog: a surrogate key is not an
      // analytical grouping, and grouping by it turns a per-line timing into
      // one person's figure.
      //
      // LEFT OUT: the demand-side hour/weekday pair, `attribution`,
      // `chefId`/`chefName`, and every plan/promise measure. Those need a
      // kitchen PLAN and a promised prazo behind each row; without them the
      // fields would be present and permanently empty, which is worse than
      // absent.
      fields: {
        readyAt: {
          label: 'Conclusão',
          type: 'date',
          role: 'dimension',
          description: 'Quando a linha ficou pronta — o eixo do período.',
        },
        sentAt: {
          label: 'Envio do pedido',
          type: 'date',
          role: 'dimension',
          description: 'Quando a demanda chegou à cozinha. Pergunta diferente da conclusão.',
        },
        completionHourOfDay: {
          label: 'Hora da conclusão',
          type: 'string',
          role: 'dimension',
          ordered: true,
          description: 'Hora local (America/Sao_Paulo) em que a linha ficou pronta.',
        },
        completionDayOfWeek: {
          label: 'Dia da conclusão',
          type: 'string',
          role: 'dimension',
          ordered: true,
          description: "Dia local (America/Sao_Paulo), '1-seg' a '7-dom'.",
        },
        stationName: { label: 'Estação', type: 'string', role: 'dimension' },
        productName: { label: 'Produto', type: 'string', role: 'dimension' },
        lines: { label: 'Linhas', type: 'number', role: 'measure' },
        quantity: {
          label: 'Quantidade produzida',
          type: 'number',
          role: 'measure',
          description: 'A quantidade pesa na produção; NÃO pesa nos tempos.',
        },
        waitSeconds: {
          label: 'Espera na fila',
          type: 'number',
          role: 'measure',
          format: 'duration',
          identityMinSample: KITCHEN_MIN_SAMPLE,
          description:
            'Do envio do pedido ao INÍCIO do preparo — a fila, não o cozinheiro.',
        },
        prepSeconds: {
          label: 'Tempo de preparo',
          type: 'number',
          role: 'measure',
          format: 'duration',
          identityMinSample: KITCHEN_MIN_SAMPLE,
          description:
            'Do início ao prato pronto — o tempo do COZINHEIRO, sem a fila. Uma linha é UMA observação.',
        },
      },
    },
    kitchen_shifts: {
      label: 'Cozinha — turnos',
      description:
        'Turnos de cozinha que cruzam o período. Turnos fechados SEM produção continuam na ' +
        'conta de horas: quem não produziu ainda custou a hora.',
      // No `id`, as in the real catalog: one shift is one cook.
      //
      // LEFT OUT: `autoClosedShifts` and `zeroOutputShifts`. Both are counters
      // over states the dimensions already expose here (`autoClosed`, and a
      // closed shift whose `outputLines` is zero).
      fields: {
        startedAt: { label: 'Início', type: 'date', role: 'dimension' },
        stationName: { label: 'Estação', type: 'string', role: 'dimension' },
        endedReason: {
          label: 'Encerramento',
          type: 'string',
          role: 'dimension',
          description: "'Cozinheiro', 'Supervisor', 'Automático' ou 'Em aberto'.",
        },
        autoClosed: {
          label: 'Fechado pelo sistema',
          type: 'boolean',
          role: 'dimension',
          description:
            'Um fechamento automático de 16h não é um turno de 16h — a marcação existe para o leitor saber.',
        },
        closed: { label: 'Encerrado', type: 'boolean', role: 'dimension' },
        shifts: { label: 'Turnos', type: 'number', role: 'measure' },
        closedShifts: { label: 'Turnos encerrados', type: 'number', role: 'measure' },
        laborSeconds: {
          label: 'Horas trabalhadas',
          type: 'number',
          role: 'measure',
          format: 'duration',
          description: 'Recortadas ao período do relatório.',
        },
        laborHours: {
          label: 'Horas trabalhadas (decimal)',
          type: 'number',
          role: 'measure',
          description: "As mesmas horas em decimal — o divisor de 'linhas por hora'.",
        },
        outputLines: { label: 'Linhas produzidas', type: 'number', role: 'measure' },
        outputQuantity: { label: 'Quantidade produzida', type: 'number', role: 'measure' },
      },
    },
  },
});
