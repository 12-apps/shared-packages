import type { ReportScheduleCopy } from "./schedule-copy";

/** The pt-BR words of the delivery section of "Ajustes do relatório" (FUT-776). */
const WEEKDAYS = [
  "Domingo",
  "Segunda-feira",
  "Terça-feira",
  "Quarta-feira",
  "Quinta-feira",
  "Sexta-feira",
  "Sábado",
] as const;

/** "toda segunda", "todo sábado": the weekday as a recurrence. */
const EVERY = ["todo domingo", "toda segunda", "toda terça", "toda quarta", "toda quinta", "toda sexta", "todo sábado"] as const;

function hour(time: string): string {
  const [hh = "0", mm = "00"] = time.split(":");
  return mm === "00" ? `${Number(hh)}h` : `${Number(hh)}h${mm}`;
}

export const PT_BR_REPORT_SCHEDULE_COPY: ReportScheduleCopy = {
  label: "Envio automático",
  summary: ({ cadence, weekday, dayOfMonth, time }) => {
    const at = hour(time);
    if (cadence === "daily") return `Enviar por e-mail todo dia, ${at}`;
    if (cadence === "monthly") return `Enviar por e-mail todo dia ${dayOfMonth}, ${at}`;
    const when = EVERY[weekday] ?? "";
    return cadence === "weekly"
      ? `Enviar por e-mail ${when}, ${at}`
      : `Enviar por e-mail ${when}, a cada 2 semanas, ${at}`;
  },
  frequencyLabel: "Frequência",
  cadences: { daily: "Diária", weekly: "Semanal", biweekly: "Quinzenal", monthly: "Mensal" },
  weekdayLabel: "Dia da semana",
  weekdays: WEEKDAYS,
  dayOfMonthLabel: "Dia do mês",
  dayOfMonthOption: (day) => `Dia ${day}`,
  monthEndNote: "Em meses mais curtos, vai no último dia do mês.",
  timeLabel: "Horário",
  recipientsLabel: "Quem recebe",
  recipientsLoading: "Carregando as pessoas da loja…",
  recipientsFailed: "Não foi possível carregar as pessoas da loja.",
  recipientsEmpty: "Nenhuma pessoa da loja para escolher.",
  needsRecipient: "Escolha quem recebe o envio automático, ou desligue o envio.",
  retry: "Tentar de novo",
  zoneNote: (zoneName) =>
    `Horário de ${zoneName} (fuso da loja). Só recebe quem tem acesso às informações deste relatório.`,
};
