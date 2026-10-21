/* V48.1C-B. Una única fila IndexedDB A; ningún cierre por DML directo. */
(function(root){
  'use strict';
  const P=root.VodaFitPersistence,N=root.VodaFitSession,L=root.VodaFitLifecycle;
  const copy=x=>JSON.parse(JSON.stringify(x)),failure=(code,extra={})=>({ok:false,code,...extra});
  const slots=['personalizada','automatica','enfocada','activeSlot'];
  function payload(s,canonical=x=>x){
    if(!N.isNative(s) || !L.validTimeline(s) || !L.pending(s)) throw Error('INVALID_PENDING_SESSION');
    const frozen=s.lifecycle.finalization;
    if(!frozen || frozen.sessionId!==s.sessionId || frozen.endedAt!==s.lifecycle.endedAt) throw Error('INVALID_CLOSE');
    const view={...s,sets:copy(frozen.sets),references:copy(frozen.references)};
    if(!N.isNative(view)) throw Error('INVALID_SETS');
    let planned=0;
    for(const ex of s.day.exercises){
      const text=String(ex.series),count=/^[0-9]{1,4}$/.test(text)?Math.max(1,Math.min(12,Number(text))):1;
      planned+=count;
      if(N.rows(view,ex.id).length!==count || N.rows(view,ex.id).some(r=>r.setNumber>count)) throw Error('INVALID_SETS');
    }
    if(!planned || view.sets.length!==planned) throw Error('INVALID_SETS');
    const sets=view.sets.map(r=>{
      if(r.completed && !N.valid(r)) throw Error('INVALID_COMPLETED_SET');
      return {exerciseInstance:r.exerciseInstance,setNumber:r.setNumber,completed:r.completed,
        peso:r.completed?r.peso:null,reps:r.completed?r.reps:null};
    }).sort((a,b)=>a.exerciseInstance<b.exerciseInstance?-1:a.exerciseInstance>b.exerciseInstance?1:a.setNumber-b.setNumber);
    // La RPC exige el plan completo, con filas incompletas neutras; sólo inserta completed=true.
    const refs={},accepted=new Map();
    for(const ex of s.day.exercises){
      const done=N.completed(view,ex.id),d=view.references[ex.id];
      if(!done.length) continue;
      if(!d || typeof d.accepted!=='boolean' || !P.equal(done,d.sets)) throw Error('REFERENCE_DECISION_REQUIRED');
      Object.defineProperty(refs,ex.id,{value:{accepted:d.accepted,sets:copy(done)},enumerable:true});
      if(d.accepted){
        const name=canonical(ex.nombre);
        if(accepted.has(name) && !P.equal(accepted.get(name),done)) throw Error('CONFLICTING_EXERCISE_REFERENCES');
        accepted.set(name,done);
      }
    }
    return {p_sesion:s.sessionId,p_fin_ms:frozen.endedAt,p_series:sets,p_referencias:refs};
  }
  function createAdapter({capabilities,rpc}){
    const ready=base=>!!(capabilities.metadata && capabilities.rpc && base && base.schemaReady && base.clienteV48 && Number.isSafeInteger(base.revision));
    async function call(owner,base,name,args){
      if(!ready(base)) return failure('V48_NOT_READY');
      try {
        const r=await rpc(owner,name,args);
        if(r.error) return failure(r.error.code==='40001'?'REVISION_CONFLICT':r.error.message||r.error.code||'RPC_ERROR');
        const e=r.data;
        if(!e || !Number.isSafeInteger(e.revision) || e.revision<0 || e.clienteV48!==true || !e.data || typeof e.data!=='object') return failure('INVALID_RESPONSE',{uncertain:true});
        if(e.terminal && (e.terminal.sessionId!==args.p_sesion || !['finalizada','cancelada','eliminada'].includes(e.terminal.estado)
          || (e.terminal.estado!=='cancelada' && typeof e.terminal.entrenoId!=='string'))) return failure('INVALID_RECEIPT',{uncertain:true});
        return {ok:true,envelope:{...e,schemaReady:true}};
      } catch(error){return failure('NETWORK_ERROR',{uncertain:true});}
    }
    return {ready,state:(o,b,id)=>call(o,b,'v48_estado',{p_sesion:id}),
      finish:(o,b,p,revision)=>call(o,b,'v48_finalizar',{p_revision:revision,...p}),
      cancel:(o,b,id,revision)=>call(o,b,'v48_cancelar',{p_revision:revision,p_sesion:id}),
      remove:(o,b,id)=>call(o,b,'v48_eliminar',{p_sesion:id})};
  }
  function sameSession(a,b){
    if(!a || !b) return a===b;
    // Excluye UI y cierre locales, nunca el snapshot ni las series remotas.
    const select=s=>({schemaVersion:s.schemaVersion,sessionId:s.sessionId,slot:s.slot,dayId:s.dayId,dayNombre:s.dayNombre,
      startedAt:s.startedAt,timezone:s.timezone,day:s.day,sets:s.sets,references:s.references});
    return P.equal(select(a),select(b));
  }
  function mergeRoutine(row,envelope){
    const draft=copy(envelope.data);
    for(const key of Object.keys(row.draft)){
      if(['sesionActiva','referenciasEjercicios','__v48StartRequest','__v48TerminalRequest'].includes(key)) continue;
      if(P.equal(row.draft[key],row.base.data[key])) continue;
      if(!slots.includes(key)) throw Error('UNSYNCED_PROTECTED_DATA');
      if(!P.equal(row.base.data[key],envelope.data[key]) && !P.equal(row.draft[key],envelope.data[key])) throw Error('ROUTINE_CONFLICT');
      draft[key]=copy(row.draft[key]);
    }
    return draft;
  }
  function createController({cache,adapter,current,identity=()=>0,canonical=x=>x}){
    const flights=new Map();
    async function run(owner,base,action,id,online,epoch){
      const valid=()=>current(owner) && identity()===epoch;
      if(!valid()) return failure('ACCOUNT_CHANGED');
      if(!adapter.ready(base)) return failure('V48_NOT_READY');
      let row;
      try {
        row=await cache.get(owner);
        if(!row || (await cache.conflicts(owner)).length) return failure('LOCAL_CONFLICT');
        const local=row.draft.sesionActiva;
        if(action==='finish' && (!local || local.sessionId!==id)) return failure('SESSION_NOT_LOCAL');
        if(action==='accept' && (!N.isNative(local) || local.sessionId!==id)) return failure('SESSION_NOT_LOCAL');
        if(action==='cancel' && (!N.isNative(local) || local.sessionId!==id || L.pending(local))) return failure('CANCEL_NOT_ALLOWED');
        if(action==='remove' && local) return failure('ACTIVE_LOCAL_SESSION');
        const request=row.draft.__v48TerminalRequest;
        if(request && (request.action!==action || request.sessionId!==id) && action!=='accept') return failure('OPERATION_IN_PROGRESS');
        const packet=action==='finish'?payload(local,canonical):null;
        if(action!=='finish' && (!request || (action==='accept' && request.action!=='accept'))){
          if(!valid()) return failure('ACCOUNT_CHANGED');
          row=await cache.put({...row,draft:{...copy(row.draft),__v48TerminalRequest:{action,sessionId:id}},pending:true,updatedAt:Date.now()},row.localVersion);
          if(row.conflict) return failure('LOCAL_CONFLICT');
        }
        if(!online) return failure('OFFLINE_PENDING');
        let result=await adapter.state(owner,base,id);
        if(!valid()) return failure('ACCOUNT_CHANGED');
        if(!result.ok) return result;
        const remote=result.envelope,terminal=remote.terminal,active=remote.data.sesionActiva;
        if(action==='finish' && terminal && terminal.estado!=='finalizada') return failure('REMOTE_'+terminal.estado.toUpperCase(),{terminal});
        if(action==='cancel' && terminal && terminal.estado!=='cancelada') return failure('REMOTE_'+terminal.estado.toUpperCase(),{terminal});
        if(action==='accept' && !terminal) return failure('SESSION_NOT_TERMINAL');
        if(action==='remove' && !terminal) return failure('SESSION_NOT_TERMINAL');
        if(action==='remove' && terminal.estado==='cancelada') return failure('REMOTE_CANCELADA',{terminal});
        if(!terminal){
          if(!active || active.sessionId!==id) return failure('SESSION_NOT_ACTIVE');
          if(!sameSession(row.base.data.sesionActiva,active)) return failure('REVISION_CONFLICT');
        }
        // No descartar rutinas editadas localmente ni cambios paralelos de otro dispositivo.
        mergeRoutine(row,remote);
        const latest=await cache.get(owner);
        if(!valid()) return failure('ACCOUNT_CHANGED');
        if(!latest || latest.localVersion!==row.localVersion || (await cache.conflicts(owner)).length) return failure('LOCAL_CONFLICT');
        if(action==='finish'){
          // También con comprobante finalizada: la RPC valida el hash del payload
          // y distingue un cierre distinto de otro dispositivo de un reintento propio.
          result=await adapter.finish(owner,base,packet,remote.revision);
        } else if(action==='cancel' && !terminal) result=await adapter.cancel(owner,base,id,remote.revision);
        else if(action==='remove' && terminal.estado==='finalizada') result=await adapter.remove(owner,base,id);
        if(!valid()) return failure('ACCOUNT_CHANGED');
        if(!result.ok) return result;
        const e=result.envelope,t=e.terminal,expected=action==='accept'?terminal.estado:{finish:'finalizada',cancel:'cancelada',remove:'eliminada'}[action];
        if(!t || t.sessionId!==id || t.estado!==expected || (e.data.sesionActiva && e.data.sesionActiva.sessionId===id)) return failure('TERMINAL_NOT_CONFIRMED',{uncertain:true});
        const draft=mergeRoutine(row,e),saved=await cache.put({version:1,ownerId:owner,base:copy(e),draft,
          pending:!P.equal(draft,e.data),updatedAt:Date.now()},row.localVersion);
        if(!valid()) return failure('ACCOUNT_CHANGED');
        if(saved.conflict) return failure('LOCAL_CONFLICT',{terminal:t});
        return {ok:true,resolved:action==='accept',envelope:e,terminal:t,routinePending:!P.equal(draft,e.data)};
      } catch(error){return failure(error.message==='ROUTINE_CONFLICT' || error.message==='UNSYNCED_PROTECTED_DATA' || error.message==='INVALID_CLOSE'
          || error.message==='INVALID_PENDING_SESSION' || error.message==='INVALID_SETS' || error.message==='INVALID_COMPLETED_SET'
          || error.message==='REFERENCE_DECISION_REQUIRED' || error.message==='CONFLICTING_EXERCISE_REFERENCES'?error.message:'LOCAL_STORAGE_ERROR');}
    }
    function perform(action,owner,base,id,online){
      const key=action+':'+id,previous=flights.get(owner);
      if(previous) return previous.key===key?previous.task:Promise.resolve(failure('OPERATION_IN_PROGRESS'));
      const task=run(owner,base,action,id,online,identity()).finally(()=>flights.delete(owner));
      flights.set(owner,{key,task});return task;
    }
    return {finish:(o,b,id,on)=>perform('finish',o,b,id,on),cancel:(o,b,id,on)=>perform('cancel',o,b,id,on),remove:(o,b,id,on)=>perform('remove',o,b,id,on),
      acceptTerminal:(o,b,id,on,confirmed)=>confirmed===true?perform('accept',o,b,id,on):Promise.resolve(failure('CONFIRMATION_REQUIRED')),
      async recover(owner,base,online){
        if(!adapter.ready(base)) return failure('V48_NOT_READY');
        const row=await cache.get(owner),s=row && row.draft.sesionActiva,request=row && row.draft.__v48TerminalRequest;
        if(request && ['cancel','remove','accept'].includes(request.action)) return perform(request.action,owner,base,request.sessionId,online);
        return s && L.pending(s)?perform('finish',owner,base,s.sessionId,online):{ok:true,unchanged:true};
      }};
  }
  root.VodaFitReconcile=Object.freeze({payload,sameSession,mergeRoutine,createAdapter,createController});
})(window);
