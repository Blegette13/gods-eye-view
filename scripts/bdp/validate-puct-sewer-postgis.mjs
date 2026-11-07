import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { downloadPuctSewerArchive, importPuctSewerArchive } from './puct-sewer-import.mjs';
import { buildPuctSewerMapSql } from '../../src/bdp/utilities/utilityContract.js';

const exec = promisify(execFile);
const { filename, manifest } = await downloadPuctSewerArchive();
await importPuctSewerArchive({ filename, manifest });
const { stdout } = await exec('psql', ['-v', 'ON_ERROR_STOP=1', '--tuples-only', '--no-align', '-c', `
SELECT jsonb_build_object(
  'rows', (SELECT COUNT(*) FROM bdp_puct_sewer_ccn),
  'source_date', (SELECT source_last_modified FROM bdp_puct_sewer_ccn_snapshot),
  'sample', bdp_puct_sewer_ccn_metrics((
    SELECT ST_Buffer(ST_PointOnSurface(geom)::geography, 50)::geometry
    FROM bdp_puct_sewer_ccn LIMIT 1
  ))
)::text;`], { env: process.env, timeout: 20000 });
const result = JSON.parse(stdout.trim());
if (result.rows < 1000 || !result.source_date ||
    result.sample.sewer_ccn_coverage !== 'mapped-snapshot' ||
    result.sample.sewer_ccn_overlap_percent <= 0 ||
    !result.sample.sewer_ccn_utilities.length) {
  throw new Error('PUCT sewer archive did not produce complete parcel territory metrics');
}
const centroid = await exec('psql', ['-v', 'ON_ERROR_STOP=1', '--tuples-only', '--no-align', '-c',
  'SELECT ST_X(ST_PointOnSurface(geom)), ST_Y(ST_PointOnSurface(geom)) FROM bdp_puct_sewer_ccn LIMIT 1'],
{ env: process.env, timeout: 20000 });
const [longitude, latitude] = centroid.stdout.trim().split('|').map(Number);
const mapSql = buildPuctSewerMapSql({ west: longitude - 0.001, south: latitude - 0.001,
  east: longitude + 0.001, north: latitude + 0.001 });
const map = await exec('psql', ['-v', 'ON_ERROR_STOP=1', '--tuples-only', '--no-align', '-c', mapSql],
  { env: process.env, timeout: 20000, maxBuffer: 2 * 1024 * 1024 });
const geojson = JSON.parse(map.stdout.trim());
if (geojson.type !== 'FeatureCollection' || geojson.coverage !== 'mapped-snapshot'
  || geojson.truncated || !geojson.features.length || !geojson.features[0].geometry) {
  throw new Error('PUCT sewer viewport did not produce clipped GeoJSON territory');
}
console.log(`[BDP:PUCT Sewer] ${result.rows} official CCN polygons and parcel overlap passed; source date ${result.source_date}`);
