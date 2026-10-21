'use strict';
// Audita un checkout/export del índice y su .vercelignore. No red ni SQL.
// Usa Git sólo en un repositorio TEMPORAL para interpretar los patrones reales.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process'),assert=require('node:assert/strict');
const root=__dirname;
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>{
 if(e.name==='.git')return [];
 const f=path.join(dir,e.name);assert.ok(!e.isSymbolicLink(),'No se admiten symlinks: '+f);
 return e.isDirectory()?walk(f):[path.relative(root,f).split(path.sep).join('/')];
});}
const files=walk(root),samples=['docs/no-publicar.md','staging/fixture.json','supabase/v48/test.sql','tests-v48.html','tests-v48rc-runner.cjs','verificar-paquete-v48.cjs','baseline-clasificacion.js','AGENTS.md','.env','secreto.sql','datos.pdf','prototipo-anatomia.html','ejercicios/anatomia/curl-biceps-anatomia.jpeg','ejercicios/anatomia/curl-inclinado-anatomia.jpeg','ejercicios/anatomia/plancha-anatomia.png'];
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'vodafit-ignore-'));
let ignored;
try{
 let r=cp.spawnSync('git',['init','--quiet',temporary],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);
 r=cp.spawnSync('git',['-c','core.excludesFile='+path.join(root,'.vercelignore'),'check-ignore','--no-index','-z','--stdin'],{
  cwd:temporary,encoding:'utf8',input:[...new Set([...files,...samples])].join('\0')+'\0'});
 assert.ok(r.status===0||r.status===1,r.stderr);ignored=new Set(r.stdout.split('\0').filter(Boolean));
}finally{
 // Sólo el directorio recién creado por este proceso, hijo directo del temp del SO.
 assert.equal(path.dirname(path.resolve(temporary)),path.resolve(os.tmpdir()));
 assert.ok(path.basename(temporary).startsWith('vodafit-ignore-'));
 fs.rmSync(temporary,{recursive:true});
}
const deployed=files.filter(p=>!ignored.has(p));
const required=new Set(['index.html','sw.js','manifest.json']);
function needed(file){file=file.split(/[?#]/)[0].replace(/^\.\//,'');if(!file)file='index.html';
 assert.ok(fs.existsSync(path.join(root,file)),'Recurso ausente: '+file);
 assert.ok(!ignored.has(file),'Recurso excluido por .vercelignore: '+file);required.add(file);
}
const html=fs.readFileSync(path.join(root,'index.html'),'utf8'),sw=fs.readFileSync(path.join(root,'sw.js'),'utf8');
for(const p of JSON.parse(sw.match(/const ASSETS = (\[[^;]+\]);/)[1]))needed(p);
for(const icon of JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8')).icons)needed(icon.src);
for(const m of html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="([^"]+)"/gi))if(!/^(?:https?:|data:|#)/.test(m[1]))needed(m[1]);
for(const m of html.matchAll(/["'](ejercicios\/[^"']+\.(?:jpg|jpeg|png|webp|gif|mp4|webm|svg))["']/g))needed(m[1]);
const unrelatedMedia=new Set(samples.filter(p=>p.startsWith('ejercicios/')));
// Incluye también rutas de medios armadas dinámicamente por el catálogo.
for(const p of files.filter(p=>p.startsWith('ejercicios/')&&!unrelatedMedia.has(p)))needed(p);
for(const css of deployed.filter(p=>p.endsWith('.css'))){
 for(const m of fs.readFileSync(path.join(root,css),'utf8').matchAll(/url\(['"]?([^)'"\s]+)['"]?\)/g)){
  assert.ok(!/^https?:/.test(m[1]),'CSS remoto: '+css);needed(path.posix.join(path.posix.dirname(css),m[1]));
 }
}
for(const p of samples)assert.ok(ignored.has(p),'No se excluye archivo interno: '+p);
assert.ok(deployed.every(p=>!/(?:\.sql|\.md|\.pdf|\.cjs|\.py)$/i.test(p)));
const secret=/sb_secret_[A-Za-z0-9_-]{12,}|eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{12,}/;
for(const p of deployed.filter(p=>/\.(?:html|js|json|css|map)$/.test(p))){const body=fs.readFileSync(path.join(root,p),'utf8');
 assert.ok(!secret.test(body),'Posible secreto en '+p);
 assert.ok(!/ittogcejkhonwnnjriot|VODAFIT_STAGING|staging-banner|127\.0\.0\.1:8084/.test(body),'Configuración staging en '+p);
}
const exportIndex=process.argv.indexOf('--export');
if(exportIndex>=0){const destination=path.resolve(process.argv[exportIndex+1]||'');
 assert.ok(!fs.existsSync(destination),'El destino debe ser nuevo');
 assert.ok(destination!==root&&!destination.startsWith(root+path.sep),'Exportar fuera del checkout');
 fs.mkdirSync(destination,{recursive:true});for(const p of deployed){const out=path.join(destination,p);fs.mkdirSync(path.dirname(out),{recursive:true});fs.copyFileSync(path.join(root,p),out);}
}
console.log(JSON.stringify({files:files.length,deployed:deployed.length,excluded:files.length-deployed.length,requiredResources:required.size,missing:0,excludedRuntimeResources:0,secretsDetected:0,stagingConfigurationDetected:0,method:'git check-ignore sobre .vercelignore; sin Vercel/deploy'},null,2));
