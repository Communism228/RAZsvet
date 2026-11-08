
import type { Surface } from "./surface.js";
export async function nativeSurface(parent: HTMLElement): Promise<Surface> {
  const canvas=document.createElement("canvas");
  canvas.className="game-canvas";canvas.setAttribute("aria-label","Игровая карта");
  parent.append(canvas);
  const ctx=canvas.getContext("2d",{alpha:false});
  if(!ctx)throw new Error("Canvas 2D недоступен.");
  return {ctx,input:canvas,name:"Canvas",
    resize(w,h){
      const dpr=Math.min(devicePixelRatio||1,2);
      canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);
      canvas.style.width=`${w}px`;canvas.style.height=`${h}px`;
      ctx.setTransform(dpr,0,0,dpr,0,0);
    },present(){},destroy(){canvas.remove();}};
}
