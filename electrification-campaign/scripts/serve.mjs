// Dependency-free LOCAL preview only. Never expose this server to the internet.
import http from "node:http";
import {readFile,stat} from "node:fs/promises";
import {resolve,extname,sep} from "node:path";
const root=resolve(process.argv[2]??"standalone");
const port=Number(process.env.PORT??4173);
const types={".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",
  ".css":"text/css; charset=utf-8",".json":"application/json; charset=utf-8",
  ".png":"image/png",".svg":"image/svg+xml"};
http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url??"/","http://127.0.0.1");
    let pathname=decodeURIComponent(url.pathname);
    if(pathname.endsWith("/"))pathname+="index.html";
    const file=resolve(root,"."+pathname);
    if(file!==root&&!file.startsWith(root+sep)){
      res.writeHead(403);res.end("Forbidden");return;
    }
    if(!(await stat(file)).isFile())throw new Error("Not a file");
    const data=await readFile(file);
    res.writeHead(200,{"Content-Type":types[extname(file)]??"application/octet-stream",
      "Cache-Control":"no-store","X-Content-Type-Options":"nosniff"});
    res.end(data);
  }catch{res.writeHead(404);res.end("Not found");}
}).listen(port,"127.0.0.1",()=>console.log(`Local preview: http://127.0.0.1:${port}`));
