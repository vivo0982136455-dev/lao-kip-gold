// Formulas that more than one page uses: one place, tested with fixed numbers in tests/calc.js
// (audit 2026-10-02, P1-10: "no test of any formula").

// What an interest rate is worth after inflation, both in % per year: (1 + rate) / (1 + inflation) - 1.
// 5% interest while prices rise 25% = -16%, not -20%: with high inflation the simple difference overstates the loss.
export const realRate = (ratePct, inflationPct) => ((1 + ratePct / 100) / (1 + inflationPct / 100) - 1) * 100;

// Weights
export const LB_PER_KG = 2.20462; // pounds in one kilogram
// US cents per pound (how the IMF quotes rubber) -> US dollars per kilogram
export const usdPerKg = (centsPerLb) => (centsPerLb * LB_PER_KG) / 100;
