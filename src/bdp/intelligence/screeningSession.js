import { fetchBdpParcelEnergy } from '../rrc/client.js';
import {
  fetchBdpParcelCleanups,
  fetchBdpParcelFlood,
  fetchBdpParcelWetlands,
} from '../environment/client.js';
import { fetchBdpParcelSoils } from '../soil/client.js';
import { fetchBdpParcelTerrain } from '../terrain/client.js';
import {
  buildCurrentScreeningComponents,
  calculateBdpScore,
} from './acquisitionScore.js';
import { deriveBdpRedFlags, summarizeBdpRedFlags } from './redFlags.js';

export const BDP_SCREENING_SOURCES = Object.freeze([
  'energy',
  'flood',
  'wetlands',
  'cleanups',
  'soils',
  'terrain',
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
  energyLoader = fetchBdpParcelEnergy,
  floodLoader = fetchBdpParcelFlood,
  wetlandsLoader = fetchBdpParcelWetlands,
  cleanupsLoader = fetchBdpParcelCleanups,
  soilsLoader = fetchBdpParcelSoils,
  terrainLoader = fetchBdpParcelTerrain,
} = {}) {
  if (!parcel?.property?.geometry) {
    throw new Error('Parcel geometry is required for BDP screening');
  }

  const loaders = Object.freeze({
    energy: energyLoader,
    flood: floodLoader,
    wetlands: wetlandsLoader,
    cleanups: cleanupsLoader,
    soils: soilsLoader,
    terrain: terrainLoader,
  });

  const settled = await Promise.allSettled(
    BDP_SCREENING_SOURCES.map((source) => Promise.resolve().then(() => loaders[source](parcel))),
  );

  const evidence = {};
  const errors = {};
  BDP_SCREENING_SOURCES.forEach((source, index) => {
    evidence[source] = settledValue(settled[index]);
    errors[source] = settled[index].status === 'rejected'
      ? serializeError(settled[index].reason)
      : null;
  });

  const components = buildCurrentScreeningComponents({
    flood: evidence.flood,
    wetlands: evidence.wetlands,
    cleanups: evidence.cleanups,
    terrain: evidence.terrain,
    soils: evidence.soils,
  });
  const score = calculateBdpScore({ components });
  const redFlags = deriveBdpRedFlags({
    parcel,
    energy: evidence.energy,
    flood: evidence.flood,
    wetlands: evidence.wetlands,
    cleanups: evidence.cleanups,
    terrain: evidence.terrain,
  });
  const redFlagSummary = summarizeBdpRedFlags(redFlags);

  const succeededSources = BDP_SCREENING_SOURCES.filter((source) => evidence[source] !== null);
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
