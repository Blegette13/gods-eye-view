import { evaluateAcquisitionEconomics } from '../economics/acquisitionEconomics.js';
import { fetchBdpParcelEnergy } from '../rrc/client.js';
import {
  fetchBdpParcelCleanups,
  fetchBdpParcelFlood,
  fetchBdpParcelMsw,
  fetchBdpParcelWetlands,
} from '../environment/client.js';
import { fetchBdpParcelSoils } from '../soil/client.js';
import { fetchBdpParcelTerrain } from '../terrain/client.js';
import { fetchBdpParcelTransportation } from '../transportation/client.js';
import { fetchBdpParcelUtilities } from '../utilities/client.js';
import { fetchBdpParcelWaterRights } from '../water/client.js';
import { fetchBdpParcelCemeteries } from '../cultural/client.js';
import { fetchBdpParcelEntitlement } from '../entitlement/client.js';
import { fetchBdpParcelGrowthRadar } from '../growth/client.js';
import {
  buildCurrentScreeningComponents,
  calculateBdpScore,
} from './acquisitionScore.js';
import { scoreAccessTraffic } from './accessTrafficScore.js';
import { scoreUtilitiesInfrastructure } from './utilitiesScore.js';
import { deriveBdpRedFlags, summarizeBdpRedFlags } from './redFlags.js';
import { deriveAccessTrafficFlags } from './transportationFlags.js';
import { deriveUtilitiesFlags } from './utilitiesFlags.js';
import { deriveWaterRightsFlags } from './waterRightsFlags.js';
import { deriveMswFlags } from './mswFlags.js';
import { deriveCulturalFlags } from './culturalFlags.js';
import { scoreEntitlementZoning } from './entitlementScore.js';
import { deriveEntitlementFlags } from './entitlementFlags.js';
import { deriveGrowthRadarFlags } from './growthRadarFlags.js';

export const BDP_SCREENING_SOURCES = Object.freeze([
  'energy',
  'flood',
  'wetlands',
  'cleanups',
  'msw',
  'soils',
  'terrain',
  'transportation',
  'utilities',
  'waterRights',
  'cemeteries',
  'entitlement',
  'growthRadar',
]);

function serializeError(error) {
  if (!error) return null;
  return Object.freeze({
    message: String(error.message || error),
    status: Number.isFinite(Number(error.status)) ? Number(error.status) : null,
    code: error.code ? String(error.code) : '',
  });
}

function settledValue(result) {
  return result.status === 'fulfilled' ? result.value : null;
}

/**
 * Collect the currently implemented BDP parcel screening feeds as one evidence
 * package. Source failures are isolated: one unavailable provider does not hide
 * the remaining evidence or turn missing data into a favorable score.
 */
export async function runBdpParcelScreening(parcel, {
  developmentConstraintsLoader = null,
  energyLoader = fetchBdpParcelEnergy,
  floodLoader = fetchBdpParcelFlood,
  wetlandsLoader = fetchBdpParcelWetlands,
  cleanupsLoader = fetchBdpParcelCleanups,
  mswLoader = fetchBdpParcelMsw,
  soilsLoader = fetchBdpParcelSoils,
  terrainLoader = fetchBdpParcelTerrain,
  transportationLoader = fetchBdpParcelTransportation,
  utilitiesLoader = fetchBdpParcelUtilities,
  waterRightsLoader = fetchBdpParcelWaterRights,
  cemeteriesLoader = fetchBdpParcelCemeteries,
  entitlementLoader = fetchBdpParcelEntitlement,
  growthRadarLoader = fetchBdpParcelGrowthRadar,
} = {}) {
  if (!parcel?.property?.geometry) {
    throw new Error('Parcel geometry is required for BDP screening');
  }

  const loaders = Object.freeze({
    energy: energyLoader,
    flood: floodLoader,
    wetlands: wetlandsLoader,
    cleanups: cleanupsLoader,
    msw: mswLoader,
    soils: soilsLoader,
    terrain: terrainLoader,
    transportation: transportationLoader,
    utilities: utilitiesLoader,
    waterRights: waterRightsLoader,
    cemeteries: cemeteriesLoader,
    entitlement: entitlementLoader,
    growthRadar: growthRadarLoader,
  });

  const settled = await Promise.allSettled(
    [
      ...BDP_SCREENING_SOURCES.map((source) => Promise.resolve().then(() => loaders[source](parcel))),
      Promise.resolve().then(() => developmentConstraintsLoader ? developmentConstraintsLoader(parcel) : null),
    ],
  );

  const evidence = {};
  const errors = {};
  BDP_SCREENING_SOURCES.forEach((source, index) => {
    evidence[source] = settledValue(settled[index]);
    errors[source] = settled[index].status === 'rejected'
      ? serializeError(settled[index].reason)
      : null;
  });

  const derived = settled[BDP_SCREENING_SOURCES.length];
  evidence.developmentConstraints = settledValue(derived);
  errors.developmentConstraints = derived.status === 'rejected' ? serializeError(derived.reason) : null;
  evidence.acquisitionEconomics = evaluateAcquisitionEconomics(parcel);

  const components = {
    ...buildCurrentScreeningComponents({
      flood: evidence.flood,
      wetlands: evidence.wetlands,
      cleanups: evidence.cleanups,
      msw: evidence.msw,
      terrain: evidence.terrain,
      soils: evidence.soils,
    }),
    accessTraffic: scoreAccessTraffic(evidence.transportation),
    utilitiesInfrastructure: scoreUtilitiesInfrastructure(evidence.utilities),
    entitlementZoning: scoreEntitlementZoning(evidence.entitlement),
  };
  const score = calculateBdpScore({ components });
  const redFlags = Object.freeze([
    ...deriveBdpRedFlags({
      parcel,
      energy: evidence.energy,
      flood: evidence.flood,
      wetlands: evidence.wetlands,
      cleanups: evidence.cleanups,
      terrain: evidence.terrain,
    }),
    ...deriveAccessTrafficFlags(evidence.transportation),
    ...deriveUtilitiesFlags(evidence.utilities),
    ...deriveWaterRightsFlags(evidence.waterRights),
    ...deriveMswFlags(evidence.msw),
    ...deriveCulturalFlags(evidence.cemeteries),
    ...deriveEntitlementFlags(evidence.entitlement),
    ...deriveGrowthRadarFlags(evidence.growthRadar),
  ].sort((a, b) => {
    const severityRank = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };
    return (severityRank[b.severity] || 0) - (severityRank[a.severity] || 0)
      || a.id.localeCompare(b.id);
  }));
  const redFlagSummary = summarizeBdpRedFlags(redFlags);

  const succeededSources = BDP_SCREENING_SOURCES.filter((source) => evidence[source] != null
    && (source !== 'msw' || evidence.msw.coverage_complete === true)
    && (source !== 'flood' || evidence.flood.coverage_complete === true));
  const failedSources = BDP_SCREENING_SOURCES.filter((source) => errors[source] !== null);

  return Object.freeze({
    parcelId: String(parcel.id || parcel.parcelId || ''),
    generatedAt: new Date().toISOString(),
    screeningOnly: true,
    evidence: Object.freeze(evidence),
    errors: Object.freeze(errors),
    succeededSources: Object.freeze(succeededSources),
    failedSources: Object.freeze(failedSources),
    sourceCoveragePercent: (succeededSources.length / BDP_SCREENING_SOURCES.length) * 100,
    score,
    redFlags,
    redFlagSummary,
  });
}

export default runBdpParcelScreening;
