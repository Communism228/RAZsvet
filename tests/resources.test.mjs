import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {generateResources} from '../.test-build/resources.js';
import {Campaign} from '../.test-build/campaign.js';
import {validateBalance} from '../.test-build/settings.js';
import {terrainFor} from './masks.mjs';
const b=JSON.parse(await readFile(new URL('../public/data/balance.json',import.meta.url)));
const index=JSON.parse(await readFile(new URL('../public/data/campaign.json',import.meta.url)));
const regions=await Promise.all(index.regions.map(f=>readFile(new URL('../public/'+f,import.meta.url)).then(JSON.parse)));
const terrains=await Promise.all(regions.map(r=>terrainFor(r,b)));
test('all six masks come from distinct atlas crops with actual river pixels',()=>{
 const signatures=new Set();
 for(const t of terrains){assert.ok(t.region.countryCrop);assert.ok(t.masks.water.pixels.some(v=>v===255));assert.ok(t.masks.hydro.pixels.some(v=>v===255));
 signatures.add(t.masks.water.pixels.reduce((a,v,i)=>(a+v*(i%65521))>>>0,0));}
 assert.equal(signatures.size,6);
});
test('identical seeds reproduce all deposits and other seeds change them',()=>{
 const t=terrains[0];assert.deepEqual(generateResources(t,101).region.deposits,generateResources(t,101).region.deposits);
 const states=new Set(Array.from({length:30},(_,i)=>JSON.stringify(generateResources(t,i).region.deposits)));
 assert.ok(states.size>10);
});
test('resource generation respects land and region boundaries over 150 seeded maps',()=>{
 let noDeposits=0,many=0;
 for(const t of terrains)for(let seed=0;seed<25;seed++){
  const g=generateResources(t,seed);if(g.region.deposits.length===0)noDeposits++;if(g.region.deposits.length>=4)many++;
  for(const d of g.region.deposits){assert.equal(g.placementError(d.kind,d.u*b.world.widthM,d.v*b.world.heightM),undefined);}
 }
 assert.ok(noDeposits>0);assert.ok(many>0);
});
test('explicit none mode produces no deposits in any region, and keeps hydropower possible',()=>{
 for(const t of terrains){const bb=structuredClone(b);bb.resources.mode='none';t.balance.resources.mode='none';
  assert.equal(generateResources(t,40).region.deposits.length,0);
  const h=t.masks.hydro;let site=false;
  for(let i=0;i<h.pixels.length;i+=3)if(h.pixels[i]){
   const x=(i%h.width+.5)/h.width*b.world.widthM,y=(Math.floor(i/h.width)+.5)/h.height*b.world.heightM;
   if(!t.placementError('hydro',x,y)){site=true;break;}
  }assert.ok(site,`No hydropower site: ${t.region.id}`);
  t.balance.resources.mode='random';
 }
});
test('explicit probability 1 allows both a whole region and an individual resource type to be absent',()=>{
 const t=terrains[0],r=t.balance.resources,old=structuredClone(r);
 r.emptyRegionChance=1;assert.equal(generateResources(t,9).region.deposits.length,0);
 r.emptyRegionChance=0;r.coal.noneChance=1;r.peat.noneChance=0;
 const dep=generateResources(t,9).region.deposits;assert.ok(dep.length>=2);assert.ok(dep.every(d=>d.kind==='peat'));
 Object.assign(r,old);
});
test('all six regions populate eight distinct settlements and two factories on actual dry masks',()=>{
 for(const t of terrains)for(let seed=0;seed<12;seed++){
  const c=new Campaign(b,regions,seed);c.begin(t.region,t);
  assert.equal(c.world.buildings.filter(x=>x.kind==='city').length,2);
  assert.equal(c.world.buildings.filter(x=>x.kind==='village').length,6);
  assert.equal(c.world.buildings.filter(x=>x.kind==='factory').length,2);
  for(const obj of c.world.buildings)assert.equal(c.world.terrain.placementError(obj.kind,obj.x,obj.y),undefined);
  assert.equal(c.objectiveCount,4);
 }
});
test('saved active region preserves random resources exactly and resumes paused',()=>{
 const t=terrains[1],c=new Campaign(b,regions,42);c.begin(t.region,t);c.advance(1);
 const restored=Campaign.restore(c.snapshot(),b,regions,t);
 assert.deepEqual(restored.region.deposits,c.region.deposits);assert.deepEqual(restored.world.snapshot(),c.world.snapshot());assert.equal(restored.paused,true);
});
test('tampered resource positions and duplicates are rejected on restore',()=>{
 const c=new Campaign(b,regions,42);c.begin(terrains[1].region,terrains[1]);const save=c.snapshot();
 save.active.deposits=[{id:'bad',kind:'coal',u:NaN,v:.3,radiusM:800}];assert.throws(()=>Campaign.restore(save,b,regions,terrains[1]));
});
test('invalid generation modes and camera ranges fail configuration validation',()=>{
 const wrong=structuredClone(b);wrong.resources.emptyRegionChance=2;assert.throws(()=>validateBalance(wrong));
 wrong.resources.emptyRegionChance=.2;wrong.world.initialZoom=10;assert.throws(()=>validateBalance(wrong));
});
