import { SEED, buildModelState } from "../store/model";
const st = buildModelState(SEED, SEED.baseScenarioId);
const grp: Record<string, number> = {};
for (const c of st.capex) {
  const k = c.id.replace(/-y\d+$/, "").replace(/\d+$/, "").slice(0, 26);
  grp[k] = (grp[k] ?? 0) + c.amount;
}
const top = Object.entries(grp).sort((a, b) => b[1] - a[1]).slice(0, 14);
for (const [k, v] of top) console.log(k.padEnd(30), String(Math.round(v / 100000)).padStart(8), "kEUR");
console.log("SUMME".padEnd(30), String(Math.round(st.capex.reduce((s,c)=>s+c.amount,0)/100000)).padStart(8), "kEUR");
