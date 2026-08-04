import { KITCHEN_ATTRIBUTION_SOLO, KITCHEN_CHEF_MIN_SAMPLE } from "./adapter-kitchen-source";
import type { SystemDashboardDef, SystemReportDef } from "./preset-types";

/**
 * Cozinha › Análise (FUT-454) — the kitchen's built-in reports, split out of
 * `presets.ts` for the size budget.
 *
 * The section deliberately ships several reports rather than one summary,
 * because the kitchen's numbers answer questions that must not be added
 * together:
 *
 *   - **Espera e preparo** — the queue and the cook, side by side and never
 *     summed: a long WAIT is a staffing answer, a long COOK is a dish or a
 *     person answer, and one "tempo total" column tells you neither.
 *   - **Evolução no período** — the same two over time, because a single
 *     figure for a month hides whether it is getting better or worse.
 *   - **Por prato** — measured time against the menu's own estimate, which is
 *     where a systematically mis-quoted dish shows up.
 *   - **Plano da cozinha** — the line against the kitchen's OWN plan.
 *   - **Promessa ao cliente** — the pedido against what the diner was told.
 *     A separate report from the one above on purpose: the same shift can be
 *     late on its plan and perfectly on time to the table (or the reverse),
 *     and a single "atraso" number would hide which one is broken.
 *   - **Repasses** — lines a second cook finished, kept visible as their own
 *     figure precisely because they are excluded from the individual ranking.
 *   - **Por cozinheiro** — the individual ranking, over SOLO lines only and
 *     under a hard suppression floor.
 */

/** Only lines one cook both started and finished may enter an individual ranking. */
const SOLO_LINES = {
  field: "attribution",
  operator: "eq",
  value: KITCHEN_ATTRIBUTION_SOLO,
} as const;

const KITCHEN_TIER = "reports:kitchen:read";

