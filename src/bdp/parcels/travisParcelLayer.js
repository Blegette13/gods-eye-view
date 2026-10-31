import { createCountyParcelLayer } from './bexarParcelLayer.js';
import travisCadAdapter from '../cad/travisAdapter.js';

export const travisParcelLayer = createCountyParcelLayer({
  adapter: travisCadAdapter,
  id: 'bdp-travis-parcels',
  name: 'BDP · Travis Parcels',
  source: 'Travis County GIS · TCAD',
});

export default travisParcelLayer;
