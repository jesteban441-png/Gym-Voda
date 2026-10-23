'use strict';
// Real worker/cache/IndexedDB, isolated loopback origin, synthetic auth only.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {chromium}=require('playwright');
const {seal}=require('./v49-release.cjs');
const root=__dirname,read=p=>fs.readFileSync(path.join(root,p));
const stub=Buffer.from(`window.supabase={createClient:()=>({auth:{onAuthStateChange(cb){setTimeout(()=>cb('INITIAL_SESSION',null),0);return {data:{subscription:{unsubscribe(){}}}};}}})};`);
function build(release,legacy=false){
  let html=legacy?execFileSync('git',['show','8ac108f:index.html'],{cwd:root,encoding:'utf8'}):read('index.html').toString();
  let sw=legacy?execFileSync('git',['show','8ac108f:sw.js'],{cwd:root,encoding:'utf8'}):read('sw.js').toString();
  html=html.replace(/const SUPABASE_URL = "[^"]+";/,'const SUPABASE_URL = "https://blocked.invalid";');
  html=html.replace(/const SUPABASE_KEY = "[^"]+";/,'const SUPABASE_KEY = "synthetic";');
  const files=new Map();
  const get=p=>p.includes('vendor/supabase-js-')?stub:
    !legacy&&p.endsWith('v48-session.js')?Buffer.concat([read(p),Buffer.from('\nwindow.__fixtureModule='+JSON.stringify(release)+';\n')]):read(p);
  if(!legacy){
    html=html.replace(/49\.1/g,release);sw=sw.replace('const RELEASE = "49.1";','const RELEASE = "'+release+'";');
    const result=seal(html,sw,get);html=result.html;sw=result.sw;
    for(const p of Object.keys(result.shell))if(p!=='./index.html')files.set('/'+p.slice(2),get(p.split('?')[0]));
  }
  files.set('/index.html',Buffer.from(html));files.set('/',Buffer.from(html));files.set('/sw.js',Buffer.from(sw));
  return {release,files,get};
}
const v48=build('48',true),v49=build('49.1'),next=build('49.2');
let deployed=v49,failure=null,normalizeLF=false,origin,browser;
const requests=[],errors=[];
const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://local');requests.push(url.pathname+url.search);
  if(failure && url.pathname===failure.path){res.writeHead(failure.status||200,{'Content-Type':'text/javascript'});return res.end('broken payload');}
  let bytes=deployed.files.get(url.pathname+url.search)||deployed.files.get(url.pathname);
  if(!bytes){try{bytes=deployed.get('.'+url.pathname);}catch(error){res.writeHead(404);return res.end();}}
  const type={'.html':'text/html','.js':'text/javascript','.css':'text/css','.ttf':'font/ttf','.json':'application/json','.png':'image/png'}[path.extname(url.pathname)]||'text/html';
  if(normalizeLF && /\.(?:html|js|css|json)$/.test(url.pathname))bytes=Buffer.from(bytes.toString().replace(/\r\n/g,'\n'));
  res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store'});res.end(bytes);
});
async function context(){
  const ctx=await browser.newContext();
  await ctx.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
  await ctx.addInitScript(()=>{
    try{sessionStorage.setItem('test-loads',String(Number(sessionStorage.getItem('test-loads')||0)+1));}catch(error){}
  });
  ctx.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
  return ctx;
}
async function open(ctx){const p=await ctx.newPage();await p.goto(origin);await p.waitForFunction(()=>window.__appTest?.state.booted && navigator.serviceWorker.controller);return p;}
async function waitRelease(p,release){try{await p.waitForFunction(r=>window.__appTest?.updates?.status().release===r,release,{timeout:20000});}catch(error){console.error(await p.evaluate(async()=>({status:window.__appTest?.updates?.status(),waiting:(await navigator.serviceWorker.getRegistration())?.waiting?.state,caches:await caches.keys(),profile:__appTest.state.profile,raw:__appTest.state.rutinaRaw,row:await VodaFitPersistence.createCache().get('fixture')})));throw error;}}
async function check(p){await p.evaluate(()=>window.__appTest.updates.check());}
async function waiting(p){
  for(let i=0;i<200;i++){if(await p.evaluate(async()=>!!(await navigator.serviceWorker.getRegistration()).waiting))return;await sleep(100);}
  throw Error('No installed waiting worker');
}
async function unchanged(p){assert.equal(await p.evaluate(()=>window.__appTest.updates.status().release),'49.1');}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function test(name,fn){if(process.env.V49_TEST&&!name.includes(process.env.V49_TEST))return;const before=errors.length;await fn();assert.deepEqual(errors.slice(before),[],name+': JavaScript errors');console.log('PASS '+name);}
async function isolated(fn){deployed=v49;failure=null;const ctx=await context();try{await fn(ctx,await open(ctx));}finally{await ctx.close();failure=null;normalizeLF=false;}}

