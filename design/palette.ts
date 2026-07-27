/** (E1) Categorical chart palette — assign in FIXED order, never cyclic.
 *  NEOS series-green leads as slot 2 and is mode-invariant. Colour follows the
 *  entity, not the rank. Use only in charts; never as status colour. */
export const CHART_PALETTE_LIGHT = [
  "#2a78d6", "#009A17", "#e87ba4", "#eda100", "#1baf7a", "#eb6834", "#4a3aa7", "#e34948",
];
export const CHART_PALETTE_DARK = [
  "#3987e5", "#009A17", "#d55181", "#c98500", "#199e70", "#d95926", "#9085e9", "#e66767",
];

/** (E2) Cell-origin semantics → NEOS tokens, ALWAYS paired with an icon/label. */
export type CellOrigin = "input" | "calc" | "link" | "external" | "hardcode";
export const ORIGIN_STYLE: Record<CellOrigin, { color: string; icon: string; title: string }> = {
  input:    { color: "var(--nx-locate)",  icon: "✎", title: "Eingabe (hier tippen)" },
  calc:     { color: "var(--nx-text)",    icon: "",  title: "Berechnung (read-only)" },
  link:     { color: "var(--nx-success)", icon: "↗", title: "Verknüpfung aus anderem Modul" },
  external: { color: "var(--nx-warning)", icon: "⇩", title: "Externer Input / Actuals" },
  hardcode: { color: "var(--nx-warning)", icon: "⚠", title: "Überschriebene Formel (Audit-Flag)" },
};
