
"""Browser fixture for environments where Chromium policy blocks navigation.
Loads the REAL compiled native modules through an import map on about:blank.
Asset bytes and JSON are embedded; localStorage is an in-memory test double.
No browser policies are modified. This does NOT test real origin persistence.
"""
from pathlib import Path
import base64, json, re, posixpath, mimetypes

PROJECT=Path(__file__).resolve().parents[1]
def install(page, saved=None, dev=False):
    web=PROJECT/"standalone"
    imports={}
    for file in (web/"js").rglob("*.js"):
        relative=file.relative_to(web/"js").as_posix()
        def rewrite(m):
            path=posixpath.normpath(posixpath.join(posixpath.dirname(relative),m[2]))
            return f'{m[1]}"local/{path}"'
        source=re.sub(r'(from\s+|import\s*)["\'](\.[^"\']+)["\']',rewrite,file.read_text())
        imports["local/"+relative]="data:text/javascript;base64,"+base64.b64encode(source.encode()).decode()
    images={}
    for file in (web/"assets").rglob("*"):
        if file.suffix.lower() not in [".svg",".png",".jpg",".webp"]:continue
        kind=mimetypes.guess_type(file.name)[0]
        images[file.relative_to(web).as_posix()]=f"data:{kind};base64,"+base64.b64encode(file.read_bytes()).decode()
    def patch(data):
        if isinstance(data,str) and data in images:return images[data]
        if isinstance(data,list):return [patch(x) for x in data]
        if isinstance(data,dict):return {k:patch(v) for k,v in data.items()}
        return data
    resources={file.relative_to(web).as_posix():patch(json.loads(file.read_text()))
               for file in (web/"data").rglob("*.json")}
    page.set_content('<html lang="ru"><head><base href="https://fixture.invalid/"><meta charset="utf-8"><style>'+
                     (PROJECT/"src/style.css").read_text()+
                     '</style></head><body><main id="app"><div id="display"></div></main></body></html>')
    page.evaluate("""({resources,saved})=>{
      const store=new Map();
      if(saved) store.set("electrification-campaign-v3",JSON.stringify(saved));
      Object.defineProperty(window,"localStorage",{configurable:true,value:{
        getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,String(v)),
        removeItem:k=>store.delete(k),clear:()=>store.clear()
      }});
      window.fetch=async url=>{
        const path=new URL(String(url),document.baseURI).pathname.slice(1);
        if(!(path in resources))return new Response("",{status:404});
        return new Response(JSON.stringify(resources[path]),{status:200,headers:{"Content-Type":"application/json"}});
      };
    }""",{"resources":resources,"saved":saved})
    page.add_script_tag(type="importmap",content=json.dumps({"imports":imports}))
    page.add_script_tag(type="module",content=f"""
      import {{ App }} from 'local/app.js';
      import {{ Assets,loadData }} from 'local/assets.js';
      import {{ nativeSurface }} from 'local/render/native.js';
      const data=await loadData();
      const assets=new Assets(data); await assets.preload();
      const surface=await nativeSurface(document.querySelector("#display"));
      window.__game=new App(document.querySelector("#app"),surface,data,assets);
      window.__game.dev={str(dev).lower()};
      window.__game.renderUI();
    """)
    page.wait_for_function("!!window.__game",timeout=20000)
