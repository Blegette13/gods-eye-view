export const BDP_INTELLIGENCE_API_BASE = '/api/bdp/intelligence';

export function normalizeBdpIntelligenceRequest(input) {
  const parcel = input?.parcel ?? input;
  if (!parcel || typeof parcel !== 'object') {
    throw new Error('Parcel is required for BDP intelligence screening');
  }
  if (!parcel?.property?.geometry) {
    throw new Error('Parcel geometry is required for BDP intelligence screening');
  }
  const geometryType = parcel.property.geometry.type;
  if (geometryType !== 'Polygon' && geometryType !== 'MultiPolygon') {
    throw new Error('Parcel geometry must be Polygon or MultiPolygon');
  }
  return Object.freeze({ parcel });
}

export default normalizeBdpIntelligenceRequest;
