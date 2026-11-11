'use strict';
// Local-only activation checks. Requires the same external Playwright as V49.
// Runtime variants (SDK stub and flag=false) are sealed IN MEMORY; no runtime file is rewritten.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright'),{seal}=require('./v49-release.cjs');
const root=__dirname,read=p=>fs.readFileSync(path.join(root,p));
const sdk=Buffer.from(`window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange(cb){cb('INITIAL_SESSION',null);return {data:{subscription:{unsubscribe(){}}}};}},from(...args){if(window.__legacyQuery)return window.__legacyQuery(...args);throw Error('Real backend forbidden');}})};`);
const variants=new Map();
for(const enabled of [true,false]){
  let html=read('index.html').toString();
  assert(html.includes('const SESION_OMITIR_HABILITADO = true;'));
  if(process.argv.includes('--baseline-history'))html=require('node:child_process').execFileSync('git',['show','HEAD:index.html'],{cwd:root,encoding:'utf8'});
  if(process.argv.includes('--original-sync'))html=require('node:child_process').execFileSync('git',['show','HEAD:index.html'],{cwd:root,encoding:'utf8'}).replace('const SESION_OMITIR_HABILITADO = false;','const SESION_OMITIR_HABILITADO = true;');
  if(!enabled)html=html.replace('const SESION_OMITIR_HABILITADO = true;','const SESION_OMITIR_HABILITADO = false;');
  const get=p=>p.includes('vendor/supabase-js-')?sdk:read(p);
  const result=seal(html,read('sw.js').toString(),get);
  variants.set(enabled,{html:result.html,get});
}
let enabled=true;
const server=http.createServer((req,res)=>{
  try{
    const pathname=decodeURIComponent(new URL(req.url,'http://local').pathname),file=path.resolve(root,'.'+pathname);
    if(!file.startsWith(root+path.sep))throw Error('outside root');
    const variant=variants.get(enabled),data=pathname==='/index.html'?variant.html:variant.get('.'+pathname);
    const type={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.ttf':'font/ttf','.png':'image/png','.jpeg':'image/jpeg','.webp':'image/webp'}[path.extname(file)]||'application/octet-stream';
    res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store'});res.end(data);
  }catch(e){res.writeHead(404);res.end();}
});
let browser,origin;
async function context(){
  const ctx=await browser.newContext({serviceWorkers:'block'});
  ctx.setDefaultTimeout(15000);
  await ctx.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  return ctx;
}
async function installFixture(page,native){
  await page.waitForFunction(()=>window.__appTest);
  await page.evaluate(async native=>{
    const T=window.__appTest,P=T.persistence,clone=x=>JSON.parse(JSON.stringify(x));
    await T.handleAuthStateChange('INITIAL_SESSION',null);
    const owner='activation-synthetic',key='activation-fixture';
    let db=JSON.parse(localStorage.getItem(key)||'null');
    if(!db){
      const day={id:'day-test',nombre:'Prueba aislada',exercises:[{id:'a',nombre:'Press de banca con barra',series:'2',reps:'10'},{id:'b',nombre:'Remo con barra',series:'1',reps:'10'}]};
      const common={slot:'personalizada',startedAt:Date.now()-600000};
      const session=native?{...common,schemaVersion:48,sessionId:'77777777-6666-5555-4444-333333333333',timezone:'America/Montevideo',day:clone(day),sets:[{exerciseInstance:'a',setNumber:1,completed:true,peso:30,reps:8},{exerciseInstance:'a',setNumber:2,completed:false,peso:null,reps:null},{exerciseInstance:'b',setNumber:1,completed:false,peso:null,reps:null}],references:{a:{accepted:false,sets:[{setNumber:1,peso:30,reps:8}]}},lifecycle:null}:{...common,dayId:day.id,dayNombre:day.nombre,sets:{a:[true,false],b:[false]},setLogs:{a:[{registroId:'record-a',peso:30,reps:8},null],b:[null]}};
      db={data:{personalizada:{days:[day]},automatica:{days:[]},enfocada:{days:[]},activeSlot:'personalizada',sesionActiva:session},revision:1,registros:[{id:'record-a',ejercicio:'Press de banca con barra',peso:30,reps:8,date:'2026-11-10'}],entrenos:[],calls:[],terminal:null};
      localStorage.setItem(key,JSON.stringify(db));
    }
    const save=()=>localStorage.setItem(key,JSON.stringify(db));
    const envelope=()=>({data:clone(db.data),revision:db.revision,clienteV48:native,schemaReady:true,terminal:clone(db.terminal)});
    T.Store.readRutina=async()=>envelope();
    T.Store.listPesoCorporal=async()=>[];
    T.Store.listRegistros=async()=>clone(db.registros);
    T.Store.listEntrenos=async()=>clone(db.entrenos);
    T.Store.addEntreno=async(owner,data)=>{db.entrenos.push(clone(data));save();return {ok:true,id:'synthetic-workout'};};
    T.Store.addRegistro=async(owner,data)=>{db.registros.push(clone(data));save();return {ok:true,id:data.id};};
    T.Store.nativeRpc=async(owner,name,args)=>{
      db.calls.push({name,args:clone(args)});
      if(name==='v48_guardar_sesion'){
        const sets=clone(args.p_series).map(({exerciseInstance,setNumber,peso,reps,completed})=>({exerciseInstance,setNumber,peso,reps,completed}))
          .sort((a,b)=>a.exerciseInstance<b.exerciseInstance?-1:a.exerciseInstance>b.exerciseInstance?1:a.setNumber-b.setNumber);
        const patch={day:clone(args.p_dia),sets,references:clone(args.p_referencias)},s=db.data.sesionActiva;
        if(!P.equal({day:s.day,sets:s.sets,references:s.references},patch)){
          assertRevision();Object.assign(s,patch);db.revision++;
        }
      }else if(name==='v48_finalizar'){
        assertRevision();
        const s=db.data.sesionActiva,active=new Set(s.day.exercises.filter(x=>!x.omitido).map(x=>x.id));
        db.entrenos.push({setsTotales:args.p_series.filter(x=>active.has(x.exerciseInstance)).length,setsCompletados:args.p_series.filter(x=>x.completed).length});
        db.terminal={sessionId:args.p_sesion,estado:'finalizada',entrenoId:'synthetic-workout'};db.data.sesionActiva=null;db.revision++;
      }else if(name!=='v48_estado')throw Error('Unexpected RPC '+name);
      save();return {data:envelope()};
      function assertRevision(){if(args.p_revision!==db.revision)throw Error('Synthetic revision mismatch');}
    };
    // Keep the application's actual singleton, IndexedDB and terminal controller.
    // Only Store's remote transport is a synthetic double.
    T.Store.saveRutina=async(owner,data)=>{
      db.data=clone(data);db.revision++;save();return {ok:true,envelope:envelope()};
    };
    T.state.profile={id:owner,name:'Synthetic',edad:30,sexo:'m',metaSemanal:3};
    T.state.authSession={user:{id:owner}};
    await T.loadProfileData();T.state.tab='sesion';T.render();
  },native);
}
async function snapshot(page){return page.evaluate(()=>{const T=__appTest;return JSON.parse(JSON.stringify({session:T.nativeSession()||T.state.session,progress:T.sessionProgress(),registros:T.state.registros,routine:T.state.rutinaSlots}));});}
async function settled(page){await page.evaluate(()=>__appTest.borradorV48.esperar());await page.waitForFunction(()=>!__appTest.borradorV48.hayPendiente);}
async function reload(page,native){await settled(page);await page.reload();await installFixture(page,native);}
async function focused(native,rollback){
  enabled=true;const ctx=await context(),page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  try{
    await page.goto(origin+'/index.html');await installFixture(page,native);
    const initial=await snapshot(page);
    assert.equal(await page.locator('[data-sesion-omitir="a"]').isDisabled(),true,'completed exercise cannot be omitted');
    await page.locator('[data-sesion-omitir="b"]').click();await page.locator('[data-sesion-restaurar="b"]').waitFor();
    await reload(page,native);assert.equal(await page.locator('[data-sesion-restaurar="b"]').count(),1,'omit survives reload');
    await page.locator('[data-sesion-restaurar="b"]').click();await page.locator('[data-sesion-omitir="b"]').waitFor();
    await reload(page,native);assert.equal(await page.locator('[data-sesion-omitir="b"]').count(),1,'restore survives reload');
    await page.locator('[data-sesion-agregar-extra]').click();
    await page.locator('#sesion-extra-name').fill('Curl con barra');await page.locator('#sesion-extra-series').fill('2');
    await page.locator('.modal-back [data-act="save"]').click();await page.locator('.modal-back').waitFor({state:'detached'});
    await reload(page,native);let snap=await snapshot(page);
    const extra=native?snap.session.day.exercises.find(x=>x.extra):snap.session.extras[0];assert(extra,'extra survives real reload');
    // Actual series controls, not a call to the internal model mutator.
    if(native){
      await page.locator(`[data-native-card="${extra.id}"] [data-native-field="peso"]`).first().fill('12');
      await page.locator(`[data-native-card="${extra.id}"] [data-native-field="reps"]`).first().fill('8');
      await page.locator(`[data-native-card="${extra.id}"] [data-native-check]`).first().click();
    }else{
      await page.locator(`[data-log-weight="${extra.id}"]`).click();
      await page.locator('#slog-peso').fill('12');await page.locator('#slog-reps').fill('8');
      await page.locator('.modal-back [data-act="save"]').click();await page.locator('.modal-back').waitFor({state:'detached'});
    }
    await page.locator('[data-sesion-omitir="b"]').click();await page.locator('[data-sesion-restaurar="b"]').waitFor();await settled(page);
    const before=await snapshot(page);assert.deepEqual(before.routine,initial.routine,'weekly routine unchanged');
    if(rollback)enabled=false;
    await reload(page,native);const after=await snapshot(page);
    assert.deepEqual(after.session,before.session,'full session survives reload/rollback');assert.deepEqual(after.registros,before.registros,'records survive rollback');
    assert.equal(await page.locator('[data-sesion-omitir-panel]').count(),rollback?0:1);
    assert.equal(after.progress.total,4,'omitted exercise excluded, extra included');
    assert(after.progress.done<after.progress.total,'incomplete workout fixture');
    console.log(JSON.stringify({focused:native?'V48':'V47',rollback,phase:'real buttons + full reload + session/records preserved',pass:true}));
    if(native){
      // Finish through actual UI. The reference dialog may appear first for the extra.
      await page.locator('[data-native-finalize]').click();
      const dialog=page.locator('.modal-back');await dialog.waitFor();
      const decline=dialog.getByRole('button',{name:'No guardar',exact:true});
      if(await decline.count()){await decline.click();await dialog.waitFor({state:'detached'});await page.locator('[data-native-finalize]').click();}
      await page.locator('.modal-back').getByRole('button',{name:'Finalizar',exact:true}).click();
    }else{
      await page.locator('#btn-save-session').click();
      await page.locator('#btn-finalize-session').click();
      await page.locator('.modal-back').getByRole('button',{name:'Finalizar',exact:true}).click();
    }
    try{await page.waitForFunction(()=>!__appTest.nativeSession()&&!__appTest.state.session);}
    catch(error){console.log(JSON.stringify({native,rollback,diagnostic:await page.evaluate(async()=>{
      const T=__appTest,db=JSON.parse(localStorage.getItem('activation-fixture')),row=await T.persistence.createCache(indexedDB).get('activation-synthetic');
      const local=row?.draft.sesionActiva,remote=db.data.sesionActiva;
      return {close:T.ultimoCierreNativoFallido,blocked:T.rutinaSync.getContext()?.blocked,localSessionKeys:Object.keys(local||{}),remoteSessionKeys:Object.keys(remote||{}),calls:db.calls.map(x=>x.name),workouts:db.entrenos.length,localDayPreserved:T.persistence.equal(local?.day,remote?.day)};
    }),errors}));throw error;}
    const db=await page.evaluate(()=>JSON.parse(localStorage.getItem('activation-fixture')));
    assert.equal(db.entrenos.length,1);assert.equal(db.entrenos[0].setsTotales,4);assert.equal(db.entrenos[0].setsCompletados,2);
    if(native){assert(db.calls.some(x=>x.name==='v48_guardar_sesion'));assert.equal(db.calls.filter(x=>x.name==='v48_finalizar').length,1);}
    assert.deepEqual(errors,[]);console.log(JSON.stringify({focused:native?'V48':'V47',rollback,pass:true}));
  }finally{await ctx.close();}
}
async function raceChecks(){
  for(const scenario of ['series-during-rpc','extra-during-rpc','lost-response','local-ack-failure','real-conflict','owner-changed']){
    enabled=true;const ctx=await context(),page=await ctx.newPage();
    try{
      await page.goto(origin+'/index.html');await installFixture(page,true);
      await page.locator('[data-sesion-omitir="b"]').click();await page.locator('[data-sesion-restaurar="b"]').waitFor();await settled(page);
      const outcome=await page.evaluate(async scenario=>{
        const T=__appTest,original=T.Store.nativeRpc,confirm=T.rutinaSync.confirmSession;let first=true,ackFailure=true;
        if(scenario==='local-ack-failure')T.rutinaSync.confirmSession=async(...args)=>{
          if(ackFailure){ackFailure=false;return {ok:false,code:'LOCAL_STORAGE_ERROR'};}return confirm(...args);
        };
        T.Store.nativeRpc=async(...args)=>{
          if(args[1]!=='v48_guardar_sesion'||!first)return original(...args);first=false;
          if(scenario==='real-conflict')return {error:{code:'40001',message:'REVISION_CONFLICT'}};
          const response=await original(...args);
          if(scenario==='lost-response')throw Error('response lost after commit');
          if(scenario==='series-during-rpc'){
            T.nativeSession().sets[1].peso=17;T.nativeSession().ui.keep='local text';await T.borradorV48.cambio();
          }
          if(scenario==='extra-during-rpc'){
            T.sesionAgregarExtraEnSesion({id:'late-extra',nombre:'Curl con barra',series:'1',reps:'10'});await T.borradorV48.cambio();
          }
          if(scenario==='owner-changed')await T.handleAuthStateChange('SIGNED_OUT',null);
          return response;
        };
        const firstResult=await T.sincronizarEstructuraNativa();
        const session=JSON.parse(JSON.stringify(T.nativeSession()));
        let retry=null;
        if(['lost-response','local-ack-failure','extra-during-rpc'].includes(scenario))retry=await T.sincronizarEstructuraNativa();
        const row=await T.persistence.createCache(indexedDB).get('activation-synthetic');
        T.rutinaSync.confirmSession=confirm;
        return {firstResult,retry,session,row,blocked:T.rutinaSync.getContext()?.blocked,db:JSON.parse(localStorage.getItem('activation-fixture'))};
      },scenario);
      assert.equal(outcome.firstResult.ok,false,scenario+' must not proceed to finalization');
      assert.equal(outcome.db.calls.filter(x=>x.name==='v48_finalizar').length,0);
      if(scenario==='series-during-rpc'){
        assert.equal(outcome.firstResult.code,'LOCAL_CHANGES_PENDING');assert.equal(outcome.row.draft.sesionActiva.sets[1].peso,17);
        assert.equal(outcome.row.draft.sesionActiva.ui.keep,'local text');assert.equal(outcome.row.base.revision,2);assert.equal(outcome.blocked,null);
      }
      if(scenario==='extra-during-rpc'){
        assert.equal(outcome.firstResult.code,'LOCAL_CHANGES_PENDING');assert(outcome.retry.ok);assert(outcome.db.data.sesionActiva.day.exercises.some(x=>x.id==='late-extra'));
      }
      if(['lost-response','local-ack-failure'].includes(scenario)){
        assert(outcome.retry.ok);assert.equal(outcome.db.revision,2,'idempotent retry must not increment revision again');assert.equal(outcome.row.base.revision,2);
      }
      if(scenario==='real-conflict'){assert.equal(outcome.firstResult.code,'REVISION_CONFLICT');assert(outcome.row.draft.sesionActiva.day.exercises[1].omitido);assert.equal(outcome.row.base.revision,1);}
      if(scenario==='owner-changed'){assert.equal(outcome.session,null);assert.equal(outcome.row.base.revision,1);}
      console.log(JSON.stringify({scenario,pass:true}));
    }finally{await ctx.close();}
  }
}
async function main(){
  await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({channel:'msedge',headless:true,args:['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost']});
  if(!process.argv.includes('--focused-only')){
    const ctx=await context();
    const suites=process.argv.includes('--baseline-history')?[['tests-v48history.html','__v48historyResults']]:[['tests-v31.html','__v31Results'],['tests-v48.html','__v48Results'],['tests-v48b.html','__v48bResults'],['tests-v48ca.html','__v48caResults'],['tests-v48cb.html','__v48cbResults'],['tests-v48history.html','__v48historyResults']];
    try{for(const [file,key] of suites){
      const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/'+file);
      await page.waitForFunction(key=>window[key],key,{timeout:240000});const result=await page.evaluate(key=>window[key],key);
      console.log(JSON.stringify({file,pass:result.pass,fail:result.fail,total:result.total,failures:result.failures||result.results?.filter(x=>!x.ok),pageErrors:errors}));if(result.fail||errors.length)process.exitCode=1;await page.close();
    }}finally{await ctx.close();}
  }
  if(!process.argv.includes('--baseline-history')){
    for(const native of (process.argv.includes('--original-sync')?[true]:[false,true]))for(const rollback of (process.argv.includes('--original-sync')?[false]:[false,true]))try{await focused(native,rollback);}catch(e){console.error(JSON.stringify({focused:native?'V48':'V47',rollback,pass:false,error:e.message}));process.exitCode=1;}
    if(!process.argv.includes('--original-sync'))await raceChecks();
  }
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();server.close();});
