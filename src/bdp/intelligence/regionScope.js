/**
 * Regional source availability is not the same thing as parcel jurisdiction.
 * Until other counties have verified entitlement and growth providers, run the
 * San Antonio-specific pilot only for parcels identified as Bexar County.
 * A Bexar parcel can still be outside San Antonio's actual city/ETJ geography;
 * the regional provider remains responsible for measuring that separately.
 */
export function eligibleForSanAntonioPilot(parcel) {
  const countyName = String(parcel?.county || parcel?.jurisdiction?.county || '').trim().toLowerCase();
  const fips = String(parcel?.countyFips || '').trim();
  const idPrefix = String(parcel?.id || '').trim().split(':')[0];

  // An explicit non-Bexar county is a veto even if another field conflicts.
  if (countyName && countyName !== 'bexar' && countyName !== 'bexar county') return false;
  if (fips && !['48029', '029'].includes(fips)) return false;
  if (/^\d{3,5}$/.test(idPrefix) && !['48029', '029'].includes(idPrefix)) return false;

  return countyName === 'bexar'
    || countyName === 'bexar county'
    || ['48029', '029'].includes(fips)
    || ['48029', '029'].includes(idPrefix);
}

export function unavailableRegionalPilotEvidence(source) {
  if (!['entitlement', 'growthRadar'].includes(source)) {
    throw new Error('Unsupported regional source');
  }
  const label = source === 'entitlement' ? 'zoning, ETJ, and land-use' : 'growth and planning';
  return Object.freeze({
    regional_scope_status: 'not-screened-outside-pilot',
    regional_scope_note: `Only the Bexar County San Antonio ${label} pilot is implemented. No locally applicable ${label} records were evaluated for this parcel. Obtain jurisdiction-specific evidence before making a land decision.`,
  });
}
