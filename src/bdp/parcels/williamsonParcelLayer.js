import { createCountyParcelLayer } from './bexarParcelLayer.js';
import williamsonCadAdapter from '../cad/williamsonAdapter.js';

export const williamsonParcelLayer = createCountyParcelLayer({
  adapter: williamsonCadAdapter,
  id: 'bdp-williamson-parcels',
  name: 'BDP · Williamson Parcels',
  source: 'Williamson County GIS · WCAD',
});
export default williamsonParcelLayer;
