import { createCountyParcelLayer } from './bexarParcelLayer.js';
import haysCadAdapter from '../cad/haysAdapter.js';

export const haysParcelLayer = createCountyParcelLayer({
  adapter: haysCadAdapter,
  id: 'bdp-hays-parcels',
  name: 'BDP · Hays Parcels',
  source: 'TNRIS / CODS · Hays CAD 2022 copy',
});
export default haysParcelLayer;
