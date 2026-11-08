
import { clamp, type Balance, type Kind, type Point, type RegionConfig } from "./types.js";

export type MaskName = "water" | "hydro" | "blocked" | "spawn";
/** Binary, un-antialiased logical mask. The summed-area table tests a whole footprint. */
export class Mask {
  private integral: Uint32Array;
  constructor(readonly width: number,readonly height: number,readonly pixels: Uint8Array) {
    if (pixels.length !== width*height || width < 1 || height < 1) throw new Error("Некорректная маска.");
    this.integral = new Uint32Array((width+1)*(height+1));
    for (let y=0;y<height;y++) {
      let row=0;
      for (let x=0;x<width;x++) {
        row += pixels[y*width+x] > 127 ? 1 : 0;
        this.integral[(y+1)*(width+1)+x+1] = row+this.integral[y*(width+1)+x+1];
      }
    }
  }
  at(u: number,v: number): boolean {
    if (u<0 || v<0 || u>1 || v>1) return false;
    const x=clamp(Math.floor(u*this.width),0,this.width-1);
    const y=clamp(Math.floor(v*this.height),0,this.height-1);
    return this.pixels[y*this.width+x]>127;
  }
  any(u0: number,v0: number,u1: number,v1: number): boolean {
    const x0=clamp(Math.floor(u0*this.width),0,this.width), y0=clamp(Math.floor(v0*this.height),0,this.height);
    const x1=clamp(Math.ceil(u1*this.width),0,this.width), y1=clamp(Math.ceil(v1*this.height),0,this.height);
    const w=this.width+1, s=this.integral;
    return s[y1*w+x1]-s[y0*w+x1]-s[y1*w+x0]+s[y0*w+x0]>0;
  }
}
export function distanceToSegment(p: Point,a: Point,b: Point): number {
  const dx=b.x-a.x,dy=b.y-a.y,l2=dx*dx+dy*dy;
  const t=l2===0?0:clamp(((p.x-a.x)*dx+(p.y-a.y)*dy)/l2,0,1);
  return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);
}
export class Terrain {
  constructor(readonly region: RegionConfig,readonly balance: Balance,
    readonly masks: Partial<Record<MaskName,Mask>>={}) {}
  sample(name: MaskName,x: number,y: number): boolean {
    const w=this.balance.world.widthM,h=this.balance.world.heightM;
    if (this.masks[name]) return this.masks[name]!.at(x/w,y/h);
    if (name==="spawn") return true;
    if (name==="blocked" || !this.region.river) return false;
    const r=this.region.river;
    for (let i=1;i<r.points.length;i++) {
      const a={x:r.points[i-1][0]*w,y:r.points[i-1][1]*h};
      const b={x:r.points[i][0]*w,y:r.points[i][1]*h};
      if (distanceToSegment({x,y},a,b)<=r.widthM/2) return true;
    }
    return false;
  }
  private touches(name: MaskName,x: number,y: number,w: number,h: number): boolean {
    const mask=this.masks[name],world=this.balance.world;
    if (mask) return mask.any((x-w/2)/world.widthM,(y-h/2)/world.heightM,
      (x+w/2)/world.widthM,(y+h/2)/world.heightM);
    // Analytic fallback only when no mask was specified (also useful in unit tests).
    const nx=Math.max(1,Math.ceil(w/60)),ny=Math.max(1,Math.ceil(h/60));
    for (let iy=0;iy<=ny;iy++) for (let ix=0;ix<=nx;ix++)
      if (this.sample(name,x-w/2+w*ix/nx,y-h/2+h*iy/ny)) return true;
    return false;
  }
  placementError(kind: Kind,x: number,y: number,ignoreResource=false): string | undefined {
    const s=this.balance.buildings[kind],world=this.balance.world;
    if (x-s.widthM/2<0 || y-s.heightM/2<0 ||
        x+s.widthM/2>world.widthM || y+s.heightM/2>world.heightM)
      return "Здание выходит за пределы участка.";
    if (this.touches("blocked",x,y,s.widthM,s.heightM)) return "Здесь строительство запрещено маской карты.";
    if (kind==="hydro") {
      if (!this.sample("hydro",x,y)) return "ГЭС: поставьте центральную точку на разрешённый участок реки.";
    } else if (this.touches("water",x,y,s.widthM,s.heightM)) return "Это вода. Наземные здания и опоры ставятся на суше.";
    if (!ignoreResource && (kind==="coal" || kind==="peat")) {
      if (!this.region.deposits.some(d=>d.kind===kind &&
        Math.hypot(x-d.u*world.widthM,y-d.v*world.heightM)<=d.radiusM))
        return kind==="coal" ? "Угольная ТЭС строится внутри угольного месторождения." : "Торфяная ТЭС строится внутри торфяного болота.";
    }
    if (["city","village","factory"].includes(kind) && !this.sample("spawn",x,y))
      return "Эта площадка не разрешена для потребителей.";
  }
}
export function random(seed: number): ()=>number {
  let a=seed|0;
  return ()=>{
    a+=0x6D2B79F5;
    let t=Math.imul(a^(a>>>15),1|a);
    t^=t+Math.imul(t^(t>>>7),61|t);
    return ((t^(t>>>14))>>>0)/4294967296;
  };
}