export const KITCHEN_SYSTEM_REPORTS: readonly SystemReportDef[] = [
  {
    key: "cozinha-tempo-preparo",
    title: "Cozinha — espera e preparo",
    description:
      "Os dois tempos separados, por estação: a ESPERA na fila (do envio do pedido ao início do preparo) e o PREPARO em si (do início ao prato pronto). Espera longa é falta de gente na praça; preparo longo é o prato ou a pessoa — somados, não dizem qual dos dois. Cada contagem é a amostra do percentil ao lado, não o total de linhas.",
    permission: KITCHEN_TIER,
    section: "kitchen",
    supportsGrain: false,
    presentation: "table",
    build: () => ({
      entity: "kitchen_ticket_items",
      dimensions: [{ field: "stationName" }],
      measures: [
        // Each percentile is preceded by the population it was computed over.
        // A total line count here would OVERSTATE both samples: a line whose
        // start nobody registered has neither a wait nor a prep time.
        { field: "waitSeconds", aggregation: "count", alias: "linhas_com_espera" },
        { field: "waitSeconds", aggregation: "p50", alias: "espera_p50" },
        { field: "waitSeconds", aggregation: "p90", alias: "espera_p90" },
        { field: "prepSeconds", aggregation: "count", alias: "linhas_cronometradas" },
        { field: "prepSeconds", aggregation: "p50", alias: "preparo_p50" },
        { field: "prepSeconds", aggregation: "p90", alias: "preparo_p90" },
      ],
      sort: [{ by: "linhas_cronometradas", direction: "desc" }],
      limit: 200,
      presentation: { kind: "table" },
    }),
  },
  {
    key: "cozinha-tendencia",
    title: "Cozinha — evolução no período",
    description:
      "Espera e preparo ao longo do tempo (dia, semana ou mês). Um único número do período inteiro esconde a tendência: é a inclinação que diz se a cozinha está melhorando ou afundando.",
    permission: KITCHEN_TIER,
    section: "kitchen",
    supportsGrain: true,
    presentation: "chart",
    build: ({ grain }) => ({
      entity: "kitchen_ticket_items",
      dimensions: [{ field: "readyAt", timeGrain: grain }],
      // Medians, not averages: one catastrophic line should bend the curve a
      // little, not redraw it.
      measures: [
        { field: "waitSeconds", aggregation: "p50", alias: "espera_p50" },
        { field: "prepSeconds", aggregation: "p50", alias: "preparo_p50" },
      ],
      sort: [{ by: `readyAt_${grain}`, direction: "asc" }],
      limit: 400,
      presentation: { kind: "chart", chartType: "line" },
    }),
  },
  {
    key: "cozinha-por-prato",
    title: "Cozinha — por prato",
    description:
      "O tempo real de cada prato contra o previsto pelo plano da cozinha. Aderência acima de 100% é prato subestimado no cardápio — o que faz a cozinha prometer prazos que não consegue cumprir. Pratos sem plano (anteriores ao FUT-364) ficam fora da aderência.",
    permission: KITCHEN_TIER,
    section: "kitchen",
    supportsGrain: false,
    presentation: "table",
    build: () => ({
      entity: "kitchen_ticket_items",
      dimensions: [{ field: "productName" }],
      measures: [
        { field: "lines", aggregation: "sum", alias: "linhas" },
        { field: "prepSeconds", aggregation: "count", alias: "linhas_cronometradas" },
        { field: "prepSeconds", aggregation: "avg", alias: "preparo_medio" },
        { field: "plannedPrepSeconds", aggregation: "avg", alias: "previsto_medio" },
        {
          // Razão de somas, não média de razões: um prato de 3 minutos não pesa
          // o mesmo que um de 40 na aderência do cardápio.
          field: "prepSeconds",
          aggregation: "ratio",
          denominator: "plannedPrepSeconds",
          alias: "aderencia_ao_previsto",
          format: "percent",
        },
      ],
      // By VOLUME, not by adherence: a suppressed cell sorts as null, so a
      // ranking by the hidden figure would order rows by what is being hidden.
      sort: [{ by: "linhas", direction: "desc" }],
      limit: 200,
      presentation: { kind: "table" },
    }),
  },
  {
    key: "cozinha-plano-atraso",
    title: "Cozinha — atraso do plano",
    description:
      "A linha contra o plano da própria cozinha. Linhas sem plano aparecem à parte — nunca contam como pontuais. Cada atraso vem precedido da sua própria amostra: o atraso do PRATO existe em toda linha com plano, o atraso do INÍCIO só nas que também têm início registrado, e são populações diferentes.",
    permission: KITCHEN_TIER,
    section: "kitchen",
    supportsGrain: true,
    presentation: "table",
    build: ({ grain }) => ({
      entity: "kitchen_ticket_items",
      dimensions: [{ field: "readyAt", timeGrain: grain }],
      measures: [
        { field: "plannedLines", aggregation: "sum", alias: "linhas_com_plano" },
        { field: "unplannedLines", aggregation: "sum", alias: "linhas_sem_plano" },
        {
          field: "planLateLines",
          aggregation: "ratio",
          denominator: "plannedLines",
          alias: "taxa_atraso_plano",
          format: "percent",
        },
        // `linhas_com_plano` IS the plate-lateness population: a line reaches
        // this fact only through its `readyAt`, so a planned line always has a
        // plate lateness. The FIRE lateness needs a registered start as well,
        // which is a strictly smaller set — hence its own count beside it.
        { field: "planPlateLatenessSeconds", aggregation: "p90", alias: "atraso_prato_p90" },
        { field: "planFireLatenessSeconds", aggregation: "count", alias: "linhas_com_inicio" },
        { field: "planFireLatenessSeconds", aggregation: "p90", alias: "atraso_inicio_p90" },
      ],
      sort: [{ by: `readyAt_${grain}`, direction: "asc" }],
      limit: 400,
      presentation: { kind: "table" },
    }),
  },
  {
    key: "cozinha-promessa-cliente",
    title: "Cozinha — promessa ao cliente",
    description:
      "O PEDIDO contra o prazo prometido à mesa. Pedidos enviados antes de a cozinha prometer prazo ficam fora da taxa e aparecem contados à parte. 'Pedidos com promessa' é exatamente a população da taxa E do p90 ao lado — um pedido tem prazo prometido e entrega, ou não entra em nenhum dos dois.",
    permission: KITCHEN_TIER,
    section: "kitchen",
    supportsGrain: true,
    presentation: "table",
    build: ({ grain }) => ({
      entity: "kitchen_ticket_items",
      dimensions: [{ field: "readyAt", timeGrain: grain }],
      measures: [
        { field: "ticketsCompleted", aggregation: "sum", alias: "pedidos" },
        { field: "ticketsPromised", aggregation: "sum", alias: "pedidos_com_promessa" },
        { field: "ticketsUnquoted", aggregation: "sum", alias: "pedidos_sem_promessa" },
        {
          field: "ticketsPromiseBroken",
          aggregation: "ratio",
          denominator: "ticketsPromised",
          alias: "taxa_promessa_quebrada",
          format: "percent",
        },
        {
          field: "ticketPromiseLatenessSeconds",
          aggregation: "p90",
          alias: "atraso_promessa_p90",
        },
      ],
      sort: [{ by: `readyAt_${grain}`, direction: "asc" }],
      limit: 400,
      presentation: { kind: "table" },
    }),
  },
  {
    key: "cozinha-repasses",
    title: "Cozinha — repasses",
    description:
      "Linhas em que um cozinheiro começou e outro finalizou. Ficam fora do ranking individual e são relatadas aqui, porque um repasse é um sinal operacional.",
    permission: KITCHEN_TIER,
    section: "kitchen",
    supportsGrain: false,
    presentation: "table",
    build: () => ({
      entity: "kitchen_ticket_items",
      dimensions: [{ field: "stationName" }],
      measures: [
        { field: "attributedLines", aggregation: "sum", alias: "linhas_com_autoria" },
        { field: "handoffLines", aggregation: "sum", alias: "repasses" },
        {
          field: "handoffLines",
          aggregation: "ratio",
          denominator: "attributedLines",
          alias: "taxa_repasse",
          format: "percent",
        },
        { field: "unattributedLines", aggregation: "sum", alias: "linhas_sem_autoria" },
      ],
      sort: [{ by: "repasses", direction: "desc" }],
      limit: 200,
      presentation: { kind: "table" },
    }),
  },
  {
    key: "cozinha-por-cozinheiro",
    title: "Cozinha — por cozinheiro",
    description: `Ranking individual sobre linhas que um mesmo cozinheiro iniciou e finalizou. Números com menos de ${KITCHEN_CHEF_MIN_SAMPLE} linhas não são exibidos.`,
    permission: KITCHEN_TIER,
    section: "kitchen",
    supportsGrain: false,
    presentation: "table",
    build: () => ({
      entity: "kitchen_ticket_items",
      dimensions: [{ field: "chefName" }],
      filters: [SOLO_LINES],
      measures: [
        {
          field: "lines",
          aggregation: "sum",
          alias: "linhas",
          minSample: KITCHEN_CHEF_MIN_SAMPLE,
        },
        {
          field: "prepSeconds",
          aggregation: "p50",
          alias: "preparo_p50",
          minSample: KITCHEN_CHEF_MIN_SAMPLE,
        },
        {
          field: "prepSeconds",
          aggregation: "p90",
          alias: "preparo_p90",
          minSample: KITCHEN_CHEF_MIN_SAMPLE,
        },
        {
          field: "planLateLines",
          aggregation: "ratio",
          denominator: "plannedLines",
          alias: "taxa_atraso_plano",
          format: "percent",
          minSample: KITCHEN_CHEF_MIN_SAMPLE,
        },
      ],
      // Ordered by volume, not by speed: a suppressed cell sorts as null, so a
      // ranking BY the hidden figure would leak position instead of value.
      sort: [{ by: "linhas", direction: "desc" }],
      limit: 100,
      presentation: { kind: "table" },
    }),
  },
  {
    key: "cozinha-demanda-por-horario",
    title: "Cozinha — demanda por horário",
    description:
      "Quando a demanda CHEGA à cozinha, por hora local — pergunta diferente de quando o trabalho termina.",
    permission: KITCHEN_TIER,
    section: "kitchen",
    supportsGrain: false,
    presentation: "chart",
    build: () => ({
      entity: "kitchen_ticket_items",
      dimensions: [{ field: "demandHourOfDay" }],
      measures: [{ field: "quantity", aggregation: "sum", alias: "quantidade" }],
      sort: [{ by: "demandHourOfDay", direction: "asc" }],
      presentation: { kind: "chart", chartType: "bar" },
    }),
  },
  {
    key: "cozinha-turnos",
    title: "Cozinha — turnos e horas",
    description:
      "Horas de cozinha por estação, recortadas ao período. Turnos encerrados sem produção continuam na conta; turnos fechados pelo sistema aparecem marcados.",
    permission: KITCHEN_TIER,
    section: "kitchen",
    supportsGrain: false,
    presentation: "table",
    build: () => ({
      entity: "kitchen_shifts",
      dimensions: [{ field: "stationName" }],
      measures: [
        { field: "shifts", aggregation: "sum", alias: "turnos" },
        { field: "laborSeconds", aggregation: "sum", alias: "horas" },
        { field: "autoClosedShifts", aggregation: "sum", alias: "fechados_pelo_sistema" },
        { field: "zeroOutputShifts", aggregation: "sum", alias: "turnos_sem_producao" },
        {
          field: "outputLines",
          aggregation: "ratio",
          denominator: "laborHours",
          alias: "linhas_por_hora",
          format: "decimal",
        },
      ],
      sort: [{ by: "horas", direction: "desc" }],
      limit: 200,
      presentation: { kind: "table" },
    }),
  },
];

