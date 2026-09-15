import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { getTceqWaterRightsDataset } from '../../src/bdp/water/tceqWaterRightsCatalog.js';

function parseArgs(argv) {
  const options = {
    datasets: ['active', 'inactive'],
    cacheDir: '.gev-cache/bdp/tceq-water',
  };

  for (const argument of argv) {
    if (argument.startsWith('--dataset=')) {
      const value = argument.slice('--dataset='.length).trim().toLowerCase();
      options.datasets = value === 'all' ? ['active', 'inactive'] : [value];
    } else if (argument.startsWith('--cache=')) {
      options.cacheDir = argument.slice('--cache='.length);
    } else if (argument === '--help' || argument === '-h') {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  for (const dataset of options.datasets) getTceqWaterRightsDataset(dataset);
  return options;
}

function usage() {
  return [
    'BDP TCEQ surface-water-rights PostGIS importer',
    '',
    'Requirements:',
    '  - GDAL with the XLSX driver (ogrinfo / ogr2ogr)',
    '  - PostgreSQL psql client',
    '  - BDP_PG_SERVICE set to a libpq service name',
    '',
    'Usage:',
    '  node scripts/bdp/tceq-water-import.mjs [--dataset=all|active|inactive]',
  ].join('\n');
}

function run(command, args, { capture = false } = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = capture ? String(result.stderr || result.stdout || '').trim() : '';
    throw new Error(`${command} failed with exit code ${result.status}${detail ? `: ${detail}` : ''}`);
  }
  return capture ? String(result.stdout || '').trim() : '';
}

function assertTools() {
  run('ogrinfo', ['--version'], { capture: true });
  run('ogr2ogr', ['--version'], { capture: true });
  run('psql', ['--version'], { capture: true });
}

function psqlArgs(service) {
  return [`service=${service}`, '-v', 'ON_ERROR_STOP=1'];
}

function sqlLiteral(value) {
  return `'${String(value ?? '').replaceAll("'", "''")}'`;
}

function stageTable(dataset) {
  return `bdp_tceq_water_${dataset}_stage`;
}

export function parseOgrLayerNames(output) {
  return String(output || '')
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*\d+:\s+(.+?)(?:\s+\([^)]*\))?\s*$/)?.[1]?.trim())
    .filter(Boolean);
}

function discoverFirstLayer(filename) {
  const output = run('ogrinfo', ['-ro', '-so', filename], { capture: true });
  const layers = parseOgrLayerNames(output);
  if (!layers.length) throw new Error(`No readable worksheet found in ${path.basename(filename)}`);
  return layers[0];
}

function applySchema(service) {
  run('psql', [
    ...psqlArgs(service),
    '-f',
    'src/bdp/ingestion/sql/tceqWaterRightsPostgis.sql',
    '-f',
    'src/bdp/ingestion/sql/tceqParcelWater.sql',
  ]);
}

