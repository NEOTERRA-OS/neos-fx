/* ==========================================================================
 * ANBAU-ADVISOR — agronomisches Regelwerk (deterministischer Experten-Kern).
 *  Bewertet den Anbauplan gegen verifizierte Agronomie (Fruchtfolge, Wasser,
 *  Nährstoffe, Markt, Standort, Arbeitsspitzen, Ökonomie) und liefert:
 *   · Rationale (warum die Struktur trägt) und
 *   · dynamische Hinweise/Risiken bei Änderungen der Flächenanteile.
 *  Quelle der Schwellen: NEOS-FX-Agronomie-* (Deep-Research, [V]-verifiziert),
 *  RO-Standort Süd-Dolj/Oltenien (Chernozem, ~550 mm, heiße Sommer).
 *  Bewusst deterministisch/erklärbar (investor-grade) — die optionale LLM-Schicht
 *  setzt hierauf auf (siehe Architektur-Notiz). Alle Anteile als Dezimalbruch.
 * ======================================================================== */
import type { Domain, StandortProfil } from "./model";
import { CROP_NAME, VALUE_CROP_IDS, deriveContribution, deriveCropAreasMY } from "./model";

/** Konstanten-Profil einer Assumption lesen (Advisor läuft ohne Szenario-Auflösung). */
function readConst(domain: Domain, key: string, fallback: number): number {
  const a = domain.assumptions[key];
  const p = a?.scenarioProfiles?.[domain.baseScenarioId];
  return p && p.kind === "constant" ? (p as any).value : fallback;
}

const DEFAULT_SITE: StandortProfil = { name: "Standort", rainfallMm: 550, soil: "chernozem", summerHeat: "hoch" };

export type AdviceSeverity = "info" | "advice" | "warning" | "risk";
export type AdviceCategory =
  | "Fruchtfolge" | "Wasser & Beregnung" | "Nährstoffe" | "Markt & Preis"
  | "Standort" | "Arbeit & Maschinen" | "Ökonomie";
export type AdviceItem = {
  id: string;
  category: AdviceCategory;
  severity: AdviceSeverity;
  title: string;
  detail: string;
  metric?: string;
};

/** Agronomisches Kulturprofil — treibt die Regeln; je Standort/Betrieb konfigurierbar. */
type AgroProfile = {
  irrigated: boolean;        // beregnungspflichtig (Wertkultur/Sommerung)
  hostGroup?: string;        // Fruchtfolge-Wirtsgruppe (gemeinsame Anbaupause)
  maxShare: number;          // max. Flächenanteil aus Fruchtfolge-/Krankheitssicht
  breakYears: number;        // Mindest-Anbaupause (Jahre)
  waterMm: [number, number]; // Saison-Wasserbedarf (mm)
  nKg: number;               // N-Bedarf kg/ha (0 = Leguminose, N-Fixierung)
  legume?: boolean;
  market: "contract" | "commodity";
  peak: ("fruehjahr" | "sommer" | "herbst")[]; // Arbeits-/Erntespitzen
};

