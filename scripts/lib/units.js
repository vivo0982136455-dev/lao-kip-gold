// Weights and the conversions built on them, for the numbers the bot derives (scripts/build-summary.js).
// One place, tested with fixed numbers in tests/calc.js (audit 2026-10-02, P1-10).

const GRAMS_PER_BAHT = 15.244; // Thai baht-weight (Thai association prices)
const GRAMS_PER_LAO_BAHT = 15; // Lao "baht" (LBB sells 15 g and 7.5 g bars = 1 and ½ baht)
const GRAMS_PER_TROY_OZ = 31.1035;
const TROY_OZ_PER_KG = 1000 / GRAMS_PER_TROY_OZ; // 32.1507

// Middle of a buying and a selling rate
const mid = (buy, sell) => (buy + sell) / 2;
// World gold: US dollars per troy ounce -> kip per Thai baht-weight (15.244 g), at kip per dollar
const goldLakPerBaht = (usdPerOz, lakPerUsd) => usdPerOz * (GRAMS_PER_BAHT / GRAMS_PER_TROY_OZ) * lakPerUsd;
// World silver: US dollars per troy ounce -> kip per kilogram
const silverLakPerKg = (usdPerOz, lakPerUsd) => usdPerOz * TROY_OZ_PER_KG * lakPerUsd;
// Lao Bullion Bank: kip per gram -> kip per Lao baht (15 g)
const lakPerLaoBaht = (lakPerGram) => lakPerGram * GRAMS_PER_LAO_BAHT;

module.exports = { GRAMS_PER_BAHT, GRAMS_PER_LAO_BAHT, GRAMS_PER_TROY_OZ, TROY_OZ_PER_KG, mid, goldLakPerBaht, silverLakPerKg, lakPerLaoBaht };
