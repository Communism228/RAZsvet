import { readLocal,writeLocal,type LocalAsset } from "./local-media.js";

/** Runtime user-font import, including a local ZIP; no font binaries are bundled. */
async function fontFromZip(bytes:ArrayBuffer):Promise<{name:string;buffer:ArrayBuffer}>{
  const d=new DataView(bytes),u=new Uint8Array(bytes);
  let end=-1;
  for(let i=d.byteLength-22;i>=Math.max(0,d.byteLength-65557);i--){
    if(d.getUint32(i,true)===0x06054b50){end=i;break;}
  }
  if(end<0)throw new Error("ZIP: central directory not found");
  let p=d.getUint32(end+16,true);
  const count=d.getUint16(end+10,true),entries:{name:string;offset:number;size:number;compressed:number;method:number}[]=[];
  for(let i=0;i<count;i++){
    if(p+46>d.byteLength||d.getUint32(p,true)!==0x02014b50)throw new Error("ZIP: invalid directory");
    const flags=d.getUint16(p+8,true),method=d.getUint16(p+10,true);
    const compressed=d.getUint32(p+20,true),size=d.getUint32(p+24,true);
    const nl=d.getUint16(p+28,true),el=d.getUint16(p+30,true),cl=d.getUint16(p+32,true);
    const name=new TextDecoder().decode(u.subarray(p+46,p+46+nl));
    if(/\.(otf|ttf|woff2?)$/i.test(name)&&!(flags&1)&&size<=8*1024*1024&&compressed<=8*1024*1024){
      entries.push({name,offset:d.getUint32(p+42,true),size,compressed,method});
    }
    p+=46+nl+el+cl;
  }
  const score=(name:string)=>/Rodchenko Bold\.otf$/i.test(name)?0:/Rodchenko Regular\.otf$/i.test(name)?1:/RodchenkoC\.otf$/i.test(name)?2:3;
  entries.sort((a,b)=>score(a.name)-score(b.name));
  const e=entries[0];if(!e)throw new Error("ZIP contains no supported fonts");
  const at=e.offset;
  if(at+30>d.byteLength||d.getUint32(at,true)!==0x04034b50)throw new Error("ZIP: bad local header");
  const start=at+30+d.getUint16(at+26,true)+d.getUint16(at+28,true);
  if(start+e.compressed>d.byteLength)throw new Error("ZIP: truncated font");
  const compressed=bytes.slice(start,start+e.compressed);
  let result:ArrayBuffer;
  if(e.method===0)result=compressed;
  else if(e.method===8){
    const stream=new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    result=await new Response(stream).arrayBuffer();
  }else throw new Error("Unsupported ZIP compression; choose an extracted OTF or TTF");
  if(result.byteLength!==e.size)throw new Error("ZIP: incorrect font size");
  return {name:e.name.split("/").at(-1)!,buffer:result};
}
export class Typography {
  name="Rodchenko (local)";
  active=false;
  private face:FontFace|null=null;
  private async apply(asset:LocalAsset):Promise<void>{
    const face=new FontFace("RazSvetUser",await asset.blob.arrayBuffer(),{weight:"100 900",style:"normal"});
    await face.load();
    document.fonts.add(face);
    if(this.face)document.fonts.delete(this.face);
    this.face=face;this.name=asset.name;this.active=true;
    document.documentElement.dataset.userFont="loaded";
    await document.fonts.ready;
  }
  async restore():Promise<void>{
    const saved=await readLocal("font");
    if(saved)try{await this.apply(saved);}catch{/* A broken saved font cannot prevent boot. */}
  }
  async import(file:File):Promise<boolean>{
    if(file.size>12*1024*1024)throw new Error("Font archive exceeds 12 MB");
    const data=await file.arrayBuffer();
    const font=/\.zip$/i.test(file.name)?await fontFromZip(data):{name:file.name,buffer:data};
    const asset={name:font.name,blob:new Blob([font.buffer])};
    await this.apply(asset);return writeLocal("font",asset);
  }
  async reset():Promise<void>{
    if(this.face)document.fonts.delete(this.face);
    this.face=null;this.active=false;this.name="Rodchenko (local)";
    delete document.documentElement.dataset.userFont;
    await writeLocal("font",null);
  }
}
