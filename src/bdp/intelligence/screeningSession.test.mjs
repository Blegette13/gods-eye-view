import assert from 'node:assert/strict';
import test from 'node:test';
import { runBdpParcelScreening } from './screeningSession.js';

const parcel = {
  id: '48029:123',
  parcelId: '123',
  property: {
    acres: 100,
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [-98.50, 29.40],
        [-98.49, 29.40],
        [-98.49, 29.41],
        [-98.50, 29.41],
        [-98.50, 29.40],
      ]],
    },
  },
};

test('collects screening evidence and derives score coverage/red flags', async () => {
  const result = await runBdpParcelScreening(parcel, {
    developmentConstraintsLoader: async () => ({ combined_mapped_constraint_acres: 15, development_score_ready: false }),
    energyLoader: async () => ({ pipeline_crossing_count: 1, nearest_well_m: 2000 }),
    floodLoader: async () => ({ coverage_complete: true, mapped_flood_percent: 10, floodway_acres: 0, sfha_acres: 10 }),
    wetlandsLoader: async () => ({ nwi_percent: 5, nwi_mapped_acres: 5 }),
    cleanupsLoader: async () => ({
      nearest_cleanup_m: 1000,
      cleanup_sites_on_parcel: 0,
      cleanup_sites_within_5_mi: 1,
      superfund_within_5_mi: 1,
      rcra_within_5_mi: 0,
      brownfields_within_5_mi: 0,
      nearest_site_name: 'TEST SITE',
    }),
    mswLoader: async () => ({
      coverage_complete: true,
      nearest_msw_site_m: 1200,
      nearest_site_name: 'TEST LANDFILL',
      msw_points_on_parcel: 0,
      active_landfills_within_1_mi: 1,
      active_landfills_within_3_mi: 1,
      closed_sites_within_1_mi: 0,
      closed_sites_within_3_mi: 0,
      unauthorized_sites_within_1_mi: 0,
      unauthorized_sites_within_3_mi: 0,
      hazardous_history_sites_within_3_mi: 0,
      all_msw_sites_within_5_mi: 1,
    }),
    soilsLoader: async () => ({ dominant: { mappedSharePercent: 80, farmlandClass: 'Prime farmland' } }),
    terrainLoader: async () => ({ slope: { meanDegrees: 3, maxDegrees: 8 } }),
    transportationLoader: async () => ({
      nearest_road_m: 20,
      nearest_road_name: 'FM 1234',
      road_centerlines_within_250_ft: 1,
      nearest_aadt_current: 12000,
      nearest_station_m: 1000,
      nearest_station_5yr_change_percent: 10,
    }),
    utilitiesLoader: async () => ({
      water_service_overlap_percent: 100,
      water_ccn_overlap_percent: 100,
      nearest_transmission_m: 2000,
      transmission_crossing_count: 0,
    }),
    waterRightsLoader: async () => ({
      nearest_water_right_point_m: 500,
      water_right_points_on_parcel: 0,
      water_right_points_within_1_mi: 1,
      water_right_points_within_5_mi: 3,
      distinct_water_rights_within_5_mi: 2,
    }),
    cemeteriesLoader: async () => ({
      nearest_cemetery_m: 300,
      nearest_cemetery_name: 'TEST CEMETERY',
      cemeteries_intersecting_parcel: 0,
      cemetery_overlap_acres: 0,
      cemetery_overlap_percent: 0,
      cemeteries_within_1_mi: 1,
      cemeteries_within_3_mi: 1,
      cemeteries_within_5_mi: 1,
      archaeology_public_screen_status: 'restricted-location-data-not-screened',
    }),
    entitlementLoader: async () => ({
      jurisdiction_screen: 'san-antonio-city-zoned',
      city_zoning_coverage_percent: 100,
      zoning_feature_count: 1,
      city_zoning_feature_count: 1,
      zoning_special_condition_count: 0,
      dominant_zoning_base: 'R-6',
      dominant_zoning_code: 'R-6',
      dominant_zoning_share_percent: 100,
      etj_overlap_percent: 0,
      future_land_use_coverage_percent: 100,
      dominant_future_land_use: 'Low Density Residential',
      dominant_future_land_use_plan: 'Area Plan',
      dominant_future_land_use_share_percent: 100,
      legal_entitlement_determined: false,
    }),
    growthRadarLoader: async () => ({
      growth_radius_miles: 25,
      nearest_mtp_m: 900,
      nearest_mtp_street: 'TEST PARKWAY',
      mtp_crossing_count: 0,
      mtp_proposed_or_changed_within_5_mi: 2,
      preliminary_plats_on_parcel: 0,
      preliminary_plats_within_5_mi: 3,
      preliminary_plats_within_10_mi: 7,
      preliminary_plats_within_25_mi: 16,
      nearest_preliminary_plat_m: 1400,
      nearest_preliminary_plat_name: 'TEST PLAT',
      regional_centers_within_5_mi: 1,
      regional_centers_within_10_mi: 1,
      regional_centers_within_25_mi: 2,
      nearest_regional_center_m: 5000,
      nearest_regional_center_name: 'TEST CENTER',
      growth_score_ready: false,
    }),
  });

  assert.equal(result.sourceCoveragePercent, 100);
  assert.equal(result.acquisitionBrief.buyRecommendation, null);
  assert.ok(result.acquisitionBrief.risks.some((risk) => risk.id === 'pipeline-crossing'));
  assert.ok(result.acquisitionBrief.gaps.some((gap) => gap.id === 'category:ownershipTitle'));
  assert.equal(result.score.components.ownershipTitle.status, 'unknown');
  assert.equal(result.evidence.ownershipTitle.title_clear, null);
  assert.equal(result.evidence.ownershipTitle.tasks[0].id, 'survey-easements');
  assert.equal(result.evidence.developmentConstraints.combined_mapped_constraint_acres, 15);
  assert.equal(result.score.components.developmentPotential.status, 'unknown');
  assert.equal(Math.round(result.score.coveragePercent), 55);
  assert.equal(result.score.readiness, 'insufficient-evidence');
  assert.equal(result.score.components.growth.status, 'unknown');
  assert.ok(result.redFlags.some((item) => item.id === 'pipeline-crossing'));
  assert.ok(result.redFlags.some((item) => item.id === 'nearby-epa-cleanup'));
  assert.ok(result.redFlags.some((item) => item.id === 'legal-access-unverified'));
  assert.deepEqual(result.failedSources, []);
  assert.ok(result.score.components.environmental.evidence.some((item) => item.includes('Superfund')));
  assert.equal(result.score.components.accessTraffic.status, 'preliminary');
  assert.equal(result.score.components.utilitiesInfrastructure.status, 'preliminary');
  assert.equal(result.score.components.entitlementZoning.status, 'preliminary');
  assert.ok(result.redFlags.some((item) => item.id === 'utility-capacity-unverified'));
  assert.ok(result.redFlags.some((item) => item.id === 'tceq-water-right-point-nearby'));
  assert.ok(result.redFlags.some((item) => item.id === 'active-landfill-within-1-mi'));
  assert.ok(result.redFlags.some((item) => item.id === 'thc-cemetery-adjacent'));
  assert.ok(result.redFlags.some((item) => item.id === 'archeology-public-screen-incomplete'));
  assert.ok(result.redFlags.some((item) => item.id === 'legal-entitlement-unverified'));
  assert.ok(result.redFlags.some((item) => item.id === 'planned-mobility-change-within-5-mi'));
  assert.ok(result.redFlags.some((item) => item.id === 'preliminary-plat-activity-within-5-mi'));
  assert.match(result.score.components.environmental.source, /TCEQ MSW/);
});