/** Wirtsgruppen: Kartoffel Pommes + Chips teilen dieselbe Anbaupause (Nematoden/Bodenmüdigkeit). */
export const AGRO: Record<string, AgroProfile> = {
  tomate:           { irrigated: true, hostGroup: "solanaceae_tomate", maxShare: 0.25, breakYears: 3, waterMm: [550, 700], nKg: 180, market: "contract", peak: ["fruehjahr", "sommer", "herbst"] },
  kartoffel_pommes: { irrigated: true, hostGroup: "kartoffel", maxShare: 0.25, breakYears: 4, waterMm: [500, 700], nKg: 180, market: "contract", peak: ["fruehjahr", "herbst"] },
  kartoffel_chips:  { irrigated: true, hostGroup: "kartoffel", maxShare: 0.25, breakYears: 4, waterMm: [500, 700], nKg: 180, market: "contract", peak: ["fruehjahr", "herbst"] },
  zwiebel_moehre:   { irrigated: true, hostGroup: "zwiebel_moehre", maxShare: 0.20, breakYears: 4, waterMm: [350, 550], nKg: 90, market: "contract", peak: ["fruehjahr", "herbst"] },
  mais:             { irrigated: true, hostGroup: "mais", maxShare: 0.40, breakYears: 1, waterMm: [500, 700], nKg: 200, market: "commodity", peak: ["fruehjahr", "herbst"] },
  soja_luzerne:     { irrigated: true, hostGroup: "leguminose", maxShare: 0.35, breakYears: 2, waterMm: [450, 600], nKg: 0, legume: true, market: "commodity", peak: ["fruehjahr", "herbst"] },
  weizen:           { irrigated: false, hostGroup: "getreide", maxShare: 0.50, breakYears: 1, waterMm: [450, 550], nKg: 200, market: "commodity", peak: ["sommer"] },
  gerste_zw:        { irrigated: false, hostGroup: "getreide", maxShare: 0.40, breakYears: 1, waterMm: [400, 500], nKg: 170, market: "commodity", peak: ["sommer"] },
  winterraps:       { irrigated: false, hostGroup: "raps", maxShare: 0.25, breakYears: 4, waterMm: [400, 500], nKg: 200, market: "commodity", peak: ["sommer"] },
  // Trockenrotation (rain-fed) — eigene Pool-Kandidaten. Getreide teilt sich die Anbaupause;
  //  Raps & Sonnenblume sind beide Sclerotinia-Wirte → je ≤ 25 %, lange Pause (4 J.).
  weizen_dry:       { irrigated: false, hostGroup: "getreide", maxShare: 0.50, breakYears: 1, waterMm: [400, 500], nKg: 130, market: "commodity", peak: ["sommer"] },
  gerste_dry:       { irrigated: false, hostGroup: "getreide", maxShare: 0.40, breakYears: 1, waterMm: [350, 450], nKg: 110, market: "commodity", peak: ["sommer"] },
  raps_dry:         { irrigated: false, hostGroup: "raps", maxShare: 0.25, breakYears: 4, waterMm: [350, 450], nKg: 130, market: "commodity", peak: ["sommer"] },
  sonnenblume:      { irrigated: false, hostGroup: "sonnenblume", maxShare: 0.25, breakYears: 4, waterMm: [400, 500], nKg: 60, market: "commodity", peak: ["herbst"] },
};

const pct = (x: number) => `${Math.round(x * 1000) / 10} %`;
const nameOf = (id: string) => (CROP_NAME as Record<string, string>)[id] ?? id;

