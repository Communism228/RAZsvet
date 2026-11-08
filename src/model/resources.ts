import { Terrain, random } from "./terrain.js";
import type { Deposit } from "./types.js";

/** Seeded once per region; painting never changes resources. */
export function generateResources(terrain: Terrain, seed: number): Terrain {
  const cfg=terrain.balance.resources;
  if(!cfg || cfg.mode==="fixed")return terrain;
  const region={...terrain.region,deposits:[] as Deposit[]};
  const next=new Terrain(region,terrain.balance,terrain.masks);
  if(cfg.mode==="none")return next;
  const rand=random((seed^terrain.region.seed^0x73a4b21d)>>>0);
  if(rand()<cfg.emptyRegionChance)return next;
  const w=terrain.balance.world.widthM,h=terrain.balance.world.heightM;
  for(const kind of ["coal","peat"] as const){
    const k=cfg[kind];if(rand()<k.noneChance)continue;
    const count=k.minCount+Math.floor(rand()*(k.maxCount-k.minCount+1));
    for(let index=0;index<count;index++){
      let found=false;
      for(let tries=0;tries<600;tries++){
        const x=w*(.04+rand()*.92),y=h*(.04+rand()*.92);
        if(next.placementError(kind,x,y,true))continue;
        if(region.deposits.some(d=>Math.hypot(x-d.u*w,y-d.v*h)<(d.radiusM+k.radiusM)*.85))continue;
        region.deposits.push({id:`${kind}-${index+1}`,kind,u:x/w,v:y/h,radiusM:k.radiusM});
        found=true;break;
      }
      if(!found)break;
    }
  }
  return next;
}