function alreadyImported(service, { dataset, checksumSha256 }) {
  if (!checksumSha256) return false;
  const query = `
    SELECT EXISTS (
      SELECT 1
      FROM bdp_ingestion_runs
      WHERE source_id = 'tceq-water-rights'
        AND dataset = ${sqlLiteral(dataset)}
        AND county_fips IS NULL
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

function importStage({ service, dataset, sourcePath }) {
  const table = stageTable(dataset);
  const layer = discoverFirstLayer(sourcePath);
  run('ogr2ogr', [
    '-f',
    'PostgreSQL',
    `PG:service=${service}`,
    sourcePath,
    layer,
    '-nln',
    table,
    '-overwrite',
    '-lco',
    'LAUNDER=YES',
    '-lco',
    'PRECISION=NO',
  ]);
  return table;
}

function jsonText(alias, keys) {
  return `COALESCE(${keys
    .map((key) => `NULLIF(BTRIM((to_jsonb(${alias}) ->> ${sqlLiteral(key)})::TEXT), '')`)
    .join(', ')})`;
}

function safeNumber(expression) {
  const normalized = `REPLACE(${expression}, ',', '')`;
  return `CASE WHEN ${normalized} ~ '^-?[0-9]+(?:\\.[0-9]+)?$' THEN ${normalized}::DOUBLE PRECISION ELSE NULL END`;
}

function safeDate(expression) {
  return `CASE
    WHEN ${expression} IS NULL THEN NULL
    WHEN ${expression} ~ '^\\d{4}-\\d{2}-\\d{2}' THEN SUBSTRING(${expression} FROM 1 FOR 10)::DATE
    WHEN ${expression} ~ '^\\d{1,2}/\\d{1,2}/\\d{4}' THEN ${expression}::DATE
    ELSE NULL
  END`;
}

export function buildNormalizeSql({ dataset, table, manifest }) {
  const status = dataset === 'active' ? 'active' : 'inactive';
  const rightId = jsonText('s', ['wr_no', 'wr no', 'WR No', 'water_right_number']);
  const rightType = jsonText('s', ['wr_type', 'wr type', 'WR Type']);
  const holder = jsonText('s', ['owners', 'Owners', 'owner']);
  const basin = jsonText('s', ['basin', 'Basin']);
  const priority = jsonText('s', ['prio_dt', 'prio dt', 'Prio DT', 'priority_date']);
  const diversion = jsonText('s', ['divert_amt', 'divert amt', 'Divert Amt', 'diversion_amount']);
  const useType = jsonText('s', ['use', 'Use', 'use_type']);
  const sourceLastModified = manifest.lastModified
    ? `${sqlLiteral(manifest.lastModified)}::timestamptz`
    : 'NULL';

  return `
    BEGIN;
    DELETE FROM bdp_tceq_water_rights WHERE source_dataset = ${sqlLiteral(dataset)};

    INSERT INTO bdp_tceq_water_rights (
      record_status, water_right_id, authorization_type, holder_name, basin,
      county, priority_date, authorized_amount_acre_feet, use_type,
      source_dataset, source_filename, source_url, source_record,
      source_last_modified
    )
    SELECT
      ${sqlLiteral(status)},
      ${rightId},
      ${rightType},
      ${holder},
      ${basin},
      NULL,
      ${safeDate(priority)},
      ${safeNumber(diversion)},
      ${useType},
      ${sqlLiteral(dataset)},
      ${sqlLiteral(manifest.filename)},
      ${sqlLiteral(manifest.url)},
      to_jsonb(s) - 'ogc_fid',
      ${sourceLastModified}
    FROM ${table} s
    WHERE ${rightId} IS NOT NULL;

    INSERT INTO bdp_ingestion_runs (
      source_id, dataset, source_filename, source_url, source_last_modified,
      checksum_sha256, completed_at, status, row_count
    ) VALUES (
      'tceq-water-rights',
      ${sqlLiteral(dataset)},
      ${sqlLiteral(manifest.filename)},
      ${sqlLiteral(manifest.url)},
      ${sourceLastModified},
      ${sqlLiteral(manifest.checksumSha256 || '')},
      NOW(),
      'succeeded',
      (SELECT COUNT(*) FROM bdp_tceq_water_rights WHERE source_dataset = ${sqlLiteral(dataset)})
    );

    DROP TABLE ${table};
    COMMIT;
  `;
}

async function importDataset({ service, dataset, cacheDir }) {
  const spec = getTceqWaterRightsDataset(dataset);
  const sourcePath = path.resolve(cacheDir, spec.filename);
  const manifestPath = `${sourcePath}.json`;
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

  if (alreadyImported(service, { dataset, checksumSha256: manifest.checksumSha256 })) {
    return { dataset, filename: spec.filename, status: 'skipped-unchanged' };
  }

  const table = importStage({ service, dataset, sourcePath });
  run('psql', [
    ...psqlArgs(service),
    '--command',
    buildNormalizeSql({ dataset, table, manifest }),
  ]);
  return { dataset, filename: spec.filename, status: 'imported' };
}

export async function runTceqWaterImport(options = {}) {
  const service = process.env.BDP_PG_SERVICE;
  if (!service || !/^[A-Za-z0-9_.-]+$/.test(service)) {
    throw new Error('Set BDP_PG_SERVICE to a configured libpq service name before importing');
  }

  assertTools();
  applySchema(service);
  const datasets = options.datasets || ['active', 'inactive'];
  const cacheDir = path.resolve(options.cacheDir || '.gev-cache/bdp/tceq-water');
  const results = [];
  for (const dataset of datasets) {
    results.push(await importDataset({ service, dataset, cacheDir }));
  }
  return results;
}

const invoked = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : '';

if (import.meta.url === invoked) {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
  } else {
    try {
      const results = await runTceqWaterImport(options);
      for (const result of results) {
        console.log(`[BDP:TCEQ] ${result.status} ${result.filename}`);
      }
    } catch (error) {
      console.error(`[BDP:TCEQ] ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    }
  }
}
