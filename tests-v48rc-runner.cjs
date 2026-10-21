'use strict';
// RC: navegador efímero, SW real, backend simulado; no usa configuración de staging.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const staticRoot=path.resolve(process.env.V48_PUBLIC_ROOT||__dirname);
function createServer(){return http.createServer((req,res)=>{
 const file=path.resolve(staticRoot,'.'+new URL(req.url,'http://local').pathname.replace(/^\/$/,'/index.html'));
 if(!file.startsWith(staticRoot+path.sep)){res.writeHead(403);return res.end()}
 fs.readFile(file,(e,data)=>{if(e){res.writeHead(404);return res.end()}
 const type={'.html':'text/html','.js':'text/javascript','.css':'text/css','.ttf':'font/ttf','.png':'image/png','.webp':'image/webp','.jpeg':'image/jpeg','.svg':'image/svg+xml'}[path.extname(file)]||'application/octet-stream';
 res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store'});res.end(data);
 });
})}
const copy=x=>JSON.parse(JSON.stringify(x));
let origin;
const owner='11111111-1111-4111-8111-111111111111';
async function install(page){
 await page.waitForFunction(()=>window.__appTest);
 await page.evaluate(async owner=>{
  const A=window.__appTest;
  A.Store.ensureProfile=async()=>({id:owner,name:'Fixture offline',metaSemanal:3});
  A.Store.readRutina=async()=>{if(!navigator.onLine)throw Error('Failed to fetch');return window.__readBackend()};
  A.Store.nativeRpc=(...args)=>window.__rpcBackend(...args);
  A.Store.listRegistros=async()=>{if(!navigator.onLine)throw Error('Failed to fetch');return []};
  A.Store.listEntrenos=async()=>{if(!navigator.onLine)throw Error('Failed to fetch');return []};
  A.Store.listPesoCorporal=async()=>[];
  A.Store.saveRutina=async()=>{throw Error('DML prohibido en cierre nativo')};
  await A.handleAuthStateChange('SIGNED_IN',{user:{id:owner}});
  if(A.nativeSession()){A.state.tab='sesion';A.render()}
 },owner);
}
async function run(browser,accepted,loseResponse){
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 const outbound=[],calls=[],packets=[],errors=[];let commits=0,remote,lost=false;
 await context.route('**/*',r=>{if(new URL(r.request().url()).origin===origin)return r.continue();outbound.push(r.request().url());return r.abort()});
 await context.exposeBinding('__readBackend',()=>copy(remote));
 await context.exposeBinding('__rpcBackend',async(_,who,name,args)=>{
  assert.equal(who,owner);calls.push(name);
  if(name==='v48_estado')return {data:copy(remote)};
  assert.equal(name,'v48_finalizar');packets.push(copy(args));
  const content=copy(args);delete content.p_revision;
  if(remote.terminal){const previous=copy(packets[0]);delete previous.p_revision;assert.deepEqual(content,previous)}
  else{
   commits++;
   assert.equal(args.p_sesion,remote.data.sesionActiva.sessionId);
   assert.equal(args.p_series.filter(s=>s.completed).length,1);
   assert.equal(args.p_series.find(s=>s.completed).peso,10);
   assert.equal(args.p_series.find(s=>s.completed).reps,12);
   const data=copy(remote.data);data.sesionActiva=null;
   if(accepted)data.referenciasEjercicios={Dominadas:{series:[{setNumber:1,peso:10,reps:12}],updatedAt:args.p_fin_ms}};
   remote={...remote,revision:remote.revision+1,data,terminal:{sessionId:args.p_sesion,entrenoId:'22222222-2222-4222-8222-222222222222',estado:'finalizada'}};
   if(loseResponse&&!lost){lost=true;throw Error('Respuesta perdida DESPUÉS de COMMIT simulado')}
  }
  return {data:copy(remote)};
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(origin,{waitUntil:'networkidle'});await page.waitForFunction(()=>window.__appTest&&navigator.serviceWorker.controller);
  remote=await page.evaluate(()=>{
   const day={id:'offline-day',nombre:'Fixture cierre offline',exercises:[{id:'e',nombre:'Dominadas',series:'3',reps:'12'},{id:'f',nombre:'Gemelos parado con mancuerna',series:'3',reps:'12'}]};
   const s=VodaFitPersistence.createSessionDraft(day,{slot:'personalizada',startedAt:Date.now()-120000,timezone:'America/Montevideo'});
   s.sets[0]={...s.sets[0],peso:10,reps:12,completed:true};
   return {schemaReady:true,clienteV48:true,revision:4,data:{personalizada:{days:[day]},automatica:{days:[]},enfocada:{days:[]},activeSlot:'personalizada',referenciasEjercicios:{},sesionActiva:s},terminal:null};
  });
  await install(page);
  assert.ok(await page.evaluate(async()=> (await __appTest.persistRutina()).ok),'Fixture inicial persistida, como reserva/edición real');
  await context.setOffline(true);await page.reload({waitUntil:'networkidle'});await install(page);
  assert.equal(await page.locator('#btn-save-session').innerText(),'Finalizar entrenamiento');
  await page.locator('#btn-save-session').click();
  await page.locator(`[data-native-answer="${accepted?'yes':'no'}"]`).click();
  await page.locator('#btn-save-session').click();
  await page.locator('[data-act="cancel"]').click();
  assert.equal(await page.evaluate(()=>VodaFitLifecycle.pending(__appTest.nativeSession())),false,'Cancelar confirmación no cierra');
  await page.locator('#btn-save-session').click();await page.locator('[data-act="ok"]').click();
  await page.waitForFunction(()=>VodaFitLifecycle.pending(__appTest.nativeSession())&&document.querySelector('#btn-save-session')?.textContent.includes('Reintentar'));
  const closed=await page.evaluate(()=>{const s=__appTest.nativeSession();return {id:s.sessionId,end:s.lifecycle.endedAt,sets:s.lifecycle.finalization.sets,clock:VodaFitLifecycle.clock(s)}});
  assert.equal(calls.length,0,'Sin RPC offline');assert.deepEqual(remote.data.referenciasEjercicios,{});
  await page.locator('#btn-save-session').click(); // retry offline: mismo cierre
  await page.evaluate(async()=>{await Promise.all([__appTest.saveSessionProgress(),__appTest.saveSessionProgress()])}); // doble tap pendiente
  await page.waitForTimeout(1100);
  assert.equal(await page.evaluate(()=>__appTest.nativeSession().lifecycle.endedAt),closed.end);
  assert.equal(await page.locator('[data-native-duration]').innerText(),closed.clock);
  assert.equal(await page.locator('[data-native-field]:enabled').count(),0);
  await page.reload({waitUntil:'networkidle'});await install(page);
  const recovered=await page.evaluate(()=>({id:__appTest.nativeSession().sessionId,end:__appTest.nativeSession().lifecycle.endedAt,sets:__appTest.nativeSession().lifecycle.finalization.sets}));
  assert.deepEqual(recovered,{id:closed.id,end:closed.end,sets:closed.sets});
  await context.setOffline(false);await page.locator('#btn-save-session').click();
  if(loseResponse){
   await page.waitForFunction(()=>__appTest.state.nativeReconcileIssue==='NETWORK_ERROR');
   assert.ok(await page.evaluate(()=>!!__appTest.nativeSession()),'Borrador se conserva tras respuesta incierta');
   await page.reload({waitUntil:'networkidle'});await install(page); // recover consulta estado antes de reintentar
  }
  await page.waitForFunction(()=>!__appTest.nativeSession());
  assert.equal(commits,1);assert.equal(remote.terminal.estado,'finalizada');
  assert.equal(packets[0].p_sesion,closed.id);assert.equal(packets[0].p_fin_ms,closed.end);
  assert.ok(calls.every((c,i)=>c!=='v48_finalizar'||calls[i-1]==='v48_estado'));
  assert.equal(!!remote.data.referenciasEjercicios.Dominadas,accepted);
  assert.equal(outbound.length,0);assert.deepEqual(errors,[]);
  console.log(JSON.stringify({test:accepted?'Acepta referencias + respuesta perdida':'Rechaza referencias + cierre offline',pass:true,commits,calls,stableSession:true,stableEnd:true,completedSets:1,externalRequests:outbound.length}));
 }finally{await context.close()}
}
async function extras(browser){
 const context=await browser.newContext({viewport:{width:390,height:844}}),outbound=[],errors=[];
 await context.route('**/*',r=>{if(new URL(r.request().url()).origin===origin)return r.continue();outbound.push(r.request().url());return r.abort()});
 let remote,cancels=0;
 await context.exposeBinding('__readBackend',()=>copy(remote));
 await context.exposeBinding('__rpcBackend',(_,who,name,args)=>{
  assert.equal(who,owner);
  if(name==='v48_estado')return {data:copy(remote)};
  assert.equal(name,'v48_cancelar');cancels++;
  remote={...remote,revision:remote.revision+1,data:{...remote.data,sesionActiva:null},terminal:{sessionId:args.p_sesion,estado:'cancelada',entrenoId:null}};
  return {data:copy(remote)};
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(origin,{waitUntil:'networkidle'});await page.waitForFunction(()=>window.__appTest&&navigator.serviceWorker.controller);
  remote=await page.evaluate(()=>{
   const day={id:'cancel-day',nombre:'Cancelar',exercises:[{id:'e',nombre:'Dominadas',series:'3',reps:'8'}]};
   const session=VodaFitPersistence.createSessionDraft(day,{slot:'personalizada'});
   return {schemaReady:true,clienteV48:true,revision:2,data:{personalizada:{days:[day]},automatica:{days:[]},enfocada:{days:[]},activeSlot:'personalizada',sesionActiva:session,referenciasEjercicios:{}},terminal:null};
  });
  await install(page);await page.evaluate(()=>__appTest.persistRutina());
  await page.locator('[data-native-cancel]').click();await page.locator('[data-act="cancel"]').click();
  assert.ok(await page.evaluate(()=>!!__appTest.nativeSession()));assert.equal(cancels,0);
  await context.setOffline(true);await page.locator('[data-native-cancel]').click();await page.locator('[data-act="ok"]').click();
  await page.waitForFunction(()=>__appTest.state.rutinaRaw?.__v48TerminalRequest?.action==='cancel');
  assert.equal(cancels,0);assert.ok(await page.evaluate(()=>!!__appTest.nativeSession()));
  await context.setOffline(false);await page.evaluate(()=>__appTest.loadProfileData());
  await page.waitForFunction(()=>!__appTest.nativeSession());assert.equal(cancels,1);
  assert.deepEqual(remote.data.referenciasEjercicios,{});
  const date='2026-10-20';
  await page.evaluate(({owner,date})=>{
   const A=__appTest;
   A.state.entrenos=[{id:'native-a',date,sessionId:'session-a',dayNombre:'Sesión A',setsCompletados:2,setsTotales:6,durationMs:65000,startedAt:1760000000000,endedAt:1760000065000,timezone:'America/Montevideo'},
    {id:'native-b',date,sessionId:'session-b',dayNombre:'Sesión B',setsCompletados:1,setsTotales:3,durationMs:30000,startedAt:1760000000000,endedAt:1760000030000,timezone:'America/Montevideo'},
    {id:'legacy',date,dayNombre:'Heredada',setsCompletados:1,setsTotales:3,durationMs:null}];
   A.Store.listSessionRegistros=async(pid,id)=>{if(pid!==owner)throw Error('Usuario incorrecto');return id==='native-a'?
    [{exercise:'Dominadas',exerciseInstance:'e',setNumber:1,peso:10,reps:'12'},
     {exercise:'Dominadas',exerciseInstance:'e',setNumber:3,peso:0,reps:'8'}]:[{exercise:'Dominadas',exerciseInstance:'x',setNumber:1,peso:99,reps:'5'}]};
   A.openCalDayModal(date);
  },{owner,date});
  assert.equal(await page.locator('[data-view-native-session]').count(),2);
  assert.ok((await page.locator('.modal').innerText()).includes('Sin duración medida'));
  assert.ok((await page.locator('.modal').innerText()).includes('00:01:05'));
  await page.locator('[data-view-native-session="native-a"]').click();
  await page.waitForSelector('[data-session-back]');
  const detail=await page.locator('.modal').innerText();
  assert.ok(detail.includes('10 kg × 12')&&detail.includes('0 kg × 8')&&detail.includes('Serie 3'));
  assert.ok(!detail.includes('99 kg'));
  await page.locator('[data-session-back]').click();assert.equal(await page.locator('[data-view-native-session]').count(),2);
  assert.equal(outbound.length,0);assert.deepEqual(errors,[]);
  console.log(JSON.stringify({test:'Cancelación offline confirmada; duración y detalle por sesión en calendario',pass:true,cancels,externalRequests:0}));
 }finally{await context.close()}
}
(async()=>{
 const server=createServer();let browser;
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});
 origin='http://127.0.0.1:'+server.address().port;
 try{browser=await chromium.launch({channel:'msedge',headless:true});await run(browser,false,false);await run(browser,true,true);await extras(browser)}
 finally{if(browser)await browser.close();await new Promise(r=>server.close(r))}
})().catch(e=>{console.error(e.stack);process.exitCode=1});
