/* V48.1C-A: timestamps y reserva confirmada. Sin activación ni RPC de cierre. */
(function(root){
  'use strict';
  const clone=x=>JSON.parse(JSON.stringify(x));
  const fail=code=>({ok:false,code});
  function localDate(ms,timezone){
    const parts=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(ms));
    const get=k=>parts.find(p=>p.type===k).value;
    return `${get('year')}-${get('month')}-${get('day')}`;
  }
  function validTimeline(s){
    try {
      if(!s || !Number.isSafeInteger(s.startedAt) || s.startedAt<=0 || typeof s.timezone!=='string' || !s.timezone) return false;
      localDate(s.startedAt,s.timezone);
      return !s.lifecycle || (pending(s) && Number.isSafeInteger(s.lifecycle.endedAt) && s.lifecycle.endedAt>=s.startedAt);
    } catch(e){return false;}
  }
  function pending(s){return !!(s && s.lifecycle && s.lifecycle.status==='pending_finalization');}
  function elapsed(s,now=Date.now()){
    const end=pending(s)?s.lifecycle.endedAt:now;
    return Math.max(0,end-s.startedAt);
  }
  function clock(s,now){
    const seconds=Math.floor(elapsed(s,now)/1000);
    return [Math.floor(seconds/3600),Math.floor(seconds/60)%60,seconds%60].map(x=>String(x).padStart(2,'0')).join(':');
  }
  function finish(s,now=Date.now()){
    if(pending(s)) return s.lifecycle;
    if(!root.VodaFitSession.isNative(s) || !validTimeline(s) || !Number.isSafeInteger(now) || now<s.startedAt) throw new Error('INVALID_END_TIME');
    // Copia estable de lo realizado y las decisiones. No se envía a ninguna RPC.
    s.lifecycle={status:'pending_finalization',endedAt:now,localStartDate:localDate(s.startedAt,s.timezone),
      finalization:{sessionId:s.sessionId,endedAt:now,sets:clone(s.sets),references:clone(s.references)}};
    return s.lifecycle;
  }
  function createAdapter({capabilities,rpc}){
    function ready(base){return !!(capabilities.metadata && capabilities.rpc && base && base.schemaReady && base.clienteV48 && Number.isSafeInteger(base.revision));}
    return {ready,async reserve(owner,request,base){
      if(!ready(base)) return fail('V48_NOT_READY');
      try {
        const result=await rpc(owner,'v48_iniciar',{
          p_revision:request.revision,p_sesion:request.sessionId,p_slot:request.slot,p_dia_id:request.dayId,
          p_inicio_ms:request.startedAt,p_zona:request.timezone,p_dia_especial:request.specialDay||null});
        if(result.error) return fail(result.error.code==='40001'?'REVISION_CONFLICT':result.error.message||'RESERVATION_FAILED');
        const e=result.data,s=e && e.data && e.data.sesionActiva;
        if(!e || !Number.isSafeInteger(e.revision) || e.revision<=request.revision || e.clienteV48!==true || e.terminal || !root.VodaFitSession.isNative(s) || !validTimeline(s)
          || s.sessionId!==request.sessionId || s.startedAt!==request.startedAt || s.timezone!==request.timezone
          || s.slot!==request.slot || s.dayId!==request.dayId || s.day.id!==request.dayId) return fail('INVALID_RESERVATION');
        return {ok:true,envelope:{...e,schemaReady:true}};
      } catch(e){return fail('NETWORK_ERROR');}
    }};
  }
  function createController({cache,adapter,current,now=Date.now,uuid=()=>root.crypto.randomUUID(),zone=()=>Intl.DateTimeFormat().resolvedOptions().timeZone}){
    const flights=new Map();
    async function run(owner,base,day,slot,online,recover,clickedAt){
      if(!online) return fail('ONLINE_REQUIRED');
      if(!adapter.ready(base)) return fail('V48_NOT_READY');
      if(!current(owner)) return fail('ACCOUNT_CHANGED');
      let row;
      try {
        row=await cache.get(owner);
        if((await cache.conflicts(owner)).length) return fail('LOCAL_CONFLICT');
        let request=row && row.draft.__v48StartRequest;
        if(!request){
          if(recover) return {ok:true,unchanged:true};
          if(base.data.sesionActiva || (row && row.draft.sesionActiva)) return fail('ACTIVE_SESSION_EXISTS');
          if(row && row.pending && !root.VodaFitPersistence.equal(row.draft,base.data)) return fail('UNSYNCED_CHANGES');
          const startedAt=clickedAt,timezone=zone();
          request={sessionId:uuid(),startedAt,timezone,localStartDate:localDate(startedAt,timezone),revision:base.revision,
            slot,dayId:day.id,specialDay:slot==='especial'?clone(day):null};
          row=await cache.put({version:1,ownerId:owner,base:clone(base),draft:{...clone(base.data),__v48StartRequest:request},pending:true,updatedAt:now()},row?row.localVersion:0);
          if(row.conflict) return fail('LOCAL_CONFLICT');
        } else if(!recover && (request.dayId!==day.id || request.slot!==slot)) return fail('START_PENDING');
        if(!current(owner)) return fail('ACCOUNT_CHANGED');
        // La misma solicitud sobrevive errores y recargas. El backend decide si existe.
        const result=await adapter.reserve(owner,request,base);
        if(!result.ok || !current(owner)) return current(owner)?result:fail('ACCOUNT_CHANGED');
        const saved=await cache.put({version:1,ownerId:owner,base:clone(result.envelope),draft:clone(result.envelope.data),pending:false,updatedAt:now()},row.localVersion);
        if(saved.conflict) return fail('LOCAL_CONFLICT');
        return result;
      } catch(e){return fail('LOCAL_STORAGE_ERROR');}
    }
    function start(owner,base,day,slot,online,recover=false){
      if(flights.has(owner)) return flights.get(owner);
      const task=run(owner,base,day,slot,online,recover,now()).finally(()=>flights.delete(owner));
      flights.set(owner,task);return task;
    }
    return {start,recover:(owner,base,online)=>start(owner,base,null,null,online,true)};
  }
  root.VodaFitLifecycle=Object.freeze({localDate,validTimeline,pending,elapsed,clock,finish,createAdapter,createController});
})(window);