/** Kernbewertung: Anteile aus dem Anbauplan → agronomische Advice-Items. */
export function deriveAnbauAdvice(domain: Domain): AdviceItem[] {
  const site = domain.standort ?? DEFAULT_SITE;
  const plan = domain.anbauplan ?? [];
  const total = plan.reduce((s, e) => s + e.areaHa, 0) || 1;
  const areaOf = (id: string) => plan.filter((e) => e.cropId === id).reduce((s, e) => s + e.areaHa, 0);
  const shareOf = (id: string) => areaOf(id) / total;
  // Wirtsgruppen-Anteile (Anbaupause gilt je Gruppe, nicht je Einzelkultur).
  const groupShare = new Map<string, number>();
  for (const e of plan) {
    const g = AGRO[e.cropId]?.hostGroup;
    if (g) groupShare.set(g, (groupShare.get(g) ?? 0) + e.areaHa / total);
  }
  const valueShare = plan.filter((e) => VALUE_CROP_IDS.includes(e.cropId)).reduce((s, e) => s + e.areaHa / total, 0);
  const hasLegume = plan.some((e) => AGRO[e.cropId]?.legume && e.areaHa > 0);
  const items: AdviceItem[] = [];
  const push = (i: AdviceItem) => items.push(i);

  /* ---- Fruchtfolge / Rotation ------------------------------------------ */
  const grpLabel: Record<string, string> = { kartoffel: "Kartoffel", zwiebel_moehre: "Zwiebel/Möhre", raps: "Raps", solanaceae_tomate: "Tomate", getreide: "Getreide", mais: "Mais", leguminose: "Leguminosen" };
  for (const [g, sh] of groupShare) {
    const prof = Object.values(AGRO).find((p) => p.hostGroup === g);
    if (!prof) continue;
    const maxByBreak = 1 / prof.breakYears; // aus Anbaupause abgeleitete Obergrenze (1/n-Feld-Rotation)
    const limit = Math.min(prof.maxShare, maxByBreak);
    if (sh > limit + 1e-6) {
      push({ id: `rot-${g}`, category: "Fruchtfolge", severity: sh > limit * 1.5 ? "risk" : "warning",
        title: `${grpLabel[g] ?? g}-Anteil zu hoch für die Anbaupause`,
        detail: `${grpLabel[g] ?? g} braucht ~${prof.breakYears} Jahre Anbaupause (≤ ${pct(limit)} der Fläche). Aktuell ${pct(sh)} → erhöhtes Risiko für Nematoden/bodenbürtige Krankheiten (z. B. ${g === "kartoffel" ? "Kartoffelzystennematoden, Rhizoctonia" : g === "raps" ? "Sclerotinia, Kohlhernie" : g === "zwiebel_moehre" ? "Sclerotinia/Fusarium" : "Bodenmüdigkeit"}). Anteil senken oder Fruchtfolge weiten.`,
        metric: `${pct(sh)} / max ${pct(limit)}` });
    }
  }
  if (hasLegume) {
    const lg = groupShare.get("leguminose") ?? 0;
    push({ id: "rot-legume", category: "Fruchtfolge", severity: "info",
      title: "Leguminose als Fruchtfolgeglied vorhanden",
      detail: `Soja/Luzerne (${pct(lg)}) fixiert Luftstickstoff (~30–60 kg N/ha Vorfruchtwert), lockert die Fruchtfolge auf und mindert bodenbürtige Getreide-/Rapskrankheiten. Gute Vorfrucht für Weizen.` });
  } else {
    push({ id: "rot-nolegume", category: "Fruchtfolge", severity: "advice",
      title: "Keine Leguminose in der Rotation",
      detail: "Ohne Soja/Luzerne fehlen N-Fixierung und Auflockerung. Ein Leguminosen-Slot senkt N-Zukauf und Krankheitsdruck der Halmfrüchte." });
  }

  /* ---- Wasser & Beregnung ---------------------------------------------- */
  const irrArea = plan.filter((e) => AGRO[e.cropId]?.irrigated).reduce((s, e) => s + e.areaHa, 0);
  const irrShare = irrArea / total;
  // Gewichteter Saison-Wasserbedarf (Mittel der Bänder).
  const wMean = plan.reduce((s, e) => { const p = AGRO[e.cropId]; return p ? s + e.areaHa * (p.waterMm[0] + p.waterMm[1]) / 2 : s; }, 0) / total;
  const overRain = wMean > site.rainfallMm;
  push({ id: "water-demand", category: "Wasser & Beregnung", severity: overRain ? "warning" : "info",
    title: `Flächengewichteter Wasserbedarf ~${Math.round(wMean)} mm/Saison`,
    detail: `Standort ~${site.rainfallMm} mm Niederschlag → die beregnungspflichtigen Kulturen (${pct(irrShare)} der Fläche) tragen die Pivot-/Fertigations-Last. ${overRain ? `Über dem Standort-Dargebot (~${site.rainfallMm} mm): Pivot-Kapazität, Pumpleistung und Wasserrecht müssen den Spitzenbedarf (Hochsommer) decken.` : "Im Rahmen — Defizitbewässerung in vegetativen Phasen möglich (WNE-Gewinn)."}`,
    metric: `${Math.round(wMean)} / ${site.rainfallMm} mm` });
  // Simultan-Peak Hochsommer: Kartoffel-Knollenfüllung + Mais-Blüte + Tomate.
  const sommerIrr = plan.filter((e) => ["kartoffel_pommes", "kartoffel_chips", "mais", "tomate"].includes(e.cropId)).reduce((s, e) => s + e.areaHa, 0) / total;
  const heavySoil = site.soil === "chernozem" || site.soil === "ton" || site.soil === "lehm";
  if (sommerIrr > 0.5) push({ id: "water-peak", category: "Wasser & Beregnung", severity: site.summerHeat === "hoch" ? "warning" : "advice",
    title: "Hoher Simultan-Wasserpeak im Hochsommer",
    detail: `Kartoffel-Knollenfüllung, Mais-Blüte und Tomate haben zeitgleich den kritischen Wasserbedarf (${pct(sommerIrr)} der Fläche)${site.summerHeat === "hoch" ? " — bei hohem Sommer-Trockenstress besonders kritisch" : ""}. ${heavySoil ? `Auf ${site.soil === "chernozem" ? "schweren Chernozem-" : site.soil === "ton" ? "Ton-" : "Lehm-"}Böden Gaben < 12 mm gegen Runoff` : "Auf leichten Böden häufigere, kleinere Gaben (geringes Wasserhaltevermögen)"} — die Pivot-Rundenzeit muss den Spitzenbedarf packen, sonst Ertragsstress.` });

  /* ---- Nährstoffe ------------------------------------------------------- */
  if (areaOf("zwiebel_moehre") > 0) push({ id: "nutri-onion-k", category: "Nährstoffe", severity: "advice",
    title: "Zwiebel/Möhre-Kalium prüfen",
    detail: "Verifizierter K-Bedarf Zwiebel liegt bei ~45–80 kg K/ha (FAO) — falls im Modell höher angesetzt, Überdüngung/Kosten. Möhre-Kaliber profitiert von ausgewogenem K, nicht von Überschuss." });
  const highN = plan.filter((e) => (AGRO[e.cropId]?.nKg ?? 0) >= 180).reduce((s, e) => s + e.areaHa, 0) / total;
  push({ id: "nutri-n", category: "Nährstoffe", severity: highN > 0.6 ? "warning" : "info",
    title: `N-intensive Kulturen: ${pct(highN)} der Fläche`,
    detail: `${highN > 0.6 ? "Hoher" : "Moderater"} N-Bedarf (Weizen/Mais/Kartoffel/Tomate ~180–200 kg N/ha). Fertigation über den Pivot (bedarfsgerechte Splits nahe Spitzenbedarf) senkt Auswaschung; Leguminosen-Vorfrucht rechnet N-Zukauf herunter.` });

  /* ---- Absatz & Verarbeitungskapazität (über den Ramp) ------------------- */
  {
    const my = deriveCropAreasMY(domain);
    const last = my.years - 1;
    // Tomate: Endausbau-Tonnage vs. kontrahierte Werkskapazität.
    const tomHa = my.areas["tomate"]?.[last] ?? 0;
    if (tomHa > 0) {
      const tomYield = readConst(domain, "yield.tomate", 88);
      const tomT = tomHa * tomYield;
      const capT = readConst(domain, "market.tomate_cap_t", 150000);
      push({ id: "market-tomcap", category: "Markt & Preis", severity: tomT > capT ? "risk" : "info",
        title: tomT > capT ? "Tomaten-Menge übersteigt Werkskapazität" : "Tomaten-Menge passt zur Werkskapazität",
        detail: `Endausbau ${Math.round(tomHa).toLocaleString("de-DE")} ha × ${tomYield} t/ha ≈ ${Math.round(tomT).toLocaleString("de-DE")} t/Kampagne vs. kontrahierte Kapazität ${Math.round(capT).toLocaleString("de-DE")} t (mittelgroßes EU-Werk ≈ 100–250 kt). ${tomT > capT ? "Kein Werk kann das abnehmen — Tomatenfläche fixieren/deckeln (cropPolicy fix) oder zweiten Abnehmer kontrahieren." : "Fläche ist über die Kultur-Politik fixiert — skaliert bewusst NICHT mit dem Flächen-Ramp."}`,
        metric: `${Math.round(tomT / 1000)} kt / ${Math.round(capT / 1000)} kt` });
    }
    // Kartoffel: Ramp-Pfad unter der Anbaupause-Grenze (Absatz gesichert, PRIO 1).
    const kart = (y: number) => (my.areas["kartoffel_pommes"]?.[y] ?? 0) + (my.areas["kartoffel_chips"]?.[y] ?? 0);
    const target = (domain.cropPolicy?.kartoffel_pommes?.targetHa ?? 0) + (domain.cropPolicy?.kartoffel_chips?.targetHa ?? 0);
    if (target > 0) {
      let reachYear = -1;
      for (let y = 0; y < my.years; y++) if (kart(y) >= target - 1) { reachYear = y; break; }
      const maxShare = Math.max(...Array.from({ length: my.years }, (_, y) => my.irrHa[y] > 0 ? kart(y) / my.irrHa[y] : 0));
      push({ id: "market-kartramp", category: "Markt & Preis", severity: "info",
        title: `Kartoffel-Ramp: ${Math.round(kart(0)).toLocaleString("de-DE")} → ${Math.round(target).toLocaleString("de-DE")} ha (PRIO 1, Absatz gesichert)`,
        detail: `Skaliert schnellstmöglich unter der 4-Jahres-Anbaupause (≤ 25 % der beregneten Fläche): ${Array.from({ length: Math.min(my.years, 5) }, (_, y) => Math.round(kart(y)).toLocaleString("de-DE")).join(" → ")} ha${reachYear >= 0 ? `; Ziel erreicht in Jahr ${reachYear + 1}` : "; Ziel im Horizont nicht erreicht (beregnete Fläche limitiert)"}. Max. Rotationsanteil ${pct(maxShare)} — Fruchtfolge bleibt gesund.`,
        metric: reachYear >= 0 ? `Ziel in J${reachYear + 1}` : "limitiert" });
    }
  }

  /* ---- Markt & Preis ---------------------------------------------------- */
  const contractShare = plan.filter((e) => AGRO[e.cropId]?.market === "contract").reduce((s, e) => s + e.areaHa / total, 0);
  push({ id: "market-contract", category: "Markt & Preis", severity: contractShare > 0.5 ? "warning" : "info",
    title: `Kontrakt-/Abnehmerabhängige Kulturen: ${pct(contractShare)}`,
    detail: `Wertkulturen (Tomate → Verarbeiter, Kartoffel → Pommes/Chips-Werk) laufen über Verträge — hohe Marge, aber Gegenpartei-/Mengenrisiko. ${contractShare > 0.5 ? "Klumpenrisiko: Vertragsvolumina, Preisformeln und Ausfallszenarien absichern; Commodity-Anteil (Getreide) als liquider Puffer sinnvoll." : "Ausgewogen durch liquide Commodity-Märkte (Getreide/Raps/Soja) als Preis-Hedge."}`,
    metric: pct(contractShare) });

  /* ---- Standort (Süd-Dolj) --------------------------------------------- */
  const soilLabel = { chernozem: "tiefgründiger Chernozem", lehm: "Lehmboden", sand: "leichter Sandboden", ton: "schwerer Tonboden" }[site.soil];
  push({ id: "site-fit", category: "Standort", severity: "info",
    title: `Standort-Fit ${site.name} (${soilLabel}, ~${site.rainfallMm} mm)`,
    detail: `Beregnete Wertkulturen + Trockenrotation nutzen den Standort komplementär: ${soilLabel} trägt ${site.soil === "sand" ? "unter Pivot Ertrag, braucht aber häufige kleine Gaben" : "Hochertrag unter Pivot"}; die ${site.summerHeat === "hoch" ? "trockene, heiße" : site.summerHeat === "mittel" ? "mäßig trockene" : "gemäßigte"} Sommerwitterung ist ohne Beregnung ${site.summerHeat === "gering" ? "auch für Sommerungen tragbar" : "nur für Halmfrüchte/Raps sicher"}. Frühsaat-Fenster (Weizen: Termin schlägt Dichte; Mais: Bodentemperatur-Trigger) ${site.summerHeat === "hoch" ? "am wärmeren Ende früher" : "standortgemäß"} ansetzen.` });

  /* ---- Arbeit & Maschinen ---------------------------------------------- */
  const herbstIntensiv = plan.filter((e) => (AGRO[e.cropId]?.peak ?? []).includes("herbst") && AGRO[e.cropId]?.irrigated).reduce((s, e) => s + e.areaHa, 0) / total;
  if (herbstIntensiv > 0.45) push({ id: "labor-autumn", category: "Arbeit & Maschinen", severity: "warning",
    title: "Herbst-Erntepeak ist der engste Flaschenhals",
    detail: `Kartoffel-, Zwiebel/Möhre-, Tomaten- und Maisernte fallen im Herbst zusammen (${pct(herbstIntensiv)} der Fläche). Wurzelernte-Fenster ist auslastungskritisch → Ernter-Staffelung (Sorten/Reife, 2-Schicht) und Transport-/Lagerkette müssen die Spitze tragen, sonst Qualitäts-/Ertragsverluste.` });

  /* ---- Ökonomie --------------------------------------------------------- */
  push({ id: "eco-mix", category: "Ökonomie", severity: valueShare > 0.6 ? "warning" : "info",
    title: `Wertkultur-Anteil ${pct(valueShare)} — Ertrag vs. Risiko`,
    detail: `Wertkulturen bringen den DB-Hebel, aber hohe Vorleistungen (Pflanzgut, PSM 16 Überfahrten, Ernte-/Lagertechnik) und Marktrisiko. ${valueShare > 0.6 ? "Sehr wertkultur-lastig → Kapitalbindung und Risiko hoch; Getreide/Raps stabilisieren Cashflow und Fruchtfolge." : "Ausgewogene Mischung: Wertkulturen als Ertragsmotor, Halmfrüchte als Stabilisator und Fruchtfolgeglied."}`,
    metric: pct(valueShare) });

  return items;
}

