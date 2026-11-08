// Decode 8-bit grayscale PNG masks used by this project. Test utility, no runtime dependency.
import { readFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import { Mask, Terrain } from '../.test-build/terrain.js';
export async function readMask(path){
  const data=await readFile(path);let w=0,h=0,depth=0,colour=0,compressed=[];
  for(let p=8;p<data.length;){
    const n=data.readUInt32BE(p),kind=data.toString('ascii',p+4,p+8),bytes=data.subarray(p+8,p+8+n);
    if(kind==='IHDR'){w=bytes.readUInt32BE(0);h=bytes.readUInt32BE(4);depth=bytes[8];colour=bytes[9];}
    if(kind==='IDAT')compressed.push(bytes);p+=n+12;
  }
  if(depth!==8||colour!==0)throw new Error(`Expected grayscale 8-bit: ${path}`);
  const raw=inflateSync(Buffer.concat(compressed)),pixels=new Uint8Array(w*h);
  const paeth=(a,b,c)=>{const p=a+b-c,aa=Math.abs(p-a),bb=Math.abs(p-b),cc=Math.abs(p-c);return aa<=bb&&aa<=cc?a:bb<=cc?b:c;};
  let p=0;
  for(let y=0;y<h;y++){
    const filter=raw[p++];if(filter>4)throw new Error('Unsupported PNG filter');
    for(let x=0;x<w;x++){
      const i=y*w+x,a=x?pixels[i-1]:0,b=y?pixels[i-w]:0,c=x&&y?pixels[i-w-1]:0;
      const predict=filter===0?0:filter===1?a:filter===2?b:filter===3?Math.floor((a+b)/2):paeth(a,b,c);
      pixels[i]=(raw[p++]+predict)&255;
    }
  }
  return new Mask(w,h,pixels);
}
export async function terrainFor(region,balance){
  const masks={};for(const [name,path] of Object.entries(region.masks))masks[name]=await readMask(new URL('../public/'+path,import.meta.url));
  return new Terrain(region,balance,masks);
}