test('keeps partial evidence when providers fail', async () => {
  const unavailable = Object.assign(new Error('PostGIS not configured'), { status: 503 });
  const result = await runBdpParcelScreening(parcel, {
    developmentConstraintsLoader: async () => { throw unavailable; },
    energyLoader: async () => { throw unavailable; },
    floodLoader: async () => { throw unavailable; },
    wetlandsLoader: async () => { throw unavailable; },
    cleanupsLoader: async () => { throw unavailable; },
    mswLoader: async () => { throw unavailable; },
    soilsLoader: async () => ({ dominant: { mappedSharePercent: 90, farmlandClass: '' } }),
    terrainLoader: async () => ({ slope: { meanDegrees: 4, maxDegrees: 9 } }),
    transportationLoader: async () => { throw unavailable; },
    utilitiesLoader: async () => { throw unavailable; },
    waterRightsLoader: async () => { throw unavailable; },
    cemeteriesLoader: async () => { throw unavailable; },
    entitlementLoader: async () => { throw unavailable; },
    growthRadarLoader: async () => { throw unavailable; },
  });

  assert.equal(result.sourceCoveragePercent, (2 / 13) * 100);
  assert.equal(result.acquisitionBrief.buyRecommendation, null);
  assert.ok(result.acquisitionBrief.gaps.some((gap) => gap.id === 'source:flood' && gap.status === 'unavailable'));
  assert.equal(result.evidence.ownershipTitle.status, 'documents-required');
  assert.ok(result.evidence.ownershipTitle.tasks.every((task) => task.status === 'unknown'));
  assert.equal(result.score.components.ownershipTitle.status, 'unknown');
  assert.deepEqual([...result.succeededSources].sort(), ['soils', 'terrain']);
  assert.deepEqual([...result.failedSources].sort(), ['cemeteries', 'cleanups', 'energy', 'entitlement', 'flood', 'growthRadar', 'msw', 'transportation', 'utilities', 'waterRights', 'wetlands']);
  assert.equal(result.errors.energy.status, 503);
  assert.equal(result.errors.cleanups.status, 503);
  assert.equal(result.errors.msw.status, 503);
  assert.equal(result.errors.transportation.status, 503);
  assert.equal(result.errors.utilities.status, 503);
  assert.equal(result.errors.waterRights.status, 503);
  assert.equal(result.errors.cemeteries.status, 503);
  assert.equal(result.errors.entitlement.status, 503);
  assert.equal(result.errors.growthRadar.status, 503);
  assert.equal(result.errors.developmentConstraints.status, 503);
  assert.equal(result.evidence.developmentConstraints, null);
  assert.equal(result.score.coveragePercent, 5);
  assert.equal(result.score.components.environmental.status, 'unknown');
  assert.equal(result.score.components.floodWater.status, 'unknown');
  assert.equal(result.score.components.terrainSoil.status, 'preliminary');
  assert.equal(result.score.components.accessTraffic.status, 'unknown');
  assert.equal(result.score.components.utilitiesInfrastructure.status, 'unknown');
  assert.equal(result.score.components.entitlementZoning.status, 'unknown');
});