/** Kurz-Score für die Kopfzeile: Anzahl je Severity. */
export function adviceSummary(items: AdviceItem[]) {
  const by = (s: AdviceSeverity) => items.filter((i) => i.severity === s).length;
  return { info: by("info"), advice: by("advice"), warning: by("warning"), risk: by("risk"), total: items.length };
}

/** Composite-Score eines Plans — Grundlage für den What-if-Vergleich. */
export function scoreAnbau(domain: Domain, scenarioId: string) {
  const items = deriveAnbauAdvice(domain);
  const w: Record<AdviceSeverity, number> = { risk: 3, warning: 1, advice: 0.3, info: 0 };
  const riskWeight = items.reduce((s, i) => s + w[i.severity], 0);
  const plan = domain.anbauplan ?? [];
  const total = plan.reduce((s, e) => s + e.areaHa, 0) || 1;
  const waterMm = plan.reduce((s, e) => { const p = AGRO[e.cropId]; return p ? s + e.areaHa * (p.waterMm[0] + p.waterMm[1]) / 2 : s; }, 0) / total;
  const valueShare = plan.filter((e) => VALUE_CROP_IDS.includes(e.cropId)).reduce((s, e) => s + e.areaHa / total, 0);
  // DB flächensensitiv: DB/ha je Kultur (aus deriveContribution, stage-basiert & area-invariant)
  //  × LIVE-Flächen des Anbauplans — so reagiert der Score auf Flächenänderungen.
  let dbCent = 0;
  try {
    const perHa = new Map(deriveContribution(domain, scenarioId).crops.map((c) => [c.cropId, c.contribPerHaCent]));
    dbCent = Math.round(plan.reduce((s, e) => s + e.areaHa * (perHa.get(e.cropId) ?? 0), 0));
  } catch { dbCent = 0; }
  return {
    items, riskWeight, waterMm, valueShare, dbCent,
    warnCount: items.filter((i) => i.severity === "warning").length,
    riskCount: items.filter((i) => i.severity === "risk").length,
  };
}
export type AnbauScore = ReturnType<typeof scoreAnbau>;

