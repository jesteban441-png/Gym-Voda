// Runner local sin build ni acceso a Supabase. Requiere Playwright de desarrollo.
const {chromium}=require('playwright');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=__dirname;
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
    const context=await browser.newContext({serviceWorkers:'block'});
    await context.route('**/vendor/supabase-js-*/**',route=>route.fulfill({contentType:'text/javascript',body:sdk}));
    await context.route('https://**/*',route=>{
      const url=route.request().url();
      if(url.includes('supabase-js')) return route.fulfill({contentType:'text/javascript',body:sdk});
      // Sin dependencias remotas ni llamadas a bases de datos durante pruebas.
      return route.fulfill({contentType:'text/javascript',body:''});
    });
    for(const [file,result] of [['tests-v48.html','__v48Results'],['tests-v31.html','__v31Results']]){
      const page=await context.newPage(),errors=[];
      page.on('pageerror',e=>errors.push(e.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/${file}`);
      await page.waitForFunction(key=>window[key],result,{timeout:180000});
      const output=await page.evaluate(key=>window[key],result);
      console.log(JSON.stringify({file,...output,pageErrors:errors}));
      failed ||= output.fail>0 || errors.length>0;
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
