/**
 * This function filters ONLY source-reported parcel attributes displayed in
 * the neighborhood list. It does not qualify land for a business purpose,
 * compare asking prices or determine that any parcel is for sale.
 */
export function filterAndSortMappedParcels(rows, {
  search = '', minAcres = '', maxAcres = '', sort = 'address',
} = {}) {
  const text = String(search || '').trim().toLocaleLowerCase();
  const min = minAcres === '' || minAcres == null ? null : Number(minAcres);
  const max = maxAcres === '' || maxAcres == null ? null : Number(maxAcres);
  const validMin = min !== null && Number.isFinite(min) && min >= 0;
  const validMax = max !== null && Number.isFinite(max) && max >= 0;
  const acreageFilter = validMin || validMax;
  const inverted = validMin && validMax && min > max;
  let unknownExcluded = 0;
  const records = (Array.isArray(rows) ? rows : []).filter((row) => {
    if (!row || typeof row.parcelId !== 'string') return false;
    if (text && ![row.label,row.parcelId].some((x)=>String(x||'').toLocaleLowerCase().includes(text))) return false;
    if (inverted) return false;
    if (!acreageFilter) return true;
    const acres = row.acresReported;
    if (!Number.isFinite(acres) || acres <= 0) {
      unknownExcluded++;
      return false;
    }
    return !(validMin && acres < min) && !(validMax && acres > max);
  });
  const labelCompare = (a,b)=>String(a.label||'').localeCompare(String(b.label||''))
    || a.parcelId.localeCompare(b.parcelId);
  if (sort === 'acres-desc' || sort === 'acres-asc') {
    // An UNKNOWN reported acreage stays below every known acreage, never 0.
    records.sort((a,b)=>{
      const x = Number.isFinite(a.acresReported) && a.acresReported > 0 ? a.acresReported : null;
      const y = Number.isFinite(b.acresReported) && b.acresReported > 0 ? b.acresReported : null;
      if (x === null && y !== null) return 1;
      if (x !== null && y === null) return -1;
      if (x !== null && y !== null && x !== y) {
        return sort === 'acres-desc' ? y-x : x-y;
      }
      return labelCompare(a,b);
    });
  } else if (sort === 'address') records.sort(labelCompare);
  return Object.freeze({ records, unknownExcluded, invalidRange: inverted });
}