/* ==========================================================================
 * ROTATIONS-OPTIMIERER — deterministische DB-maximale Flächenallokation je Pool
 *  (beregnet + trocken) unter agronomischen Nebenbedingungen (Anbaupausen als
 *  Einzel- und Gruppen-Caps). Investor-grade: reproduzierbar, erklärbar, offline.
 *  Fokus-Hebel ist die Trockenrotation (dort entscheidet sich Sonnenblume vs. Raps/
 *  Getreide); der beregnete Pool ist kontrakt-/absatzgetrieben und bleibt so, wie ihn
 *  die Kultur-Politik plant (Tomate fix, Kartoffel-Ramp unter Anbaupause).
 * ======================================================================== */

/** Trockenrotations-Kandidaten (Pool „dryland"). */
const DRYLAND_CANDIDATES = ["weizen_dry", "gerste_dry", "raps_dry", "sonnenblume"];
/** Break-Gruppen der Trockenrotation mit kombinierter Obergrenze (Anteil am Trockenpool).
 *  Getreide (Weizen+Gerste) ≤ 2/3 (Halmfrucht-Krankheiten/Take-all); Ölsaaten (Raps+Sonnenblume,
 *  beide Sclerotinia-Wirte) ≤ 1/3 als EIN Ölsaat-Slot mit 4-Jahres-Pause. Summe = 1,0. */
