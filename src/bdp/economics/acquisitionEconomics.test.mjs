import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateAcquisitionEconomics } from './acquisitionEconomics.js';

const parcel = {
  property: { acres: 10 }, valuation: { landValue: 80000, marketValue: 150000 },
  source: { recordCurrency: 'archived' },
  acquisition: { askingPrice: 100000, scenario: {
    closingCosts: 5000, dueDiligenceCosts: 2000, siteWorkCosts: 10000,
    holdingCosts: 3000, dispositionCosts: 5000, exitPrice: 150000, targetReturnPercent: 20,
  } },
};
test('computes acquisition basis, profit and residual offer from explicit assumptions', () => {
  const result = evaluateAcquisitionEconomics(parcel);
  assert.equal(result.allInCost, 125000);
  assert.equal(result.allInCostPerAcre, 12500);
  assert.equal(result.askingPricePerAcre, 10000);
  assert.equal(result.breakEvenExitPrice, 125000);
  assert.equal(result.scenarioProfit, 25000);
  assert.equal(result.returnOnCostPercent, 20);
  assert.equal(result.maximumOffer, 100000);
  assert.equal(result.economicsScoreReady, false);
  assert.equal(result.cadLandValuePerAcre, 8000);
});
test('CAD-only parcel cannot become an acquisition price or favorable economics score', () => {
  const result = evaluateAcquisitionEconomics({ ...parcel, acquisition: {} });
  assert.equal(result.askingPrice, null);
  assert.equal(result.allInCost, null);
  assert.equal(result.scenarioProfit, null);
  assert.equal(result.maximumOffer, null);
  assert.equal(result.status, 'incomplete');
  assert.equal(result.economicsScoreReady, false);
});
test('blank costs remain unknown while explicitly entered zero costs are usable', () => {
  const scenario = { ...parcel.acquisition.scenario, siteWorkCosts: '' };
  const result = evaluateAcquisitionEconomics({ ...parcel, acquisition: { askingPrice: 100000, scenario } });
  assert.equal(result.allInCost, null);
  assert.equal(result.maximumOffer, null);
  assert.ok(result.missingInputs.includes('siteWorkCosts'));
  scenario.siteWorkCosts = 0;
  assert.equal(evaluateAcquisitionEconomics({ ...parcel, acquisition: { askingPrice: 100000, scenario } }).allInCost, 115000);
});
test('rejects invalid prices and acreage, preserves losses and infeasible residuals', () => {
  for (const value of [null, undefined, '', ' ', true, false, {}, [], -1, Infinity, 'bad', Number.MAX_VALUE]) {
    const result = evaluateAcquisitionEconomics({ ...parcel, property: { acres: value }, acquisition: { askingPrice: value } });
    assert.equal(result.askingPrice, null);
    assert.equal(result.askingPricePerAcre, null);
  }
  const result = evaluateAcquisitionEconomics({ ...parcel, acquisition: { ...parcel.acquisition, scenario: { ...parcel.acquisition.scenario, exitPrice: 10000 } } });
  assert.equal(result.scenarioProfit, -115000);
  assert.ok(result.maximumOffer < 0);
  assert.equal(result.targetFeasible, false);
});
