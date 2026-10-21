/* V48.1A: infraestructura sin activación ni cambios del entrenamiento.
   Si cambia este módulo, actualizar su query de versión en index.html y sw.js. */
(function(root){
  'use strict';
  const clone = value => JSON.parse(JSON.stringify(value));
  function stable(value){
    if(Array.isArray(value)) return value.map(stable);
    if(value && typeof value==='object') return Object.keys(value).sort().reduce((out,key)=>{ out[key]=stable(value[key]); return out; },Object.create(null));
    return value;
  }
  const equal = (a,b) => JSON.stringify(stable(a))===JSON.stringify(stable(b));
  const failure = (code,error) => ({ok:false,code,error:error || {code}});
  // Cambiar solo en una entrega posterior, después de instalar/probar el SQL.
  // No se habilita por usuario, URL, localStorage ni detección mediante errores.
  // Candidata V48: publicar SÓLO después de instalar/verificar el paquete SQL.
  // Las capacidades no activan cuentas: cliente_v48 sigue siendo por usuario.
  const capabilities = Object.freeze({metadata:true,rpc:true});

  function createRepository(getClient,caps=capabilities){
    async function read(userId){
      const fields = caps.metadata ? 'data,revision,cliente_v48' : 'data';
      const {data,error} = await getClient().from('rutinas').select(fields).eq('profile_id',userId).maybeSingle();
      if(error) throw error;
      const revision = caps.metadata ? (data ? data.revision : 0) : null;
      if(caps.metadata && (!Number.isSafeInteger(revision) || revision<0 || (data && typeof data.cliente_v48!=='boolean')))
        throw Object.assign(new Error('Metadatos de rutina inválidos'),{code:'INVALID_METADATA'});
      return {data:clone(data && data.data ? data.data : {days:[]}),revision,
        clienteV48:!!(caps.metadata && data && data.cliente_v48),schemaReady:!!caps.metadata};
    }
    async function write(userId,data,base,isCurrent=()=>true){
      try {
        if(!isCurrent()) return failure('ACCOUNT_CHANGED');
        if(!base) return failure('NOT_LOADED');
        if(data.sesionActiva && data.sesionActiva.schemaVersion===48 && !base.clienteV48)
          return failure('V48_SESSION_NOT_READY');
        if(base.clienteV48){
          if(!caps.metadata || !caps.rpc) return failure('V48_NOT_READY');
          // Este bloque solo permite preparar CAS de rutina, no inicio/cierre/referencias.
          if(!equal(data.sesionActiva || null,base.data.sesionActiva || null)) return failure('V48_SESSION_NOT_READY');
          const patch = {};
          ['personalizada','automatica','enfocada','activeSlot'].forEach(k=>{ if(k in data) patch[k]=data[k]; });
          const {data:result,error} = await getClient().rpc('v48_guardar_rutina',{p_revision:base.revision,p_patch:patch});
          if(error) return failure(error.code==='40001' ? 'REVISION_CONFLICT' : 'REMOTE_ERROR',error);
          if(!result || !Number.isSafeInteger(result.revision) || !result.data) return failure('INVALID_RESPONSE');
          return {ok:true,envelope:{data:clone(result.data),revision:result.revision,clienteV48:true,schemaReady:true}};
        }
        // V47 no dispone de CAS atómico. Detectar cambios conocidos antes de upsert.
        // Queda una ventana entre lectura y escritura hasta instalar SQL; no simular CAS.
        const remote = await read(userId);
        if(!isCurrent()) return failure('ACCOUNT_CHANGED');
        if(remote.clienteV48 || !equal(remote.data,base.data) || remote.revision!==base.revision)
          return failure('REVISION_CONFLICT');
        const {error} = await getClient().from('rutinas').upsert({profile_id:userId,data}, {onConflict:'profile_id'});
        if(error) return failure(error.code==='40001' ? 'REVISION_CONFLICT' : 'REMOTE_ERROR',error);
        // Con el trigger instalado la revisión cambia en servidor: releer, no adivinarla.
        if(caps.metadata){
          const latest = await read(userId);
          if(!equal(latest.data,data)) return failure('REVISION_CONFLICT');
          return {ok:true,envelope:latest};
        }
        return {ok:true,envelope:{...base,data:clone(data)}};
      } catch(error){ return failure('NETWORK_ERROR',error); }
    }
    return {read,write};
  }

  function createCache(factory,name='vodafit-rutina-drafts'){
    if(factory===undefined){try {factory=root.indexedDB;} catch(error){factory=null;}}
    let opening;
    function open(){
      if(!factory) return Promise.reject(new Error('IndexedDB no disponible'));
      if(!opening) opening = new Promise((resolve,reject)=>{
        let abandoned=false;
        const request=factory.open(name,1);
        request.onupgradeneeded=()=>{
          const db=request.result;
          db.createObjectStore('drafts',{keyPath:'ownerId'});
          db.createObjectStore('conflicts',{keyPath:'id'}).createIndex('ownerId','ownerId');
        };
        request.onerror=()=>{ opening=null; reject(request.error); };
        request.onblocked=()=>{ abandoned=true; opening=null; reject(new Error('IndexedDB bloqueado')); };
        request.onsuccess=()=>{
          if(abandoned){request.result.close();return;}
          request.result.onversionchange=()=>{request.result.close();opening=null;}; resolve(request.result);
        };
      });
      return opening;
    }
    async function get(ownerId){
      const db=await open();
      return new Promise((resolve,reject)=>{
        const tx=db.transaction('drafts','readonly'); let row;
        const request=tx.objectStore('drafts').get(ownerId);
        request.onsuccess=()=>{row=request.result;};
        tx.oncomplete=()=>{
          if(row && (row.ownerId!==ownerId || row.version!==1 || !Number.isSafeInteger(row.localVersion)
            || !row.base || !row.base.data || !row.draft || typeof row.pending!=='boolean'))
            return reject(new Error('Borrador local incompatible; se conserva sin modificar'));
          resolve(row || null);
        };
        tx.onerror=tx.onabort=()=>reject(tx.error || new Error('Lectura local fallida'));
      });
    }
    async function put(row,expectedVersion){
      const db=await open();
      return new Promise((resolve,reject)=>{
        const tx=db.transaction(['drafts','conflicts'],'readwrite'); let result;
        const store=tx.objectStore('drafts'), req=store.get(row.ownerId);
        req.onsuccess=()=>{
          const current=req.result, version=current ? current.localVersion : 0;
          if(version!==expectedVersion){
            tx.objectStore('conflicts').put({...clone(row),id:root.crypto.randomUUID()});
            result={conflict:true,backupSaved:true,localVersion:version};
          } else {
            result={...clone(row),version:1,localVersion:version+1}; store.put(result);
          }
        };
        tx.oncomplete=()=>resolve(result);
        tx.onerror=tx.onabort=()=>reject(tx.error || new Error('Guardado local fallido'));
      });
    }
    async function conflicts(ownerId){
      const db=await open();
      return new Promise((resolve,reject)=>{
        const tx=db.transaction('conflicts','readonly'); let rows;
        const req=tx.objectStore('conflicts').index('ownerId').getAll(ownerId);
        req.onsuccess=()=>{rows=req.result;}; tx.oncomplete=()=>resolve(rows);
        tx.onerror=tx.onabort=()=>reject(tx.error || new Error('No se pudieron leer las copias en conflicto'));
      });
    }
    return {get,put,conflicts};
  }

  function createSync(repository,cache){
    let active=null, tail=Promise.resolve();
    function detach(){ active=null; tail=Promise.resolve(); }
    function current(ctx){ return active===ctx; }
    async function load(ownerId){
      const ctx={ownerId,base:null,localVersion:0,blocked:null}; active=ctx; tail=Promise.resolve();
      let local,localError,branches=[];
      try {local=await cache.get(ownerId); if(cache.conflicts) branches=await cache.conflicts(ownerId);} catch(e){localError=e;}
      if(!current(ctx)) return failure('ACCOUNT_CHANGED');
      ctx.localVersion=local ? local.localVersion : 0;
      let remote;
      try {remote=await repository.read(ownerId);} catch(error){
        if(!current(ctx)) return failure('ACCOUNT_CHANGED');
        if(!local) throw error;
        ctx.base=clone(local.base);
        if(branches.length) ctx.blocked='LOCAL_CONFLICT';
        return {ok:true,...clone(local.base),data:clone(local.draft),offline:true,pending:true,localError};
      }
      if(!current(ctx)) return failure('ACCOUNT_CHANGED');
      ctx.base=clone(remote);
      if(branches.length){
        ctx.blocked='LOCAL_CONFLICT';
        return {ok:true,...remote,conflict:true,localDrafts:clone(branches),localError};
      }
      if(local && local.pending && !equal(local.draft,remote.data)){
        if(equal(local.base.data,remote.data) && local.base.revision===remote.revision && local.base.clienteV48===remote.clienteV48)
          return {ok:true,...remote,data:clone(local.draft),pending:true,recovered:true,localError};
        ctx.blocked='REVISION_CONFLICT';
        return {ok:true,...remote,conflict:true,localDraft:clone(local.draft),localError};
      }
      return {ok:true,...remote,localError};
    }
    function save(data){
      const ctx=active, snapshot=clone(data);
      const task=async()=>{
        if(!ctx || !ctx.base) return failure('NOT_LOADED');
        let localSaved=false,localError;
        const row={version:1,ownerId:ctx.ownerId,base:clone(ctx.base),draft:snapshot,pending:true,updatedAt:Date.now()};
        try {
          // Si ya hay conflicto, guardar otra variante sin reemplazar el borrador
          // que lo originó (la UI puede estar mostrando la copia remota).
          const result=await cache.put(row,ctx.blocked ? -1 : ctx.localVersion);
          if(result.conflict){ ctx.blocked=ctx.blocked || 'LOCAL_CONFLICT'; return {...failure(ctx.blocked),localSaved:result.backupSaved}; }
          ctx.localVersion=result.localVersion; localSaved=true;
        } catch(e){localError=e;}
        if(!current(ctx)) return {...failure('ACCOUNT_CHANGED'),localSaved};
        if(ctx.blocked) return {...failure(ctx.blocked),localSaved,localError};
        const result=await repository.write(ctx.ownerId,snapshot,ctx.base,()=>current(ctx));
        if(!current(ctx)) return {...failure('ACCOUNT_CHANGED'),localSaved};
        if(!result.ok){
          if(result.code==='REVISION_CONFLICT') ctx.blocked=result.code;
          return {...result,localSaved,localError};
        }
        ctx.base=clone(result.envelope);
        if(localSaved){
          try {
            const ack=await cache.put({...row,base:clone(ctx.base),draft:clone(ctx.base.data),pending:false},ctx.localVersion);
            if(ack.conflict) ctx.blocked='LOCAL_CONFLICT'; else ctx.localVersion=ack.localVersion;
          } catch(e){localError=e;}
        }
        return {ok:true,envelope:clone(ctx.base),localSaved,localError,conflict:ctx.blocked};
      };
      const result=tail.then(task,task); tail=result.catch(()=>{}); return result;
    }
    return {load,save,detach,getContext:()=>active ? clone(active) : null};
  }

  function createSessionDraft(day,{sessionId=root.crypto.randomUUID(),slot,startedAt=Date.now(),timezone=Intl.DateTimeFormat().resolvedOptions().timeZone}={}){
    const snapshot=clone(day);
    return {schemaVersion:48,sessionId,slot,dayId:snapshot.id,dayNombre:snapshot.nombre,
      startedAt,timezone,day:snapshot,references:{},sets:(snapshot.exercises||[]).flatMap(ex=>
        Array.from({length:Math.max(1,Math.min(12,parseInt(ex.series,10)||1))},(_,i)=>
          ({exerciseInstance:ex.id,setNumber:i+1,peso:null,reps:null,completed:false})))};
  }
  root.VodaFitPersistence=Object.freeze({capabilities,createRepository,createCache,createSync,createSessionDraft,equal});
})(window);
