import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAcquisitionBrief } from './acquisitionBrief.js';
import { BDP_SCORE_WEIGHTS, calculateBdpScore } from './acquisitionScore.js';

test('empty evidence is a verification plan, never clearance or a buy verdict', () => {
  const brief = buildAcquisitionBrief({ parcel: { id: '48029:123' } });
  assert.equal(brief.parcelId, '48029:123');
  assert.equal(brief.risks.length, 0);
  assert.equal(brief.gaps.filter((gap) => gap.id.startsWith('category:')).length, 10);
  assert.equal(brief.actions.length, 10);
  assert.equal(brief.status, 'verification-required');
  assert.equal(brief.buyRecommendation, null);
  assert.equal(brief.scoreCoveragePercent, null);
  assert.match(brief.notice, /empty risk list is not clearance/);
  assert.ok(brief.actions.every((action) => action.priority === 'resolve-evidence-gap'));
});

test('high-severity mapped evidence leads the action list and preserves source caveats', () => {
  const flag = { id: 'tceq-msw-point-on-parcel', severity: 'high', title: 'MSW point',
    detail: 'Coordinates may be a gate; waste boundaries are unverified.', source: 'TCEQ MSW' };
  const brief = buildAcquisitionBrief({ redFlags: [flag], evidence: { msw: { coverage_complete: false, msw_points_on_parcel: 1 } } });
  assert.equal(brief.actions[0].id, 'environmental');
  assert.equal(brief.actions[0].priority, 'first-review');
  assert.equal(brief.risks[0].detail, flag.detail);
  assert.equal(brief.risks[0].source, flag.source);
  assert.equal(brief.risks[0].evidenceRef, 'redFlags.tceq-msw-point-on-parcel');
  assert.ok(brief.gaps.some((gap) => gap.id === 'source:msw'));
  assert.ok(brief.actions[0].flagIds.includes(flag.id));
  assert.ok(brief.actions[0].gapIds.includes('source:msw'));
});

test('failed feeds and unverified coverage do not hide surviving positive evidence or expose private errors', () => {
  const brief = buildAcquisitionBrief({
    errors: { flood: { message: 'private database connection string', status: 503 } },
    evidence: { wetlands: { nwi_percent: 10 }, msw: { msw_points_on_parcel: 0 } },
    redFlags: [{ id: 'nwi-wetlands', severity: 'medium', title: 'Mapped wetlands', detail: 'Jurisdiction remains unverified.', source: 'USFWS NWI' }],
  });
  assert.equal(brief.risks.length, 1);
  assert.equal(brief.gaps.find((gap) => gap.id === 'source:flood').evidenceRef, 'errors.flood');
  assert.equal(brief.gaps.find((gap) => gap.id === 'source:flood').status, 'unavailable');
  assert.ok(brief.gaps.some((gap) => gap.id === 'source:msw'));
  assert.ok(!JSON.stringify(brief).includes('private database'));
});

test('even complete high numeric scores and optimistic caller assertions cannot enable a recommendation', () => {
  const score = calculateBdpScore({ components: Object.fromEntries(Object.keys(BDP_SCORE_WEIGHTS).map((category) => [category, 100])) });
  const before = JSON.stringify(score);
  const brief = buildAcquisitionBrief({ score, parcel: { titleClear: true }, evidence: { ownershipTitle: { title_clear: true } } });
  assert.equal(brief.buyRecommendation, null);
  assert.equal(brief.scoreCoveragePercent, 100);
  assert.equal(JSON.stringify(score), before);
});

test('preliminary scoring remains a verification gap and info flags stay separate from risk findings', () => {
  const score = calculateBdpScore({ components: { utilitiesInfrastructure: { score: 90, confidence: 0.3, note: 'Capacity unverified.' } } });
  const brief = buildAcquisitionBrief({ score, redFlags: [{ id: 'utility-capacity-unverified', severity: 'info', title: 'Capacity unknown', detail: 'Provider confirmation needed.', source: 'Utility screening' }] });
  assert.equal(brief.risks.length, 0);
  assert.equal(brief.caveats.length, 1);
  assert.equal(brief.gaps.find((gap) => gap.id === 'category:utilitiesInfrastructure').status, 'preliminary');
  assert.equal(brief.gaps.find((gap) => gap.id === 'category:utilitiesInfrastructure').detail, 'Capacity unverified.');
});

test('unrecognized future flags retain traceability and high-severity priority without invented interpretation', () => {
  const brief = buildAcquisitionBrief({ redFlags: [{ id: 'future-source', severity: 'critical', title: 'Future evidence', detail: 'Source detail', source: 'New source' }] });
  assert.equal(brief.actions[0].id, 'flag:future-source');
  assert.deepEqual(brief.actions[0].evidenceRefs, ['redFlags.future-source']);
  assert.equal(brief.risks[0].category, null);
});

test('all follow-up reasons resolve to retained flags or gaps and snapshots are independent', () => {
  const first = buildAcquisitionBrief({ redFlags: [{ id: 'fema-floodway', severity: 'high', title: 'Floodway', detail: 'Mapped hazard', source: 'FEMA' }] });
  for (const action of first.actions) {
    assert.ok(action.flagIds.every((id) => [...first.risks, ...first.caveats].some((flag) => flag.id === id)));
    assert.ok(action.gapIds.every((id) => first.gaps.some((gap) => gap.id === id)));
  }
  const second = buildAcquisitionBrief();
  assert.equal(second.risks.length, 0);
  assert.notEqual(first.actions[0].id, second.actions[0].id);
});
