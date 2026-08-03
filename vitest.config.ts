import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["core/__tests__/**/*.test.ts", "store/__tests__/**/*.test.ts"],
    // Das Modell rechnet 96 Perioden über die volle Stammdatenbasis — ein Lauf
    // dauert länger als der vitest-Default für einen Testfall.
    testTimeout: 30_000,
  },
});