/**
 * The Cozinha canvas. Reading order matters: the two tempos split apart, then
 * their trend, then the two lateness signals one under the other (so a reader
 * compares them instead of conflating them), then the menu, then the
 * people-side reports, then the labour and the demand curve it has to absorb.
 */
export const KITCHEN_SYSTEM_DASHBOARD: SystemDashboardDef = {
  key: "cozinha",
  title: "Cozinha — análise",
  description:
    "Os relatórios da cozinha no mesmo período: espera e preparo, a evolução no tempo, o atraso contra o plano da cozinha, a promessa feita ao cliente, o tempo por prato, os repasses entre cozinheiros, o ranking individual e as horas de turno.",
  permission: KITCHEN_TIER,
  section: "kitchen",
  // Stated on the CANVAS, not only on each report's own page: these two
  // qualify every figure above, and a reader who never opens a single report
  // would otherwise never meet them.
  notes: [
    "Pedidos e linhas anteriores ao plano da cozinha (FUT-364) não têm prazo previsto nem promessa ao cliente: eles ficam FORA das taxas de atraso e aparecem contados à parte — nunca como pontuais.",
    `Tempos e atrasos são medidas do trabalho de uma pessoa. Qualquer recorte com menos de ${KITCHEN_CHEF_MIN_SAMPLE} linhas elegíveis mostra "—" no lugar do número, mesmo sem nenhuma coluna de cozinheiro no relatório — inclusive recortes de estação, de horário ou de prato que acabem isolando um só cozinheiro. As contagens ao lado continuam visíveis para explicar o traço.`,
  ],
  blocks: [
    { reportKey: "cozinha-tempo-preparo", span: 12 },
    { reportKey: "cozinha-tendencia", span: 12 },
    { reportKey: "cozinha-plano-atraso", span: 12 },
    { reportKey: "cozinha-promessa-cliente", span: 12 },
    { reportKey: "cozinha-por-prato", span: 12 },
    { reportKey: "cozinha-repasses", span: 6 },
    { reportKey: "cozinha-por-cozinheiro", span: 6 },
    { reportKey: "cozinha-turnos", span: 6 },
    { reportKey: "cozinha-demanda-por-horario", span: 6 },
  ],
};
