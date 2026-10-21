/* Compatibilidad de historial V48: no modifica el borrador de entrenamiento. */
(function(root){
 'use strict';
 const P=root.VodaFitPersistence,copy=x=>JSON.parse(JSON.stringify(x));
 const fail=(code,error)=>({ok:false,code,error:error||{message:code}});
 const snapshot=r=>Object.fromEntries(['id','profile_id','exercise','peso','date','reps','series','nota','set_number','created_at'].map(k=>[k,r[k]??null]));
 const sameRecord=(r,p)=>r && r.exercise===p.exercise && r.peso===p.peso && r.date===p.date
   && (r.reps||'')===p.reps && (r.series||'')===p.series && (r.nota||'')===p.nota;
 function createJournal(factory,name='vodafit-history-intents'){
  if(factory===undefined){try{factory=root.indexedDB;}catch(error){factory=null;}}
  let opening;
  function open(){return opening||(opening=new Promise((resolve,reject)=>{
   if(!factory){reject(Error('LOCAL_STORAGE_ERROR'));return;}
   let abandoned=false;
   const req=factory.open(name,1);req.onupgradeneeded=()=>req.result.createObjectStore('operations',{keyPath:'key'});
   req.onsuccess=()=>{if(abandoned){req.result.close();return;}req.result.onversionchange=()=>req.result.close();resolve(req.result);};req.onerror=()=>reject(req.error);
   req.onblocked=()=>{abandoned=true;reject(Error('LOCAL_STORAGE_ERROR'));};
  }));}
  async function transaction(owner,channel,fn,write=true){
   const db=await open(),key=JSON.stringify([owner,channel]);
   return new Promise((resolve,reject)=>{
    const tx=db.transaction('operations',write?'readwrite':'readonly'),store=tx.objectStore('operations');let value,error;
    const req=store.get(key);req.onsuccess=()=>{try{value=fn(req.result,store,key);}catch(e){error=e;tx.abort();}};
    tx.oncomplete=()=>resolve(value);tx.onerror=tx.onabort=()=>reject(error||tx.error||Error('LOCAL_STORAGE_ERROR'));
   });
  }
  return {
   peek:(o,c)=>transaction(o,c,row=>row?copy(row):null,false),
   prepare:(o,c,spec,recover)=>transaction(o,c,(row,store,key)=>{
    if(recover && row && recover.operationId!==row.operationId)throw Error('LOCAL_CONFLICT');
    if(recover && !row){const restored={...copy(recover),key};store.put(restored);return restored;}
    if(row && row.owner!==o)throw Error('ACCOUNT_CHANGED');
    if(row && P.equal(row.request,spec))return copy(row);
    if(row && !['confirmed','rejected','prepared'].includes(row.status))throw Error('PENDING_HISTORY_OPERATION');
    const operationId=root.crypto.randomUUID(),next={key,owner:o,channel:c,operationId,id:spec.id||operationId,
      request:copy(spec),status:'prepared',expected:null};store.put(next);return copy(next);
   }),
   update:(op,patch)=>transaction(op.owner,op.channel,(row,store)=>{
    if(!row || row.operationId!==op.operationId)throw Error('LOCAL_CONFLICT');
    const next={...row,...copy(patch)};store.put(next);return next;
   }),
   release:(o,c,id)=>transaction(o,c,(row,store,key)=>{if(row && row.operationId===id && row.status==='confirmed')store.delete(key);})
  };
 }
 function createController({capabilities,account,rpc,readRecord,readWorkout,journal=createJournal(),canonical=x=>x}){
  const flights=new Map(),last=new Map(),attempts=new Map();
  function mode(owner){
   const a=account();if(!a || a.owner!==owner)return fail('ACCOUNT_CHANGED');
   if(!a.loaded)return fail('NOT_LOADED');
   if(!a.clienteV48)return {ok:true,mode:'legacy',epoch:a.epoch};
   if(!capabilities.metadata || !capabilities.rpc || !a.schemaReady)return fail('V48_NOT_READY');
   return {ok:true,mode:'v48',epoch:a.epoch};
  }
  async function call(owner,name,args,current){
   if(!current())return fail('ACCOUNT_CHANGED');
   try{
    const r=await rpc(owner,name,args);
    if(!current())return fail('ACCOUNT_CHANGED');
    if(r.error){
      if(r.status>=500 && r.error.code!=='40001')return {...fail('REMOTE_UNCERTAIN',r.error),uncertain:true};
      return fail(r.error.code==='40001'?'HISTORY_CONFLICT':r.error.message||r.error.code||'RPC_ERROR',r.error);
    }
    return {ok:true,data:r.data};
   }catch(error){return {...fail('NETWORK_ERROR',error),uncertain:true};}
  }
  async function execute(owner,kind,data,id,channel){
   let op;const failed=(code,error)=>({...fail(code,error),id:op?.id,operationId:op?.operationId,channel});
   const m=mode(owner);if(!m.ok)return m;if(m.mode!=='v48')return failed('LEGACY_ROUTE_REQUIRED');
   const current=()=>{const a=account();return a && a.owner===owner && a.epoch===m.epoch;};
   try{
    const spec={kind,id:id||null,data:copy(data)};
    const key=JSON.stringify([owner,channel]),previous=attempts.get(key);
    const recover=previous && previous.epoch===m.epoch && P.equal(previous.op.request,spec)?previous.op:null;
    op=await journal.prepare(owner,channel,spec,recover);attempts.set(key,{epoch:m.epoch,op:copy(op)});
    const updateOp=async patch=>{op=await journal.update(op,patch);attempts.set(key,{epoch:m.epoch,op:copy(op)});return op;};
    if(!current())return failed('ACCOUNT_CHANGED');
    const resultBase={id:op.id,operationId:op.operationId,channel};
    if(op.status==='confirmed')return {ok:true,...resultBase,replayed:true};
    const send=async(name,args)=>{await updateOp({status:'sending'});return call(owner,name,args,current);};
    const read=async(fn,id)=>{try{return await fn(owner,id);}catch(error){throw Object.assign(Error('REMOTE_READ_ERROR'),{cause:error});}};
    let result;
    if(kind==='create' || kind==='edit' || kind==='delete'){
     const row=await read(readRecord,op.id);
     if(!current())return failed('ACCOUNT_CHANGED');
     if(row && row.profile_id!==owner)return failed('ACCOUNT_CHANGED');
     if(row && row.entreno_id)return failed(kind==='delete'?'DELETE_WHOLE_SESSION_REQUIRED':'SESSION_RECORD_IMMUTABLE');
     if(kind==='delete'){
      result=await send('v48_registro_eliminar',{p_id:op.id});
     }else{
      const payload={...copy(data),exercise:kind==='edit'?(op.payload?.exercise||row?.exercise):canonical(data.exercise)};
      if(kind==='edit' && !row)return failed('RECORD_NOT_FOUND');
      if(op.expected && row && !P.equal(snapshot(row),op.expected) && !sameRecord(row,op.payload))return failed('HISTORY_CONFLICT');
      if(row && kind==='create' && !sameRecord(row,payload))return failed('IDEMPOTENCY_CONFLICT');
      if(kind==='edit' && !op.expected){await updateOp({expected:snapshot(row),payload});}
      if(row && sameRecord(row,payload))result={ok:true,data:op.id};
      else result=await send('v48_registro_guardar',{p_id:op.id,p_datos:payload,p_editar:kind==='edit',p_esperado:kind==='edit'?op.expected:null});
     }
    }else if(kind==='mark'){
     const row=await read(readWorkout,op.id);
     if(!current())return failed('ACCOUNT_CHANGED');
     if(row && row.profile_id!==owner)return failed('ACCOUNT_CHANGED');
     if(row && (!row.is_manual || row.sesion_id || row.date!==data.date || row.day_nombre!==data.dayNombre))return failed('IDEMPOTENCY_CONFLICT');
     result=row?{ok:true,data:op.id}:await send('v48_marcar_dia',{p_id:op.id,p_fecha:data.date,p_nombre:data.dayNombre});
    }else if(kind==='deleteWorkout'){
     const row=await read(readWorkout,op.id);
     if(!current())return failed('ACCOUNT_CHANGED');
     if(row && row.profile_id!==owner)return failed('ACCOUNT_CHANGED');
     if(row && row.sesion_id)return failed('USE_V48_ELIMINAR');
     result=await send('v48_historico_eliminar',{p_id:op.id});
    }else return failed('INVALID_OPERATION');
    if(!current())return failed('ACCOUNT_CHANGED');
    if(!result.ok){await updateOp({status:result.uncertain?'uncertain':'rejected'});return {...result,...resultBase};}
    const isVoid=kind==='delete'||kind==='deleteWorkout';
    if(isVoid?result.data!==null:result.data!==op.id)return {...fail('INVALID_RPC_RESPONSE'),...resultBase};
    await updateOp({status:'confirmed'});
    if(!current())return failed('ACCOUNT_CHANGED');
    return {ok:true,...resultBase};
   }catch(error){if(error.message==='REMOTE_READ_ERROR')return failed('NETWORK_ERROR',error.cause);return failed(['PENDING_HISTORY_OPERATION','LOCAL_CONFLICT','ACCOUNT_CHANGED'].includes(error.message)?error.message:'LOCAL_STORAGE_ERROR',error);}
  }
  function perform(owner,kind,data={},id=null,channel=kind+':'+(id||'new')){
   const key=JSON.stringify([owner,channel]),existing=flights.get(key),request={kind,id,data};
   if(existing)return P.equal(existing.request,request)?existing.task:Promise.resolve(fail('OPERATION_IN_PROGRESS'));
   const epoch=account()?.epoch;
   const task=execute(owner,kind,data,id,channel).then(r=>{if(account()?.owner===owner && account()?.epoch===epoch)last.set(owner,r);return r;}).finally(()=>flights.delete(key));
   flights.set(key,{request:copy(request),task});return task;
  }
  async function acceptRemote(owner,result,confirmed){
   if(confirmed!==true)return fail('CONFIRMATION_REQUIRED');
   const m=mode(owner);if(!m.ok || m.mode!=='v48')return m.ok?fail('V48_NOT_READY'):m;
   const valid=()=>account()?.owner===owner && account()?.epoch===m.epoch;
   try{
    const op=await journal.peek(owner,result.channel);
    if(!op || op.operationId!==result.operationId)return fail('LOCAL_CONFLICT');
    if(!['create','edit','mark'].includes(op.request.kind))return fail('INVALID_OPERATION');
    const row=await (op.request.kind==='mark'?readWorkout:readRecord)(owner,op.id);
    if(!valid())return fail('ACCOUNT_CHANGED');
    if(!row || row.profile_id!==owner || row.entreno_id || row.sesion_id)return fail('RECORD_NOT_FOUND');
    await journal.update(op,{status:'confirmed'});
    return {ok:true,resolved:true,id:op.id,operationId:op.operationId,channel:op.channel};
   }catch(error){return fail('LOCAL_CONFLICT',error);}
  }
  return {mode,status:owner=>last.get(owner),acceptRemote,
   save:(o,d,c='registro-create')=>perform(o,'create',d,null,c),
   edit:(o,id,d)=>perform(o,'edit',d,id),remove:(o,id)=>perform(o,'delete',{},id),
   mark:(o,d)=>perform(o,'mark',d,null,'calendar:'+d.date),removeWorkout:(o,id)=>perform(o,'deleteWorkout',{},id),
   acknowledge:async(o,r)=>{
    if(account()?.owner!==o || !r?.ok || !r.operationId)return;
    await journal.release(o,r.channel,r.operationId);
    const key=JSON.stringify([o,r.channel]);if(attempts.get(key)?.op.operationId===r.operationId)attempts.delete(key);
   },
   draft:o=>account()?.owner===o?journal.peek(o,'registro-create'):Promise.resolve(null),snapshot};
 }
 root.VodaFitHistory=Object.freeze({createJournal,createController,snapshot,sameRecord});
})(window);
