
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { World } from "../.test-build/world.js";
import { Terrain,Mask } from "../.test-build/terrain.js";
import { simulate } from "../.test-build/simulation.js";
import { Campaign,populate } from "../.test-build/campaign.js";
import { validateBalance } from "../.test-build/settings.js";
import { solveLP } from "../.test-build/simplex.js";

const BASE=JSON.parse(await readFile(new URL("../public/data/balance.json",import.meta.url)));
const R=JSON.parse(await readFile(new URL("../public/data/regions/grodno.json",import.meta.url)));
R.deposits=[{id:"test-site",kind:"coal",u:.17,v:.28,radiusM:1250}];
function setup(loss=true){
  const b=structuredClone(BASE);
  b.lines.hv.maxLengthM=20000;b.lines.lv.maxLengthM=20000;
  if(!loss){b.lines.hv.resistanceOhmPerM=0;b.lines.lv.resistanceOhmPerM=0;}
  const r=structuredClone(R);r.river=null;r.masks={};
  r.deposits=[{id:"all",kind:"coal",u:.5,v:.5,radiusM:30000},{id:"all2",kind:"peat",u:.5,v:.5,radiusM:30000}];
  const t=new Terrain(r,b);return {b,r,t,w:new World(b,t)};
}
function add(w,k,x,y,v="hv"){
  const r=w.add(k,x,y,{voltage:v});assert.ok(r.ok,r.error);return r.value;
}
const ep=(b,p="terminal")=>({id:b.id,port:p});
function link(w,a,b){const r=w.connect(a,b);assert.ok(r.ok,r.error);}
function simple(loss=false){
  const s=setup(loss),p=add(s.w,"coal",2000,3000),t=add(s.w,"transformer",4000,3000);
  const v=add(s.w,"village",5500,3000),f=add(s.w,"factory",5500,4800);
  link(s.w,ep(p),ep(t,"in"));link(s.w,ep(t,"out"),ep(v));link(s.w,ep(t,"out"),ep(f));
  return {...s,p,tb:t,v,f};
}
test("balance schema rejects NaN, wrong voltages and fractional limits",()=>{
  const b=structuredClone(BASE);b.lines.lv.voltageV=20000;assert.throws(()=>validateBalance(b));
  b.lines.lv.voltageV=400;b.world.maxBuildings=2.5;assert.throws(()=>validateBalance(b));
});
test("all default balance values validate",()=>assert.equal(validateBalance(BASE).schemaVersion,3));
test("matrix stores metres and is symmetric",()=>{
  const {w}=setup();const a=add(w,"pole",1000,1000),b=add(w,"pole",2000,3000);
  link(w,ep(a),ep(b));assert.equal(w.adjacency[0][1],Math.hypot(1000,2000));
  assert.equal(w.adjacency[1][0],w.adjacency[0][1]);assert.equal(w.adjacency[0][0],0);
});
test("self connections, duplicates and missing endpoints rejected",()=>{
  const {w}=setup();const a=add(w,"pole",1000,1000),b=add(w,"pole",2000,3000);
  assert.equal(w.connect(ep(a),ep(a)).ok,false);link(w,ep(a),ep(b));
  assert.equal(w.connect(ep(a),ep(b)).ok,false);assert.equal(w.connect(ep(a),{id:999,port:"terminal"}).ok,false);
});
test("no direct high-voltage station to low-voltage consumer",()=>{
  const {w}=setup();const a=add(w,"coal",1500,1500),b=add(w,"village",3500,1500);
  assert.equal(w.connect(ep(a),ep(b)).ok,false);
});
test("high and low poles cannot be directly joined",()=>{
  const {w}=setup();const a=add(w,"pole",1500,1500),b=add(w,"pole",2500,1500,"lv");
  assert.equal(w.connect(ep(a),ep(b)).ok,false);
});
test("cable length caps distinguish high/low voltage",()=>{
  const {w,b}=setup();b.lines.hv.maxLengthM=3800;b.lines.lv.maxLengthM=1600;
  const a=add(w,"pole",1000,1000,"lv"),z=add(w,"pole",3000,1000,"lv");
  assert.equal(w.connect(ep(a),ep(z)).ok,false);
});
test("buildings cannot overlap",()=>{
  const {w}=setup();add(w,"coal",3000,3000);assert.equal(w.add("pole",3000,3000).ok,false);
});
test("world boundary checks the footprint",()=>{
  const {w}=setup();assert.equal(w.add("coal",1,3000).ok,false);
});
test("station must be within its resource radius",()=>{
  const b=structuredClone(BASE),t=new Terrain(R,b),w=new World(b,t);
  assert.equal(w.add("coal",18000,11000).ok,false);
  assert.equal(w.add("coal",3400,3500).ok,true);
});
test("whole footprint intersects water even when center is dry",()=>{
  const {b,r}=setup();
  const pixels=new Uint8Array(100*100);pixels[50*100+51]=255;
  const t=new Terrain(r,b,{water:new Mask(100,100,pixels)});
  assert.ok(t.placementError("coal",10000,6250));
});
test("hydro needs a white point on hydro mask",()=>{
  const {b,r}=setup();
  const all=new Mask(1,1,new Uint8Array([255]));
  const w=new World(b,new Terrain(r,b,{water:all,hydro:all}));
  assert.equal(w.add("hydro",10000,6000).ok,true);
  assert.equal(w.add("pole",5000,6000).ok,false);
});
test("a black hydro mask forbids hydro even on water",()=>{
  const {b,r}=setup();
  const w=new World(b,new Terrain(r,b,{hydro:new Mask(1,1,new Uint8Array([0]))}));
  assert.equal(w.add("hydro",10000,6000).ok,false);
});
test("lossless model delivers exactly demand and transformer efficiency",()=>{
  const {w,v,f}=simple(false),s=simulate(w);
  assert.ok(Math.abs(s.consumerKW.get(v.id)-24)<1e-6);
  assert.ok(Math.abs(s.consumerKW.get(f.id)-130)<1e-6);
  assert.ok(Math.abs(s.generatedKW-154/.96)<1e-5);
  assert.ok(Math.abs(s.balanceErrorKW)<1e-5);
});
test("insufficient supply uses equal percentage, not equal kW",()=>{
  const {w,p,v,f}=simple(false);p.generationKW=80;
  const s=simulate(w),rv=s.consumerKW.get(v.id)/24,rf=s.consumerKW.get(f.id)/130;
  assert.ok(Math.abs(rv-rf)<1e-7);assert.ok(rv>0&&rv<1);
  assert.ok(Math.abs(rv-80*.96/154)<1e-6);
});
test("a disconnected consumer does not reduce connected ones",()=>{
  const {w,v}=simple(false),d=add(w,"city",12000,10000),s=simulate(w);
  assert.equal(s.consumerKW.get(d.id),0);assert.ok(Math.abs(s.consumerKW.get(v.id)-24)<1e-6);
});
test("transformer output capacity is enforced",()=>{
  const {w,tb}=simple(false);tb.outputLimitKW=77;
  const s=simulate(w);assert.ok(Math.abs(s.deliveredKW-77)<1e-6);
});
test("cable losses depend on length and preserve the energy balance",()=>{
  const {w}=simple(true),s=simulate(w);
  assert.ok(s.cableLossKW>0);assert.ok(s.transformerLossKW>0);
  assert.ok(Math.abs(s.balanceErrorKW)<1e-4);
  for(const state of s.cables.values())for(const f of state.flows)assert.ok(f.sentKW>=f.receivedKW);
});
test("a longer low-voltage line needs more generation for the same delivered power",()=>{
  function trial(x){
    const {w}=setup(true),p=add(w,"coal",2000,2000),t=add(w,"transformer",4000,2000),v=add(w,"village",x,2000);
    link(w,ep(p),ep(t,"in"));link(w,ep(t,"out"),ep(v));return simulate(w);
  }
  assert.ok(trial(7500).generatedKW>trial(5300).generatedKW);
});
test("consumers do not transit power",()=>{
  const {w}=setup(false),p=add(w,"coal",2000,2000),t=add(w,"transformer",4000,2000);
  const a=add(w,"village",6000,2000),b=add(w,"village",8000,2000);
  link(w,ep(p),ep(t,"in"));link(w,ep(t,"out"),ep(a));link(w,ep(a),ep(b));
  const s=simulate(w);assert.ok(s.consumerKW.get(a.id)>0);assert.equal(s.consumerKW.get(b.id),0);
});
test("stations do not transit power",()=>{
  const {w}=setup(false),p=add(w,"coal",2000,2000),p2=add(w,"coal",4000,2000);
  p2.generationKW=0;
  const t=add(w,"transformer",6000,2000),v=add(w,"village",7500,2000);
  link(w,ep(p),ep(p2));link(w,ep(p2),ep(t,"in"));link(w,ep(t,"out"),ep(v));
  assert.equal(simulate(w).consumerKW.get(v.id),0);
});
test("two sources cooperate through poles",()=>{
  const {w}=setup(false),p=add(w,"coal",2000,2000),p2=add(w,"peat",2000,5000),q=add(w,"pole",4000,3500);
  p.generationKW=p2.generationKW=60;
  const t=add(w,"transformer",6000,3500),f=add(w,"factory",7500,3500);
  link(w,ep(p),ep(q));link(w,ep(p2),ep(q));link(w,ep(q),ep(t,"in"));link(w,ep(t,"out"),ep(f));
  const s=simulate(w);assert.ok(Math.abs(s.deliveredKW-120*.96)<1e-5);
});
test("cycles preserve power balance",()=>{
  const {w}=simple(true),a=add(w,"pole",8500,2000),b=add(w,"pole",9000,4000),c=add(w,"pole",10000,2000);
  link(w,ep(a),ep(b));link(w,ep(b),ep(c));link(w,ep(c),ep(a));
  const s=simulate(w);assert.ok(Math.abs(s.balanceErrorKW)<1e-4);
});
test("fixed consumers cannot be sold",()=>{
  const {w,v}=simple();assert.equal(w.remove(v.id).ok,false);
});
test("deleting a building removes its row, column and incident cables",()=>{
  const {w,tb}=simple(),n=w.buildings.length;assert.ok(w.remove(tb.id).ok);
  assert.equal(w.buildings.length,n-1);assert.equal(w.adjacency.length,n-1);
  assert.ok(w.adjacency.every(r=>r.length===n-1));assert.equal(w.cables().length,0);
});
test("save roundtrip preserves matrix and ports",()=>{
  const {w,b,t}=simple(),restored=World.restore(w.snapshot(),b,t);
  assert.deepEqual(restored.snapshot(),w.snapshot());
});
test("tampered matrix distances are rejected",()=>{
  const {w,b,t}=simple(),s=w.snapshot();s.adjacency[0][1]=s.adjacency[1][0]=10;
  assert.throws(()=>World.restore(s,b,t));
});
test("mask outside and integral any query",()=>{
  const m=new Mask(2,2,new Uint8Array([0,255,0,0]));
  assert.equal(m.at(.75,.1),true);assert.equal(m.at(-1,0),false);
  assert.equal(m.any(0,0,.5,.5),false);assert.equal(m.any(.5,0,1,1),true);
});
test("seeded placement is deterministic, finite and nonoverlapping",()=>{
  const b=structuredClone(BASE),t=new Terrain(R,b),a=new World(b,t),z=new World(b,t);
  populate(a,123);populate(z,123);assert.deepEqual(a.snapshot(),z.snapshot());
  assert.equal(a.buildings.length,R.spawn.settlements.length+R.spawn.factories.length);assert.equal(a.buildings.filter(b=>b.kind==="factory").length,2);
});
test("all six regions and 25 seeds populate without water overlap",async()=>{
  const index=JSON.parse(await readFile(new URL("../public/data/campaign.json",import.meta.url)));
  for(const file of index.regions){
    const r=JSON.parse(await readFile(new URL("../public/"+file,import.meta.url)));
    for(let seed=0;seed<25;seed++){
      const b=structuredClone(BASE),t=new Terrain(r,b),w=new World(b,t);populate(w,seed);
      assert.equal(w.buildings.length,r.spawn.settlements.length+r.spawn.factories.length);
      for(const x of w.buildings)assert.equal(t.placementError(x.kind,x.x,x.y),undefined);
    }
  }
});
function active(){
  const {b,r,t,w,p,v,f}=simple(false);
  const c=new Campaign(b,[r,{...r,id:"second"}],22);
  c.status="playing";c.region=r;c.world=w;c.objectives=[{id:f.id,name:"Factory",kind:"factory",months:12},{id:v.id,name:"Village",kind:"village",months:12}];c.refresh();
  return {c,b,r,t,w,p,v,f};
}
test("failed purchase never spends money",()=>{
  const {c}=active(),before=c.money;
  assert.equal(c.place("coal",2000,3000,"hv").ok,false);assert.equal(c.money,before);
  c.money=0;assert.equal(c.place("coal",12000,10000,"hv").ok,false);assert.equal(c.money,0);
});
test("successful purchase and deletion use original paid price",()=>{
  const {c}=active(),before=c.money;
  assert.ok(c.place("pole",12000,10000,"hv").ok);
  const b=c.world.buildings.at(-1),paid=b.paid;
  assert.ok(c.removeBuilding(b.id).ok);assert.equal(c.money,before-paid*.5);
});
test("failed cable purchase never spends money",()=>{
  const {c,p,v}=active(),before=c.money;
  assert.equal(c.connect(ep(p),ep(v)).ok,false);assert.equal(c.money,before);
});
test("time and income stop together during pause",()=>{
  const {c}=active(),before=c.money;
  c.paused=true;c.advance(10);assert.equal(c.elapsed,0);assert.equal(c.money,before);
  c.paused=false;c.advance(10);assert.equal(c.elapsed,10);assert.ok(c.money>before);
});
test("only fully supplied settlements earn money; factories do not",()=>{
  const {c,p}=active();
  assert.equal(c.incomeRate,1.3);p.generationKW=50;c.refresh();assert.equal(c.incomeRate,0);
});
test("deadline advances only remaining active seconds (no excess income)",()=>{
  const {c}=active(),money=c.money;c.elapsed=c.duration-2;
  const result=c.advance(100);assert.ok(result.success);
  assert.ok(Math.abs(c.money-money-2*1.3)<1e-6);
});
test("one previously powered factory is insufficient if disconnected at deadline",()=>{
  const {c,w,f}=active();
  assert.equal(c.poweredFactories,1);
  const cable=w.cables().find(x=>x.b.id===f.id);w.disconnect(cable.a.id,cable.b.id);c.refresh();
  const r=c.advance(c.duration);assert.equal(r.success,false);assert.equal(c.status,"reprimand");
});
test("completed region is locked; money carries into next stage",()=>{
  const {c,r,t}=active();const outcome=c.advance(c.duration);
  assert.ok(outcome.success);assert.equal(c.status,"map");assert.equal(c.completed[0],r.id);
  const money=c.money;assert.equal(c.place("pole",13000,11000,"hv").ok,false);assert.equal(c.money,money);
  assert.throws(()=>c.begin(r,t));assert.equal(c.duration,165);assert.ok(Math.abs(c.priceFactor-1.08)<1e-8);
});
test("deadline with missing power fails even when money is positive",()=>{
  const {c,p}=active();p.generationKW=0;c.refresh();
  assert.equal(c.advance(c.duration).success,false);assert.equal(c.status,"reprimand");
});
test("campaign save resumes paused and rejects changed balance",()=>{
  const {c,b,r,t}=active();c.advance(3);
  const save=c.snapshot(),resumed=Campaign.restore(save,b,[r,{...r,id:"second"}],t);
  assert.equal(resumed.paused,true);assert.equal(resumed.elapsed,3);assert.equal(resumed.money,c.money);
  const changed=structuredClone(b);changed.economy.startingMoney+=1;
  assert.throws(()=>Campaign.restore(save,changed,[r],t));
});
test("all regions complete leads to victory",()=>{
  const {c,r}=active();c.completed=["second"];
  const outcome=c.advance(c.duration);assert.ok(outcome.success);assert.equal(c.status,"won");
});
test("simplex basic lexicographic solve",()=>{
  const s=solveLP({A:[[1,1],[1,0],[0,1]],b:[10,8,8],primary:[1,1],secondary:[0,1]});
  assert.ok(Math.abs(s.objective-10)<1e-6);assert.ok(Math.abs(s.x[1]-8)<1e-6);
});

test("connected high-voltage loop remains balanced and useful",()=>{
  const {w,p,tb}=simple(true),a=add(w,"pole",4000,6500),b=add(w,"pole",2000,6500);
  link(w,ep(p),ep(b));link(w,ep(b),ep(a));link(w,ep(a),ep(tb,"in"));
  const s=simulate(w);
  assert.ok(s.deliveredKW>0);assert.ok(Math.abs(s.balanceErrorKW)<1e-4);
});
test("all six stages can settle a fully supplied current plan and carry their balance",async()=>{
  const index=JSON.parse(await readFile(new URL("../public/data/campaign.json",import.meta.url)));
  const regions=[];for(const f of index.regions)regions.push(JSON.parse(await readFile(new URL("../public/"+f,import.meta.url))));
  const b=structuredClone(BASE),c=new Campaign(b,regions,8723);
  for(const r of regions){
    c.begin(r,new Terrain(r,b));
    // Deadline rule unit test. Power routing is covered by physical-network tests above.
    for(const o of c.objectives)c.sim.consumerKW.set(o.id,c.world.byId(o.id).demandKW);
    c.refresh=()=>{};
    assert.ok(c.advance(c.remaining).success);
  }
  assert.equal(c.status,"won");
});
