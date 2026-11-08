import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Campaign } from '../.test-build/campaign.js';
import { World } from '../.test-build/world.js';
import { Terrain } from '../.test-build/terrain.js';
import { validateBalance } from '../.test-build/settings.js';
const base=JSON.parse(await readFile(new URL('../public/data/balance.json',import.meta.url)));
const raw=JSON.parse(await readFile(new URL('../public/data/regions/minsk.json',import.meta.url)));
function setup(){
 const b=structuredClone(base);b.lines.hv.maxLengthM=20000;b.lines.lv.maxLengthM=20000;
 b.lines.hv.resistanceOhmPerM=0;b.lines.lv.resistanceOhmPerM=0;
 const r={...structuredClone(raw),masks:{},river:null,deposits:[{id:'coal',kind:'coal',u:.2,v:.24,radiusM:2000}]};
 const terrain=new Terrain(r,b),world=new World(b,terrain);
 const plant=world.add('coal',2000,3000).value;
 const transformer=world.add('transformer',4000,3000).value;
 const village=world.add('village',6000,3000).value;
 const factory=world.add('factory',6000,5000).value;
 world.connect({id:plant.id,port:'terminal'},{id:transformer.id,port:'in'});
 const c=new Campaign(b,[r,{...r,id:'second'}],71);
 c.world=world;c.region=r;c.status='playing';
 c.objectives=[{id:village.id,name:'Village 1',months:6,kind:'village'},{id:factory.id,name:'Factory 1',months:8,kind:'factory'}];
 c.refresh();return {c,b,r,terrain,world,plant,transformer,village,factory};
}
function connectAll(s){
 for(const b of [s.village,s.factory])assert.ok(s.world.connect({id:s.transformer.id,port:'out'},{id:b.id,port:'terminal'}).ok);
 s.c.refresh();
}
test('first failed deadline issues one fine and permits debt',()=>{
 const {c}=setup();c.money=10;const out=c.advance(c.duration);
 assert.equal(out.success,false);assert.equal(out.fine,120);assert.equal(c.money,-110);
 assert.equal(c.strikes,1);assert.equal(c.status,'reprimand');assert.equal(out.terminal,false);
});
test('oversized dt and repeated updates do not multiply fines',()=>{
 const {c}=setup();c.advance(1e6);const money=c.money;
 assert.equal(c.advance(1e6),null);assert.equal(c.strikes,1);assert.equal(c.money,money);
});
test('retry keeps network, objective IDs and resource positions',()=>{
 const {c}=setup();const world=c.world,snapshot=c.world.snapshot(),deposits=structuredClone(c.region.deposits),objectives=structuredClone(c.objectives);
 c.advance(c.duration);c.retry();assert.equal(c.world,world);assert.deepEqual(c.world.snapshot(),snapshot);
 assert.deepEqual(c.region.deposits,deposits);assert.deepEqual(c.objectives,objectives);
 assert.equal(c.status,'playing');assert.equal(c.elapsed,0);assert.equal(c.duration,120);assert.equal(c.paused,false);
});
test('second violation fines 180; third sends to Siberia, exactly once',()=>{
 const {c}=setup();c.money=0;c.advance(c.duration);c.retry();const second=c.advance(c.duration);
 assert.equal(second.fine,180);assert.equal(c.money,-300);assert.equal(c.strikes,2);
 c.retry();const third=c.advance(c.duration);
 assert.equal(third.terminal,true);assert.equal(c.status,'failed');assert.equal(c.strikes,3);assert.equal(c.money,-300);
 assert.equal(c.advance(300),null);assert.throws(()=>c.retry());
});
test('settlement income repays debt without creating automatic credit',()=>{
 const s=setup();s.c.money=-20;connectAll(s);const before=s.c.money;
 assert.equal(s.c.place('pole',12000,9000,'hv').ok,false);
 s.c.advance(10);assert.ok(s.c.money>before);assert.equal(s.c.money,-7);
});
test('strike count survives a successful regional deadline',()=>{
 const s=setup();s.c.advance(s.c.duration);s.c.retry();connectAll(s);
 const out=s.c.advance(s.c.duration);assert.equal(out.success,true);assert.equal(s.c.strikes,1);
 assert.equal(s.c.status,'map');assert.equal(s.c.duration,165);assert.equal(s.c.completed[0],s.r.id);
});
test('negative balance and pending reprimand restore without a second charge',()=>{
 const s=setup();s.c.money=1;s.c.advance(s.c.duration);
 const restored=Campaign.restore(s.c.snapshot(),s.b,s.c.regions,s.terrain);
 assert.equal(restored.money,-119);assert.equal(restored.status,'reprimand');assert.equal(restored.strikes,1);
 assert.equal(restored.advance(20),null);restored.retry();assert.equal(restored.money,-119);assert.equal(restored.duration,120);
});
test('active retry resumes paused with debt and remaining grace time',()=>{
 const s=setup();s.c.money=0;s.c.advance(s.c.duration);s.c.retry();s.c.advance(17);
 const restored=Campaign.restore(s.c.snapshot(),s.b,s.c.regions,s.terrain);
 assert.equal(restored.paused,true);assert.equal(restored.attempt,1);assert.equal(restored.remaining,103);assert.equal(restored.money,-120);
});
test('Siberia outcome can be restored without an active region',()=>{
 const s=setup();s.c.advance(s.c.duration);s.c.retry();s.c.advance(s.c.duration);s.c.retry();s.c.advance(s.c.duration);
 const restored=Campaign.restore(s.c.snapshot(),s.b,s.c.regions);
 assert.equal(restored.status,'failed');assert.equal(restored.lastOutcome.terminal,true);assert.equal(restored.strikes,3);
});
test('strikes are global across regions',()=>{
 const s=setup();s.c.advance(s.c.duration);s.c.retry();connectAll(s);s.c.advance(s.c.duration);
 const r={...structuredClone(s.r),id:'second'};
 s.c.begin(r,new Terrain(r,s.b));const out=s.c.advance(s.c.duration);
 assert.equal(out.strikes,2);assert.equal(out.fine,180);assert.equal(s.c.status,'reprimand');
});
test('invalid counters and nonfinite debt are rejected',()=>{
 const s=setup();const save=s.c.snapshot();
 for(const value of [-1,4,NaN,1.5])assert.throws(()=>Campaign.restore({...save,strikes:value},s.b,s.c.regions,s.terrain));
 assert.throws(()=>Campaign.restore({...save,money:Infinity},s.b,s.c.regions,s.terrain));
 assert.throws(()=>Campaign.restore({...save,active:{...save.active,attempt:-1}},s.b,s.c.regions,s.terrain));
});
test('warning pauses money/time and prevents spending',()=>{
 const {c}=setup();c.advance(c.duration);const before=[c.money,c.elapsed];
 assert.equal(c.place('pole',10000,8000,'hv').ok,false);c.advance(30);assert.deepEqual([c.money,c.elapsed],before);
});
test('penalty settings validation rejects fractional strikes and negative fines',()=>{
 const b=structuredClone(base);b.penalties.maxStrikes=2.5;assert.throws(()=>validateBalance(b));
 b.penalties.maxStrikes=3;b.penalties.fine=-1;assert.throws(()=>validateBalance(b));
 b.penalties.fine=0;assert.equal(validateBalance(b).penalties.fine,0);
});
