
import { Assets,type GameData } from "../assets.js";
import { Campaign } from "../model/campaign.js";
import { BUILD_KINDS,NAMES,isConsumer,isPlant,clamp,type Balance,type Building,
  type Endpoint,type Point,type Tool,type Voltage } from "../model/types.js";

export type Phase="menu"|"intro"|"country"|"transition"|"region"|"result";
export interface Camera { x:number;y:number;zoom:number }
export interface View { x:number;y:number;w:number;h:number;scale:number }
export interface PaintState {
  width:number;height:number;time:number;phase:Phase;
  campaign:Campaign;assets:Assets;data:GameData;camera:Camera;
  mouse:Point|null;tool:Tool;poleVoltage:Voltage;selected:number|string|null;pending:Endpoint|null;
  hoverRegion:string|null;introIndex:number;introStart:number;
  transition:{regionId:string;start:number}|null;
}
const C={gold:"#edbd69",paper:"#f1d5aa",red:"#dc3b35",dark:"#1c2327",blue:"#9cc7cf"};
export function countryRect(width:number,height:number):View {
  const s=Math.min((width-80)/1280,(height-150)/800);
  const w=1280*s,h=800*s;
  return {x:(width-w)/2,y:105+(height-150-h)/2,w,h,scale:s};
}
export function worldView(width:number,height:number,b:Balance,c:Camera):View {
  const scale=Math.min(width/b.world.widthM,height/b.world.heightM)*c.zoom;
  return {x:width/2-c.x*scale,y:height/2-c.y*scale,w:b.world.widthM*scale,h:b.world.heightM*scale,scale};
}
export function screenToWorld(p:Point,s:PaintState):Point {
  const v=worldView(s.width,s.height,s.campaign.balance,s.camera);
  return {x:(p.x-v.x)/v.scale,y:(p.y-v.y)/v.scale};
}
export function worldToScreen(p:Point,s:PaintState):Point {
  const v=worldView(s.width,s.height,s.campaign.balance,s.camera);
  return {x:v.x+p.x*v.scale,y:v.y+p.y*v.scale};
}
function text(ctx:CanvasRenderingContext2D,t:string,x:number,y:number,size=12,color=C.paper,align:CanvasTextAlign="left"):void {
  ctx.font=`600 ${size}px "DejaVu Sans",Arial,sans-serif`;ctx.fillStyle=color;ctx.textAlign=align;ctx.textBaseline="middle";
  ctx.fillText(t,x,y);
}
function wrap(ctx:CanvasRenderingContext2D,t:string,width:number):string[] {
  const words=t.split(" "),lines:string[]=[];let line="";
  for(const word of words){
    const next=line?line+" "+word:word;
    if(line&&ctx.measureText(next).width>width){lines.push(line);line=word;}else line=next;
  }
  if(line)lines.push(line);return lines;
}
function sprite(ctx:CanvasRenderingContext2D,s:PaintState,kind:Building["kind"],x:number,y:number,active:boolean,scale:number):void {
  const spec=s.data.manifest.sprites[kind],image=s.assets.image(active&&spec.powered?spec.powered:spec.idle);
  if(!image)return;
  const w=spec.width*scale,h=spec.height*scale,dx=x-w*spec.anchorX,dy=y-h*spec.anchorY;
  const f=spec.frames;
  if(f){
    const n=Math.floor(image.naturalWidth/f.width);
    const frame=active?Math.floor(s.time/1000*f.fps)%f.count:0;
    ctx.drawImage(image,(frame%n)*f.width,Math.floor(frame/n)*f.height,f.width,f.height,dx,dy,w,h);
  }else ctx.drawImage(image,dx,dy,w,h);
}
function country(ctx:CanvasRenderingContext2D,s:PaintState):void {
  const r=countryRect(s.width,s.height),dark=s.assets.image(s.data.manifest.country.dark)!;
  ctx.save();
  if(s.phase==="transition"&&s.transition){
    const p=clamp((s.time-s.transition.start)/1050,0,1),e=p*p*(3-2*p),z=1+3.5*e;
    const reg=s.data.regions.find(r=>r.id===s.transition!.regionId)!;
    const x=r.x+reg.city.u*r.w,y=r.y+reg.city.v*r.h;
    ctx.translate(s.width/2,s.height/2);ctx.scale(z,z);
    ctx.translate(-((s.width/2)*(1-e)+x*e),-((s.height/2)*(1-e)+y*e));
  }
  ctx.drawImage(dark,r.x,r.y,r.w,r.h);
  for(const id of s.campaign.completed){
    const img=s.assets.litRegions.get(id);if(img)ctx.drawImage(img,r.x,r.y,r.w,r.h);
  }
  if(s.hoverRegion&&!s.campaign.completed.includes(s.hoverRegion)){
    const image=s.assets.litRegions.get(s.hoverRegion);
    if(image){ctx.globalAlpha=.14+.035*Math.sin(s.time/300);ctx.drawImage(image,r.x,r.y,r.w,r.h);ctx.globalAlpha=1;}
  }
  if(s.phase==="transition")for(const reg of s.data.regions){
    text(ctx,reg.name.toUpperCase(),r.x+reg.city.u*r.w,r.y+reg.city.v*r.h,15,C.paper,"center");
  }
  ctx.restore();
  if(s.phase==="transition"&&s.transition){
    ctx.fillStyle=`rgba(18,24,27,${clamp((s.time-s.transition.start-700)/350,0,1)})`;
    ctx.fillRect(0,0,s.width,s.height);
  }
}
function menu(ctx:CanvasRenderingContext2D,s:PaintState):void {
  const m=s.data.manifest.menu;
  const image=s.assets.image(m?.background??s.data.manifest.country.dark)!;
  const z=1.08+.012*Math.sin(s.time/3000);
  ctx.save();ctx.translate(s.width/2,s.height/2);ctx.scale(z,z);
  ctx.drawImage(image,-s.width/2,-s.height/2,s.width,s.height);ctx.restore();
  for(const layer of m?.layers??[]){
    const img=s.assets.image(layer.image);if(!img)continue;
    const phase=s.time/Math.max(100,layer.periodMs??7000)*Math.PI*2;
    ctx.save();ctx.globalAlpha=clamp(layer.opacity??1,0,1);
    ctx.drawImage(img,Math.sin(phase)*(layer.amplitudeX??6),Math.cos(phase)*(layer.amplitudeY??4),s.width,s.height);ctx.restore();
  }
  const g=ctx.createLinearGradient(0,0,s.width,0);
  g.addColorStop(0,"rgba(13,20,24,.93)");g.addColorStop(.54,"rgba(13,20,24,.7)");g.addColorStop(1,"rgba(13,20,24,.25)");
  ctx.fillStyle=g;ctx.fillRect(0,0,s.width,s.height);
  if(m?.showNetworkOverlay===false)return;
  const points=[{x:s.width*.63,y:s.height*.77},{x:s.width*.76,y:s.height*.38},{x:s.width*.93,y:s.height*.67}];
  ctx.strokeStyle="#edbd6980";ctx.lineWidth=2;ctx.beginPath();
  points.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.stroke();
  for(let i=0;i<points.length;i++){
    const p=points[i];sprite(ctx,s,i===1?"pole":"factory",p.x,p.y,true,s.width/1100);
    const r=8+(s.time/90+i*12)%35;ctx.strokeStyle=`rgba(237,189,105,${(1-(r-8)/35)*.3})`;
    ctx.beginPath();ctx.arc(p.x,p.y,r,0,Math.PI*2);ctx.stroke();
  }
}
function intro(ctx:CanvasRenderingContext2D,s:PaintState):void {
  ctx.fillStyle="#d7be94";ctx.fillRect(0,0,s.width,s.height);
  const c=s.data.intro,scale=Math.min((s.width-70)/c.width,(s.height-150)/c.height);
  const ox=(s.width-c.width*scale)/2,oy=(s.height-c.height*scale)/2;
  c.panels.forEach((p,i)=>{
    const x=ox+p.x*scale,y=oy+p.y*scale,w=p.width*scale,h=p.height*scale;
    if(!c.fullPageLayers){ctx.fillStyle="#b49c77";ctx.fillRect(x,y,w,h);}
    if(i>s.introIndex)return;
    const alpha=i<s.introIndex?1:clamp((s.time-s.introStart)/c.fadeMs,0,1);
    ctx.save();ctx.globalAlpha=alpha;ctx.beginPath();ctx.rect(x,y,w,h);ctx.clip();
    const image=s.assets.image(p.image)!;
    const z=c.fullPageLayers?1:1+(1-alpha)*.035;
    ctx.drawImage(image,x-w*(z-1)/2,y-h*(z-1)/2,w*z,h*z);
    if(p.caption){
      ctx.fillStyle="#161e23ed";ctx.fillRect(x,y+h-65*scale,w,65*scale);
      ctx.font=`600 ${Math.max(11,16*scale)}px "DejaVu Sans",Arial`;
      const lines=wrap(ctx,p.caption,w-28*scale);
      lines.forEach((line,j)=>text(ctx,line,x+14*scale,y+h-(lines.length-j)*20*scale-6*scale,Math.max(11,16*scale)));
    }
    ctx.restore();
    if(!c.fullPageLayers){ctx.strokeStyle="#171e23";ctx.lineWidth=3*scale;ctx.strokeRect(x,y,w,h);}
  });
}
function region(ctx:CanvasRenderingContext2D,s:PaintState):void {
  const c=s.campaign,w=c.world,r=c.region;if(!w||!r)return;
  const v=worldView(s.width,s.height,c.balance,s.camera),u=v.scale;
  const pos=(p:Point):Point=>({x:v.x+p.x*u,y:v.y+p.y*u});
  ctx.save();ctx.beginPath();ctx.rect(v.x,v.y,v.w,v.h);ctx.clip();
  const bg=s.assets.image(r.map);if(bg)ctx.drawImage(bg,v.x,v.y,v.w,v.h);
  if(BUILD_KINDS.includes(s.tool as never)){
    ctx.strokeStyle="#dfc28c0d";ctx.lineWidth=1;ctx.beginPath();
    for(let x=1000;x<c.balance.world.widthM;x+=1000){ctx.moveTo(v.x+x*u,v.y);ctx.lineTo(v.x+x*u,v.y+v.h);}
    for(let y=1000;y<c.balance.world.heightM;y+=1000){ctx.moveTo(v.x,v.y+y*u);ctx.lineTo(v.x+v.w,v.y+y*u);}ctx.stroke();
  }
  for(const d of r.deposits){
    const p=pos({x:d.u*c.balance.world.widthM,y:d.v*c.balance.world.heightM}),radius=d.radiusM*u;
    const selected=s.tool===d.kind;
    ctx.strokeStyle=selected?C.gold:"#b49b674d";ctx.lineWidth=selected?2:1;ctx.setLineDash([4,5]);
    ctx.beginPath();ctx.arc(p.x,p.y,radius,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);
    if(selected){ctx.fillStyle="#edbd6910";ctx.fill();}
    text(ctx,d.kind==="coal"?"УГОЛЬ":"ТОРФ",p.x,p.y-radius-10,10,selected?C.gold:"#b6a183","center");
  }
  for(const cable of w.cables()){
    const a=pos(w.endpointPosition(cable.a)),b=pos(w.endpointPosition(cable.b));
    const state=c.sim?.cables.get(cable.key),active=state?.active,selected=s.selected===cable.key;
    ctx.strokeStyle=selected?"#fff0c5":active?(cable.voltage==="hv"?C.gold:C.blue):"#847359";
    ctx.globalAlpha=active||selected?1:.65;
    ctx.lineWidth=selected?5:cable.voltage==="hv"?3:2.2;
    if(!active)ctx.setLineDash([7,5]);
    ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();ctx.setLineDash([]);ctx.globalAlpha=1;
    if(active&&state!.flows.length){
      const from=state!.flows[0].from.id===cable.a.id?a:b,to=from===a?b:a,t=(s.time/2300)%1;
      ctx.fillStyle="#fff2d6";ctx.beginPath();ctx.arc(from.x+(to.x-from.x)*t,from.y+(to.y-from.y)*t,2.5,0,Math.PI*2);ctx.fill();
    }
  }
  for(const b of [...w.buildings].sort((a,b)=>a.y-b.y)){
    const p=pos(b),cfg=c.balance.buildings[b.kind],scale=u*c.balance.world.widthM/1280;
    const power=c.sim?.consumerKW.get(b.id)??0,ratio=b.demandKW>0?clamp(power/b.demandKW,0,1):0;
    const full=ratio>=c.balance.simulation.fullPowerThreshold;
    const active=isConsumer(b)?full:isPlant(b)?(c.sim?.generationKW.get(b.id)??0)>1e-6:
      b.kind==="transformer"?(c.sim?.transformer.get(b.id)?.outputKW??0)>1e-6:true;
    if(s.selected===b.id||s.pending?.id===b.id){
      ctx.strokeStyle=C.gold;ctx.lineWidth=1.5;
      ctx.strokeRect(p.x-cfg.widthM*u/2-5,p.y-cfg.heightM*u/2-5,cfg.widthM*u+10,cfg.heightM*u+10);
    }
    const objective=isConsumer(b)&&c.isObjective(b.id);
    if(objective){
      const planGlow=ctx.createRadialGradient(p.x,p.y,2,p.x,p.y,58*scale);
      planGlow.addColorStop(0,full?"#ff9b8f55":"#ff544855");
      planGlow.addColorStop(1,"#ff544800");ctx.fillStyle=planGlow;
      ctx.fillRect(p.x-58*scale,p.y-58*scale,116*scale,116*scale);
    }
    if(full){
      const glow=ctx.createRadialGradient(p.x,p.y,2,p.x,p.y,50*scale);
      glow.addColorStop(0,"#edbd6935");glow.addColorStop(1,"#edbd6900");ctx.fillStyle=glow;
      ctx.fillRect(p.x-50*scale,p.y-50*scale,100*scale,100*scale);
    }
    sprite(ctx,s,b.kind,p.x,p.y,active,scale);
    if(b.kind==="transformer"){
      for(const port of ["in","out"] as const){
        const ep=pos(w.endpointPosition({id:b.id,port}));
        ctx.fillStyle=port==="in"?C.gold:C.blue;ctx.beginPath();ctx.arc(ep.x,ep.y,4,0,Math.PI*2);ctx.fill();
        text(ctx,port==="in"?"ВН":"НН",ep.x,ep.y-13,8,port==="in"?C.gold:C.blue,"center");
      }
    }
    const y=p.y+cfg.heightM*u/2+11,short=b.kind==="factory"?`ЗАВОД ${w.buildings.filter(x=>x.kind==="factory").indexOf(b)+1}`:
      b.name|| (b.kind==="pole"?(b.voltage==="hv"?"ВН":"НН"):b.kind==="transformer"?"10 кВ → 400 В":NAMES[b.kind]);
    if(b.kind!=="pole"||s.selected===b.id){
      ctx.font='600 10px "DejaVu Sans",Arial';const tw=ctx.measureText(short).width;
      ctx.fillStyle="#182024da";ctx.fillRect(p.x-tw/2-5,y-7,tw+10,15);
      text(ctx,short,p.x,y,10,isConsumer(b)?full?C.gold:C.paper:"#c9b797","center");
    }else {
      text(ctx,b.voltage==="hv"?"ВН":"НН",p.x+10,p.y+11,8,b.voltage==="hv"?C.gold:C.blue);
    }
    if(isConsumer(b)){
      const bw=Math.max(34,cfg.widthM*u*.8);
      ctx.fillStyle="#10171b";ctx.fillRect(p.x-bw/2,y+11,bw,4);
      ctx.fillStyle=full?C.gold:ratio>0?"#c78047":C.red;ctx.fillRect(p.x-bw/2,y+11,bw*ratio,4);
      text(ctx,`${full?100:Math.floor(ratio*100+.001)}%`,p.x,y+26,10,full?C.gold:"#b6b3a7","center");
    }
  }
  if(s.mouse&&!c.paused){
    const mouse=screenToWorld(s.mouse,s);
    if(BUILD_KINDS.includes(s.tool as never)){
      const kind=s.tool as "coal",cfg=c.balance.buildings[kind];
      const error=w.placementError(kind,mouse.x,mouse.y);
      ctx.strokeStyle=error?C.red:C.gold;ctx.fillStyle=error?"#dc3b351a":"#edbd691a";
      ctx.fillRect(s.mouse.x-cfg.widthM*u/2,s.mouse.y-cfg.heightM*u/2,cfg.widthM*u,cfg.heightM*u);
      ctx.strokeRect(s.mouse.x-cfg.widthM*u/2,s.mouse.y-cfg.heightM*u/2,cfg.widthM*u,cfg.heightM*u);
      ctx.globalAlpha=.6;sprite(ctx,s,kind,s.mouse.x,s.mouse.y,false,u*c.balance.world.widthM/1280);ctx.globalAlpha=1;
    }
    if(s.tool==="cable"&&s.pending){
      const a=pos(w.endpointPosition(s.pending)),target=w.hit(mouse);
      const end=target?w.endpointAt(target,mouse):null;
      const error=end?w.connectionError(s.pending,end):undefined;
      const b=end?pos(w.endpointPosition(end)):s.mouse;
      ctx.strokeStyle=error?C.red:C.gold;ctx.lineWidth=2;ctx.setLineDash([6,5]);ctx.beginPath();
      ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();ctx.setLineDash([]);
      const source=w.byId(s.pending.id)!,dist=Math.hypot(mouse.x-source.x,mouse.y-source.y)/1000;
      text(ctx,end&&!error?`${c.cablePrice(s.pending,end)} ₽`:`${dist.toFixed(2)} км`,b.x+14,b.y-12,12,error?C.red:C.gold);
    }
  }
  ctx.restore();
  const sx=95,sy=s.height-142,len=2000*u;
  ctx.strokeStyle="#dfc18d";ctx.lineWidth=1.5;ctx.beginPath();
  ctx.moveTo(sx,sy-4);ctx.lineTo(sx,sy);ctx.lineTo(sx+len,sy);ctx.lineTo(sx+len,sy-4);ctx.stroke();
  text(ctx,"2 км",sx+len/2,sy-13,10,"#dfc18d","center");
}
export function paint(ctx:CanvasRenderingContext2D,s:PaintState):void {
  ctx.save();ctx.fillStyle="#171f23";ctx.fillRect(0,0,s.width,s.height);
  if(s.phase==="menu")menu(ctx,s);
  else if(s.phase==="intro")intro(ctx,s);
  else if(s.phase==="region")region(ctx,s);
  else country(ctx,s);
  if(s.phase==="result"){ctx.fillStyle="#10171bbd";ctx.fillRect(0,0,s.width,s.height);}
  ctx.restore();
}
