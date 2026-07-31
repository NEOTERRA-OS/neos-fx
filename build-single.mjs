import { execSync } from "node:child_process";
import fs from "node:fs";
// entry
fs.writeFileSync("web-entry.tsx",
`import React from "react";
import { createRoot } from "react-dom/client";
import { AppShell } from "./components/shell/AppShell";
import { AuthGate } from "./components/shell/AuthGate";
const el = document.getElementById("root");
createRoot(el).render(React.createElement(React.StrictMode, null, React.createElement(AuthGate, null, React.createElement(AppShell))));
`);
execSync(`./node_modules/.bin/esbuild web-entry.tsx --bundle --format=iife --jsx=automatic --define:process.env.NODE_ENV='"production"' --minify --outfile=/tmp/app.js`, { stdio: "inherit" });
fs.writeFileSync("/tmp/tw-in.css", "@tailwind base;\n@tailwind components;\n@tailwind utilities;\n");
execSync(`./node_modules/.bin/tailwindcss -i /tmp/tw-in.css -o /tmp/tw.css --minify`, { stdio: "inherit" });
const fonts = fs.readFileSync("design/fonts.css","utf8");
const tokens = fs.readFileSync("design/tokens.css","utf8");
const nsb = fs.readFileSync("design/neos-sidebar.css","utf8") + "\n" + fs.readFileSync("design/sidebar-compact.css","utf8");
const tw = fs.readFileSync("/tmp/tw.css","utf8");
const js = fs.readFileSync("/tmp/app.js","utf8");
const globals = `html,body{height:100%}body{background:var(--nx-app-bg);color:var(--nx-text);font-family:"Google Sans Flex",system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased;font-size:12.5px;line-height:1.55;margin:0}.num{font-family:"JetBrains Mono",ui-monospace,"SF Mono",monospace;font-variant-numeric:tabular-nums}.caption{text-transform:uppercase;letter-spacing:.06em}`
  + `input[type=number]::-webkit-outer-spin-button,input[type=number]::-webkit-inner-spin-button{-webkit-appearance:none!important;appearance:none!important;margin:0}input[type=number]{-moz-appearance:textfield;appearance:textfield}`
  + `input[type=number]{color:var(--nx-locate)!important;font-weight:600}`;
const gfont = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Google+Sans+Flex:wght@400..700&display=swap">`;
const html = `<!DOCTYPE html><html lang="de" data-neos-theme="dark"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>NEOS FX — Financial Model</title>${gfont}<style>${fonts}\n${tokens}\n${nsb}\n${tw}\n${globals}</style></head><body><div id="root"></div><script>${js}</script></body></html>`;
// Repo-lokaler Output (CI/Vercel deploy): dist/index.html
fs.mkdirSync("dist", { recursive: true });
fs.writeFileSync("dist/index.html", html);
// Session-Workflow (lokaler Absolut-Pfad für SendUserFile) — best effort, in CI nicht vorhanden.
//  Diese Fassung öffnet OHNE Login: die Datei trägt das ganze Modell im Quelltext, ein Passwort
//  davor schützt nichts und ist in der Chat-Vorschau nicht bedienbar. `dist/index.html` (Deploy)
//  behält den Login — dort steht die App im Netz und die Anmeldung ist der Zugangsschutz.
const htmlOffen = html.replace('<div id="root"></div>', '<script>window.__NFX_NO_AUTH__=true</script><div id="root"></div>');
try { fs.writeFileSync(process.env.NFX_OUT || "/home/claude/NEOS-FX-App.html", htmlOffen); } catch { /* CI: Pfad existiert nicht */ }
fs.rmSync("web-entry.tsx");
console.log("HTML:", (html.length / 1024).toFixed(0), "KB → dist/index.html");