const DRYLAND_GROUPS: { group: string; label: string; members: string[]; cap: number }[] = [
  { group: "getreide", label: "Getreide (Weizen/Gerste)", members: ["weizen_dry", "gerste_dry"], cap: 0.66 },
  { group: "oelsaat", label: "Ölsaaten (Raps/Sonnenblume)", members: ["raps_dry", "sonnenblume"], cap: 0.34 },
];

export type RotAlloc = { cropId: string; name: string; ha: number; sharePct: number; dbPerHaCent: number };
export type RotPool = {
  pool: "irrigated" | "dryland";
  areaHa: number;
  current: RotAlloc[];
  recommended: RotAlloc[];
  currentDbCent: number;
  recommendedDbCent: number;
  upliftCent: number;         // ΔDB/Jahr (recommended − current)
  binding: string[];          // welche Nebenbedingungen die Lösung begrenzen (Rationale)
  optimized: boolean;         // false = markt-/kontraktgetrieben, nur ausgewiesen
};
export type SunflowerVerdict = {
  available: boolean;
  dbPerHaCent: number;        // Sonnenblume DB/ha
  bestAlternativeId: string;  // bester Trocken-Alternativkandidat
  bestAlternativeDbCent: number;
  deltaPerHaCent: number;     // Vorsprung Sonnenblume ggü. bester Alternative
  recommendedHa: number;      // vom Optimierer vorgeschlagene Sonnenblumen-Fläche
  attractive: boolean;
  note: string;
};
export type OptimalRotation = {
  pools: RotPool[];
  totalUpliftCent: number;
  sunflower: SunflowerVerdict;
};

