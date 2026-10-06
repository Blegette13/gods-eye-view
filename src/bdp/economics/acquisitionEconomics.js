/** Scenario arithmetic only. CAD values and user inputs never become sale comps. */
export const ACQUISITION_COST_FIELDS = Object.freeze([
  ['closingCosts', 'Closing / transaction costs'],
  ['dueDiligenceCosts', 'Due diligence costs'],
  ['siteWorkCosts', 'Site work / utilities / entitlement costs'],
  ['holdingCosts', 'Holding / financing / tax costs'],
  ['dispositionCosts', 'Disposition costs'],
]);

function amount(value, { positive = false } = {}) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > Number.MAX_SAFE_INTEGER) return null;
  return positive && number <= 0 ? null : number;
}

function safe(value) {
  return Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER ? value : null;
}

export function evaluateAcquisitionEconomics(parcel = {}) {
  const acquisition = parcel.acquisition || {};
  const scenario = acquisition.scenario || {};
  const acres = amount(parcel.property?.acres, { positive: true });
  const askingPrice = amount(acquisition.askingPrice, { positive: true });
  const exitPrice = amount(scenario.exitPrice, { positive: true });
  const targetReturnPercent = amount(scenario.targetReturnPercent);
  const costs = Object.fromEntries(ACQUISITION_COST_FIELDS.map(([key]) => [key, amount(scenario[key])]));
  const missingInputs = [
    ...(askingPrice === null ? ['askingPrice'] : []),
    ...ACQUISITION_COST_FIELDS.filter(([key]) => costs[key] === null).map(([key]) => key),
  ];
  const allCostsKnown = ACQUISITION_COST_FIELDS.every(([key]) => costs[key] !== null);
  const totalAdditionalCosts = allCostsKnown ? safe(Object.values(costs).reduce((sum, value) => sum + value, 0)) : null;
  const allInCost = missingInputs.length === 0 && totalAdditionalCosts !== null
    ? safe(askingPrice + totalAdditionalCosts) : null;
  const scenarioProfit = allInCost !== null && exitPrice !== null ? safe(exitPrice - allInCost) : null;
  const returnOnCostPercent = scenarioProfit !== null && allInCost > 0 ? safe(scenarioProfit / allInCost * 100) : null;
  const maximumOffer = totalAdditionalCosts !== null && exitPrice !== null && targetReturnPercent !== null
    ? safe(exitPrice / (1 + targetReturnPercent / 100) - totalAdditionalCosts) : null;
  const cadLandValue = amount(parcel.valuation?.landValue);
  const cadTotalValue = amount(parcel.valuation?.marketValue);
  const perAcre = (value) => acres !== null && value !== null ? safe(value / acres) : null;

  return Object.freeze({
    status: allInCost === null ? 'incomplete' : 'scenario-only',
    source: 'Parcel CAD context + user-supplied acquisition assumptions',
    economicsScoreReady: false,
    askingPrice,
    askingPricePerAcre: perAcre(askingPrice),
    reportedAcres: acres,
    costs: Object.freeze(costs),
    missingInputs: Object.freeze(missingInputs),
    totalAdditionalCosts,
    allInCost,
    allInCostPerAcre: perAcre(allInCost),
    breakEvenExitPrice: allInCost,
    assumedExitPrice: exitPrice,
    scenarioProfit,
    returnOnCostPercent,
    targetReturnPercent,
    maximumOffer,
    targetFeasible: maximumOffer === null ? null : maximumOffer > 0,
    cadLandValue,
    cadLandValuePerAcre: perAcre(cadLandValue),
    cadTotalValue,
    cadRecordCurrency: parcel.source?.recordCurrency || 'unknown',
    notice: 'User assumptions are unverified scenario inputs. Enter zero only when a cost is explicitly assumed zero; blank costs remain unknown. Include all applicable costs in the entered buckets. CAD values are appraisal context, not asking prices, verified sales or comparable-sale evidence. Acreage is reported parcel acreage; no buildable acreage or market value is inferred. Economics remains unscored pending verified market and cost evidence.',
  });
}
