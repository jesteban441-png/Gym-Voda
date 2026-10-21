// Runner local sin build ni acceso a Supabase. Requiere Playwright de desarrollo.
const {chromium}=require('playwright');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=__dirname;
async function installNativeFixture(page,fixture){
  await page.waitForFunction(()=>window.__appTest);
  await page.evaluate(async fixture=>{
    const A=window.__appTest;window.__nativeWrites=0;
    A.Store.ensureProfile=async u=>({id:u.id,name:'Prueba móvil',metaSemanal:3});
    A.Store.readRutina=async id=>({data:JSON.parse(JSON.stringify(id===fixture.owner ? fixture.data : {days:[]})),revision:null,clienteV48:false,schemaReady:false});
    A.Store.listRegistros=async()=>[];A.Store.listEntrenos=async()=>[];A.Store.listPesoCorporal=async()=>[];
    ['saveRutina','addRegistro','updateRegistro','addEntreno'].forEach(key=>A.Store[key]=async()=>{window.__nativeWrites++;throw new Error('No escribir en servidor');});
    await A.handleAuthStateChange('SIGNED_IN',{user:{id:fixture.owner}});
    A.state.tab='sesion';A.render();
  },fixture);
}
const sdk=`window.supabase={createClient:()=>({auth:{onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},from(){throw new Error('Supabase real no permitido en pruebas')}})};`;
const server=http.createServer((req,res)=>{
  const file=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://local').pathname));
  if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
  fs.readFile(file,(e,data)=>{
    if(e){res.writeHead(404);return res.end();}
    const type={'.html':'text/html','.js':'text/javascript','.png':'image/png','.jpeg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml'}[path.extname(file)]||'application/octet-stream';
    res.writeHead(200,{'Content-Type':type});res.end(data);
  });
});
(async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser=await chromium.launch({headless:true,...(process.env.V48_BROWSER_CHANNEL ? {channel:process.env.V48_BROWSER_CHANNEL} : {})});
  let failed=false;
  try {
    const context=await browser.newContext({serviceWorkers:'block',viewport:{width:390,height:844},isMobile:true,hasTouch:true});
    await context.route('**/vendor/supabase-js-*/**',route=>route.fulfill({contentType:'text/javascript',body:sdk}));
    await context.route('https://**/*',route=>{
      const url=route.request().url();
      if(url.includes('supabase-js')) return route.fulfill({contentType:'text/javascript',body:sdk});
      // Sin dependencias remotas ni llamadas a bases de datos durante pruebas.
      return route.fulfill({contentType:'text/javascript',body:''});
    });
    for(const [file,result] of [['tests-v48cb.html','__v48cbResults'],['tests-v48ca.html','__v48caResults'],['tests-v48b.html','__v48bResults'],['tests-v48.html','__v48Results'],['tests-v31.html','__v31Results']]){
      const page=await context.newPage(),errors=[];
      page.on('pageerror',e=>errors.push(e.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/${file}`);
      await page.waitForFunction(key=>window[key],result,{timeout:180000});
      const output=await page.evaluate(key=>window[key],result);
      console.log(JSON.stringify({file,...output,pageErrors:errors}));
      failed ||= output.fail>0 || errors.length>0;
      if(file==='tests-v48cb.html'){
        await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);await page.waitForFunction(()=>window.__appTest);
        const fixture=await page.evaluate(async()=>{
          const P=VodaFitPersistence,N=VodaFitSession,L=VodaFitLifecycle,R=VodaFitReconcile;
          const day={id:'d',nombre:'Cierre',exercises:[{id:'e',nombre:'Dominadas',series:'1',reps:'8'}]},owner=crypto.randomUUID();
          const active=P.createSessionDraft(day,{slot:'personalizada'}),base={schemaReady:true,clienteV48:true,revision:1,data:{sesionActiva:JSON.parse(JSON.stringify(active)),referenciasEjercicios:{}}};
          N.edit(active,'e',1,'peso','0');N.edit(active,'e',1,'reps','8');N.toggle(active,'e',1,true);N.decide(active,'e',false);L.finish(active,active.startedAt+5000);
          const cache=P.createCache(indexedDB,'v48cb-real-reload');await cache.put({version:1,ownerId:owner,base,draft:{...base.data,sesionActiva:active},pending:true},0);
          let remote=JSON.parse(JSON.stringify(base)),packet;
          const adapter=R.createAdapter({capabilities:{metadata:true,rpc:true},rpc:async(o,name,args)=>{
            if(name==='v48_estado')return {data:remote};packet=args;
            remote={schemaReady:true,clienteV48:true,revision:2,data:{sesionActiva:null,referenciasEjercicios:{}},terminal:{sessionId:active.sessionId,entrenoId:crypto.randomUUID(),estado:'finalizada'}};
            throw Error('Respuesta perdida tras COMMIT');
          }});
          const result=await R.createController({cache,adapter,current:()=>true}).finish(owner,base,active.sessionId,true);
          return {owner,base,remote,packet,uncertain:result.uncertain};
        });
        await page.reload();await page.waitForFunction(()=>window.__appTest);
        const output=await page.evaluate(async fixture=>{
          const P=VodaFitPersistence,R=VodaFitReconcile,cache=P.createCache(indexedDB,'v48cb-real-reload'),calls=[];
          const adapter=R.createAdapter({capabilities:{metadata:true,rpc:true},rpc:async(o,name,args)=>{
            calls.push(name);if(name==='v48_finalizar'){
              const previous={...fixture.packet},replay={...args};delete previous.p_revision;delete replay.p_revision;
              if(!P.equal(previous,replay))throw Error('Payload cambiado');
            }return {data:fixture.remote};
          }});
          const result=await R.createController({cache,adapter,current:()=>true}).recover(fixture.owner,fixture.base,true);
          return fixture.uncertain && result.ok && !(await cache.get(fixture.owner)).draft.sesionActiva && calls.join(',')==='v48_estado,v48_finalizar';
        },fixture);
        console.log(JSON.stringify({file:'V48CB recarga real después de COMMIT con respuesta perdida',pass:output?1:0,fail:output?0:1}));failed ||= !output;
      }
      if(file==='tests-v48ca.html'){
        await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
        await page.waitForFunction(()=>window.__appTest);
        const fixture=await page.evaluate(()=>{
          const day={id:'d',nombre:'Recuperación V48',exercises:[{id:'e',nombre:'Dominadas',series:'3',reps:'8'}]};
          return {owner:crypto.randomUUID(),data:{personalizada:{days:[day]},automatica:{days:[]},enfocada:{days:[]},activeSlot:'personalizada',sesionActiva:VodaFitPersistence.createSessionDraft(day,{slot:'personalizada',startedAt:Date.now()-7200000})}};
        });
        await installNativeFixture(page,fixture);
        // Cierre sin conexión: sólo IndexedDB. La red remota permanece interceptada.
        await context.setOffline(true);
        const before=await page.evaluate(async()=>{
          const A=window.__appTest;await A.finalizeSession(A.nativeSession().day);
          return {sid:A.nativeSession().sessionId,end:A.nativeSession().lifecycle.endedAt,duration:VodaFitLifecycle.elapsed(A.nativeSession())};
        });
        await context.setOffline(false);await page.reload();
        // Cuenta autenticada conocida; perfil, rutina e historial no disponibles en red.
        await page.waitForFunction(()=>window.__appTest);
        const restored=await page.evaluate(async ({fixture,before})=>{
          const A=window.__appTest;
          for(const key of ['ensureProfile','readRutina','listRegistros','listEntrenos','listPesoCorporal']) A.Store[key]=async()=>{throw new TypeError('Failed to fetch');};
          await A.handleAuthStateChange('SIGNED_IN',{user:{id:fixture.owner}});
          const s=A.nativeSession();
          return !A.state.dbError && A.state.nativeOffline && s.sessionId===before.sid && s.lifecycle.endedAt===before.end
            && VodaFitLifecycle.elapsed(s)===before.duration && document.querySelector('[data-native-field]').disabled
            && A.state.entrenos.length===0;
        },{fixture,before});
        console.log(JSON.stringify({file:'V48CA recarga real tras cierre offline y backend inaccesible',pass:restored?1:0,fail:restored?0:1}));failed ||= !restored;
        // Petición pendiente persistida antes de perder respuesta y cerrar la página.
        const request=await page.evaluate(async()=>{
          const P=VodaFitPersistence,L=VodaFitLifecycle,cache=P.createCache(indexedDB,'v48ca-real-request');
          const base={data:{sesionActiva:null},revision:1,clienteV48:true,schemaReady:true};
          const ctl=L.createController({cache,adapter:{ready:()=>true,reserve:async()=>({ok:false,code:'NETWORK_ERROR'})},current:()=>true});
          await ctl.start('request-owner',base,{id:'d'},'personalizada',true);
          return (await cache.get('request-owner')).draft.__v48StartRequest;
        });
        await page.reload();await page.waitForFunction(()=>window.__appTest);
        const requestRecovered=await page.evaluate(async request=>{
          const cache=VodaFitPersistence.createCache(indexedDB,'v48ca-real-request');
          const row=await cache.get('request-owner');let sent;
          const ctl=VodaFitLifecycle.createController({cache,adapter:{ready:()=>true,reserve:async(o,r)=>{sent=r;return {ok:false,code:'NETWORK_ERROR'};}},current:()=>true});
          await ctl.recover('request-owner',row.base,true);
          return sent.sessionId===request.sessionId && sent.startedAt===request.startedAt && !row.draft.sesionActiva;
        },request);
        console.log(JSON.stringify({file:'V48CA recarga real de solicitud no confirmada sin UUID nuevo',pass:requestRecovered?1:0,fail:requestRecovered?0:1}));failed ||= !requestRecovered;
      }
      if(file==='tests-v48b.html'){
        await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
        await page.waitForFunction(()=>window.__appTest);
        const fixture=await page.evaluate(()=>{
          const day={id:'d',nombre:'Entrenamiento de prueba',exercises:[
            {id:'e1',nombre:'Dominadas',series:'3',reps:'8'},
            {id:'e2',nombre:'Gemelos parado con mancuerna',series:'2',reps:'12'}]};
          return {owner:crypto.randomUUID(),data:{personalizada:{days:[day]},automatica:{days:[]},enfocada:{days:[]},activeSlot:'personalizada',
            sesionActiva:window.__appTest.persistence.createSessionDraft(day,{slot:'personalizada'}),
            referenciasEjercicios:{'Dominadas':{series:[{setNumber:3,peso:0,reps:6}],updatedAt:1}}}};
        });
        await installNativeFixture(page,fixture);
        const third=page.locator('[data-native-row="e1"][data-number="3"]');
        await third.locator('[data-native-field="peso"]').fill('0');
        await third.locator('[data-native-field="reps"]').fill('8');
        await third.locator('[data-native-check]').check();
        await page.locator('[data-native-finish="e1"]').click();
        await page.locator('[data-native-answer="yes"]').click();
        await page.waitForFunction(()=>!document.querySelector('.modal-back'));
        await page.evaluate(()=>window.__appTest.persistRutina());
        const before=await page.evaluate(()=>({sid:window.__appTest.nativeSession().sessionId,writes:window.__nativeWrites}));
        await page.reload();await installNativeFixture(page,fixture);
        const restored=await page.evaluate(before=>{
          const A=window.__appTest,s=A.nativeSession(),r=window.VodaFitSession.rows(s,'e1');
          return s.sessionId===before.sid && r[2].completed && r[2].peso===0 && r[2].reps===8 && !r[0].completed
            && s.references.e1.accepted && A.state.rutinaRaw.referenciasEjercicios.Dominadas.series[0].reps===6
            && A.state.registros.length===0 && A.state.entrenos.length===0 && window.__nativeWrites===0 && before.writes===0;
        },before);
        console.log(JSON.stringify({file:'V48B recarga real: series, decisión pendiente y referencia definitiva intacta',pass:restored?1:0,fail:restored?0:1}));
        failed ||= !restored;
        const screenshots=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'vodafit-v48b-'));
        // Esperar el splash/toast y sus transiciones antes de la revisión visual.
        await page.waitForTimeout(2500);
        for(const theme of ['light','dark']){
          await page.evaluate(theme=>{document.documentElement.setAttribute('data-theme',theme);window.scrollTo(0,0);},theme);
          const output=path.join(screenshots,`${theme}.png`);await page.screenshot({path:output});console.log(JSON.stringify({screenshot:output}));
        }
        const width=await page.evaluate(()=>({viewport:innerWidth,content:document.documentElement.scrollWidth}));
        if(width.content>width.viewport){console.error('Overflow móvil',width);failed=true;}
      }
      if(file==='tests-v48.html'){
        await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
        await page.waitForFunction(()=>window.__appTest);
        await page.evaluate(async()=>{
          const P=window.__appTest.persistence;
          const base={data:{days:[]},revision:null,clienteV48:false,schemaReady:false};
          const sync=P.createSync({read:async()=>base,write:async()=>({ok:false,code:'NETWORK_ERROR'})},P.createCache(indexedDB,'v48-real-reload'));
          await sync.load('reload-owner');
          await sync.save({days:[],sesionActiva:{dayId:'reload-day',sets:{e:[true,false]}}});
        });
        await page.reload();
        await page.waitForFunction(()=>window.__appTest);
        const restored=await page.evaluate(async()=>{
          const P=window.__appTest.persistence;
          const sync=P.createSync({read:async()=>({data:{days:[]},revision:null,clienteV48:false,schemaReady:false})},P.createCache(indexedDB,'v48-real-reload'));
          const loaded=await sync.load('reload-owner');
          return loaded.recovered && loaded.data.sesionActiva.dayId==='reload-day' && loaded.data.sesionActiva.sets.e[0]===true;
        });
        console.log(JSON.stringify({file:'recarga real de página',pass:restored?1:0,fail:restored?0:1}));
        failed ||= !restored;
      }
      await page.close();
    }
    await context.close();
  } finally {await browser.close();server.close();}
  process.exitCode=failed?1:0;
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
