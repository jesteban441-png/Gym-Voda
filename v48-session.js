/* V48.1B: modelo y edición inline del borrador nativo. Sin escrituras definitivas. */
(function(root){
  'use strict';
  const P=root.VodaFitPersistence;
  const copy=x=>JSON.parse(JSON.stringify(x));
  const esc=x=>String(x==null?'':x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function isNative(s){
    if(!(s && s.schemaVersion===48 && typeof s.sessionId==='string' && s.sessionId && s.day && Array.isArray(s.day.exercises) && Array.isArray(s.sets))) return false;
    const ids=s.day.exercises.map(ex=>ex && ex.id),seen=new Set();
    if(new Set(ids).size!==ids.length || s.day.exercises.some(ex=>!ex || typeof ex.id!=='string' || !ex.id || typeof ex.nombre!=='string')) return false;
    return s.sets.every(row=>{
      if(!row || !ids.includes(row.exerciseInstance) || !Number.isInteger(row.setNumber) || row.setNumber<1 || row.setNumber>12 || typeof row.completed!=='boolean') return false;
      const k=key(row);if(seen.has(k)) return false;seen.add(k);return true;
    });
  }
  function rows(s,id){return s.sets.filter(x=>x.exerciseInstance===id).sort((a,b)=>a.setNumber-b.setNumber);}
  function weight(raw){
    const text=String(raw==null?'':raw).trim();
    if(!/^(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(text)) return null;
    const n=Number(text.replace(',','.'));return Number.isFinite(n) && n>=0 ? n : null;
  }
  function reps(raw){
    const text=String(raw==null?'':raw).trim();
    if(!/^[1-9]\d*$/.test(text)) return null;
    const n=Number(text);return Number.isSafeInteger(n) && n<=2147483647 ? n : null;
  }
  function valid(row){return typeof row.peso==='number' && Number.isFinite(row.peso) && row.peso>=0 && Number.isInteger(row.reps) && row.reps>0 && row.reps<=2147483647;}
  function completed(s,id){return rows(s,id).filter(r=>r.completed && valid(r)).map(({setNumber,peso,reps})=>({setNumber,peso,reps}));}
  function progress(s){return {total:s.sets.length,done:s.sets.filter(r=>r.completed && valid(r)).length};}
  function ui(s){
    if(!s.ui) s.ui={};
    if(!s.ui.inputs) s.ui.inputs={};
    if(!s.ui.errors) s.ui.errors={};
    if(!s.ui.invalidated) s.ui.invalidated={};
    if(!s.references) s.references={};
    return s.ui;
  }
  const key=row=>JSON.stringify([row.exerciseInstance,row.setNumber]);
  const decision=(s,id)=>s.references && Object.prototype.hasOwnProperty.call(s.references,id) ? s.references[id] : null;
  function invalidate(s,id){
    if(decision(s,id) && !P.equal(decision(s,id).sets,completed(s,id))){
      delete s.references[id];Object.defineProperty(ui(s).invalidated,id,{value:true,writable:true,enumerable:true,configurable:true});
    }
  }
  function edit(s,id,number,field,text){
    if(field!=='peso' && field!=='reps') return false;
    const row=rows(s,id).find(r=>r.setNumber===number);if(!row) return false;
    const info=ui(s),k=key(row);
    if(!info.inputs[k]) info.inputs[k]={};
    info.inputs[k][field]=String(text);
    row[field]=field==='peso' ? weight(text) : reps(text);
    if(row.completed && !valid(row)){row.completed=false;info.errors[k]='Ingresá peso y repeticiones válidos antes de completar.';}
    else if(valid(row)) delete info.errors[k];
    invalidate(s,id);return true;
  }
  function toggle(s,id,number,checked){
    const row=rows(s,id).find(r=>r.setNumber===number);if(!row) return false;
    const info=ui(s),k=key(row);
    if(checked && !valid(row)){info.errors[k]='Ingresá un peso de 0 kg o mayor y repeticiones enteras positivas.';return false;}
    row.completed=!!checked;delete info.errors[k];invalidate(s,id);return true;
  }
  function decide(s,id,accepted,snapshot=completed(s,id)){
    if(!snapshot.length || !P.equal(snapshot,completed(s,id))) return false;
    ui(s);Object.defineProperty(s.references,id,{value:{accepted:!!accepted,sets:copy(snapshot)},writable:true,enumerable:true,configurable:true});
    delete s.ui.invalidated[id];return true;
  }
  function reference(map,name,canonical){
    const target=canonical(name);let selected=null;
    Object.keys(map || {}).forEach(k=>{
      const candidate=map[k];
      if(canonical(k)!==target || !candidate || !Array.isArray(candidate.series)) return;
      if(!selected || Number(candidate.updatedAt || 0)>Number(selected.updatedAt || 0)) selected=candidate;
    });
    return selected;
  }
  function raw(s,row,field){
    const saved=s.ui && s.ui.inputs && s.ui.inputs[key(row)];
    return saved && Object.prototype.hasOwnProperty.call(saved,field) ? saved[field] : row[field]==null ? '' : String(row[field]);
  }
  function message(s,id){
    const choice=decision(s,id);
    if(choice) return choice.accepted ? 'Referencia propuesta. Se confirma al finalizar el entrenamiento.' : 'Referencia anterior conservada. Tus series realizadas siguen en el borrador.';
    if(s.ui && s.ui.invalidated && Object.prototype.hasOwnProperty.call(s.ui.invalidated,id)) return 'Cambiaste las series. Volvé a terminar el ejercicio para elegir la referencia.';
    return 'Terminá el ejercicio para decidir si actualizás su referencia.';
  }
  function html(s,referenceMap,canonical){
    return `<div class="card native-note"><b>Borrador del entrenamiento</b>${s.slot==='especial'?'<p class="helptext"><span class="special-badge">Día Especial</span> No suma al objetivo semanal.</p>':''}<p class="helptext">Solo las series marcadas se consideran completadas. El cierre definitivo estará disponible en V48.1C.</p><p class="helptext" data-native-save-status role="status">Los cambios se conservan en este dispositivo.</p></div>`+
      s.day.exercises.map(ex=>{
        const ref=reference(referenceMap,ex.nombre,canonical);
        return `<section class="card stack native-exercise" data-native-card="${esc(ex.id)}" aria-label="${esc(ex.nombre)}">
          <div class="row between"><h3>${esc(canonical(ex.nombre))}</h3><span class="badge" data-native-count="${esc(ex.id)}"></span></div>
          <p class="helptext">${esc(ex.series)} series × ${esc(ex.reps)} reps planificadas</p>
          <div class="native-grid native-labels" aria-hidden="true"><span>Serie</span><span>Peso · kg</span><span>Reps</span><span>Hecha</span></div>
          ${rows(s,ex.id).map(row=>{
            const previous=ref && ref.series.find(x=>x.setNumber===row.setNumber);
            return `<div class="native-set" data-native-row="${esc(ex.id)}" data-number="${row.setNumber}">
              <div class="native-grid"><b class="num">${row.setNumber}</b>
                <input type="text" inputmode="decimal" autocomplete="off" data-native-field="peso" value="${esc(raw(s,row,'peso'))}" placeholder="0" aria-label="Peso de serie ${row.setNumber} de ${esc(ex.nombre)}">
                <input type="text" inputmode="numeric" autocomplete="off" data-native-field="reps" value="${esc(raw(s,row,'reps'))}" placeholder="Reps" aria-label="Repeticiones de serie ${row.setNumber} de ${esc(ex.nombre)}">
                <label class="native-check"><input type="checkbox" data-native-check ${row.completed && valid(row)?'checked':''} aria-label="Completar serie ${row.setNumber} de ${esc(ex.nombre)}"></label>
              </div>
              <div class="helptext native-reference">${previous ? `Referencia guardada: ${esc(previous.peso)} kg × ${esc(previous.reps)}` : 'Sin referencia guardada para esta serie'}</div>
              <div class="native-error" data-native-error role="status"></div>
            </div>`;
          }).join('')}
          <p class="helptext" data-native-decision="${esc(ex.id)}">${esc(message(s,ex.id))}</p>
          <div class="row"><button class="btn btn-outline btn-sm" data-native-info="${esc(ex.id)}">Cómo hacerlo</button><button class="btn btn-outline btn-sm" data-native-rest>Descansar</button></div>
          <button class="btn btn-primary btn-block" data-native-finish="${esc(ex.id)}">Terminar ejercicio</button>
        </section>`;
      }).join('');
  }
  function bind(container,s,{onChange,onFinish,onRest,onInfo}){
    function refresh(){
      s.day.exercises.forEach(ex=>invalidate(s,ex.id));
      container.querySelectorAll('[data-native-row]').forEach(el=>{
        const row=rows(s,el.dataset.nativeRow).find(r=>r.setNumber===Number(el.dataset.number));
        el.querySelector('[data-native-check]').checked=!!(row.completed && valid(row));
        const error=s.ui && s.ui.errors && s.ui.errors[key(row)];
        el.querySelector('[data-native-error]').textContent=error || '';
        el.querySelectorAll('[data-native-field]').forEach(input=>input.setAttribute('aria-invalid',error && (input.dataset.nativeField==='peso' ? weight(raw(s,row,'peso')) : reps(raw(s,row,'reps')))===null ? 'true' : 'false'));
      });
      s.day.exercises.forEach(ex=>{
        const card=Array.from(container.querySelectorAll('[data-native-card]')).find(x=>x.dataset.nativeCard===ex.id);
        const done=completed(s,ex.id).length;
        card.querySelector('[data-native-count]').textContent=`${done}/${rows(s,ex.id).length}`;
        card.querySelector('[data-native-decision]').textContent=message(s,ex.id);
        card.querySelector('[data-native-finish]').disabled=done===0;
      });
    }
    container.querySelectorAll('[data-native-row]').forEach(el=>{
      const id=el.dataset.nativeRow,number=Number(el.dataset.number);
      el.querySelectorAll('[data-native-field]').forEach(input=>input.oninput=()=>{edit(s,id,number,input.dataset.nativeField,input.value);refresh();onChange();});
      el.querySelector('[data-native-check]').onchange=event=>{toggle(s,id,number,event.target.checked);refresh();onChange();};
    });
    container.querySelectorAll('[data-native-finish]').forEach(button=>button.onclick=()=>onFinish(button.dataset.nativeFinish));
    container.querySelectorAll('[data-native-rest]').forEach(button=>button.onclick=onRest);
    container.querySelectorAll('[data-native-info]').forEach(button=>button.onclick=()=>onInfo(button.dataset.nativeInfo));
    refresh();return refresh;
  }
  // Inicio nuevo: nunca local/offline. La reserva se conecta únicamente cuando
  // exista infraestructura desplegada y cuenta ya activada, no activa la cuenta.
  async function requestStart({online,ready,reserve,args}){
    if(!online) return {ok:false,code:'ONLINE_REQUIRED'};
    if(!ready) return {ok:false,code:'V48_NOT_READY'};
    try {return await reserve(args);} catch(error){return {ok:false,code:'NETWORK_ERROR',error};}
  }
  root.VodaFitSession=Object.freeze({isNative,rows,weight,reps,valid,completed,progress,edit,toggle,decide,reference,html,bind,requestStart});
})(window);
