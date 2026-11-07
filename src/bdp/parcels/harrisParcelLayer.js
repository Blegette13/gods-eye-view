import { createCountyParcelLayer } from './bexarParcelLayer.js';
import harrisCadAdapter from '../cad/harrisAdapter.js';

export const harrisParcelLayer = createCountyParcelLayer({
  adapter: harrisCadAdapter,
  id: 'bdp-harris-parcels',
  name: 'BDP · Harris Parcels',
  source: 'Harris County GIS / HCAD',
});
export default harrisParcelLayer;
