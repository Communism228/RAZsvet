"""Focused Chromium test for country preload and region data.
Uses actual compiled Assets, Campaign and paint modules, and actual map bytes.
Only country/terrain assets are loaded; this is not a full intro/sprite UI test.
HTTP navigation is blocked in the build environment, so the resource loader is
in-memory on about:blank. No browser policies are disabled.
"""
from pathlib import Path
import base64,json,mimetypes,posixpath,re,os
from playwright.sync_api import sync_playwright
P=Path(__file__).resolve().parents[1];web=P/'standalone'
out=Path(os.environ.get('SMOKE_OUTPUT',str(P/'.country-smoke')));out.mkdir(exist_ok=True,parents=True)
resources={f.relative_to(web).as_posix():json.loads(f.read_text()) for f in (web/'data').rglob('*.json')}
paths=set()
for f in [web/'assets/country',web/'assets/regions']:
    for image in f.rglob('*'):
        if image.suffix in ['.png','.svg']:
            paths.add(image.relative_to(web).as_posix())
images={path:'data:'+mimetypes.guess_type(path)[0]+';base64,'+base64.b64encode((web/path).read_bytes()).decode() for path in paths}
def patch(value):
    if isinstance(value,str):return images.get(value,value)
    if isinstance(value,list):return [patch(v) for v in value]
    if isinstance(value,dict):return {k:patch(v) for k,v in value.items()}
    return value
resources=patch(resources)
imports={}
for f in (web/'js').rglob('*.js'):
    rel=f.relative_to(web/'js').as_posix()
    def rewrite(m):return m[1]+'"local/'+posixpath.normpath(posixpath.join(posixpath.dirname(rel),m[2]))+'"'
    code=re.sub(r'(from\s+|import\s*)["\'](\.[^"\']+)["\']',rewrite,f.read_text())
    imports['local/'+rel]='data:text/javascript;base64,'+base64.b64encode(code.encode()).decode()
with sync_playwright() as pw:
    browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1280,'height':800});errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_content('<base href="https://fixture.invalid/"><canvas id="map" width="1280" height="800"></canvas>')
    page.evaluate('''resources=>{window.fetch=async input=>{const p=new URL(String(input),document.baseURI).pathname.slice(1);return new Response(JSON.stringify(resources[p]),{status:p in resources?200:404,headers:{'Content-Type':'application/json'}});};}''',resources)
    page.add_script_tag(type='importmap',content=json.dumps({'imports':imports}))
    page.add_script_tag(type='module',content='''
      import { Assets,loadData } from 'local/assets.js';
      import { Campaign } from 'local/model/campaign.js';
      import { paint } from 'local/render/paint.js';
      const data=await loadData();
      const countryOnly={...data,manifest:{...data.manifest,sprites:{},menu:undefined,overseer:data.manifest.country.dark},intro:{...data.intro,panels:[]}};
      const assets=new Assets(countryOnly);await assets.preload();
      const results=[];
      for(const region of data.regions){
        const im=assets.image(region.countryMask),light=assets.litRegions.get(region.id);
        const ctx=light.getContext('2d');
        const terrain=await assets.terrain(region,data.balance);
        const campaign=new Campaign(data.balance,data.regions,123456);campaign.begin(region,terrain);
        results.push({id:region.id,mask:[im.naturalWidth,im.naturalHeight],composite:[light.width,light.height],cityAlpha:ctx.getImageData(Math.round(region.city.u*1280),Math.round(region.city.v*800),1,1).data[3],buildings:campaign.world.buildings.length,plans:campaign.objectiveCount});
      }
      const campaign=new Campaign(data.balance,data.regions,123456);campaign.completed=['grodno'];
      paint(document.querySelector('#map').getContext('2d'),{width:1280,height:800,time:0,phase:'country',campaign,assets,data,camera:{x:10000,y:6250,zoom:1},mouse:null,tool:'inspect',poleVoltage:'hv',selected:null,pending:null,hoverRegion:null,introIndex:0,introStart:0,transition:null});
      window.__report={regions:results,maps:[data.manifest.country.dark,data.manifest.country.light].map(path=>{const im=assets.image(path);return [im.naturalWidth,im.naturalHeight]})};
    ''')
    try:page.wait_for_function('!!window.__report',timeout=15000)
    except Exception:
        print('ERRORS',errors);raise
    result=page.evaluate('window.__report');result['browser']=browser.version;result['errors']=errors
    assert result['maps']==[[1280,800],[1280,800]],result
    assert len(result['regions'])==6
    for r in result['regions']:
        assert r['mask']==[1280,800] and r['composite']==[1280,800],r
        assert r['cityAlpha']>200 and r['buildings']>=10 and r['plans']>0,r
    assert not errors,errors
    page.screenshot(path=str(out/'country-lit.png'))
    (out/'report.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
    print(json.dumps(result,ensure_ascii=False,indent=2))
    browser.close()
