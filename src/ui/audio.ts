import { readLocal,writeLocal,type LocalAsset } from "./local-media.js";

/** One looping music element plus lightweight click effects. Never autoplay at boot. */
export class Audio {
  enabled=false;
  trackName="";
  volume=.35;
  onError:(message:string)=>void=()=>{};
  private context:AudioContext|null=null;
  private player:HTMLAudioElement;
  private blobUrl:string|null=null;
  private background:string|null=null;
  private request=0;
  constructor(){
    this.player=new window.Audio();this.player.loop=true;this.player.preload="metadata";
    this.player.addEventListener("error",()=>{
      if(this.enabled){this.enabled=false;this.onError("Audio file cannot be decoded");}
    });
    document.addEventListener("visibilitychange",()=>{
      if(document.hidden)this.player.pause();
      else if(this.enabled)void this.start().catch(e=>this.onError(String(e)));
    });
    window.addEventListener("pagehide",()=>this.player.pause());
  }
  get hasTrack():boolean{return !!this.player.getAttribute("src");}
  get playing():boolean{return this.enabled&&!this.player.paused;}
  configure(background:string|null,volume:number):void{
    this.background=background;this.setVolume(volume);
    if(background){this.player.src=new URL(background,document.baseURI).href;this.trackName=background.split("/").at(-1)!;}
  }
  setVolume(value:number):void{this.volume=Math.min(1,Math.max(0,value));this.player.volume=this.volume;}
  private setAsset(asset:LocalAsset):void{
    this.request++;this.player.pause();this.enabled=false;
    if(this.blobUrl)URL.revokeObjectURL(this.blobUrl);
    this.blobUrl=URL.createObjectURL(asset.blob);this.player.src=this.blobUrl;
    this.player.load();this.trackName=asset.name;
  }
  async restore():Promise<void>{
    const saved=await readLocal("music");if(saved)this.setAsset(saved);
  }
  async import(file:File):Promise<boolean>{
    if(file.size>80*1024*1024)throw new Error("Music file exceeds 80 MB");
    if(!/\.(mp3|wav|ogg|opus|m4a|aac|flac)$/i.test(file.name)&&!file.type.startsWith("audio/"))throw new Error("Choose an audio file");
    const asset={name:file.name,blob:file};this.setAsset(asset);
    return writeLocal("music",asset);
  }
  private async start():Promise<void>{
    const id=++this.request;
    try{
      await this.player.play();
      if(id===this.request)this.enabled=true;
    }catch(e){
      if(id===this.request)this.enabled=false;
      throw e;
    }
  }
  async toggle():Promise<void>{
    if(!this.hasTrack)throw new Error("No music selected");
    if(this.enabled){this.request++;this.enabled=false;this.player.pause();return;}
    await this.start();
  }
  async reset():Promise<void>{
    this.request++;this.enabled=false;this.player.pause();
    if(this.blobUrl)URL.revokeObjectURL(this.blobUrl);this.blobUrl=null;
    this.player.removeAttribute("src");this.player.load();this.trackName="";
    if(this.background){this.player.src=new URL(this.background,document.baseURI).href;this.trackName=this.background.split("/").at(-1)!;}
    await writeLocal("music",null);
  }
  tone(good=true):void{
    if(!this.enabled)return;
    try{
      this.context??=new AudioContext();void this.context.resume();
      const c=this.context,o=c.createOscillator(),g=c.createGain();
      o.type="triangle";o.frequency.setValueAtTime(good?440:160,c.currentTime);
      o.frequency.exponentialRampToValueAtTime(good?680:90,c.currentTime+.09);
      g.gain.setValueAtTime(.035*this.volume,c.currentTime);g.gain.exponentialRampToValueAtTime(.001,c.currentTime+.15);
      o.connect(g);g.connect(c.destination);o.start();o.stop(c.currentTime+.16);
      o.onended=()=>{o.disconnect();g.disconnect();};
    }catch{/* Optional effects must not change music state. */}
  }
}