async function main(){
  await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({channel:'msedge',headless:true,args:['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost']});
  await test('V49 → next: automatic single reload; foreign cache preserved',()=>isolated(async(ctx,p)=>{
    await p.evaluate(async()=>{await (await caches.open('other-app')).put('/foreign',new Response('keep'));});
    deployed=next;await check(p);await waitRelease(p,'49.2');
    assert.equal(await p.evaluate(()=>window.__fixtureModule),'49.2');
    assert.equal(await p.evaluate(()=>sessionStorage.getItem('test-loads')),'2');
    for(let i=0;i<3;i++)await check(p);
    assert.equal(await p.evaluate(()=>sessionStorage.getItem('test-loads')),'2');
    assert.equal(await p.evaluate(async()=>(await caches.match('/foreign')).text()),'keep');
  }));
  for(const status of [404,200])await test('Incomplete/corrupt version '+status+' keeps old offline shell',()=>isolated(async(ctx,p)=>{
    failure={path:'/v48-session.js',status};deployed=next;await check(p);await sleep(1200);
    assert.equal(await p.evaluate(async()=>!!(await navigator.serviceWorker.getRegistration()).waiting),false);
    await ctx.setOffline(true);await p.reload();await waitRelease(p,'49.1');
    assert.equal(await p.evaluate(()=>typeof VodaFitSession.isNative),'function');
    assert.equal(await p.evaluate(()=>window.__fixtureModule),'49.1');
  }));
  for(const kind of ['legacy','native','unresolved','timer'])await test('Busy '+kind+' postpones then applies',()=>isolated(async(ctx,p)=>{
    await p.evaluate(kind=>{
      const a=__appTest;
      if(kind==='timer')a.workoutClock.running=true;
      else if(kind==='unresolved')a.state.unresolvedSession={schemaVersion:999};
      else if(kind==='native')a.state.unresolvedSession=VodaFitPersistence.createSessionDraft({id:'x',nombre:'Test',exercises:[]},{slot:'personalizada'});
      else a.state.session={dayId:'x',sets:{}};
    },kind);
    deployed=next;await check(p);await waiting(p);await sleep(3300);await unchanged(p);
    await p.evaluate(()=>{__appTest.state.session=null;__appTest.state.unresolvedSession=null;__appTest.workoutClock.running=false;});
    await waitRelease(p,'49.2'); // poll must apply without another visibility event
  }));
  await test('Dirty form blocks until explicit navigation removes it',()=>isolated(async(ctx,p)=>{
    await p.locator('input').first().fill('unsaved@example.test');
    deployed=next;await check(p);await waiting(p);await sleep(3300);await unchanged(p);
    await p.evaluate(()=>document.querySelectorAll('input').forEach(el=>el.remove()));await waitRelease(p,'49.2');
  }));
  await test('Two tabs: one busy vetoes; both reload after safe point',()=>isolated(async(ctx,p)=>{
    const second=await open(ctx);await second.evaluate(()=>{__appTest.state.session={dayId:'busy',sets:{}};});
    deployed=next;await check(p);await waiting(p);await sleep(3500);await unchanged(p);await unchanged(second);
    assert.equal(await p.evaluate(()=>!!document.getElementById('vf-update-lock')),false);
    await second.evaluate(()=>{__appTest.state.session=null;});await check(second);
    await Promise.all([waitRelease(p,'49.2'),waitRelease(second,'49.2')]);
  }));
  await test('Nonresponding client vetoes; timeout releases input lock',()=>isolated(async(ctx,p)=>{
    const unknown=await ctx.newPage();await unknown.goto(origin+'/silent.html');
    // A plain in-scope document is deliberately not a protocol participant.
    deployed=next;await check(p);await waiting(p);await sleep(4000);await unchanged(p);
    assert.equal(await p.evaluate(()=>__appTest.updates.status().locked),false);
    await unknown.close();await check(p);await waitRelease(p,'49.2');
  }));
  await test('Durable offline pending draft and journal survive update',()=>isolated(async(ctx,p)=>{
    await p.evaluate(async()=>{
      const owner='fixture',data={days:[],note:'durable'};
      await VodaFitPersistence.createCache().put({ownerId:owner,base:{data,revision:0,clienteV48:false},draft:data,pending:true},0);
      const journal=VodaFitHistory.createJournal(),op=await journal.prepare(owner,'registro-create',{kind:'create',id:null,data:{exercise:'test'}},null);
      await journal.update(op,{status:'uncertain'});
      __appTest.state.profile={id:owner};__appTest.state.persistence={pending:true};__appTest.state.rutinaRaw=data;
      __appTest.state.session={dayId:'hold',sets:{}};
    });
    deployed=next;await check(p);await waiting(p);
    await ctx.setOffline(true);
    await p.evaluate(()=>{__appTest.state.session=null;});await check(p);await waitRelease(p,'49.2');
    assert.equal(await p.evaluate(async()=>(await VodaFitPersistence.createCache().get('fixture')).draft.note),'durable');
    assert.equal(await p.evaluate(async()=>(await VodaFitHistory.createJournal().peek('fixture','registro-create')).status),'uncertain');
  }));
  await test('Durable native finalization updates offline with stable UUID/end time',()=>isolated(async(ctx,p)=>{
    const expected=await p.evaluate(async()=>{
      const s=VodaFitPersistence.createSessionDraft({id:'day',nombre:'Test',exercises:[]},{slot:'personalizada',startedAt:Date.now()-60000});
      VodaFitLifecycle.finish(s);const data={sesionActiva:s};
      await VodaFitPersistence.createCache().put({ownerId:'fixture',base:{data},draft:data,pending:true},0);
      __appTest.state.profile={id:'fixture'};__appTest.state.persistence={pending:true};__appTest.state.rutinaRaw=data;
      __appTest.state.unresolvedSession=s;__appTest.workoutClock.running=true;
      return {id:s.sessionId,end:s.lifecycle.endedAt};
    });
    deployed=next;await check(p);await waiting(p);await ctx.setOffline(true);
    await p.evaluate(()=>{__appTest.workoutClock.running=false;});await check(p);await waitRelease(p,'49.2');
    const actual=await p.evaluate(async()=>{const s=(await VodaFitPersistence.createCache().get('fixture')).draft.sesionActiva;return {id:s.sessionId,end:s.lifecycle.endedAt};});
    assert.deepEqual(actual,expected);
  }));
  await test('In-flight save and unpersisted failure block; successful retry releases',()=>isolated(async(ctx,p)=>{
    await p.evaluate(()=>{
      window.finishSave=null;
      __appTest.updates.track(()=>new Promise(r=>{window.finishSave=r;}),'fixture',{local:true})();
    });
    deployed=next;await check(p);await waiting(p);await sleep(3200);await unchanged(p);
    await p.evaluate(()=>finishSave({ok:false,localSaved:false}));await sleep(3200);await unchanged(p);
    assert.equal(await p.evaluate(()=>__appTest.updates.status().blocked),'unpersisted');
    await p.evaluate(()=>__appTest.updates.track(async()=>({ok:true,localSaved:true}),'fixture',{local:true})());
    await waitRelease(p,'49.2');
  }));
  await test('Git LF normalization preserves integrity and execution',()=>isolated(async(ctx,p)=>{
    normalizeLF=true;deployed=next;await check(p);await waitRelease(p,'49.2');
    assert.equal(await p.evaluate(()=>typeof VodaFitReconcile.createController),'function');
  }));
  await test('Reconnect event discovers the update without manual reload',()=>isolated(async(ctx,p)=>{
    await ctx.setOffline(true);deployed=next;await check(p);await unchanged(p);
    await ctx.setOffline(false);await waitRelease(p,'49.2');
  }));
  await test('Same visible release with different content still updates exactly once',()=>isolated(async(ctx,p)=>{
    const same=build('49.1');
    let html=same.files.get('/index.html').toString().replace('V49 · revisión local','V49 · prueba de identidad');
    const result=seal(html,same.files.get('/sw.js').toString(),same.get);
    same.files.set('/index.html',Buffer.from(result.html));same.files.set('/',Buffer.from(result.html));same.files.set('/sw.js',Buffer.from(result.sw));
    const originalBuild=await p.evaluate(()=>__appTest.updates.status().build);
    deployed=same;await check(p);
    await p.waitForFunction(previous=>__appTest.updates.status().build!==previous,originalBuild);
    assert.equal(await p.evaluate(()=>sessionStorage.getItem('test-loads')),'2');
    await check(p);assert.equal(await p.evaluate(()=>sessionStorage.getItem('test-loads')),'2');
  }));
  await test('Memory pending without durable copy and local conflict veto update',()=>isolated(async(ctx,p)=>{
    await p.evaluate(()=>{__appTest.state.profile={id:'fixture'};__appTest.state.persistence={pending:true};__appTest.state.rutinaRaw={note:'only-memory'};});
    deployed=next;await check(p);await waiting(p);await sleep(3200);await unchanged(p);
    await p.evaluate(async()=>{
      const data=__appTest.state.rutinaRaw;
      await VodaFitPersistence.createCache().put({ownerId:'fixture',base:{data},draft:data,pending:true},0);
      __appTest.state.persistence.conflict=true;
    });await check(p);await sleep(3200);await unchanged(p);
    await p.evaluate(()=>{__appTest.state.persistence.conflict=false;});await waitRelease(p,'49.2');
  }));
  await test('Legacy uncertain remote result blocks until matching confirmed retry',()=>isolated(async(ctx,p)=>{
    await p.evaluate(()=>__appTest.updates.track(async()=>({ok:false}),'addRegistro',{mutation:true})('fixture',{id:'stable'}));
    deployed=next;await check(p);await waiting(p);await sleep(3200);await unchanged(p);
    assert.equal(await p.evaluate(()=>__appTest.updates.status().blocked),'uncertain-remote');
    await p.evaluate(()=>__appTest.updates.track(async()=>({ok:true}),'addRegistro',{mutation:true})('fixture',{id:'stable'}));
    await waitRelease(p,'49.2');
  }));
  await test('State changes during preparation veto the commit',()=>isolated(async(ctx,p)=>{
    await p.evaluate(()=>navigator.serviceWorker.addEventListener('message',event=>{
      if(event.data?.type==='VF_PREPARE'&&!window.raceInjected){window.raceInjected=true;__appTest.state.session={dayId:'late',sets:{}};}
    }));
    deployed=next;await check(p);await waiting(p);await sleep(3500);await unchanged(p);
    assert.equal(await p.evaluate(()=>__appTest.state.session.dayId),'late');
    await p.evaluate(()=>{__appTest.state.session=null;});await waitRelease(p,'49.2');
  }));
  await test('V48 → V49: unknown old client never force-reloaded; close/reopen works',async()=>{
    deployed=v48;const ctx=await context();
    try{
      const old=await open(ctx);await old.evaluate(()=>{__appTest.state.session={dayId:'active',sets:{}};});
      deployed=v49;await old.evaluate(async()=>{await (await navigator.serviceWorker.getRegistration()).update();});await waiting(old);
      const modern=await open(ctx);await waitRelease(modern,'49.1');await check(modern);await sleep(4000);
      assert.equal(await old.evaluate(()=>__appTest.state.session.dayId),'active');
      assert.equal(await modern.evaluate(async()=>!!(await navigator.serviceWorker.getRegistration()).waiting),true);
      await old.close();await modern.close();
      const reopened=await open(ctx);await waitRelease(reopened,'49.1');
      await reopened.waitForFunction(async()=>!(await navigator.serviceWorker.getRegistration()).waiting);
      await ctx.setOffline(true);await reopened.reload();await waitRelease(reopened,'49.1');
    }finally{await ctx.close();}
  });
}
// Nonparticipant is a real document under the same scope, not a mocked message.
for(const version of [v48,v49,next])version.files.set('/silent.html',Buffer.from('<!doctype html><title>Suspended/old client fixture</title>'));
main().catch(error=>{console.error(error.stack);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();await new Promise(r=>server.close(r));});
