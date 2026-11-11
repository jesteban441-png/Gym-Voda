'use strict';
// Deterministic failure/CAS tests of the real persistence module. No network or files written.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const sandbox={window:{}};vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'v48-persistence.js'),'utf8'),sandbox);
const P=sandbox.window.VodaFitPersistence,copy=x=>JSON.parse(JSON.stringify(x));
const equal=(a,b)=>assert(P.equal(a,b));
async function fixture(){
  const session={schemaVersion:48,sessionId:'s',slot:'personalizada',day:{id:'d',exercises:[{id:'z',series:'2'},{id:'a',series:'1'}]},
    sets:[{exerciseInstance:'z',setNumber:1,peso:30,reps:8,completed:true},{exerciseInstance:'z',setNumber:2,peso:null,reps:null,completed:false},{exerciseInstance:'a',setNumber:1,peso:null,reps:null,completed:false}],references:{z:{accepted:false,sets:[{setNumber:1,peso:30,reps:8}]}}};
  const base={data:{personalizada:{days:[]},sesionActiva:session},revision:1,clienteV48:true,schemaReady:true};
  let row=null,remote=copy(base),branches=[],failWrite=false,hook=null;
  const cache={get:async()=>copy(row),conflicts:async()=>copy(branches),put:async(next,version)=>{
    if(hook){const h=hook;hook=null;await h();}
    if(failWrite)throw Error('synthetic write failure');
    if(version!==(row?.localVersion||0)){branches.push(copy(next));return {conflict:true,backupSaved:true};}
    row={...copy(next),localVersion:version+1};return copy(row);
  }};
  const sync=P.createSync({read:async()=>copy(remote),write:async()=>({ok:false,code:'NATIVE_LOCAL_ONLY'})},cache);
  await sync.load('owner');
  const draft=copy(base.data);draft.sesionActiva.day.exercises[1].omitido=true;draft.sesionActiva.ui={raw:'do not discard'};
  draft.sesionActiva._nativeDiaConfirmado=copy(session.day);await sync.save(draft);
  const sent={sessionId:'s',day:copy(draft.sesionActiva.day),sets:copy(draft.sesionActiva.sets),references:copy(draft.sesionActiva.references)};
  const envelope={...copy(base),revision:2,data:{...copy(base.data),sesionActiva:{...copy(session),day:copy(sent.day),sets:copy(sent.sets).sort((a,b)=>a.exerciseInstance<b.exerciseInstance?-1:a.exerciseInstance>b.exerciseInstance?1:a.setNumber-b.setNumber),references:copy(sent.references)}}};
  return {sync,base,draft,sent,envelope,cache,row:()=>copy(row),branches:()=>copy(branches),
    fail:v=>failWrite=v,hook:h=>hook=h,remote:v=>remote=copy(v),otherTab:()=>row.localVersion++,branch:()=>branches.push(copy(row))};
}
let count=0;
async function test(name,fn){await fn();count++;console.log('PASS '+name);}
(async()=>{
  await test('Confirmed SQL order, local-only fields and latest draft survive; next save uses localVersion',async()=>{
    const f=await fixture(),d=copy(f.draft);d.sesionActiva.sets[0].peso=44;d.personalizada.days.push({id:'later'});
    const queued=f.sync.save(d),ack=f.sync.confirmSession('owner',f.base,f.sent,f.envelope);await queued;assert((await ack).ok);
    equal(f.row().base,f.envelope);assert.equal(f.row().draft.sesionActiva.sets[0].peso,44);assert.equal(f.row().draft.sesionActiva.ui.raw,'do not discard');
    equal(f.row().draft.personalizada,d.personalizada);equal(f.row().draft.sesionActiva._nativeDiaConfirmado,f.sent.day);
    f.remote(f.envelope);const loaded=await f.sync.load('owner');assert(loaded.recovered&&!loaded.conflict);
    await f.sync.save(loaded.data);assert.equal(f.branches().length,0);
  });
  await test('Write failure leaves base/version/draft unchanged; exact receipt can be retried',async()=>{
    const f=await fixture(),before=f.row();f.fail(true);assert.equal((await f.sync.confirmSession('owner',f.base,f.sent,f.envelope)).code,'LOCAL_STORAGE_ERROR');
    equal(f.row(),before);assert.equal(f.sync.getContext().base.revision,1);f.fail(false);assert((await f.sync.confirmSession('owner',f.base,f.sent,f.envelope)).ok);
  });
  await test('Second-tab write wins: CAS backs up attempted acknowledgement; never overwrites',async()=>{
    const f=await fixture();f.hook(()=>f.otherTab());const result=await f.sync.confirmSession('owner',f.base,f.sent,f.envelope);
    assert.equal(result.code,'LOCAL_CONFLICT');assert.equal(f.row().base.revision,1);assert.equal(f.branches().length,1);
  });
  await test('Existing conflict copies are preserved and block acknowledgement',async()=>{
    const f=await fixture();f.branch();assert.equal((await f.sync.confirmSession('owner',f.base,f.sent,f.envelope)).code,'LOCAL_CONFLICT');assert.equal(f.branches().length,1);
  });
  await test('Wrong owner, changed account and changed session are rejected',async()=>{
    const f=await fixture();assert.equal((await f.sync.confirmSession('other',f.base,f.sent,f.envelope)).code,'ACCOUNT_CHANGED');
    const wrong=copy(f.envelope);wrong.data.sesionActiva.sessionId='other';assert.equal((await f.sync.confirmSession('owner',f.base,f.sent,wrong)).code,'INVALID_RESPONSE');
    f.sync.detach();assert.equal((await f.sync.confirmSession('owner',f.base,f.sent,f.envelope)).code,'ACCOUNT_CHANGED');
  });
  await test('Remote divergence in sets, references or routine is not acknowledged',async()=>{
    for(const change of [e=>e.data.sesionActiva.sets[1].peso=99,e=>e.data.sesionActiva.references.z.accepted=true,e=>e.data.personalizada.days.push({id:'remote'})]){
      const f=await fixture(),e=copy(f.envelope);change(e);const before=f.row();assert.equal((await f.sync.confirmSession('owner',f.base,f.sent,e)).code,'INVALID_RESPONSE');equal(f.row(),before);
    }
  });
  await test('Load detecting a true revision conflict cannot be cleared by acknowledgement',async()=>{
    const f=await fixture(),other=copy(f.base);other.revision=3;other.data.personalizada.days.push({id:'remote'});f.remote(other);
    assert((await f.sync.load('owner')).conflict);assert.equal((await f.sync.confirmSession('owner',f.base,f.sent,f.envelope)).code,'REVISION_CONFLICT');
  });
  await test('Edit queued after acknowledgement retains its content and confirmed base',async()=>{
    const f=await fixture(),later=copy(f.draft);later.sesionActiva.sets[0].peso=55;
    const ack=f.sync.confirmSession('owner',f.base,f.sent,f.envelope),save=f.sync.save(later);assert((await ack).ok);await save;
    assert.equal(f.row().draft.sesionActiva.sets[0].peso,55);assert.equal(f.row().base.revision,2);assert.equal(f.branches().length,0);
  });
  console.log(JSON.stringify({pass:count,fail:0}));
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
