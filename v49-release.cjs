'use strict';
// Local release integrity utility, no dependencies/build/runtime configuration.
// Default: read-only verification. --seal: update HTML SRI and SW's exact hashes.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const hash=(bytes,algorithm='sha256',encoding='hex')=>crypto.createHash(algorithm).update(bytes).digest(encoding);
const canonical=(bytes,url)=>/\.(?:js|css|html|json)$/.test(url.split('?')[0])?Buffer.from(bytes.toString().replace(/\r\n/g,'\n')):bytes;
function integrity(bytes){
  const lf=bytes.toString().replace(/\r\n/g,'\n');
  return [...new Set([hash(lf,'sha384','base64'),hash(lf.replace(/\n/g,'\r\n'),'sha384','base64')])].map(x=>'sha384-'+x).join(' ');
}
function seal(html,sw,read){
  const release=sw.match(/const RELEASE = "([^"]+)";/)[1];
  assert.equal(html.match(/const APP_RELEASE = "([^"]+)";/)[1],release,'HTML/worker release mismatch');
  const assets=new Set(['./index.html','./manifest.json','./apple-touch-icon.png','./icon-192.png','./icon-512.png','./icon-512-maskable.png','./favicon-32.png']);
  html=html.replace(/<script src="(\.\/[^"?]+(?:\?[^" ]+)?)"[^>]*><\/script>/g,(_,url)=>{
    const parsed=new URL(url,'https://local.invalid/'),bytes=read(url.split('?')[0]);
    parsed.searchParams.set('h',hash(canonical(bytes,url)));
    url='.'+parsed.pathname+parsed.search;
    assets.add(url);
    return `<script src="${url}" integrity="${integrity(bytes)}" crossorigin="anonymous"></script>`;
  });
  html=html.replace(/<link\b[^>]*href="(\.\/vendor\/fonts\/fonts.css)(?:\?[^" ]+)?"[^>]*>/g,(_,url)=>{
    const bytes=read(url);url+='?h='+hash(canonical(bytes,url));
    assets.add(url);
    return `<link rel="stylesheet" href="${url}" integrity="${integrity(bytes)}" crossorigin="anonymous">`;
  });
  const css=read('./vendor/fonts/fonts.css').toString();
  for(const match of css.matchAll(/url\(['"]?([^)'"\s]+)['"]?\)/g))assets.add('./vendor/fonts/'+match[1].replace(/^\.\//,''));
  const shell=Object.fromEntries([...assets].filter(url=>url!=='./index.html').sort().map(url=>[url,hash(canonical(read(url.split('?')[0]),url))]));
  html=html.replace(/const APP_BUILD = "[^"]+";/,'const APP_BUILD = "unsealed";');
  const build=hash(canonical(Buffer.from(html),'index.html').toString()+JSON.stringify(shell));
  html=html.replace('const APP_BUILD = "unsealed";','const APP_BUILD = "'+build+'";');
  shell['./index.html']=hash(canonical(Buffer.from(html),'index.html'));
  // Cache identity includes ALL essential bytes, not just a cosmetic version label.
  const identity=hash(JSON.stringify(shell));
  sw=sw.replace(/const SHELL = [\s\S]*?\/\/ END SHELL/,
    'const SHELL = '+JSON.stringify(shell,null,2)+';\nconst SHELL_ID = "'+identity+'";\nconst BUILD = "'+build+'";\n// END SHELL');
  return {html,sw,shell,release};
}
if(require.main===module){
  const root=__dirname,read=url=>fs.readFileSync(path.join(root,url));
  const html=read('index.html').toString(),sw=read('sw.js').toString(),result=seal(html,sw,read);
  if(process.argv.includes('--seal')){
    fs.writeFileSync(path.join(root,'index.html'),result.html);fs.writeFileSync(path.join(root,'sw.js'),result.sw);
    console.log('Sealed local V'+result.release+' ('+Object.keys(result.shell).length+' essential resources).');
  }else{
    assert.equal(html,result.html,'HTML SRI needs sealing');assert.equal(sw,result.sw,'Shell hashes need sealing');
    for(const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))if(match[1].trim())new Function(match[1]);
    new Function(sw);console.log('PASS: SRI, shell hashes, matching releases and JavaScript syntax.');
  }
}
module.exports={seal};