/** DB/ha (Direktkosten-Deckungsbeitrag) je Kandidat — über eine Probe-Domäne, die ALLE Kandidaten
 *  enthält (DB/ha ist flächeninvariant, daher Nominalflächen). */
function dbPerHaMap(domain: Domain, scenarioId: string): Map<string, { db: number; be: number; name: string }> {
  const ids = new Set<string>([...DRYLAND_CANDIDATES, ...domain.anbauplan.map((a) => a.cropId)]);
  const probe: Domain = {
    ...domain,
    anbauplan: Array.from(ids).map((cropId) => ({
      id: `probe-${cropId}`, cropId, areaHa: 100, plantingPeriod: 0, harvestPeriods: [8],
      pool: DRYLAND_CANDIDATES.includes(cropId) ? ("dryland" as const) : ("irrigated" as const),
    })),
  };
  const m = new Map<string, { db: number; be: number; name: string }>();
  try {
    for (const c of deriveContribution(probe, scenarioId).crops) m.set(c.cropId, { db: c.contribPerHaCent, be: c.bePerHaCent, name: c.name });
  } catch { /* leer → Fallback 0 */ }
  return m;
}

/** Greedy-Allokation (DB-optimal für Einzel- + Gruppen-Obergrenzen mit Σ = Fläche): höchster DB/ha
 *  zuerst, gefüllt bis min(Einzel-Cap, Gruppen-Restbudget, Pool-Rest). */
function allocateDryland(
  areaHa: number,
  db: Map<string, { db: number; be: number; name: string }>,
): { alloc: RotAlloc[]; binding: string[] } {
  const groupOf = (id: string) => DRYLAND_GROUPS.find((g) => g.members.includes(id));
  const cands = DRYLAND_CANDIDATES
    .map((id) => ({ id, name: db.get(id)?.name ?? id, dbc: db.get(id)?.db ?? 0, maxShare: AGRO[id]?.maxShare ?? 1 }))
    .sort((a, b) => b.dbc - a.dbc);
  const groupUsed = new Map<string, number>();
  const binding = new Set<string>();
  let remaining = areaHa;
  const alloc: RotAlloc[] = [];
  for (const c of cands) {
    if (remaining <= 0) break;
    const g = groupOf(c.id);
    const groupBudget = g ? g.cap * areaHa - (groupUsed.get(g.group) ?? 0) : Infinity;
    const own = c.maxShare * areaHa;
    const ha = Math.max(0, Math.min(own, groupBudget, remaining));
    if (ha <= 0) continue;
    // Welche Schranke bindet?
    if (ha === own && own < groupBudget && own < remaining) binding.add(`${c.name}: Einzel-Anbaupause ${pct(c.maxShare)}`);
    if (g && ha === groupBudget && groupBudget < own) binding.add(`${g.label}: Gruppen-Anbaupause ≤ ${pct(g.cap)}`);
    alloc.push({ cropId: c.id, name: c.name, ha: Math.round(ha), sharePct: ha / areaHa, dbPerHaCent: c.dbc });
    if (g) groupUsed.set(g.group, (groupUsed.get(g.group) ?? 0) + ha);
    remaining -= ha;
  }
  return { alloc, binding: Array.from(binding) };
}

