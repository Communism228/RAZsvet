
import Phaser from "phaser";
import type { Surface } from "./surface.js";

/**
 * Phaser hosts the same painter as the dependency-free Canvas entry.
 * No second simulation and no divergent input/rules are maintained.
 * This bridge deliberately uses a CanvasTexture instead of a scene-specific sprite tree.
 */
export function phaserSurface(parent: HTMLElement): Promise<Surface> {
  return new Promise((resolve,reject)=>{
    const drawing=document.createElement("canvas");
    drawing.width=innerWidth;drawing.height=innerHeight;
    const ctx=drawing.getContext("2d",{alpha:false});
    if(!ctx){reject(new Error("Canvas 2D недоступен."));return;}
    const timer=setTimeout(()=>reject(new Error("Phaser не завершил запуск.")),10000);
    class Board extends Phaser.Scene {
      create(): void {
        clearTimeout(timer);
        const texture=this.textures.addCanvas("campaign-board",drawing);
        if(!texture){reject(new Error("Не удалось создать CanvasTexture."));return;}
        const image=this.add.image(0,0,"campaign-board").setOrigin(0);
        const input=this.game.canvas;input.className="game-canvas";
        input.setAttribute("aria-label","Игровая карта");
        const game=this.game;
        resolve({ctx:ctx!,input,name:"Phaser",
          resize(w,h){
            drawing.width=w;drawing.height=h;
            texture.setSize(w,h);game.scale.resize(w,h);
            image.setPosition(0,0).setDisplaySize(w,h);
          },
          present(){texture.refresh();},
          destroy(){game.destroy(true);}
        });
      }
    }
    new Phaser.Game({type:Phaser.AUTO,parent,width:innerWidth,height:innerHeight,
      backgroundColor:"#191f22",scene:[Board],audio:{noAudio:true},
      render:{antialias:true},banner:false});
  });
}
