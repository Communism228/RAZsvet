import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {Campaign} from '../.test-build/campaign.js';
import {terrainFor} from './masks.mjs';
import {referencePlanV05} from './reference-v05.mjs';
const balance=JSON.parse(await readFile(new URL('../public/data/balance.json',import.meta.url)));
const index=JSON.parse(await readFile(new URL('../public/data/campaign.json',import.meta.url)));
const regions=await Promise.all(index.regions.map(f=>readFile(new URL('../public/'+f,import.meta.url)).then(JSON.parse)));
const c=new Campaign(balance,regions,8723),stats=[];
for(const r of regions){
  try{c.begin(r,await terrainFor(r,balance));const result=referencePlanV05(c);const outcome=c.advance(c.remaining);
    stats.push({region:r.id,...result,success:outcome.success,resources:c.region.deposits.length});
    console.log(JSON.stringify(stats.at(-1)));
    if(!outcome.success)throw new Error('Deadline failed');
  }catch(e){console.error('FAILED',r.id,e.message);process.exitCode=1;break;}
}
await mkdir('.v05-check',{recursive:true});await writeFile('.v05-check/playthrough.json',JSON.stringify({seed:8723,status:c.status,regions:stats},null,2));
