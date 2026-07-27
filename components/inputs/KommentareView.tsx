"use client";
import React from "react";
import { useModelStore } from "../../store/modelStore";
import { CommentsPanel } from "./CommentsPanel";
import { t, getLang } from "../../lib/i18n";

/** Kommentare — Team-Diskussion über das ganze Modell: alle Threads (offen/erledigt), Filter,
 *  Öffnen zum Antworten/Auflösen. Kommentare funktionieren auch im Betrachter-Modus. */
export function KommentareView() {
  const domain = useModelStore((s) => s.domain);
  const mutate = useModelStore((s) => s.mutateComments);
  const readOnly = useModelStore((s) => s.readOnly);
  const locale = getLang() === "en" ? "en-US" : "de-DE";
  const threads = domain.comments ?? [];
  const [f, setF] = React.useState<"open" | "resolved" | "all">("open");
  const [q, setQ] = React.useState("");
  const [open, setOpen] = React.useState<{ target: string; label: string; area?: string } | null>(null);

  const openCnt = threads.filter((th) => !th.resolved).length;
  let list = threads;
  if (f !== "all") list = list.filter((th) => (f === "open" ? !th.resolved : th.resolved));
  if (q.trim()) { const s = q.toLowerCase(); list = list.filter((th) => th.targetLabel.toLowerCase().includes(s) || th.messages.some((m) => m.text.toLowerCase().includes(s) || m.author.toLowerCase().includes(s))); }
  list = [...list].sort((a, b) => (b.messages[b.messages.length - 1]?.ts ?? "").localeCompare(a.messages[a.messages.length - 1]?.ts ?? ""));

  const toggleResolved = (target: string) => mutate((d) => { const th = d.comments?.find((x) => x.target === target); if (th) th.resolved = !th.resolved; });
  const chip = (v: typeof f, label: string, n?: number) => (
    <button onClick={() => setF(v)} className="rounded-control border px-2.5 text-[12px] font-semibold" style={{ height: 32, borderColor: f === v ? "var(--nx-locate)" : "var(--nx-border)", background: f === v ? "color-mix(in srgb, var(--nx-locate) 12%, transparent)" : "var(--nx-surface)", color: f === v ? "var(--nx-locate)" : "var(--nx-text-secondary)" }}>{label}{n != null ? ` · ${n}` : ""}</button>
  );

  return (
    <div className="space-y-4">
      <section className="rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }}>
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b" style={{ borderColor: "var(--nx-border)" }}>
          <div>
            <h2 className="text-[14px] font-semibold">{t("Kommentare")} <span className="text-nx-text-muted">· {openCnt} {t("offen")}</span></h2>
            <div className="text-[11px] text-nx-text-muted">{t("Team-Diskussion über das Modell — an jeder Zahl kommentieren (auch im Betrachter-Modus).")}</div>
          </div>
          {readOnly && <span className="rounded-control px-2 py-1 text-[11px] font-semibold" style={{ background: "color-mix(in srgb, var(--nx-warn, #C9A227) 16%, transparent)", color: "var(--nx-warn, #C9A227)" }}>{t("Betrachter-Modus — Kommentieren erlaubt")}</span>}
        </div>

        <div className="flex flex-wrap items-center gap-2 px-4 py-3">
          {chip("open", t("Offen"), threads.filter((th) => !th.resolved).length)}
          {chip("resolved", t("Erledigt"), threads.filter((th) => th.resolved).length)}
          {chip("all", t("Alle"), threads.length)}
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Suche …")} className="min-w-[160px] flex-1 rounded-control border px-2 text-[12.5px]" style={{ height: 32, background: "var(--nx-app-bg)", borderColor: "var(--nx-border)", color: "var(--nx-text)" }} />
        </div>

        <div className="px-3 pb-3">
          {list.length === 0 && <div className="px-2 py-8 text-center text-[12px] text-nx-text-muted">{t("Keine Kommentare. Kommentiere eine Zahl im Annahmen-Register (💬).")}</div>}
          <div className="space-y-1.5">
            {list.map((th) => {
              const last = th.messages[th.messages.length - 1];
              return (
                <div key={th.id} className="rounded-tile border px-3 py-2" style={{ borderColor: "var(--nx-border)", background: "var(--nx-app-bg)" }}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[12.5px] font-semibold">{th.targetLabel}</span>
                        {th.area && <span className="rounded-control border px-1.5 text-[9.5px] text-nx-text-muted" style={{ borderColor: "var(--nx-border)" }}>{t(th.area)}</span>}
                        {th.resolved
                          ? <span className="rounded-control px-1.5 text-[9.5px] font-semibold" style={{ background: "var(--nx-green)", color: "#fff" }}>{t("erledigt")}</span>
                          : <span className="rounded-control px-1.5 text-[9.5px] font-semibold" style={{ background: "color-mix(in srgb, var(--nx-locate) 16%, transparent)", color: "var(--nx-locate)" }}>{t("offen")}</span>}
                        <span className="num text-[10px] text-nx-text-muted">{th.messages.length} {t("Nachricht(en)")}</span>
                      </div>
                      {last && <div className="mt-0.5 truncate text-[11.5px] text-nx-text-secondary"><b>{last.author}:</b> {last.text}</div>}
                      {last && <div className="num text-[9.5px] text-nx-text-muted">{new Date(last.ts).toLocaleString(locale)}</div>}
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <button className="rounded-control border px-2 py-1 text-[11px] font-semibold" style={{ borderColor: "var(--nx-border)", color: "var(--nx-locate)" }} onClick={() => setOpen({ target: th.target, label: th.targetLabel, area: th.area })}>{t("öffnen")}</button>
                      <button className="rounded-control border px-2 py-1 text-[11px] font-semibold" style={{ borderColor: "var(--nx-border)", color: th.resolved ? "var(--nx-text-muted)" : "var(--nx-green)" }} onClick={() => toggleResolved(th.target)}>{th.resolved ? t("wieder öffnen") : t("erledigt")}</button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>
      {open && <CommentsPanel target={open.target} targetLabel={open.label} area={open.area} onClose={() => setOpen(null)} />}
    </div>
  );
}
