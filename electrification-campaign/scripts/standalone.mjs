
import {readFile,writeFile,cp,mkdir} from "node:fs/promises";
await mkdir("standalone",{recursive:true});
const html=(await readFile("index.html","utf8")).replace("./src/style.css","./style.css")
  .replace("./src/main.ts","./js/standalone.js");
await writeFile("standalone/index.html",html);
await cp("src/style.css","standalone/style.css");
await cp("public","standalone",{recursive:true});
console.log("Standalone build: standalone/ (no external network dependencies).");
