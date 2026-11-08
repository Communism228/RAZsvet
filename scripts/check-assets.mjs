
// Zero-dependency filename and image-registration checks for artist hand-offs.
import { readFile,stat } from "node:fs/promises";
import { resolve,extname,sep } from "node:path";
import { imageDimensions,assertSameDimensions as same } from "./image-dimensions.mjs";
const root=resolve("public"),seen=new Set();
async function read(path){
  const file=resolve(root,path);
  if(!file.startsWith(root+sep))throw new Error(`Asset path escapes public/: ${path}`);
  await stat(file);seen.add(path);return readFile(file);
}
async function config(path){return JSON.parse((await read(path)).toString("utf8"));}
async function image(path){
  const data=await read(path);
  try { return imageDimensions(data,extname(path).toLowerCase()); }
  catch (error) { throw new Error(`${path}: ${error.message}`); }
}
const manifest=await config("data/assets.json"),index=await config("data/campaign.json");
await config("data/balance.json");await config("data/messages.json");
const country=await image(manifest.country.dark);
same(country,await image(manifest.country.light),"country dark/light");
if(manifest.menu){await image(manifest.menu.background);for(const l of manifest.menu.layers??[])await image(l.image);}
await image(manifest.overseer);
for(const [kind,s] of Object.entries(manifest.sprites)){
  await image(s.idle);if(s.powered)await image(s.powered);if(s.icon)await image(s.icon);
  if(!(s.width>0&&s.height>0))throw new Error(`Invalid sprite size: ${kind}`);
}
const intro=await config(manifest.intro);for(const p of intro.panels)await image(p.image);
for(const file of index.regions){
  const r=await config(file),bg=await image(r.map);
  same(country,await image(r.countryMask),`${r.id}: country mask`);
  for(const path of Object.values(r.masks))if(path)same(bg,await image(path),`${r.id}: terrain mask`);
}
console.log(`Assets OK: ${seen.size} referenced files, ${index.regions.length} regions.`);
