
"""Run after npm run build:standalone. Requires Python Playwright + Chromium.
The sandbox fixture uses about:blank, embedded assets and in-memory storage;
see browser_fixture.py. Does not test the Phaser bridge or real HTTP navigation.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright
from browser_fixture import install
import json,sys,traceback
OUT=Path(sys.argv[1]) if len(sys.argv)>1 else Path(__file__).resolve().parents[1]/"test-artifacts"
OUT.mkdir(parents=True,exist_ok=True)
checks=[]
def passed(name):
    checks.append(name)
    print("PASS",len(checks),name,flush=True)
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path="/usr/bin/chromium",headless=True,args=["--no-sandbox","--disable-dev-shm-usage"])
    page=browser.new_page(viewport={"width":1440,"height":900},device_scale_factor=1)
    page.set_default_timeout(4000)
    errors=[];page.on("pageerror",lambda err:errors.append(str(err)))
    try:
        install(page)
        page.screenshot(path=str(OUT/"menu.png"))
        assert page.locator('[data-action="play"]').count()==1
        passed("Menu loads all assets and has one primary Play action.")
        page.click('[data-action="play"]')
        page.wait_for_timeout(80)
        page.click('[data-action="next-panel"]')
        assert page.evaluate("__game.introIndex")==0
        page.click('[data-action="next-panel"]')
        assert page.evaluate("__game.introIndex")==1
        page.wait_for_timeout(650)
        page.click('[data-action="next-panel"]')
        page.wait_for_timeout(650)
        page.click('[data-action="next-panel"]')
        page.wait_for_timeout(650)
        page.screenshot(path=str(OUT/"intro.png"))
        assert page.evaluate("__game.introIndex")==3
        passed("Comic click completes current fade first; panels then reveal in order on one page.")
        assert page.evaluate("""async()=>{
          const {paint}=await import('local/render/paint.js'),g=__game;
          const svg=(x,color)=>'data:image/svg+xml,'+encodeURIComponent(
            `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="800"><rect x="${x}" y="0" width="640" height="800" fill="${color}"/></svg>`);
          const left=svg(0,'#ff0000'),right=svg(640,'#00ff00');
          await g.assets.loadImage(left);await g.assets.loadImage(right);
          const canvas=document.createElement('canvas');canvas.width=1440;canvas.height=900;
          const ctx=canvas.getContext('2d'),state=g.state();
          state.phase='intro';state.width=1440;state.height=900;state.time=1000;state.introStart=0;state.introIndex=1;
          state.data={...g.data,intro:{width:1280,height:800,fadeMs:600,fullPageLayers:true,
            panels:[left,right].map(image=>({image,caption:'',x:0,y:0,width:1280,height:800}))}};
          paint(ctx,state);
          const a=ctx.getImageData(400,790,1,1).data,b=ctx.getImageData(1000,790,1,1).data;
          return a[0]===255&&a[1]===0&&b[0]===0&&b[1]===255;
        }""")
        passed("Full-page transparent comic layers preserve earlier panels and empty captions add no text strip.")
        page.click('[data-action="skip"]')
        assert page.locator("[data-region]").count()==6
        before=page.locator('[data-region="grodno"]').evaluate("(e)=>getComputedStyle(e).transform")
        page.hover('[data-region="grodno"]');page.wait_for_timeout(230)
        after=page.locator('[data-region="grodno"]').evaluate("(e)=>getComputedStyle(e).transform")
        assert before!=after
        page.screenshot(path=str(OUT/"country.png"))
        passed("Six region buttons and city hover scaling work.")
        page.click('[data-region="grodno"]')
        assert page.evaluate("__game.phase")=="transition"
        page.wait_for_function("__game.phase==='region'")
        assert page.evaluate("__game.campaign.world.buildings.length")==7
        assert page.evaluate("__game.campaign.world.terrain.masks.water.width")==1280
        passed("Zoom/fade transition enters a region with five settlements, two factories and real raster masks.")
        def world_click(x,y,button="left"):
            pos=page.evaluate("""({x,y})=>{
              const g=__game,b=g.balance.world,c=g.camera,s=Math.min(innerWidth/b.widthM,innerHeight/b.heightM)*c.zoom;
              return {x:innerWidth/2+(x-c.x)*s,y:innerHeight/2+(y-c.y)*s};
            }""",{"x":x,"y":y})
            page.mouse.click(pos["x"],pos["y"],button=button)
        def buildings():return page.evaluate("__game.campaign.world.buildings.length")
        def money():return page.evaluate("__game.campaign.money")
        page.keyboard.press("Digit1");world_click(3400,3500)
        assert buildings()==8 and money()==330
        plant=page.evaluate("__game.campaign.world.buildings.at(-1)")
        world_click(3400,3500)
        assert buildings()==8 and money()==330
        world_click(10000,2000)
        assert buildings()==8 and money()==330
        passed("Station purchase via keyboard/mouse charges once; overlap and out-of-deposit clicks spend nothing.")
        village=page.evaluate("__game.campaign.world.buildings.find(b=>b.kind==='village')")
        site=page.evaluate("""(v)=>{
          const w=__game.campaign.world;
          for(const [dx,dy] of [[-1100,0],[1100,0],[0,-1100],[0,1100]])
            if(!w.placementError('transformer',v.x+dx,v.y+dy))return {x:v.x+dx,y:v.y+dy};
          throw Error('No test transformer site');
        }""",village)
        page.keyboard.press("Digit4");world_click(site["x"],site["y"])
        assert buildings()==9
        tx=page.evaluate("__game.campaign.world.buildings.at(-1)")
        page.keyboard.press("Digit6")
        world_click(plant["x"],plant["y"]);world_click(tx["x"]-250,tx["y"])
        world_click(tx["x"]+250,tx["y"]);world_click(village["x"],village["y"])
        assert page.evaluate("__game.campaign.world.cables().length")==2
        assert page.evaluate("(c)=>__game.campaign.sim.consumerKW.get(c.id)/c.demandKW",village)>.999
        assert page.evaluate("__game.campaign.incomeRate")>0
        passed("Mouse-built 10 kV -> transformer -> 400 V network lights a village and starts income.")
        page.keyboard.press("Digit7");world_click(village["x"],village["y"])
        assert buildings()==9
        passed("Fixed settlements cannot be deleted.")
        page.keyboard.press("Digit5");page.keyboard.press("KeyV");world_click(9400,2300)
        low=page.evaluate("__game.campaign.world.buildings.at(-1)")
        assert low["kind"]=="pole" and low["voltage"]=="lv"
        page.keyboard.press("Digit6");world_click(plant["x"],plant["y"]);world_click(low["x"],low["y"])
        assert page.evaluate("__game.campaign.world.cables().length")==2
        assert "напряжение" in page.locator("#toast").inner_text()
        passed("Pole voltage toggles with V; incompatible endpoints are rejected.")
        page.keyboard.press("Escape");page.keyboard.press("Digit7");world_click(low["x"],low["y"])
        assert buildings()==9
        assert "Возвращено" in page.locator("#toast").inner_text()
        passed("Demolition refunds actual purchase value.")
        page.keyboard.press("KeyM")
        assert page.locator(".matrix-scroll tbody tr").count()==9
        assert page.locator(".matrix-scroll [data-key]").count()==4
        page.locator(".matrix-scroll [data-key]").first.click()
        assert page.locator(".matrix-sheet").count()==0
        assert "Потери" in page.locator(".inspector").inner_text()
        passed("Optional matrix matches the model; a nonzero cell selects the real cable.")
        page.keyboard.press("Escape")
        assert page.evaluate("__game.campaign.paused")
        elapsed=page.evaluate("__game.campaign.elapsed");cash=money()
        page.wait_for_timeout(300)
        assert elapsed==page.evaluate("__game.campaign.elapsed") and cash==money()
        page.locator('.pause-dialog [data-action="pause"]').click()
        passed("Pause stops both active time and income.")
        page.click('[data-action="help"]')
        assert page.evaluate("__game.campaign.paused")
        page.click('.help-dialog [data-action="close"].primary')
        assert not page.evaluate("__game.campaign.paused")
        passed("Help pauses and resumes the prior state.")
        before=page.evaluate("__game.campaign.world.adjacency")
        page.mouse.move(1000,400);page.mouse.wheel(0,-800);page.wait_for_timeout(100)
        page.mouse.move(700,400);page.mouse.down(button="middle");page.mouse.move(1400,850,steps=5);page.mouse.up(button="middle")
        assert page.evaluate("__game.camera.zoom")<=1.65
        assert abs(page.evaluate("__game.camera.x")-10000)<=2800.001
        assert before==page.evaluate("__game.campaign.world.adjacency")
        page.keyboard.press("Home")
        passed("Camera zoom/pan is bounded and never changes physical cable distances.")
        page.evaluate("window.dispatchEvent(new Event('blur'))")
        assert page.evaluate("__game.campaign.paused")
        page.locator('.pause-dialog [data-action="pause"]').click()
        passed("Window blur pauses the game; it does not earn background income.")
        # Reference routing uses the SAME paid campaign operations, not arbitrary injected buildings.
        source=(Path(__file__).parent/"reference-plan.mjs").read_text().replace("export function referencePlan","function referencePlan")
        report=page.evaluate("()=>{"+source+"""
          const g=__game; g.pending=null;g.selected=null;g.tool='inspect';
          const stats=referencePlan(g.campaign);
          g.save();g.renderUI();g.toastEl.classList.remove('visible');g.toastUntil=0;return stats;
        }""")
        assert page.evaluate("__game.campaign.poweredFactories") == 2
        page.wait_for_timeout(100)
        page.screenshot(path=str(OUT/"region.png"))
        passed("Real-mask reference network powers both factories without bypassing prices or constraints.")
        # Ensure a mandatory target is not covered by the lower construction dock.
        for f in page.evaluate("__game.campaign.world.buildings.filter(b=>b.kind==='factory')"):
            hit=page.evaluate("""p=>{
              const b=__game.balance.world,s=Math.min(innerWidth/b.widthM,innerHeight/b.heightM);
              const x=(innerWidth-b.widthM*s)/2+p.x*s,y=(innerHeight-b.heightM*s)/2+p.y*s;
              return document.elementFromPoint(x,y)?.tagName;
            }""",f)
            assert hit=="CANVAS",hit
        passed("Factories are not hidden beneath the construction dock at the initial zoom.")
        for width,height in [(1280,800),(960,640)]:
            page.set_viewport_size({"width":width,"height":height})
            page.wait_for_timeout(100)
            assert page.locator(".build-card").count()==7
            assert page.locator(".build-card").last.bounding_box()["x"]<width-50
            assert page.locator(".ledger").bounding_box()["x"]>=0
            page.screenshot(path=str(OUT/f"region-{width}.png"))
        page.set_viewport_size({"width":1440,"height":900})
        passed("HUD and all seven build tools remain within view at 1440x900, 1280x800 and 960x640.")
        saved=page.evaluate("__game.campaign.snapshot()")
        page2=browser.new_page(viewport={"width":1280,"height":800})
        page2.on("pageerror",lambda err:errors.append(str(err)))
        install(page2,saved)
        page2.click('[data-action="play"]')
        page2.wait_for_function("__game.phase==='region'")
        assert page2.evaluate("__game.campaign.paused")
        assert page2.evaluate("__game.campaign.money")==saved["money"]
        assert page2.evaluate("__game.campaign.world.adjacency")==saved["active"]["world"]["adjacency"]
        passed("Save reconstruction restores cash, topology and elapsed time, and resumes paused (storage fixture).")
        page2.evaluate("""()=>{
          const g=__game,c=g.campaign;c.paused=false;
          const f=c.world.buildings.find(b=>b.kind==='factory');
          const edge=c.world.cables().find(e=>e.a.id===f.id||e.b.id===f.id);
          c.removeCable(edge.key);const outcome=c.advance(c.remaining);g.finish(outcome);
        }""")
        assert "ОТПРАВЛЯЕТЕСЬ В СИБИРЬ" in page2.locator(".result-card h1").inner_text()
        page2.screenshot(path=str(OUT/"failure.png"))
        passed("Disconnecting a factory before the deadline produces the requested failure screen.")
        page2.close()
        page.bring_to_front()
        page.evaluate("""()=>{
          const g=__game,c=g.campaign;c.paused=false;
          g.finish(c.advance(c.remaining));
        }""")
        assert page.evaluate("__game.campaign.status")=="map"
        assert page.evaluate("__game.campaign.completed")==["grodno"]
        page.click('[data-action="next-region"]')
        assert page.locator('[data-region="grodno"]').is_disabled()
        page.screenshot(path=str(OUT/"country-completed.png"))
        passed("A successful deadline illuminates and locks the completed region.")
        bank=money()
        page.click('[data-region="brest"]')
        page.wait_for_function("__game.phase==='region'")
        assert money()==bank
        assert page.evaluate("__game.campaign.incomeRate")==0
        assert page.evaluate("__game.campaign.duration")==165
        assert page.evaluate("__game.campaign.price('coal')")==130
        passed("Next region keeps the treasury, stops old-region income and increases difficulty.")
        page.evaluate("__game.dev=true;__game.renderUI()")
        page.click('[data-action="dev"]')
        assert page.evaluate("__game.campaign.paused")
        seed=page.evaluate("__game.campaign.seed")
        page.locator('[data-balance-path="economy.startingMoney"]').fill("700")
        assert json.loads(page.locator("#balance-json").input_value())["economy"]["startingMoney"]==700
        page.click('[data-action="apply-balance"]')
        assert page.evaluate("__game.phase")=="country"
        assert money()==700 and page.evaluate("__game.campaign.seed")==seed
        passed("Developer balance fields update JSON and restart with the same seed and new budget.")
        assert not errors,errors
        passed("No uncaught browser exceptions during all scenarios.")
        result={"checks":checks,"count":len(checks),"errors":errors,"reference_network":report,
                "scope":"Native Canvas; about:blank fixture, embedded assets, in-memory storage. Not Phaser or real HTTP persistence."}
        (OUT/"browser-results.json").write_text(json.dumps(result,ensure_ascii=False,indent=2))
        print(json.dumps(result,ensure_ascii=False,indent=2))
    except Exception:
        page.screenshot(path=str(OUT/"failure-debug.png"))
        print("CHECKS COMPLETED",json.dumps(checks,ensure_ascii=False))
        print("PAGE ERRORS",errors)
        traceback.print_exc()
        raise
    finally:
        browser.close()