/** Hauptfunktion: optimale Rotation je Pool + Sonnenblume-Verdikt + ΔDB. */
export function deriveOptimalRotation(domain: Domain, scenarioId: string): OptimalRotation {
  const db = dbPerHaMap(domain, scenarioId);
  const plan = domain.anbauplan ?? [];
  const dbcOf = (id: string) => db.get(id)?.db ?? 0;
  const nameOfC = (id: string) => db.get(id)?.name ?? nameOf(id);
  const mkCurrent = (rows: typeof plan, area: number): RotAlloc[] =>
    rows.map((e) => ({ cropId: e.cropId, name: nameOfC(e.cropId), ha: Math.round(e.areaHa), sharePct: area > 0 ? e.areaHa / area : 0, dbPerHaCent: dbcOf(e.cropId) }));
  const sumDb = (rows: { ha: number; dbPerHaCent: number }[]) => Math.round(rows.reduce((s, r) => s + r.ha * r.dbPerHaCent, 0));

  const pools: RotPool[] = [];

  // — Trockenpool: voll optimieren —
  const dryRows = plan.filter((e) => e.pool === "dryland");
  const dryArea = dryRows.reduce((s, e) => s + e.areaHa, 0);
  if (dryArea > 0) {
    const cur = mkCurrent(dryRows, dryArea);
    const { alloc, binding } = allocateDryland(dryArea, db);
    const curDb = sumDb(cur), recDb = sumDb(alloc);
    pools.push({ pool: "dryland", areaHa: Math.round(dryArea), current: cur, recommended: alloc,
      currentDbCent: curDb, recommendedDbCent: recDb, upliftCent: recDb - curDb, binding, optimized: true });
  }

  // — Beregneter Pool: markt-/kontraktgetrieben, nur ausgewiesen (keine Re-Optimierung) —
  const irrRows = plan.filter((e) => e.pool !== "dryland");
  const irrArea = irrRows.reduce((s, e) => s + e.areaHa, 0);
  if (irrArea > 0) {
    const cur = mkCurrent(irrRows, irrArea);
    pools.push({ pool: "irrigated", areaHa: Math.round(irrArea), current: cur, recommended: cur,
      currentDbCent: sumDb(cur), recommendedDbCent: sumDb(cur), upliftCent: 0,
      binding: ["Wertkulturen sind kontrakt-/absatzbegrenzt (Werkskapazität, Anbaupause) — die Kultur-Politik plant den beregneten Pool bereits an der Kapazitätsgrenze."],
      optimized: false });
  }

  // — Sonnenblume-Verdikt —
  const sbDb = dbcOf("sonnenblume");
  const alts = DRYLAND_CANDIDATES.filter((id) => id !== "sonnenblume").map((id) => ({ id, name: nameOfC(id), dbc: dbcOf(id) })).sort((a, b) => b.dbc - a.dbc);
  const best = alts[0] ?? { id: "raps_dry", name: nameOfC("raps_dry"), dbc: 0 };
  const dryPool = pools.find((p) => p.pool === "dryland");
  const recSbHa = dryPool?.recommended.find((r) => r.cropId === "sonnenblume")?.ha ?? 0;
  const delta = sbDb - best.dbc;
  const attractive = sbDb > best.dbc;
  const sunflower: SunflowerVerdict = {
    available: db.has("sonnenblume"),
    dbPerHaCent: sbDb, bestAlternativeId: best.id, bestAlternativeDbCent: best.dbc,
    deltaPerHaCent: delta, recommendedHa: recSbHa, attractive,
    note: attractive
      ? `Sonnenblume liefert ${Math.round(delta / 100)} €/ha mehr DB als die beste Alternative (${best.name}) — als trockentolerante Ölsaat mit niedrigem N-Bedarf der stärkste Trocken-Kandidat. Empfohlen bis zur Ölsaat-Anbaupausengrenze.`
      : `Sonnenblume liegt beim DB nicht vor ${best.name} — an diesem Standort/Preis kein Vorteil.`,
  };

  return { pools, totalUpliftCent: pools.reduce((s, p) => s + p.upliftCent, 0), sunflower };
}
