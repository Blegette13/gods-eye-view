/**
 * In-memory, privacy-minimal diagnostic counters for a parcel viewport layer.
 * Records aggregate durations/record counts only. No addresses, parcel IDs,
 * ownership, camera coordinates or browser persistent storage.
 *
 * Source requests are "unknown" unless the provider adapter explicitly
 * reports a real count. A browser cache hit is not a GIS network request.
 */
export function createParcelDiscoveryMetrics({
  now = () => (typeof performance !== 'undefined' && performance?.now
    ? performance.now() : Date.now()),
  maxSamples = 32,
} = {}) {
  if (typeof now !== 'function' || !Number.isInteger(maxSamples)
      || maxSamples < 1 || maxSamples > 128) {
    throw new Error('Invalid parcel diagnostic configuration');
  }
  let runs = 0, successes = 0, failures = 0, cancellations = 0;
  let capped = 0, cacheHits = 0, knownSourceRequests = 0, unknownRequestRuns = 0;
  const samples = [];
  let last = null;

  function nonnegativeInt(value) {
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }
  function start() {
    const started = now();
    let finished = false;
    return Object.freeze({
      finish({
        outcome = 'success', sourceRequests = null, fromCache = false,
        parcelCount = 0, sourceFootprints = 0, cachedWindows = 0,
        entityCount = null,
      } = {}) {
        if (finished) return false;
        if (!['success', 'over-limit', 'error', 'cancelled'].includes(outcome)) {
          throw new Error('Invalid parcel diagnostic outcome');
        }
        finished = true;
        const elapsed = Math.max(0, now() - started);
        const durationMs = Number.isFinite(elapsed)
          ? Math.round(Math.min(elapsed, 600_000)) : null;
        const requests = nonnegativeInt(sourceRequests);
        const sample = Object.freeze({
          outcome, durationMs, sourceRequests: requests,
          fromCache: Boolean(fromCache),
          parcelCount: nonnegativeInt(parcelCount) ?? 0,
          sourceFootprints: nonnegativeInt(sourceFootprints) ?? 0,
          cachedWindows: nonnegativeInt(cachedWindows) ?? 0,
          entityCount: nonnegativeInt(entityCount),
        });
        runs++;
        if (outcome === 'success') successes++;
        if (outcome === 'error') failures++;
        if (outcome === 'cancelled') cancellations++;
        if (outcome === 'over-limit') capped++;
        if (sample.fromCache) cacheHits++;
        if (requests === null) unknownRequestRuns++;
        else knownSourceRequests += requests;
        samples.push(sample);
        while (samples.length > maxSamples) samples.shift();
        last = sample;
        return true;
      },
    });
  }
  function snapshot() {
    const durations = samples.map((sample) => sample.durationMs)
      .filter(Number.isFinite).sort((a,b)=>a-b);
    const percentile = (p) => durations.length
      ? durations[Math.ceil(p * durations.length) - 1] : null;
    return Object.freeze({
      runs, successes, failures, cancellations, capped,
      cacheHits, knownSourceRequests, unknownRequestRuns,
      sampleCount: samples.length,
      p50DurationMs: percentile(0.5), p95DurationMs: percentile(0.95),
      last,
    });
  }
  return Object.freeze({ start, snapshot });
}
