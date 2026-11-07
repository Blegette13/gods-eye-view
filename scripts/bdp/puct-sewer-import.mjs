import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

export const PUCT_SEWER_ARCHIVE_URL = 'https://ftp.puc.texas.gov/public/puct-info/industry/water/utilities/PUCT_CCN_SEWER_TSMS.zip';
const exec = promisify(execFile);
const shape = 'PUCT_CCN_SEWER_TSMS_for_GIS/PUCT_CCN_SEWER_TSMS.shp';
const schemaFile = fileURLToPath(new URL('../../src/bdp/ingestion/sql/puctSewerCcn.sql', import.meta.url));

function sqlLiteral(value) { return `'${String(value).replaceAll("'", "''")}'`; }
function pgConnection() {
  const service = String(process.env.BDP_PG_SERVICE || '').trim();
  if (service && /^[\w.-]+$/.test(service)) return `PG:service=${service}`;
  const names = [['host', 'PGHOST'], ['port', 'PGPORT'], ['dbname', 'PGDATABASE'], ['user', 'PGUSER']];
  if (!process.env.PGDATABASE) throw new Error('Set BDP_PG_SERVICE or PGDATABASE before importing PUCT CCNs');
  return `PG:${names.filter(([, env]) => process.env[env]).map(([key, env]) => `${key}=${process.env[env]}`).join(' ')}`;
}
function psqlArgs() {
  const service = String(process.env.BDP_PG_SERVICE || '').trim();
  return [...(service ? [`service=${service}`] : []), '-v', 'ON_ERROR_STOP=1', '--no-psqlrc'];
}
async function run(program, args, options = {}) {
  return exec(program, args, { env: process.env, timeout: 120000, maxBuffer: 2 * 1024 * 1024, ...options });
}

export async function downloadPuctSewerArchive({ cacheDir = '.gev-cache/bdp/puct-sewer', fetchImpl = globalThis.fetch } = {}) {
  const directory = path.resolve(cacheDir);
  await mkdir(directory, { recursive: true });
  const filename = path.join(directory, 'PUCT_CCN_SEWER_TSMS.zip');
  const manifestFile = `${filename}.json`;
  let previous = null;
  try { previous = JSON.parse(await readFile(manifestFile, 'utf8')); } catch { /* no verified cache */ }
  let verified = false;
  try {
    await access(filename);
    verified = createHash('sha256').update(await readFile(filename)).digest('hex') === previous?.checksumSha256;
  } catch { /* no verified cache */ }
  const headers = {};
  if (verified && previous?.etag) headers['if-none-match'] = previous.etag;
  if (verified && previous?.sourceLastModified) headers['if-modified-since'] = previous.sourceLastModified;
  const response = await fetchImpl(PUCT_SEWER_ARCHIVE_URL, { headers, signal: AbortSignal.timeout(30000) });
  if (response.status === 304 && verified) return { filename, manifest: previous, changed: false };
  if (!response.ok) throw new Error(`PUCT sewer CCN download failed (${response.status})`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 1024 || bytes.length > 40 * 1024 * 1024 || bytes.toString('ascii', 0, 4) !== 'PK\x03\x04') {
    throw new Error('PUCT sewer CCN download is not a bounded ZIP archive');
  }
  const checksumSha256 = createHash('sha256').update(bytes).digest('hex');
  const sourceLastModified = response.headers.get('last-modified');
  const manifest = { sourceUrl: PUCT_SEWER_ARCHIVE_URL, checksumSha256, sourceLastModified:
    sourceLastModified && !Number.isNaN(Date.parse(sourceLastModified)) ? sourceLastModified : null,
    etag: response.headers.get('etag'), checkedAt: new Date().toISOString() };
  const changed = !verified || checksumSha256 !== previous.checksumSha256;
  if (changed) await writeFile(filename, bytes);
  await writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  return { filename, manifest, changed };
}

export async function importPuctSewerArchive({ filename, manifest }) {
  if (!filename || !manifest || !/^[a-f0-9]{64}$/.test(manifest.checksumSha256)) throw new Error('Verified PUCT archive manifest required');
  const archive = path.resolve(filename);
  const digest = createHash('sha256').update(await readFile(archive)).digest('hex');
  if (digest !== manifest.checksumSha256) throw new Error('PUCT sewer archive checksum changed');
  await run('psql', [...psqlArgs(), '-f', schemaFile]);
  // GDAL reads the projection and transforms the official TSMS shapefile to WGS84.
  await run('ogr2ogr', ['-f', 'PostgreSQL', pgConnection(), `/vsizip/${archive}/${shape}`,
    '-overwrite', '-nln', 'bdp_puct_sewer_stage', '-nlt', 'PROMOTE_TO_MULTI',
    '-t_srs', 'EPSG:4326', '-select', 'CCN_NO,UTILITY,DBA_NAME,COUNTY,STATUS,CCN_TYPE',
    '-lco', 'GEOMETRY_NAME=geom']);
  const sourceDate = manifest.sourceLastModified && !Number.isNaN(Date.parse(manifest.sourceLastModified))
    ? sqlLiteral(new Date(manifest.sourceLastModified).toISOString()) : 'NULL';
  const sql = `BEGIN;
    DO $$ BEGIN
      IF (SELECT COUNT(*) FROM bdp_puct_sewer_stage) < 1000
        OR EXISTS (SELECT 1 FROM bdp_puct_sewer_stage WHERE geom IS NULL OR ST_IsEmpty(geom)
          OR ST_GeometryType(geom) NOT IN ('ST_Polygon','ST_MultiPolygon')) THEN
        RAISE EXCEPTION 'PUCT sewer CCN staging is incomplete or has invalid geometry';
      END IF;
    END $$;
    TRUNCATE bdp_puct_sewer_ccn;
    INSERT INTO bdp_puct_sewer_ccn (ccn_no, utility, dba_name, county, status, ccn_type, geom)
    SELECT NULLIF(ccn_no, ''), NULLIF(utility, ''), NULLIF(dba_name, ''), NULLIF(county, ''),
      NULLIF(status, ''), NULLIF(ccn_type, ''), ST_Multi(ST_CollectionExtract(ST_MakeValid(geom), 3))
    FROM bdp_puct_sewer_stage;
    INSERT INTO bdp_puct_sewer_ccn_snapshot (singleton, source_url, source_last_modified, checksum_sha256, feature_count)
    SELECT TRUE, ${sqlLiteral(PUCT_SEWER_ARCHIVE_URL)}, ${sourceDate}, ${sqlLiteral(digest)}, COUNT(*)
    FROM bdp_puct_sewer_ccn
    ON CONFLICT (singleton) DO UPDATE SET source_url = EXCLUDED.source_url,
      source_last_modified = EXCLUDED.source_last_modified, checksum_sha256 = EXCLUDED.checksum_sha256,
      feature_count = EXCLUDED.feature_count, imported_at = NOW();
    COMMIT;`;
  await run('psql', [...psqlArgs(), '-c', sql]);
  await run('psql', [...psqlArgs(), '-c', 'DROP TABLE IF EXISTS bdp_puct_sewer_stage']);
  return { checksumSha256: digest, sourceLastModified: manifest.sourceLastModified };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cacheDir = process.argv.find((arg) => arg.startsWith('--cache='))?.slice(8);
  const result = await downloadPuctSewerArchive({ ...(cacheDir && { cacheDir }) });
  const imported = await importPuctSewerArchive(result);
  console.log(`[BDP:PUCT Sewer] Imported verified ${imported.checksumSha256} (${imported.sourceLastModified || 'source date unknown'})`);
}
