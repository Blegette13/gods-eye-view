import { createCountyParcelLayer } from './bexarParcelLayer.js';
import dallasCadAdapter from '../cad/dallasAdapter.js';

export const dallasParcelLayer = createCountyParcelLayer({
  adapter: dallasCadAdapter,
  id: 'bdp-dallas-parcels',
  name: 'BDP · Dallas Parcels',
  source: 'Dallas Central Appraisal District GIS',
});
export default dallasParcelLayer;
