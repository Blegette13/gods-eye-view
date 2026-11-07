/**
 * Compute only the EXTERIOR and hole outlines of the geometric union of
 * completed source-query envelopes. Each rectangle comes from an actual,
 * completed county GIS request; these are not cadastral or legal boundaries.
 *
 * Rectangle edges are already longitude/latitude axis aligned. A tiny
 * compressed coordinate grid avoids a geodesic union dependency and, unlike
 * overlaying rectangles, never draws seams where two verified windows overlap.
 * This routine does not infer anything about areas outside the union.
 */
export function unionSourceWindowOutlines(rectangles) {
  if (!Array.isArray(rectangles) || rectangles.length > 12) {
    throw new Error('Invalid source window list');
  }
  if (!rectangles.length) return [];
  for (const b of rectangles) {
    if (!b || ![b.west,b.south,b.east,b.north].every(Number.isFinite)
        || b.west >= b.east || b.south >= b.north) {
      throw new Error('Invalid sourced focus footprint');
    }
  }
  const xs = [...new Set(rectangles.flatMap((r)=>[r.west,r.east]))].sort((a,b)=>a-b);
  const ys = [...new Set(rectangles.flatMap((r)=>[r.south,r.north]))].sort((a,b)=>a-b);
  const width = xs.length - 1, height = ys.length - 1;
  const occupied = Array.from({length:width},()=>new Array(height).fill(false));
  for (let i=0;i<width;i++) for (let j=0;j<height;j++) {
    const cx=(xs[i]+xs[i+1])/2, cy=(ys[j]+ys[j+1])/2;
    occupied[i][j] = rectangles.some((r)=>
      cx >= r.west && cx <= r.east && cy >= r.south && cy <= r.north);
  }
  const filled=(i,j)=>i>=0 && j>=0 && i<width && j<height && occupied[i][j];
  const edges=[];
  const at=(i,j)=>i+','+j;
  function add(x1,y1,x2,y2,direction) {
    edges.push({from:at(x1,y1),to:at(x2,y2),
      end:[xs[x2],ys[y2]],direction});
  }
  // Counter-clockwise around mapped source windows (unmapped area on right).
  for(let i=0;i<width;i++) for(let j=0;j<height;j++) if(filled(i,j)) {
    if(!filled(i,j-1)) add(i,j,i+1,j,0);       // east
    if(!filled(i+1,j)) add(i+1,j,i+1,j+1,1);   // north
    if(!filled(i,j+1)) add(i+1,j+1,i,j+1,2);   // west
    if(!filled(i-1,j)) add(i,j+1,i,j,3);       // south
  }
  const outbound=new Map();
  edges.forEach((edge,index)=>{
    if(!outbound.has(edge.from)) outbound.set(edge.from,[]);
    outbound.get(edge.from).push(index);
  });
  const visited=new Set();
  const loops=[];
  // At one-point touching windows, prefer the leftmost turn. This keeps the
  // two components separate instead of spuriously connecting a point gap.
  const turnRank=[1,0,3,2];
  for(let start=0;start<edges.length;start++) {
    if(visited.has(start)) continue;
    const initial=edges[start],coords=[];
    const [ix,iy]=initial.from.split(',').map(Number);
    coords.push([xs[ix],ys[iy]]);
    let index=start,turns=0;
    while(true) {
      if(visited.has(index) || ++turns>edges.length) {
        throw new Error('Invalid source window outline topology');
      }
      visited.add(index);
      const edge=edges[index];
      coords.push(edge.end);
      if(edge.to===initial.from) break;
      const options=(outbound.get(edge.to)||[]).filter((candidate)=>!visited.has(candidate));
      options.sort((a,b)=>{
        const turnA=(edges[a].direction-edge.direction+4)%4;
        const turnB=(edges[b].direction-edge.direction+4)%4;
        return turnRank.indexOf(turnA)-turnRank.indexOf(turnB);
      });
      if(!options.length) throw new Error('Open source window outline');
      index=options[0];
    }
    // A compressed grid can have intermediate collinear vertices. Remove
    // them while preserving every real outer/inner boundary corner.
    const corners=[];
    for(let k=0;k<coords.length-1;k++) {
      const prev=coords[(k+coords.length-2)%(coords.length-1)];
      const here=coords[k],next=coords[k+1];
      if((prev[0]===here[0] && here[0]===next[0])
        ||(prev[1]===here[1] && here[1]===next[1])) continue;
      corners.push(here);
    }
    if(corners.length<4) {
      // A valid rectangle has exactly four corners; duplicates are not
      // legal source windows. The union must not disappear silently.
      if(corners.length!==4) throw new Error('Degenerate source window union');
    }
    loops.push([...corners,corners[0]]);
  }
  return loops;
}
