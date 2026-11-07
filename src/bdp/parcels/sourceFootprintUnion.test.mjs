import test from 'node:test';
import assert from 'node:assert/strict';
import { unionSourceWindowOutlines } from './sourceFootprintUnion.js';

const rect = (west,south,east,north)=>({west,south,east,north});

// Even/odd inclusion over the returned loops: holes subtract from coverage,
// whether components touch or one outline winds clockwise.
function mapped(point, rings) {
  const [x,y]=point;
  let hit=false;
  for(const ring of rings) {
    for(let i=0,j=ring.length-1;i<ring.length;j=i++) {
      const [xi,yi]=ring[i], [xj,yj]=ring[j];
      if(((yi>y)!==(yj>y))
          && x < (xj-xi)*(y-yi)/(yj-yi)+xi) hit=!hit;
    }
  }
  return hit;
}
test('single-source window remains the exact original orange query rectangle',()=>{
  const rings=unionSourceWindowOutlines([rect(0,0,2,2)]);
  assert.deepEqual(rings,[[[0,0],[2,0],[2,2],[0,2],[0,0]]]);
  assert.equal(mapped([1,1],rings),true);
  assert.equal(mapped([3,1],rings),false);
});
test('overlap merges to one exact exterior with no internal orange diagonals/seams',()=>{
  const rings=unionSourceWindowOutlines([rect(0,0,2,2),rect(1,1,3,3)]);
  assert.equal(rings.length,1);
  assert.deepEqual(rings[0],[[0,0],[2,0],[2,1],[3,1],[3,3],[1,3],[1,2],[0,2],[0,0]]);
  assert.equal(mapped([1.5,1.5],rings),true);
  assert.equal(mapped([2.5,.5],rings),false,'gap outside either original GIS query remains unassessed');
});
test('edge-adjacent windows form one outline; duplicate/nested windows do not add extra borders',()=>{
  assert.deepEqual(unionSourceWindowOutlines([rect(0,0,2,2),rect(2,0,4,2)]),
    [[[0,0],[4,0],[4,2],[0,2],[0,0]]]);
  assert.deepEqual(unionSourceWindowOutlines([rect(0,0,4,4),rect(1,1,2,2),rect(0,0,4,4)]),
    [[[0,0],[4,0],[4,4],[0,4],[0,0]]]);
});
test('separate neighborhoods and point-touching source windows are not spuriously joined',()=>{
  const detached=unionSourceWindowOutlines([rect(0,0,2,2),rect(3,0,4,1)]);
  assert.equal(detached.length,2);
  assert.equal(mapped([2.5,.5],detached),false);
  const tangent=unionSourceWindowOutlines([rect(0,0,2,2),rect(2,2,3,3)]);
  assert.equal(tangent.length,2,'source windows touching at a single point have no shared area');
});
test('ring of four sourced windows preserves the unsearched interior as a hole',()=>{
  const rings=unionSourceWindowOutlines([
    rect(0,0,4,1),rect(0,3,4,4),rect(0,1,1,3),rect(3,1,4,3),
  ]);
  assert.equal(rings.length,2);
  assert.equal(mapped([.5,2],rings),true);
  assert.equal(mapped([2,2],rings),false,'interior GIS-unqueried hole must remain unverified');
  assert.equal(mapped([5,2],rings),false);
});
test('invalid or excess windows fail before any coverage outline is shown',()=>{
  assert.deepEqual(unionSourceWindowOutlines([]),[]);
  assert.throws(()=>unionSourceWindowOutlines([rect(1,1,1,3)]),/Invalid sourced/);
  assert.throws(()=>unionSourceWindowOutlines([rect(0,0,2,NaN)]),/Invalid sourced/);
  assert.throws(()=>unionSourceWindowOutlines(Array(13).fill(rect(0,0,2,2))),/Invalid source window list/);
});
