# NEOS FX — Financial Model

Investor-grade AgTech financial model für NEOTERRA (Măceșu de Jos, Süd-Dolj, RO).
Single-File-HTML-App (Next.js/React/TS-Quelle → ein HTML via `build-single.mjs`).

## Build
```
npm install
node build-single.mjs   # → dist/index.html
```

## Deploy
Automatisch via GitHub Actions (`.github/workflows/deploy.yml`): jeder Push auf `main`
baut und deployt nach Vercel (Projekt `neos-fx-web`, Domain fx.neoterra.ag).
Benötigt Repository-Secret `VERCEL_TOKEN`.

## Stack
- UI-Quelle: `components/`, `store/`, `design/`
- Engine: `core/engine.ts`, `store/model.ts` (Composer), `core/aggregate.ts`
- Backend: Supabase (Auth + RLS + Edge Functions), Projekt `gmuhuuggvdqckszbxnfu`
