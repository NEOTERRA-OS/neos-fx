"use client";
import React from "react";
import { useModelStore } from "../../store/modelStore";
import type { CommentThread } from "../../store/model";
import { t, getLang } from "../../lib/i18n";

const rid = () => `c-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

/** Kommentar-Thread-Overlay für ein Ziel (Treiber/Zahl). Lesen, antworten, auflösen, löschen.
 *  Kommentare sind AUCH im Betrachter-Modus erlaubt (mutateComments umgeht den Schreibschutz). */
export function CommentsPanel({ target, targetLabel, area, onClose }: {
  target: string; targetLabel: string; area?: string; onClose: () => void;
}) {
  const comments = useModelStore((s) => s.domain.comments);
  const editor = useModelStore((s) => s.editor);
  const mutate = useModelStore((s) => s.mutateComments);
  const [text, setText] = React.useState("");
  const locale = getLang() === "en" ? "en-US" : "de-DE";
  const thread = (comments ?? []).find((th) => th.target === target);

  const send = () => {
    const body = text.trim(); if (!body) return;
    mutate((d) => {
      d.comments = d.comments ?? [];
      let th = d.comments.find((x) => x.target === target);
      if (!th) { th = { id: `th-${rid()}`, target, targetLabel, area, resolved: false, messages: [] }; d.comments.push(th); }
      th.resolved = false;
      th.messages.push({ id: rid(), author: editor, ts: new Date().toISOString(), text: body });
    });
    setText("");
  };
  const toggleResolved = () => mutate((d) => { const th = d.comments?.find((x) => x.target === target); if (th) th.resolved = !th.resolved; });
  const del = (mid: string) => mutate((d) => {
    const th = d.comments?.find((x) => x.target === target); if (!th) return;
    th.messages = th.messages.filter((m) => m.id !== mid);
    if (!th.messages.length) d.comments = (d.comments ?? []).filter((x) => x.id !== th!.id);
  });

  const msgs = thread?.messages ?? [];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,.55)" }} onClick={onClose}>
      <div className="flex max-h-[82vh] w-full max-w-[560px] flex-col rounded-tile border" style={{ borderColor: "var(--nx-border)", background: "var(--nx-surface)" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b px-4 py-3" style={{ borderColor: "var(--nx-border)" }}>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-[14px] font-semibold">💬 {targetLabel}</h3>
              {thread?.resolved && <span className="rounded-control px-1.5 py-0.5 text-[9.5px] font-semibold" style={{ background: "var(--nx-green)", color: "#fff" }}>{t("erledigt")}</span>}
            </div>
            {area && <div className="text-[10.5px] text-nx-text-muted">{t(area)}</div>}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {msgs.length > 0 && (
              <button className="rounded-control border px-2 py-1 text-[11px] font-semibold" style={{ borderColor: "var(--nx-border)", color: thread?.resolved ? "var(--nx-text-muted)" : "var(--nx-green)" }} onClick={toggleResolved}>
                {thread?.resolved ? t("wieder öffnen") : t("erledigt")}
              </button>
            )}
            <button className="rounded-control border px-2 py-1 text-[13px]" style={{ borderColor: "var(--nx-border)", color: "var(--nx-text-secondary)" }} onClick={onClose}>✕</button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
          {msgs.length === 0 && <div className="py-6 text-center text-[12px] text-nx-text-muted">{t("Noch keine Kommentare. Starte die Diskussion.")}</div>}
          <div className="space-y-2.5">
            {msgs.map((m) => (
              <div key={m.id} className="rounded-tile border px-3 py-2" style={{ borderColor: "var(--nx-border)", background: "var(--nx-app-bg)" }}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11.5px] font-semibold" style={{ color: "var(--nx-locate)" }}>{m.author}</span>
                  <span className="flex items-center gap-2">
                    <span className="num text-[9.5px] text-nx-text-muted">{new Date(m.ts).toLocaleString(locale)}</span>
                    <button className="text-[11px] text-nx-error hover:opacity-70" title={t("Löschen")} onClick={() => del(m.id)}>✕</button>
                  </span>
                </div>
                <div className="mt-0.5 whitespace-pre-wrap text-[12.5px] text-nx-text-secondary">{m.text}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-end gap-2 border-t px-4 py-3" style={{ borderColor: "var(--nx-border)" }}>
          <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={`${t("Kommentar als")} ${editor} …`}
            rows={2} className="min-w-0 flex-1 rounded-control border px-2 py-1.5 text-[12.5px]" style={{ background: "var(--nx-app-bg)", borderColor: "var(--nx-border)", color: "var(--nx-text)", resize: "vertical" }}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send(); }} />
          <button onClick={send} disabled={!text.trim()} className="rounded-control px-3 py-2 text-[12.5px] font-bold disabled:opacity-50" style={{ background: "var(--nx-locate)", color: "#fff" }}>{t("Kommentieren")}</button>
        </div>
      </div>
    </div>
  );
}

/** Anzahl offener/aller Nachrichten eines Ziels — für Badges. */
export function threadOf(comments: CommentThread[] | undefined, target: string): CommentThread | undefined {
  return (comments ?? []).find((th) => th.target === target);
}
