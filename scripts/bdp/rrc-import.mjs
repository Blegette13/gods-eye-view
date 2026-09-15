import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { normalizeTexasCountyFips } from '../../src/bdp/ingestion/rrcCatalog.js';

function parseArgs(argv) {
  const options = {
    county: '029',
    datasets: ['wells', 'pipelines'],
    cacheDir: '.gev-cache/bdp/rrc',
  };

  for (const argument of argv) {
    if (argument.startsWith('--county=')) {
      options.county = argument.slice('--county='.length);
    } else if (argument.startsWith('--dataset=')) {
      const value = argument.slice('--dataset='.length).trim().toLowerCase();
      options.datasets = value === 'all' ? ['wells', 'pipelines'] : [value];
    } else if (argument.startsWith('--cache=')) {
      options.cacheDir = argument.slice('--cache='.length);
    } else if (argument === '--help' || argument === '-h') {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  for (const dataset of options.datasets) {
    if (!['wells', 'pipelines'].includes(dataset)) {
      throw new Error(`Unsupported RRC dataset: ${dataset}`);
    }
  }

  return options;
}

function usage() {
  return [
    'BDP RRC PostGIS importer',
    '',
    'Requirements:',
    '  - GDAL/ogr2ogr',
    '  - PostgreSQL psql client',
    '  - BDP_PG_SERVICE set to a libpq service name',
    '',
    'Usage:',
    '  node scripts/bdp/rrc-import.mjs [--county=029] [--dataset=all|wells|pipelines]',
  ].join('\n');
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = options.capture ? String(result.stderr || result.stdout || '').trim() : '';
    throw new Error(`${command} failed with exit code ${result.status}${detail ? `: ${detail}` : ''}`);
  }
  return options.capture ? String(result.stdout || '').trim() : '';
}

function assertTools() {
  run('ogr2ogr', ['--version'], { capture: true });
  run('psql', ['--version'], { capture: true });
}

function sqlLiteral(value) {
  return `'${String(value ?? '').replaceAll("'", "''")}'`;
}

function psqlArgs(service) {
  return [`service=${service}`, '-v', 'ON_ERROR_STOP=1'];
}

function applySchema(service) {
  run('psql', [
    ...psqlArgs(service),
    '-f',
    'src/bdp/ingestion/sql/rrcPostgis.sql',
    '-f',
    'src/bdp/ingestion/sql/rrcParcelEnergy.sql',
  ]);
}

function alreadyImported(service, { dataset, countyFips, checksumSha256 }) {
  if (!checksumSha256) return false;
  const query = `
    SELECT EXISTS (
      SELECT 1
      FROM bdp_ingestion_runs
      WHERE source_id = 'texas-rrc'
        AND dataset = ${sqlLiteral(dataset)}
        AND county_fips = ${sqlLiteral(countyFips)}
        AND checksum_sha256 = ${sqlLiteral(checksumSha256)}
        AND status = 'succeeded'
    );
  `;
  return run('psql', [
    ...psqlArgs(service),
    '--tuples-only',
    '--no-align',
    '--command',
    query,
  ], { capture: true }) === 't';
}

function sourceLayer(dataset, countyFips) {
  return dataset === 'wells'
    ? `well${countyFips}s.shp`
    : `pipe${countyFips}l.shp`;
}

function stageTable(dataset, countyFips) {
  return `bdp_rrc_${dataset}_stage_${countyFips}`;
}

function importStage({ service, dataset, countyFips, archivePath }) {
  const layer = sourceLayer(dataset, countyFips);
  const table = stageTable(dataset, countyFips);
  const source = `/vsizip/${path.resolve(archivePath).replaceAll('\\', '/')}/${layer}`;
  const geometryType = dataset === 'wells' ? 'POINT' : 'PROMOTE_TO_MULTI';

  run('ogr2ogr', [
    '-f',
    'PostgreSQL',
    `PG:service=${service}`,
    source,
    '-nln',
    table,
    '-overwrite',
    '-s_srs',
    'EPSG:4267',
    '-t_srs',
    'EPSG:4326',
    '-nlt',
    geometryType,
    '-lco',
    'GEOMETRY_NAME=geom',
    '-lco',
    'LAUNDER=YES',
    '-lco',
    'PRECISION=NO',
  ]);

  return table;
}

function wellStatusSql() {
  return `CASE s.symnum::INTEGER
    WHEN 2 THEN 'permitted'
    WHEN 3 THEN 'dry-hole'
    WHEN 4 THEN 'oil'
    WHEN 5 THEN 'gas'
    WHEN 6 THEN 'oil-gas'
    WHEN 7 THEN 'plugged-oil'
    WHEN 8 THEN 'plugged-gas'
    WHEN 9 THEN 'canceled-location'
    WHEN 10 THEN 'plugged-oil-gas'
    WHEN 11 THEN 'injection-disposal'
    WHEN 19 THEN 'shut-in-oil'
    WHEN 20 THEN 'shut-in-gas'
    WHEN 86 THEN 'horizontal-surface'
    WHEN 87 THEN 'directional-surface'
    ELSE CASE WHEN s.symnum IS NULL THEN NULL ELSE 'symnum-' || s.symnum::TEXT END
  END`;
}

function normalizeSql({ dataset, countyFips, table, manifest }) {
  const filename = sqlLiteral(manifest.filename);
  const lastModified = manifest.lastModified ? `${sqlLiteral(manifest.lastModified)}::timestamptz` : 'NULL';
  const sourceUrl = sqlLiteral(manifest.resolvedDownloadUrl || manifest.folderUrl || '');
  const checksum = sqlLiteral(manifest.checksumSha256 || '');

  if (dataset === 'wells') {
    return `
      BEGIN;
      DELETE FROM bdp_rrc_wells WHERE county_fips = ${sqlLiteral(countyFips)};
      INSERT INTO bdp_rrc_wells (
        county_fips, api_number, well_id, surface_id, symnum, status,
        reliability_code, source_lat27, source_long27, source_lat83,
        source_long83, source_filename, source_record, source_last_modified, geom
      )
      SELECT
        ${sqlLiteral(countyFips)},
        NULLIF(BTRIM(s.api::TEXT), ''),
        NULLIF(BTRIM(s.wellid::TEXT), ''),
        NULLIF(s.surface_id::TEXT, '')::BIGINT,
        NULLIF(s.symnum::TEXT, '')::INTEGER,
        ${wellStatusSql()},
        NULLIF(BTRIM(s.reliab::TEXT), ''),
        NULLIF(s.lat27::TEXT, '')::DOUBLE PRECISION,
        NULLIF(s.long27::TEXT, '')::DOUBLE PRECISION,
        NULLIF(s.lat83::TEXT, '')::DOUBLE PRECISION,
        NULLIF(s.long83::TEXT, '')::DOUBLE PRECISION,
        ${filename},
        to_jsonb(s) - 'geom',
        ${lastModified},
        s.geom
      FROM ${table} s
      WHERE s.geom IS NOT NULL;
      INSERT INTO bdp_ingestion_runs (
        source_id, dataset, county_fips, source_filename, source_url,
        source_last_modified, checksum_sha256, completed_at, status, row_count
      ) VALUES (
        'texas-rrc', 'wells', ${sqlLiteral(countyFips)}, ${filename}, ${sourceUrl},
        ${lastModified}, ${checksum}, NOW(), 'succeeded',
        (SELECT COUNT(*) FROM bdp_rrc_wells WHERE county_fips = ${sqlLiteral(countyFips)})
      );
      DROP TABLE ${table};
      COMMIT;
    `;
  }

  return `
    BEGIN;
    DELETE FROM bdp_rrc_pipelines WHERE county_fips = ${sqlLiteral(countyFips)};
    INSERT INTO bdp_rrc_pipelines (
      county_fips, tpms_id, ops_id, p5_number, operator_name, system_name,
      subsystem_name, pipeline_id, permit_number, diameter, commodity,
      commodity_code, operational_status, interstate_code, quality_code,
      system_type, source_filename, source_record, source_last_modified, geom
    )
    SELECT
      ${sqlLiteral(countyFips)},
      NULLIF(BTRIM(s.tpms_id::TEXT), ''),
      NULLIF(s.ops_id::TEXT, '')::BIGINT,
      NULLIF(BTRIM(s.p5_num::TEXT), ''),
      NULLIF(BTRIM(s.oper_nm::TEXT), ''),
      NULLIF(BTRIM(s.sys_nm::TEXT), ''),
      NULLIF(BTRIM(s.subsys_nm::TEXT), ''),
      NULLIF(BTRIM(s.pline_id::TEXT), ''),
      NULLIF(BTRIM(s.t4permit::TEXT), ''),
      NULLIF(s.diameter::TEXT, '')::DOUBLE PRECISION,
      COALESCE(NULLIF(BTRIM(s.cmdty_desc::TEXT), ''), NULLIF(BTRIM(s.commodity1::TEXT), '')),
      NULLIF(BTRIM(s.commodity1::TEXT), ''),
      CASE BTRIM(s.status_cd::TEXT)
        WHEN 'I' THEN 'in-service'
        WHEN 'B' THEN 'abandoned'
        ELSE NULLIF(BTRIM(s.status_cd::TEXT), '')
      END,
      NULLIF(BTRIM(s.interstate::TEXT), ''),
      NULLIF(BTRIM(s.quality_cd::TEXT), ''),
      NULLIF(BTRIM(s.systype::TEXT), ''),
      ${filename},
      to_jsonb(s) - 'geom',
      ${lastModified},
      ST_Multi(s.geom)
    FROM ${table} s
    WHERE s.geom IS NOT NULL;
    INSERT INTO bdp_ingestion_runs (
      source_id, dataset, county_fips, source_filename, source_url,
      source_last_modified, checksum_sha256, completed_at, status, row_count
    ) VALUES (
      'texas-rrc', 'pipelines', ${sqlLiteral(countyFips)}, ${filename}, ${sourceUrl},
      ${lastModified}, ${checksum}, NOW(), 'succeeded',
      (SELECT COUNT(*) FROM bdp_rrc_pipelines WHERE county_fips = ${sqlLiteral(countyFips)})
    );
    DROP TABLE ${table};
    COMMIT;
  `;
}

async function importDataset({ service, dataset, countyFips, cacheDir }) {
  const filename = dataset === 'wells' ? `well${countyFips}.zip` : `pipeline${countyFips}.zip`;
  const archivePath = path.resolve(cacheDir, countyFips, filename);
  const manifestPath = `${archivePath}.json`;
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

  if (alreadyImported(service, { dataset, countyFips, checksumSha256: manifest.checksumSha256 })) {
    return { dataset, filename, status: 'skipped-unchanged' };
  }

  const table = importStage({ service, dataset, countyFips, archivePath });
  run('psql', [
    ...psqlArgs(service),
    '--command',
    normalizeSql({ dataset, countyFips, table, manifest }),
  ]);

  return { dataset, filename, status: 'imported' };
}

export async function runRrcImport(options = {}) {
  const service = process.env.BDP_PG_SERVICE;
  if (!service || !/^[A-Za-z0-9_.-]+$/.test(service)) {
    throw new Error('Set BDP_PG_SERVICE to a configured libpq service name before importing');
  }

  assertTools();
  applySchema(service);

  const countyFips = normalizeTexasCountyFips(options.county || '029');
  const datasets = options.datasets || ['wells', 'pipelines'];
  const cacheDir = options.cacheDir || '.gev-cache/bdp/rrc';
  const results = [];
  for (const dataset of datasets) {
    results.push(await importDataset({ service, dataset, countyFips, cacheDir }));
  }
  return results;
}

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  console.log(usage());
} else {
  try {
    const results = await runRrcImport(options);
    for (const result of results) {
      console.log(`[BDP:RRC] ${result.status} ${result.filename}`);
    }
  } catch (error) {
    console.error(`[BDP:RRC] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
