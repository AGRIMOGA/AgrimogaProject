// w = { tempC, humidityPct, rainProbPct, soilIsWet }
// d.riskRules: عتبات لكل مرض (كيجيو من diseases.json)
export function computeRisk(d, w) {
  let score = 0;

  if (d.riskRules.tempMin !== undefined && w.tempC >= d.riskRules.tempMin) score += 1;
  if (d.riskRules.tempMax !== undefined && w.tempC <= d.riskRules.tempMax) score += 1;

  if (d.riskRules.humidityMin !== undefined && w.humidityPct >= d.riskRules.humidityMin) score += 1;
  if (d.riskRules.humidityMax !== undefined && w.humidityPct <= d.riskRules.humidityMax) score += 1;

  if (d.riskRules.rainProbMin !== undefined && w.rainProbPct >= d.riskRules.rainProbMin) score += 1;

  if (d.riskRules.soilWetFlag && w.soilIsWet) score += 2; // أمراض الجذور حساسة لتشبّع التربة

  if (score >= 4) return 'مرتفع';
  if (score >= 2) return 'متوسط';
  return 'منخفض';
}
