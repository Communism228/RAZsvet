
/**
 * Deterministic reference builder used ONLY by tests.
 * It pays real prices, uses real placement/voltage checks and advances active time
 * after each operation. It is not a UI cheat or a proof of fun/balance.
 */
export function referencePlan(c,{secondsPerAction=1.5}={}){
  let actions=0,waited=0;
  const w=c.world;
  if(!w)throw new Error("No active world.");
  function need(money){
    if(c.money+1e-6>=money)return;
    if(c.incomeRate<=0)throw new Error(`No money/income; need ${money}, have ${c.money}`);
    const dt=(money-c.money)/c.incomeRate+.02;
    if(dt>=c.remaining-4)throw new Error("Cannot afford plan before deadline.");
    c.advance(dt);waited+=dt;
  }
  function step(){
    actions++;if(secondsPerAction>0){
      const outcome=c.advance(secondsPerAction);if(outcome)throw new Error("Deadline before last build.");
    }
  }
  function place(kind,x,y,voltage="hv"){
    need(c.price(kind));
    const result=c.place(kind,x,y,voltage);
    if(!result.ok)throw new Error(result.error);
    const b=w.buildings.at(-1);step();return b;
  }
  function ep(b,port="terminal"){return {id:b.id,port};}
  function connect(a,b){
    need(c.cablePrice(a,b));
    const result=c.connect(a,b);
    if(!result.ok)throw new Error(result.error);
    step();
  }
  let plant=w.buildings.find(b=>["coal","peat","hydro"].includes(b.kind));
  if(!plant){
    const dep=w.terrain.region.deposits.find(d=>d.kind==="coal");
    if(!dep)throw new Error("Reference plan needs one coal deposit.");
    plant=place("coal",dep.u*c.balance.world.widthM,dep.v*c.balance.world.heightM);
  }
  const nearestVillage=w.buildings.filter(b=>b.kind==="village")
    .sort((a,b)=>Math.hypot(a.x-plant.x,a.y-plant.y)-Math.hypot(b.x-plant.x,b.y-plant.y))[0];
  const consumers=[nearestVillage,...w.buildings.filter(b=>b.kind==="city"),...w.buildings.filter(b=>b.kind==="factory")];
  for(const consumer of consumers){
    if((c.sim.consumerKW.get(consumer.id)??0)>=consumer.demandKW*c.balance.simulation.fullPowerThreshold)continue;
    const candidates=[];
    for(const radius of [1050,1150,1300,1450])for(let i=0;i<32;i++){
      const theta=i/32*Math.PI*2,x=consumer.x+Math.cos(theta)*radius,y=consumer.y+Math.sin(theta)*radius;
      if(w.placementError("transformer",x,y))continue;
      const near=w.buildings.filter(b=>b.kind==="pole"&&b.voltage==="hv"||["coal","peat","hydro"].includes(b.kind))
        .reduce((d,b)=>Math.min(d,Math.hypot(x-b.x,y-b.y)),Infinity);
      candidates.push({x,y,score:near+radius*.35});
    }
    candidates.sort((a,b)=>a.score-b.score);
    if(!candidates.length)throw new Error("No transformer site near consumer.");
    const site=candidates[0],t=place("transformer",site.x,site.y);
    let start=w.buildings.filter(b=>b.kind==="pole"&&b.voltage==="hv"||["coal","peat","hydro"].includes(b.kind))
      .sort((a,b)=>Math.hypot(a.x-t.x,a.y-t.y)-Math.hypot(b.x-t.x,b.y-t.y))[0];
    const max=c.balance.lines.hv.maxLengthM;
    let guard=0;
    while(Math.hypot(start.x-t.x,start.y-t.y)>max){
      if(++guard>20)throw new Error("Reference routing failed.");
      const angle=Math.atan2(t.y-start.y,t.x-start.x),d=Math.min(max*.86,Math.hypot(t.x-start.x,t.y-start.y)-850);
      let next=null;
      for(const shift of [0,.08,-.08,.16,-.16,.26,-.26,.4,-.4,.55,-.55]){
        const x=start.x+Math.cos(angle+shift)*d,y=start.y+Math.sin(angle+shift)*d;
        if(!w.placementError("pole",x,y)){next={x,y};break;}
      }
      if(!next)throw new Error("No safe pole waypoint.");
      const pole=place("pole",next.x,next.y);
      connect(ep(start),ep(pole));start=pole;
    }
    connect(ep(start),ep(t,"in"));
    connect(ep(t,"out"),ep(consumer));
  }
  if(c.poweredFactories!==c.factories)throw new Error("Reference plan underpowered.");
  return {actions,waited,money:c.money,elapsed:c.elapsed,income:c.incomeRate,
    generation:c.sim.generatedKW,delivered:c.sim.deliveredKW,losses:c.sim.cableLossKW+c.sim.transformerLossKW};
}
