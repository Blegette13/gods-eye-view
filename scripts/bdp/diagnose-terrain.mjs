/**
 * Read-only USGS 3DEP diagnostics for the Austin terrain pilot.
 *
 * Checks whether an otherwise valid parcel-scale polygon produces statistics
 * with the current renderer and whether the service behaves differently when
 * the optional raster rendering and pixel-size settings are omitted.
 * Does not infer slope, change cadastral data, or claim elevation clearance.
 */
import { build3depStatisticsUrl } from '../../src/bdp/terrain/terrainContract.js';

const input = {
  geometry: {
    type: 'Polygon',
    coordinates: [[
      [-97.758, 30.245],
      [-97.754, 30.245],
      [-97.754, 30.248],
      [-97.758, 30.248],
      [-97.758, 30.245],
    ]],
  },
};

const cases = [
  { name: 'current-elevation', mode: 'elevation' },
  { name: 'current-slope', mode: 'slope' },
  { name: 'default-elevation-without-optional-rules', mode: 'elevation', omitOptional: true },
];

console.log('USGS 3DEP terrain diagnostic · Austin sample geometry · read only');
for (const entry of cases) {
  const url = new URL(build3depStatisticsUrl(input, { mode: entry.mode }));
  if (entry.omitOptional) {
    url.searchParams.delete('renderingRule');
    url.searchParams.delete('pixelSize');
  }

  try {
    const response = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(20_000),
    });
    const text = await response.text();
    const body = JSON.parse(text);
    const statistics = Array.isArray(body?.statistics) ? body.statistics : [];
    console.log(JSON.stringify({
      test: entry.name,
      httpStatus: response.status,
      responseKeys: body && typeof body === 'object' ? Object.keys(body).slice(0, 15) : [],
      statisticsEntries: statistics.length,
      firstStatisticFields: statistics.length ? Object.keys(statistics[0]) : [],
      error: body?.error ? {
        code: body.error.code ?? null,
        message: String(body.error.message || '').slice(0, 260),
      } : null,
    }, null, 2));
  } catch (error) {
    console.log(JSON.stringify({
      test: entry.name,
      requestFailed: String(error?.message || error).slice(0, 260),
    }, null, 2));
  }
}
console.log('Diagnostic only: empty statistics and failed requests remain UNKNOWN terrain evidence.');
