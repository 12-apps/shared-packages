/**
 * What the store's clock is called to the person reading the dialog (FUT-776):
 * "Horário Padrão de Brasília", never the IANA id. The host may word it itself
 * (`ReportScheduleSurface.timeZoneLabel`); otherwise the platform's own name for
 * the zone in the pack's language, and the id only when the platform knows none.
 */
export function zoneDisplayName(timeZone: string, locale: string, override?: string): string {
  if (override !== undefined && override !== "") return override;
  try {
    const name = new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: "longGeneric" })
      .formatToParts(new Date())
      .find((part) => part.type === "timeZoneName")?.value;
    return name ?? timeZone;
  } catch {
    return timeZone;
  }
}
