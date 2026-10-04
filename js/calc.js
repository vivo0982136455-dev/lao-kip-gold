// Formulas that more than one page uses: one place, tested with fixed numbers in tests/calc.js
// (audit 2026-10-02, P1-10: "no test of any formula").

// What an interest rate is worth after inflation, both in % per year: (1 + rate) / (1 + inflation) - 1.
// 5% interest while prices rise 25% = -16%, not -20%: with high inflation the simple difference overstates the loss.
export const realRate = (ratePct, inflationPct) => ((1 + ratePct / 100) / (1 + inflationPct / 100) - 1) * 100;

// A foreign currency against the kip, from the kip price of one unit before and now. Two measures of one move,
// and they are not the same size (audit 2026-10-02, P2-2: "rate now / rate before - 1" was labelled "kip lost"):
//   dearer    how much dearer the foreign currency became, in % of its old price  (10,000 -> 20,000 kip = +100%)
//   kipChange how the kip's own value changed, in %: before / now - 1             (the same move      = -50%)
// Import prices follow "dearer"; what a kip note is still worth follows "kipChange".
export const dearer = (before, now) => (now / before - 1) * 100;
export const kipChange = (before, now) => (before / now - 1) * 100;

// Weights
export const LB_PER_KG = 2.20462; // pounds in one kilogram
// US cents per pound (how the IMF quotes rubber) -> US dollars per kilogram
export const usdPerKg = (centsPerLb) => (centsPerLb * LB_PER_KG) / 100;
