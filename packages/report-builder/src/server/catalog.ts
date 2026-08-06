import { defineCatalog } from "../index";
import { KITCHEN_CHEF_MIN_SAMPLE } from "./adapter-kitchen-source";

/**
 * Future Pay's report field catalog (FUT-133/FUT-138): the semantic model
 * every report spec — built-in preset, admin-built custom report, or
 * LLM-authored over MCP — is validated against. Only fields listed here are
 * queryable; tenant scoping happens in the adapter
 * (`lib/repositories/reports/adapter.ts`), never in specs.
 *
 * Prisma-free by design: the MCP registry imports this module offline
 * (`mcp:generate`), and the catalog is pure data.
 *
 * Conventions:
 * - Money fields are integer centavos (repo-wide convention).
 * - `createdAt`/`occurredAt` bucket by UTC calendar (day/week/month grains).
 * - `hourOfDay` ("00"–"23") and `dayOfWeek` ("1-seg"–"7-dom") are derived in
 *   America/Sao_Paulo so peak-hour analysis matches the merchant's clock.
 */
export const reportCatalog = defineCatalog({
  entities: {
    orders: {
      label: "Pedidos",
      description:
        "Um registro por pedido. Filtre status = PAID para análises de receita; a medida revenueCents soma itens + extras pagos (mesma fórmula do dashboard).",
      fields: {
        id: { label: "Pedido", type: "string", role: "dimension" },
        createdAt: { label: "Data", type: "date", role: "dimension" },
        hourOfDay: {
          label: "Hora do dia",
          type: "string",
          role: "dimension",
          description: "Hora local (America/Sao_Paulo), '00' a '23'.",
        },
        dayOfWeek: {
          label: "Dia da semana",
          type: "string",
          role: "dimension",
          description: "Dia local (America/Sao_Paulo), '1-seg' a '7-dom'.",
        },
        // Closed sets, so a filter on either is PICKED rather than typed
        // (FUT-391). The values mirror the DB CHECK constraints on `orders`, so
        // adding a status to the schema means adding it here too. Labels are
        // display-only — a stored spec always carries the code.
        status: {
          label: "Status",
          type: "string",
          role: "dimension",
          values: [
            { value: "PAID", label: "Pago" },
            { value: "AWAITING_PAYMENT", label: "Aguardando pagamento" },
            { value: "FAILED", label: "Falhou" },
            { value: "EXPIRED", label: "Expirado" },
          ],
        },
        method: {
          label: "Forma de pagamento",
          type: "string",
          role: "dimension",
          values: [
            { value: "PIX", label: "PIX" },
            { value: "CARD", label: "Cartão" },
            { value: "WAITER", label: "Com o garçom" },
          ],
        },
        revenueCents: { label: "Receita", type: "money", role: "measure" },
      },
    },
    order_items: {
      label: "Itens vendidos",
      description: "Linhas de pedidos PAGOS (somente vendas concretizadas).",
      fields: {
        id: { label: "Linha", type: "string", role: "dimension" },
        createdAt: { label: "Data", type: "date", role: "dimension" },
        productName: { label: "Produto", type: "string", role: "dimension" },
        categoryName: { label: "Categoria", type: "string", role: "dimension" },
        quantity: { label: "Quantidade", type: "number", role: "measure" },
        revenueCents: { label: "Receita", type: "money", role: "measure" },
        costCents: { label: "Custo (CMV)", type: "money", role: "measure" },
      },
    },
    payments: {
      label: "Pagamentos",
      description: "Cobranças por pedido. Filtre status = PAID para receita liquidada.",
      fields: {
        id: { label: "Pagamento", type: "string", role: "dimension" },
        createdAt: { label: "Data", type: "date", role: "dimension" },
        // A payment's sets are NOT the order's: no WAITER method (a charge is
        // only ever online) and a four-state lifecycle of its own. Sharing one
        // list between the two would offer filters that match nothing.
        method: {
          label: "Forma de pagamento",
          type: "string",
          role: "dimension",
          values: [
            { value: "PIX", label: "PIX" },
            { value: "CARD", label: "Cartão" },
          ],
        },
        status: {
          label: "Status",
          type: "string",
          role: "dimension",
          values: [
            { value: "PAID", label: "Pago" },
            { value: "AUTHORIZED", label: "Autorizado" },
            { value: "PENDING", label: "Pendente" },
            { value: "DECLINED", label: "Recusado" },
          ],
        },
        amountCents: { label: "Valor", type: "money", role: "measure" },
      },
    },
    stock_movements: {
      label: "Movimentações de estoque",
      description: "Ledger de estoque (movimentos cancelados são excluídos).",
      fields: {
        id: { label: "Movimentação", type: "string", role: "dimension" },
        createdAt: { label: "Data", type: "date", role: "dimension" },
        type: { label: "Tipo", type: "string", role: "dimension" },
        itemName: { label: "Insumo", type: "string", role: "dimension" },
        fromLocationName: { label: "Local de origem", type: "string", role: "dimension" },
        toLocationName: { label: "Local de destino", type: "string", role: "dimension" },
        quantityDelta: { label: "Quantidade (delta)", type: "number", role: "measure" },
        costCents: { label: "Custo", type: "money", role: "measure" },
      },
    },
    loss_events: {
      label: "Perdas",
      description:
        "Baixas de estoque atribuídas a um motivo de perda, lidas do ledger. " +
        "Exclui movimentos cancelados e motivos do eixo GAIN (uma sobra encontrada não é perda). " +
        "Baixas negativas SEM motivo atribuído — conciliação, estoque inicial — ficam de fora.",
      fields: {
        id: { label: "Perda", type: "string", role: "dimension" },
        occurredAt: { label: "Data", type: "date", role: "dimension" },
        reasonName: { label: "Motivo", type: "string", role: "dimension" },
        itemName: { label: "Insumo", type: "string", role: "dimension" },
        quantity: { label: "Quantidade perdida", type: "number", role: "measure" },
        lossValueCents: { label: "Valor perdido", type: "money", role: "measure" },
      },
    },
    kitchen_ticket_items: {
      label: "Cozinha — linhas",
      description:
        "Uma linha de cozinha CONCLUÍDA (item de comanda), no período em que ficou pronta. Linhas do garçom, linhas antigas sem rota e linhas canceladas ficam de fora. Medidas 'plan…' comparam a linha com o PLANO DA COZINHA; medidas 'ticket…' comparam o PEDIDO com a promessa feita ao cliente — são sinais diferentes e não devem ser somados. Medidas de tempo e de atraso são individuais por natureza: qualquer recorte com menos de " +
        `${KITCHEN_CHEF_MIN_SAMPLE} linhas elegíveis não exibe esses números, mesmo sem nenhuma coluna de cozinheiro no relatório.`,
      fields: {
        // No `id`: a surrogate key is not an analytical grouping, and grouping
        // by it turns every per-line timing into a single person's figure
        // (FUT-454). The other entities keep theirs — an order id names an
        // order, not a cook.
        readyAt: {
          label: "Conclusão",
          type: "date",
          role: "dimension",
          description: "Quando a linha ficou pronta — o eixo do período.",
        },
        sentAt: {
          label: "Envio do pedido",
          type: "date",
          role: "dimension",
          description: "Quando a demanda chegou à cozinha. Pergunta diferente da conclusão.",
        },
        completionHourOfDay: {
          label: "Hora da conclusão",
          type: "string",
          role: "dimension",
          description: "Hora local (America/Sao_Paulo) em que a linha ficou pronta.",
        },
        completionDayOfWeek: {
          label: "Dia da conclusão",
          type: "string",
          role: "dimension",
          description: "Dia local (America/Sao_Paulo), '1-seg' a '7-dom'.",
        },
        demandHourOfDay: {
          label: "Hora da demanda",
          type: "string",
          role: "dimension",
          description: "Hora local em que o pedido foi enviado — quando a demanda chegou.",
        },
        demandDayOfWeek: {
          label: "Dia da demanda",
          type: "string",
          role: "dimension",
          description: "Dia local do envio do pedido, '1-seg' a '7-dom'.",
        },
        stationName: { label: "Estação", type: "string", role: "dimension" },
        productName: { label: "Produto", type: "string", role: "dimension" },
        attribution: {
          label: "Atribuição",
          type: "string",
          role: "dimension",
          description:
            "'Individual' (mesmo cozinheiro iniciou e finalizou), 'Repasse' (cozinheiros diferentes) ou 'Sem atribuição' (linha antiga ou sem registro de quem trabalhou).",
        },
        chefId: {
          label: "Cozinheiro (id)",
          type: "string",
          role: "dimension",
          minGroupSample: KITCHEN_CHEF_MIN_SAMPLE,
          description:
            "Só preenchido em linhas 'Individual'. Repasses e linhas sem atribuição ficam fora de qualquer ranking individual.",
        },
        chefName: {
          label: "Cozinheiro",
          type: "string",
          role: "dimension",
          minGroupSample: KITCHEN_CHEF_MIN_SAMPLE,
          description:
            "Só preenchido em linhas 'Individual'. Agrupar por este campo exige minSample em todas as medidas.",
        },
        lines: { label: "Linhas", type: "number", role: "measure" },
        quantity: {
          label: "Quantidade produzida",
          type: "number",
          role: "measure",
          description: "A quantidade pesa na produção; NÃO pesa nos tempos.",
        },
        waitSeconds: {
          label: "Espera na fila",
          type: "number",
          role: "measure",
          format: "duration",
          identityMinSample: KITCHEN_CHEF_MIN_SAMPLE,
          description:
            "Do envio do pedido ao INÍCIO do preparo — a fila, não o cozinheiro. Espera longa aponta falta de gente na praça; preparo longo aponta o prato ou a pessoa. São perguntas separadas e não devem ser somadas. Vazio quando ninguém registrou o início.",
        },
        prepSeconds: {
          label: "Tempo de preparo",
          type: "number",
          role: "measure",
          format: "duration",
          identityMinSample: KITCHEN_CHEF_MIN_SAMPLE,
          description:
            "Do início ao prato pronto — o tempo do COZINHEIRO, sem a fila. Uma linha é UMA observação, qualquer que seja a quantidade. Vazio quando ninguém registrou o início.",
        },
        plannedPrepSeconds: {
          label: "Tempo previsto no plano",
          type: "number",
          role: "measure",
          format: "duration",
          description:
            "O previsto pelo plano da cozinha (do disparo ao prato) — configuração do cardápio, não trabalho medido de ninguém.",
        },
        planPlateLatenessSeconds: {
          label: "Atraso do plano — prato",
          type: "number",
          role: "measure",
          format: "duration",
          identityMinSample: KITCHEN_CHEF_MIN_SAMPLE,
          description:
            "Pronto menos previsto pelo plano da cozinha (negativo = adiantado). Vazio em linhas sem plano.",
        },
        planFireLatenessSeconds: {
          label: "Atraso do plano — início",
          type: "number",
          role: "measure",
          format: "duration",
          identityMinSample: KITCHEN_CHEF_MIN_SAMPLE,
          description: "Início real menos início previsto — o sinal de 'a praça ficou para trás'.",
        },
        plannedLines: {
          label: "Linhas com plano",
          type: "number",
          role: "measure",
          description:
            "Denominador das taxas de plano. Linhas anteriores ao FUT-364 não têm plano e saem da conta — nunca contam como pontuais.",
        },
        planLateLines: {
          label: "Linhas atrasadas no plano",
          type: "number",
          role: "measure",
          identityMinSample: KITCHEN_CHEF_MIN_SAMPLE,
          description:
            "Numerador da taxa de atraso. Um veredito sobre como o trabalho saiu, então segue a mesma regra de amostra das medidas de tempo.",
        },
        unplannedLines: { label: "Linhas sem plano", type: "number", role: "measure" },
        attributedLines: {
          label: "Linhas com autoria",
          type: "number",
          role: "measure",
          description: "Início e fim registrados. Denominador da taxa de repasses.",
        },
        soloLines: { label: "Linhas individuais", type: "number", role: "measure" },
        handoffLines: {
          label: "Linhas em repasse",
          type: "number",
          role: "measure",
          description: "Um cozinheiro iniciou, outro finalizou. Sinal operacional, não descarte.",
        },
        unattributedLines: { label: "Linhas sem autoria", type: "number", role: "measure" },
        ticketsCompleted: {
          label: "Pedidos atendidos",
          type: "number",
          role: "measure",
          description: "Contagem por PEDIDO (não por linha) — denominador das medidas de promessa.",
        },
        ticketsPromised: {
          label: "Pedidos com promessa",
          type: "number",
          role: "measure",
          description: "Pedidos com prazo prometido E entregues. Histórico sem promessa fica fora.",
        },
        ticketsPromiseBroken: {
          label: "Promessas quebradas",
          type: "number",
          role: "measure",
          identityMinSample: KITCHEN_CHEF_MIN_SAMPLE,
          description:
            "Numerador da taxa de promessa quebrada — mesmo tratamento de amostra das demais medidas de atraso.",
        },
        ticketsUnquoted: {
          label: "Pedidos sem promessa",
          type: "number",
          role: "measure",
          description: "Enviados antes de a cozinha passar a prometer prazo. Nunca contam como pontuais.",
        },
        ticketPromiseLatenessSeconds: {
          label: "Atraso da promessa ao cliente",
          type: "number",
          role: "measure",
          format: "duration",
          identityMinSample: KITCHEN_CHEF_MIN_SAMPLE,
          description:
            "Entrega menos prazo prometido, por PEDIDO (negativo = adiantado). Não confundir com o atraso do plano da cozinha.",
        },
      },
    },
    kitchen_shifts: {
      label: "Cozinha — turnos",
      description:
        "Turnos de cozinha que cruzam o período. Turnos fechados SEM produção continuam na conta de horas: quem não produziu ainda custou a hora. Horas são recortadas ao período e turnos fechados pelo sistema ficam marcados. Um turno é de UMA pessoa, então não há como agrupar por turno — só por estação, data e forma de encerramento.",
      fields: {
        // No `id`: one shift is one cook, and the surrogate key joins straight
        // back to the person, so grouping by it turns every shift measure into
        // a named individual's hours and output (FUT-454).
        startedAt: { label: "Início", type: "date", role: "dimension" },
        stationName: { label: "Estação", type: "string", role: "dimension" },
        endedReason: {
          label: "Encerramento",
          type: "string",
          role: "dimension",
          description: "'Cozinheiro', 'Supervisor', 'Automático' ou 'Em aberto'.",
        },
        autoClosed: {
          label: "Fechado pelo sistema",
          type: "boolean",
          role: "dimension",
          description:
            "Um fechamento automático de 16h não é um turno de 16h — a marcação existe para o leitor saber.",
        },
        closed: { label: "Encerrado", type: "boolean", role: "dimension" },
        shifts: { label: "Turnos", type: "number", role: "measure" },
        closedShifts: { label: "Turnos encerrados", type: "number", role: "measure" },
        autoClosedShifts: { label: "Turnos fechados pelo sistema", type: "number", role: "measure" },
        zeroOutputShifts: {
          label: "Turnos sem produção",
          type: "number",
          role: "measure",
          description: "Turnos encerrados sem nenhuma linha atribuída. Turnos em aberto ficam fora.",
        },
        laborSeconds: {
          label: "Horas trabalhadas",
          type: "number",
          role: "measure",
          format: "duration",
          description: "Recortadas ao período do relatório.",
        },
        laborHours: {
          label: "Horas trabalhadas (decimal)",
          type: "number",
          role: "measure",
          description: "As mesmas horas em decimal — o divisor de 'linhas por hora'.",
        },
        outputLines: {
          label: "Linhas produzidas",
          type: "number",
          role: "measure",
          description:
            "Linhas de cozinha que o turno abriu — mesmo recorte dos demais blocos (rota COZINHA, não canceladas), inclusive as concluídas depois do fim do período: elas pertencem ao turno, não à janela.",
        },
        outputQuantity: { label: "Quantidade produzida", type: "number", role: "measure" },
      },
    },
  },
});

/** The date field the adapter windows each entity on. */
export const REPORT_ENTITY_DATE_FIELD: Record<string, string> = {
  orders: "createdAt",
  order_items: "createdAt",
  payments: "createdAt",
  stock_movements: "createdAt",
  // The one entity whose window column differs from its catalog field name
  // (FUT-654): losses are read off the LEDGER, so the window applies on
  // `stock_movements.createdAt`, while the entity keeps exposing the instant as
  // `occurredAt` on the wire — renaming it would break every saved report that
  // already groups by it.
  loss_events: "createdAt",
  // Completion, not creation: a cozinha line belongs to the period in which the
  // work FINISHED. `sentAt` rides along as its own dimension because "when did
  // the demand arrive" is a different question, not a different window.
  kitchen_ticket_items: "readyAt",
  kitchen_shifts: "startedAt",
};
