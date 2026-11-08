
export class Audio {
  enabled=false;
  private context:AudioContext|null=null;
  tone(good=true): void {
    if(!this.enabled)return;
    try {
      this.context??=new AudioContext();
      void this.context.resume();
      const c=this.context,o=c.createOscillator(),g=c.createGain();
      o.type="triangle";o.frequency.setValueAtTime(good?440:160,c.currentTime);
      o.frequency.exponentialRampToValueAtTime(good?680:90,c.currentTime+.09);
      g.gain.setValueAtTime(.035,c.currentTime);g.gain.exponentialRampToValueAtTime(.001,c.currentTime+.15);
      o.connect(g);g.connect(c.destination);o.start();o.stop(c.currentTime+.16);
    }catch{this.enabled=false;}
  }
}
