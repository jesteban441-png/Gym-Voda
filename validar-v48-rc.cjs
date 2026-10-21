'use strict';
// Sólo archivos locales. Sin SDK, red, credenciales privadas ni ejecución SQL.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),vm=require('node:vm'),crypto=require('node:crypto');
const read=p=>fs.readFileSync(path.join(__dirname,p),'utf8'),html=read('index.html'),sw=read('sw.js');
const modules=['persistence','session','lifecycle','reconcile','history'];
for(const name of modules){new vm.Script(read(`v48-${name}.js`));assert.ok(html.includes(`./v48-${name}.js?v=48.rc1`));}
for(const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi))if(!/\bsrc\s*=/.test(m[1]))new vm.Script(m[2]);
new vm.Script(sw);
const assets=JSON.parse(sw.match(/const ASSETS = (\[[^;]+\]);/)[1]);
for(const asset of assets){const local=asset.split('?')[0];assert.ok(fs.existsSync(path.join(__dirname,local)),asset);}
const manifest=JSON.parse(read('vendor/DEPENDENCIAS.json'));
for(const f of manifest.files){const bytes=fs.readFileSync(path.join(__dirname,'vendor',f.path));assert.equal(bytes.length,f.bytes);assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),f.sha256);}
for(const f of ['index.html','sw.js','manifest.json',...modules.map(n=>`v48-${n}.js`)]){
 assert.ok(!/ittogcejkhonwnnjriot|VODAFIT_STAGING|staging-banner|127\.0\.0\.1:8084|vodafit-staging/.test(read(f)),f+' contiene configuración de staging');
}
assert.ok(read('v48-persistence.js').includes('Object.freeze({metadata:true,rpc:true})'));
assert.ok(sw.includes('gymapp-v48-rc1'));
assert.ok(!/<(?:script|link)\b[^>]*(?:cdn\.jsdelivr|cdnjs\.cloudflare|fonts\.googleapis|fonts\.gstatic)/i.test(html));
assert.ok(html.includes('if(nativeSession()) return requestNativeFinish();'));
function definition(s){const start=s.search(/^CREATE (OR REPLACE )?FUNCTION public.v48_registro_guardar/m);return s.slice(start,s.indexOf('END $$;',start)+7).replace('CREATE OR REPLACE FUNCTION','CREATE FUNCTION').replace(/\r\n/g,'\n').trim();}
assert.equal(definition(read('supabase/v48/03_compatibilidad.sql')),definition(read('supabase/v48/11_fix_registro_guardar.sql')));
assert.ok(!/\bpeso\s*=\s*peso\b/.test(read('supabase/v48/03_compatibilidad.sql')));
const signatures=['02_rpc','03_compatibilidad','09_compatibilidad_edicion'].reduce((n,f)=>n+(read(`supabase/v48/${f}.sql`).match(/CREATE FUNCTION public\.[a-z0-9_]+\(/g)||[]).length,0);
assert.equal(signatures,13);
for(const n of ['01_expansion','02_rpc','03_compatibilidad','07_cierre_canonico','09_compatibilidad_edicion','04_activar_acceso']){
 const sql=read(`supabase/v48/${n}.sql`);assert.ok(/^BEGIN;/m.test(sql)&&/COMMIT;\s*$/.test(sql),n);
}
console.log(JSON.stringify({syntax:'OK',modules:modules.length,precacheAssets:assets.length,vendorIntegrity:'OK',stagingConfiguration:'ABSENT',sql03MatchesPatch11:true,sqlExecuted:false}));
