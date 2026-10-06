import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { sha256Hex } from '../../src/bdp/ingestion/rrcDownloader.js';
import { getTceqMswDataset } from '../../src/bdp/environment/tceqMswCatalog.js';

function parseArgs(argv) {
  const options = {
    datasets: ['facilities', 'closed', 'revoked', 'unnumbered'],
    cacheDir: '.gev-cache/bdp/tceq-msw',
  };

  for (const argument of argv) {
    if (argument.startsWith('--dataset=')) {
      const value = argument.slice('--dataset='.length).trim().toLowerCase();
      options.datasets = value === 'all'
        ? ['facilities', 'closed', 'revoked', 'unnumbered']
        : [value];
    } else if (argument.startsWith('--cache=')) {
      options.cacheDir = argument.slice('--cache='.length);
    } else if (argument === '--help' || argument === '-h') {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  for (const dataset of options.datasets) getTceqMswDataset(dataset);
  return options;
}

function usage() {
  return [
    'BDP TCEQ municipal-solid-waste PostGIS importer',
    '',
    'Requirements:',
    '  - GDAL with XLS/XLSX support (ogrinfo / ogr2ogr)',
    '  - PostgreSQL psql client',
    '  - BDP_PG_SERVICE set to a libpq service name',
    '',
    'Usage:',
    '  node scripts/bdp/tceq-msw-import.mjs [--dataset=all|facilities|closed|revoked|unnumbered]',
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
  return `bdp_tceq_msw_${dataset}_stage`;
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
    'src/bdp/ingestion/sql/tceqMswPostgis.sql',
    '-f',
    'src/bdp/ingestion/sql/tceqParcelMsw.sql',
  ]);
}

export function buildMswAlreadyImportedSql({ dataset, checksumSha256 }) {
  getTceqMswDataset(dataset);
  return `
    SELECT EXISTS (
      SELECT 1
      FROM (SELECT * FROM bdp_ingestion_runs
        WHERE source_id = 'tceq-msw' AND dataset = ${sqlLiteral(dataset)}
          AND status = 'succeeded' AND county_fips IS NULL
        ORDER BY completed_at DESC NULLS LAST, id DESC LIMIT 1) AS latest
      WHERE checksum_sha256 = ${sqlLiteral(checksumSha256)}
        AND row_count > 0
        AND row_count = (SELECT COUNT(*) FROM bdp_tceq_msw_sites WHERE source_dataset = ${sqlLiteral(dataset)})
    )
  `;
}

function alreadyImported(service, { dataset, checksumSha256 }) {
  if (!checksumSha256) return false;
  return run('psql', [
    ...psqlArgs(service), '--tuples-only', '--no-align', '--command',
    buildMswAlreadyImportedSql({ dataset, checksumSha256 }),
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
    WHEN pg_input_is_valid(${expression}, 'date') AND ${expression} ~ '^\\d{4}-\\d{2}-\\d{2}' THEN SUBSTRING(${expression} FROM 1 FOR 10)::DATE
    WHEN pg_input_is_valid(${expression}, 'date') AND ${expression} ~ '^\\d{1,2}/\\d{1,2}/\\d{4}' THEN ${expression}::DATE
    ELSE NULL
  END`;
}

function yesNoBoolean(expression) {
  return `CASE
    WHEN LOWER(COALESCE(${expression}, '')) IN ('y','yes','true','1') THEN TRUE
    WHEN LOWER(COALESCE(${expression}, '')) IN ('n','no','false','0') THEN FALSE
    ELSE NULL
  END`;
}

function currentDatasetExpressions() {
  return {
    siteName: jsonText('s', ['site_name', 'site name', 'Site Name']),
    alternateName: 'NULL',
    authorizationNumber: jsonText('s', ['additional_id', 'additional id', 'Additional ID']),
    rn: jsonText('s', ['rn', 'RN']),
    facilityType: jsonText('s', ['physical_type', 'physical type', 'Physical Type']),
    legalStatus: jsonText('s', ['legal_status', 'legal status', 'Legal Status']),
    physicalStatus: jsonText('s', ['physical_site_status', 'physical site status', 'Physical Site Status']),
    county: jsonText('s', ['county', 'County']),
    region: jsonText('s', ['region', 'Region']),
    address: jsonText('s', ['phys_addr_line_1', 'phys addr. line 1', 'phys addr line 1', 'Phys Addr. Line 1']),
    latitude: jsonText('s', ['latitude', 'Latitude']),
    longitude: jsonText('s', ['longitude', 'Longitude']),
    locationText: jsonText('s', ['near_phys_loc_txt', 'near phys loc txt', 'Near Phys Loc Txt']),
    unauthorized: 'NULL',
    hazConfirmed: 'NULL',
    hazProbable: 'NULL',
    hazUnlikely: 'NULL',
    dateOpened: 'NULL',
    dateClosed: 'NULL',
    sizeAcres: 'NULL',
    accuracy: 'NULL',
    coordinateSource: 'NULL',
  };
}

function unnumberedExpressions() {
  return {
    siteName: jsonText('s', ['site_name1', 'SITE_NAME1']),
    alternateName: jsonText('s', ['site_name2', 'SITE_NAME2']),
    authorizationNumber: jsonText('s', ['unum', 'UNUM']),
    rn: 'NULL',
    facilityType: `'Historical unnumbered / unauthorized landfill'`,
    legalStatus: jsonText('s', ['legal', 'LEGAL']),
    physicalStatus: `'Historical'`,
    county: jsonText('s', ['cnty_name', 'CNTY_NAME']),
    region: 'NULL',
    address: jsonText('s', ['location', 'LOCATION']),
    latitude: jsonText('s', ['latit_dd', 'LATIT_DD']),
    longitude: jsonText('s', ['longi_dd', 'LONGI_DD']),
    locationText: jsonText('s', ['location', 'LOCATION']),
    unauthorized: yesNoBoolean(jsonText('s', ['unauthor', 'UNAUTHOR'])),
    hazConfirmed: yesNoBoolean(jsonText('s', ['haz_cert', 'HAZ_CERT'])),
    hazProbable: yesNoBoolean(jsonText('s', ['haz_prob', 'HAZ_PROB'])),
    hazUnlikely: yesNoBoolean(jsonText('s', ['haz_unlike', 'HAZ_UNLIKE'])),
    dateOpened: safeDate(jsonText('s', ['date_open', 'DATE_OPEN'])),
    dateClosed: safeDate(jsonText('s', ['date_close', 'DATE_CLOSE'])),
    sizeAcres: safeNumber(jsonText('s', ['size_acres', 'SIZE_ACRES'])),
    accuracy: jsonText('s', ['accuracy', 'ACCURACY']),
    coordinateSource: jsonText('s', ['coor_cd', 'COOR_CD']),
  };
}

export function buildNormalizeSql({ dataset, table, manifest }) {
  getTceqMswDataset(dataset);
  if (!/^[a-z_][a-z0-9_]*$/.test(table)) throw new Error('Invalid MSW staging table');
  const fields = dataset === 'unnumbered'
    ? unnumberedExpressions()
    : currentDatasetExpressions();
  const latNumber = safeNumber(fields.latitude);
  const lonNumber = safeNumber(fields.longitude);
  const sourceLastModified = manifest.lastModified
    ? `${sqlLiteral(manifest.lastModified)}::timestamptz`
    : 'NULL';

  return `
    BEGIN;
    DELETE FROM bdp_tceq_msw_sites WHERE source_dataset = ${sqlLiteral(dataset)};

    INSERT INTO bdp_tceq_msw_sites (
      source_dataset, source_filename, source_url, source_last_modified,
      source_record, site_name, alternate_name, authorization_number, rn,
      facility_type, legal_status, physical_status, county, region, address,
      unauthorized, hazardous_waste_confirmed, hazardous_waste_probable,
      hazardous_waste_unlikely, date_opened, date_closed, size_acres,
      latitude, longitude, coordinate_accuracy_code, coordinate_source_code,
      location_text, geom
    )
    SELECT
      ${sqlLiteral(dataset)},
      ${sqlLiteral(manifest.filename)},
      ${sqlLiteral(manifest.url)},
      ${sourceLastModified},
      to_jsonb(s) - 'ogc_fid',
      ${fields.siteName},
      ${fields.alternateName},
      ${fields.authorizationNumber},
      ${fields.rn},
      ${fields.facilityType},
      ${fields.legalStatus},
      ${fields.physicalStatus},
      ${fields.county},
      ${fields.region},
      ${fields.address},
      ${fields.unauthorized},
      ${fields.hazConfirmed},
      ${fields.hazProbable},
      ${fields.hazUnlikely},
      ${fields.dateOpened},
      ${fields.dateClosed},
      ${fields.sizeAcres},
      ${latNumber},
      ${lonNumber},
      ${fields.accuracy},
      ${fields.coordinateSource},
      ${fields.locationText},
      CASE
        WHEN ${latNumber} BETWEEN 25 AND 37
          AND ${lonNumber} BETWEEN -107 AND -93
        THEN ST_SetSRID(ST_MakePoint(${lonNumber}, ${latNumber}), 4326)
        ELSE NULL
      END
    FROM ${table} s
    WHERE COALESCE(${fields.siteName}, ${fields.authorizationNumber}) IS NOT NULL;

    DO $guard$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM bdp_tceq_msw_sites WHERE source_dataset = ${sqlLiteral(dataset)})
        OR NOT EXISTS (SELECT 1 FROM bdp_tceq_msw_sites WHERE source_dataset = ${sqlLiteral(dataset)} AND geom IS NOT NULL)
      THEN RAISE EXCEPTION 'MSW snapshot has no usable records/coordinates; previous snapshot retained'; END IF;
    END $guard$;

    INSERT INTO bdp_ingestion_runs (
      source_id, dataset, source_filename, source_url, source_last_modified,
      checksum_sha256, completed_at, status, row_count
    ) VALUES (
      'tceq-msw',
      ${sqlLiteral(dataset)},
      ${sqlLiteral(manifest.filename)},
      ${sqlLiteral(manifest.url)},
      ${sourceLastModified},
      ${sqlLiteral(manifest.checksumSha256 || '')},
      ${sqlLiteral(manifest.checkedAt)}::timestamptz,
      'succeeded',
      (SELECT COUNT(*) FROM bdp_tceq_msw_sites WHERE source_dataset = ${sqlLiteral(dataset)})
    );

    DROP TABLE ${table};
    COMMIT;
  `;
}

export async function validateMswCache({ spec, sourcePath, manifest, now = Date.now() }) {
  if (manifest.dataset !== spec.dataset || manifest.filename !== spec.filename || manifest.url !== spec.url) {
    throw new Error('MSW cache manifest does not match official dataset');
  }
  const checkedAt = Date.parse(manifest.checkedAt);
  if (!Number.isFinite(checkedAt) || checkedAt > now || now - checkedAt > 14 * 86400000) {
    throw new Error('MSW cache verification expired; run the downloader before importing');
  }
  const bytes = new Uint8Array(await readFile(sourcePath));
  if (!/^[a-f0-9]{64}$/.test(manifest.checksumSha256 || '')
    || await sha256Hex(bytes) !== manifest.checksumSha256) {
    throw new Error('MSW cached file checksum mismatch; run the downloader again');
  }
}

async function importDataset({ service, dataset, cacheDir }) {
  const spec = getTceqMswDataset(dataset);
  const sourcePath = path.resolve(cacheDir, spec.filename);
  const manifestPath = `${sourcePath}.json`;
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  await validateMswCache({ spec, sourcePath, manifest });

  if (alreadyImported(service, { dataset, checksumSha256: manifest.checksumSha256 })) {
    run('psql', [...psqlArgs(service), '--command', `
      UPDATE bdp_ingestion_runs SET completed_at = ${sqlLiteral(manifest.checkedAt)}::timestamptz
      WHERE id = (SELECT id FROM bdp_ingestion_runs WHERE source_id = 'tceq-msw'
        AND dataset = ${sqlLiteral(dataset)} AND status = 'succeeded' AND county_fips IS NULL
        ORDER BY completed_at DESC NULLS LAST, id DESC LIMIT 1);
    `]);
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

export async function runTceqMswImport(options = {}) {
  const service = process.env.BDP_PG_SERVICE;
  if (!service || !/^[A-Za-z0-9_.-]+$/.test(service)) {
    throw new Error('Set BDP_PG_SERVICE to a configured libpq service name before importing');
  }

  assertTools();
  applySchema(service);
  const datasets = options.datasets || ['facilities', 'closed', 'revoked', 'unnumbered'];
  const cacheDir = path.resolve(options.cacheDir || '.gev-cache/bdp/tceq-msw');
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
      const results = await runTceqMswImport(options);
      for (const result of results) {
        console.log(`[BDP:TCEQ:MSW] ${result.status} ${result.filename}`);
      }
    } catch (error) {
      console.error(`[BDP:TCEQ:MSW] ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    }
  }
}
