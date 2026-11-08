/** Test-only builder. Pays real prices, obeys masks and advances real campaign time. */
export function referencePlanV05(c,{oneConsumer=false,secondsPerAction=1.2}={}){
  const w=c.world,b=c.balance;
  if(!w)throw new Error('No world');
  const ep=(x,p='terminal')=>({id:x.id,port:p});
  let actions=0,waited=0;
  const advance=()=>{actions++;if(c.advance(secondsPerAction))throw new Error('Deadline passed during construction');};
  function need(cost){
    if(cost<=c.money+1e-7)return;
    if(c.incomeRate<=0)throw new Error(`Cannot afford ${cost}; balance ${c.money}`);
    const time=(cost-c.money)/c.incomeRate+.05;
    if(time>=c.remaining-3)throw new Error('Insufficient time for income');
    c.advance(time);waited+=time;
  }
  function place(kind,x,y){need(c.price(kind));const r=c.place(kind,x,y,'hv');if(!r.ok)throw new Error(r.error);advance();return w.buildings.at(-1);}
  function link(a,z){need(c.cablePrice(a,z));const r=c.connect(a,z);if(!r.ok)throw new Error(r.error);advance();}
  const settlements=w.buildings.filter(x=>x.kind==='village'||x.kind==='city');
  const targets=c.objectives.map(o=>w.byId(o.id));
  function sites(){
    const list=[];
    for(const d of c.region.deposits){
      for(let i=0;i<20;i++){
        const angle=i/20*Math.PI*2,radius=i===0?0:d.radiusM*.8;
        const x=d.u*b.world.widthM+Math.cos(angle)*radius,y=d.v*b.world.heightM+Math.sin(angle)*radius;
        if(!w.placementError(d.kind,x,y))list.push({kind:d.kind,x,y});
      }
    }
    const h=w.terrain.masks.hydro;
    if(h)for(let y=2;y<h.height-2;y+=3)for(let x=2;x<h.width-2;x+=3){
      if(!h.pixels[y*h.width+x])continue;
      const xx=(x+.5)/h.width*b.world.widthM,yy=(y+.5)/h.height*b.world.heightM;
      if(!w.placementError('hydro',xx,yy))list.push({kind:'hydro',x:xx,y:yy});
    }
    return list;
  }
  function near(a,z){return Math.hypot(a.x-z.x,a.y-z.y);}
  function connectHV(plant,target,root){
    let from=plant;
    if(!from)from=w.buildings.filter(x=>x.kind==='pole'&&x.voltage==='hv').sort((a,z)=>near(a,target)-near(z,target))[0]||root;
    let guard=0;
    while(near(from,target)>b.lines.hv.maxLengthM){
      if(++guard>24)throw new Error('Routing search did not converge');
      const cand=[],angle=Math.atan2(target.y-from.y,target.x-from.x),max=b.lines.hv.maxLengthM;
      for(const radius of [max*.9,max*.7,max*.5])for(let i=0;i<60;i++){
        const t=angle+(i-30)*Math.PI/30,x=from.x+Math.cos(t)*radius,y=from.y+Math.sin(t)*radius;
        if(w.placementError('pole',x,y))continue;
        if(Math.hypot(target.x-x,target.y-y)>=near(from,target)-150)continue;
        cand.push({x,y,d:Math.hypot(target.x-x,target.y-y)});
      }
      cand.sort((a,z)=>a.d-z.d);if(!cand.length)throw new Error('No safe high-voltage waypoint');
      const pole=place('pole',cand[0].x,cand[0].y);link(ep(from),ep(pole));from=pole;
    }
    link(ep(from),ep(target,target.kind==='transformer'?'in':'terminal'));
  }
  const candidates=sites(),needCapacity=targets.reduce((sum,x)=>sum+x.demandKW,0)*1.12;
  const score=s=>c.price(s.kind)+Math.min(...settlements.map(x=>near(x,s)))*.015+
    targets.reduce((sum,x)=>sum+near(x,s),0)*.002+(b.buildings[s.kind].generationKW<needCapacity?200:0);
  candidates.sort((a,z)=>score(a)-score(z));
  if(!candidates.length)throw new Error('No legal generation site');
  const station=place(candidates[0].kind,candidates[0].x,candidates[0].y);
  const hubSites=[];
  for(const r of [650,850,1050])for(let i=0;i<32;i++){
    const x=station.x+Math.cos(i/32*Math.PI*2)*r,y=station.y+Math.sin(i/32*Math.PI*2)*r;
    if(!w.placementError('pole',x,y))hubSites.push({x,y,d:targets.reduce((sum,t)=>sum+Math.hypot(t.x-x,t.y-y),0)});
  }
  hubSites.sort((a,z)=>a.d-z.d);if(!hubSites.length)throw new Error('No dry station terminal');
  const hub=place('pole',hubSites[0].x,hubSites[0].y);link(ep(station),ep(hub));
  const starter=[...settlements].sort((a,z)=>near(a,station)-near(z,station))[0];
  const consumers=[starter,...targets.filter(x=>x.id!==starter.id)];
  for(const consumer of oneConsumer?consumers.slice(0,1):consumers){
    const potential=[];
    for(const r of [640,760,900,1050,1250])for(let i=0;i<48;i++){
      const x=consumer.x+Math.cos(i/48*Math.PI*2)*r,y=consumer.y+Math.sin(i/48*Math.PI*2)*r;
      if(w.placementError('transformer',x,y))continue;
      const dist=Math.min(...w.buildings.filter(x=>x.kind==='pole'&&x.voltage==='hv').map(z=>Math.hypot(z.x-x,z.y-y)));
      potential.push({x,y,d:dist+r*.8});
    }
    potential.sort((a,z)=>a.d-z.d);if(!potential.length)throw new Error('No transformer site');
    const t=place('transformer',potential[0].x,potential[0].y);
    connectHV(null,t,hub);link(ep(t,'out'),ep(consumer));
  }
  if(!oneConsumer&&c.poweredObjectives<c.objectiveCount){
    const other=sites().sort((a,z)=>near(a,hub)-near(z,hub))[0];
    if(other){const added=place(other.kind,other.x,other.y);connectHV(added,hub,hub);}
  }
  if(oneConsumer&&c.incomeRate<=0)throw new Error('Starter settlement is not fully powered');
  if(!oneConsumer&&c.poweredObjectives<c.objectiveCount)throw new Error('Plan underpowered');
  return {actions,waited,elapsed:c.elapsed,balance:c.money,income:c.incomeRate,station:station.kind,
    deliveredKW:c.sim.deliveredKW,lossesKW:c.sim.cableLossKW+c.sim.transformerLossKW};
}
