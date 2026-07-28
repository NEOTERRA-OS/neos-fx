/** Block 11 — Sprach-Review: nachgezogene DE→EN-Übersetzungen (Team/Zugriff, Login/Auth,
 *  Sensitivität, CAPEX-Editor, Sidebar/TopBar, diverse Panel-Labels). Deutscher Text = Schlüssel. */
const B11: Record<string, string> = {
  // — Team & Zugriff / Rollen —
  "Team & Zugriff": "Team & Access",
  "Deine Rolle": "Your role",
  "Rolle": "Role",
  "Rolle aktualisiert.": "Role updated.",
  "Mitglied": "Member",
  "Mitglied entfernt.": "Member removed.",
  "Noch keine weiteren Mitglieder.": "No further members yet.",
  "Einladen": "Invite",
  "E-Mail einladen": "Invite by email",
  "Eingeladen / hinzugefügt.": "Invited / added.",
  "Entfernen": "Remove",
  "entfernen": "remove",
  "Betrachter": "Viewer",
  "Betrachter (nur lesen)": "Viewer (read-only)",
  "Editor (bearbeiten)": "Editor (edit)",
  "Owner (Admin)": "Owner (admin)",
  "= volle Verwaltung · ": "= full administration · ",
  "= darf das Modell ändern · ": "= may edit the model · ",
  "= nur lesen & kommentieren (App startet automatisch im Betrachter-Modus).":
    "= read & comment only (the app starts in viewer mode automatically).",
  "Mitglieder einladen und Rollen vergeben — ohne SQL. Nur der Owner kann verwalten.":
    "Invite members and assign roles — no SQL. Only the owner can manage.",
  "Bereits registrierte Personen werden direkt hinzugefügt; neue bekommen eine Einladung per E-Mail (sofern E-Mail-Versand konfiguriert ist).":
    "Already-registered people are added directly; new ones receive an email invitation (if email delivery is configured).",
  "Supabase ist nicht konfiguriert — Team-Verwaltung inaktiv.": "Supabase is not configured — team administration inactive.",
  "Supabase ist nicht konfiguriert.": "Supabase is not configured.",
  "Bitte zuerst anmelden. Danach erscheint hier die Team-Verwaltung.":
    "Please sign in first. Team administration then appears here.",
  "Nur der Owner des geteilten Modells kann Mitglieder verwalten.":
    "Only the owner of the shared model can manage members.",
  "Noch kein geteiltes Modell vorhanden. So wirst du zum Owner: einmal unter »Speichern & Versionen« speichern (oder einen Wert ändern) — das legt das Team-Modell an und macht dich automatisch zum Owner. Danach Seite neu laden, dann erscheint hier die Verwaltung.":
    "No shared model exists yet. How to become owner: save once under »Save & Versions« (or change a value) — that creates the team model and makes you the owner automatically. Then reload the page and administration appears here.",
  "Nicht angemeldet — im Betrachter-Modus. Zum Speichern in der Cloud bitte über das Login anmelden; Mitglieder und Rollen verwaltest du im Modul »Team & Zugriff«.":
    "Not signed in — in viewer mode. To save to the cloud, please sign in via the login; you manage members and roles in the »Team & Access« module.",

  // — Login / Auth —
  "Finanz-Cockpit — planen, prüfen, entscheiden.": "Finance cockpit — plan, review, decide.",
  "Konto erstellen": "Create account",
  "Registriere dich mit deiner @neoterra.ag-Adresse.": "Register with your @neoterra.ag address.",
  "Registriert — bitte E-Mail bestätigen, dann anmelden.": "Registered — please confirm your email, then sign in.",
  "Anmeldung fehlgeschlagen.": "Sign-in failed.",
  "Melde dich an, um fortzufahren.": "Sign in to continue.",
  "Noch kein Konto?": "No account yet?",
  "Schon registriert?": "Already registered?",
  "Nur ansehen?": "Just viewing?",
  "Betrachter-Modus öffnen": "Open viewer mode",
  "Betrachter-Modus": "Viewer mode",
  "GoBD-konform · Daten in der EU": "GoBD-compliant · Data in the EU",
  "angemeldet als": "signed in as",
  "du": "you",

  // — TopBar / Shell —
  "Granularität": "Granularity",
  "Währung": "Currency",
  "Skalierungsstufe": "Scaling stage",
  "Lädt …": "Loading …",

  // — Produktion / Anbau —
  "Beregnete Kulturen + unberegnete Trockenrotation in einer Tabelle. Jede Kultur mit eigener Bottom-up-Kalkulation.":
    "Irrigated crops + rain-fed dryland rotation in one table. Each crop with its own bottom-up costing.",
  "Trockenkulturen laufen nativ mit eigener Kalkulation (☀ trocken); Maschinen über die volle Fläche.":
    "Dryland crops run natively with their own costing (☀ rain-fed); machinery over the full area.",

  // — Sensitivität / Financials / diverse Panels —
  "Aufwand": "Expense",
  "Behobene Hinweise": "Resolved notes",
  "Alle Konten zugeordnet": "All accounts assigned",
  "ausgeglichen": "balanced",
  "außerh. Benchmark": "outside benchmark",
  "Finanzierung & Funding": "Financing & Funding",
  "Kapitalbedarf im Jahresverlauf": "Capital requirement over the year",
  "zilieri FTE": "day-laborer FTE",
};
export default B11;
