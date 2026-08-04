import { SEED, deriveCropMassnahmen } from "../store/model";
const SZ = SEED.baseScenarioId;
const e = SEED.catalog.find((c) => c.cropId === "kartoffel_pommes")!;
for (const op of e.ops) {
  console.log(`\n[${op.code}] ${op.label ?? ""}`);
  op.lines.forEach((l: any, i) => console.log(`   ${i}  label="${l.label}"  productId=${l.productId ?? "—"}  unit=${l.unit}  mid=${l.mid ?? "—"}`));
}
console.log("\n=== Maßnahmenzeilen der Ansicht ===");
for (const r of deriveCropMassnahmen(SEED, "kartoffel_pommes", SZ, 0).rows) {
  console.log(`${(r.phase ?? "").slice(0,55).padEnd(56)} | bm: ${(r as any).bm?.map((b: any) => b.label).join(" || ") ?? "—"}`);
}
