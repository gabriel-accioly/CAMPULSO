/* CAMPULSO R02 — modelo isolado de demonstração. Não é o motor do MVP. */
export const model = (function () {
  'use strict';
  const local = new URLSearchParams(location.search).get('scenario') === 'local';
  const now = new Date();
  const TODAY = local ? [now.getFullYear(), String(now.getMonth()+1).padStart(2,'0'), String(now.getDate()).padStart(2,'0')].join('-') : '2026-11-23';
  const clone = value => JSON.parse(JSON.stringify(value));
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function validDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
    const d = new Date(value + 'T12:00:00Z');
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
  }
  function minutes(value) {
    if (!/^\d{2}:\d{2}$/.test(value || '')) return NaN;
    const [h, m] = value.split(':').map(Number);
    return h < 24 && m < 60 ? h * 60 + m : NaN;
  }
  const time = value => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
  const overlaps = (a, b) => a.start < b.end && b.start < a.end;
  function addDays(date, n) {
    const d = new Date(date + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function formatDate(date, full = false) {
    if (!validDate(date)) return 'Sem prazo';
    return new Intl.DateTimeFormat('pt-BR', {day:'2-digit',month:full?'long':'2-digit',year:'numeric',timeZone:'UTC'}).format(new Date(date + 'T12:00:00Z'));
  }
  function duration(value) {
    const h = Math.floor(value / 60), m = value % 60;
    return h ? `${h}h${m ? String(m).padStart(2, '0') : ''}` : `${m} min`;
  }
  function createState(scenario = 'planned') {
    if (!['planned','empty','overloaded'].includes(scenario)) scenario = 'planned';
    const state = {scenario, revision:1, nextId:10, tasks:[], commitments:[], availability:[], blocks:[], lightMode:false};
    if (scenario === 'empty') return state;
    state.tasks = [
      {id:'t1',title:'Finalizar resenha do artigo',course:'Metodologia Científica',duration:40,due:TODAY,done:false},
      {id:'t2',title:'Revisar referências do projeto',course:'Projeto Integrador',duration:25,due:addDays(TODAY,1),done:false},
      {id:'t3',title:'Preparar roteiro da apresentação',course:'Comunicação e Sociedade',duration:30,due:addDays(TODAY,2),done:false},
      {id:'t4',title:'Ler o capítulo indicado',course:'Fundamentos de Pesquisa',duration:35,due:addDays(TODAY,4),done:false}
    ];
    state.commitments = [
      {id:'c1',title:'Aula de Metodologia Científica',course:'Metodologia Científica',date:TODAY,start:540,end:630},
      {id:'c2',title:'Encontro do grupo de projeto',course:'Projeto Integrador',date:TODAY,start:660,end:720}
    ];
    state.availability = [{date:TODAY,start:840,end:scenario==='overloaded'?870:960}];
    if (scenario === 'overloaded') {
      state.tasks[1].due = TODAY;
      state.tasks[2].due = TODAY;
      state.tasks[3].due = addDays(TODAY,1);
    }
    state.blocks = buildProposal(state, false).blocks;
    return state;
  }
  function availableIntervals(state, date = TODAY) {
    let free = state.availability.filter(w => w.date === date).map(w => ({start:w.start,end:w.end}));
    for (const event of state.commitments.filter(e => e.date === date)) {
      free = free.flatMap(w => !overlaps(w,event) ? [w] : [
        ...(event.start > w.start ? [{start:w.start,end:Math.min(w.end,event.start)}] : []),
        ...(event.end < w.end ? [{start:Math.max(w.start,event.end),end:w.end}] : [])
      ]);
    }
    return free.sort((a,b)=>a.start-b.start);
  }
  function stats(state, date = TODAY) {
    const open = state.tasks.filter(t=>!t.done);
    const capacity = availableIntervals(state,date).reduce((s,w)=>s+w.end-w.start,0);
    const scheduled = state.blocks.filter(b=>b.date===date && open.some(t=>t.id===b.taskId));
    const planned = scheduled.reduce((s,b)=>s+b.end-b.start,0);
    const critical = open.filter(t=>t.due && t.due<=date);
    return {open:open.length,commitments:state.commitments.filter(e=>e.date===date).length,capacity,planned,free:Math.max(0,capacity-planned),critical:critical.length,criticalMinutes:critical.reduce((s,t)=>s+t.duration,0)};
  }
  function validateTitle(input) {
    const title = String(input.title ?? '').trim();
    if (!title || title.length > 160) throw new Error('Informe um título de até 160 caracteres.');
    const course = String(input.course ?? '').trim();
    if (course.length > 100) throw new Error('Use até 100 caracteres para a disciplina.');
    const estimate = Number(input.duration);
    if (!Number.isInteger(estimate) || estimate < 1 || estimate > 480) throw new Error('Informe uma duração inteira entre 1 e 480 minutos.');
    return {title,course,duration:estimate};
  }
  function upsertTask(state, input, id) {
    const values = validateTitle(input);
    const due = String(input.due || '');
    if (due && !validDate(due)) throw new Error('Informe um prazo válido ou deixe o campo vazio.');
    const next = clone(state);
    if (id) {
      const index = next.tasks.findIndex(t=>t.id===id);
      if (index < 0) throw new Error('A tarefa não está mais disponível.');
      if (next.tasks[index].duration !== values.duration) next.blocks = next.blocks.filter(b=>b.taskId!==id);
      next.tasks[index] = {...next.tasks[index], ...values, due};
    } else next.tasks.push({id:local?crypto.randomUUID():'t'+next.nextId++, ...values, due, done:false});
    next.revision++;
    return next;
  }
  function upsertCommitment(state, input, id) {
    const values = validateTitle(input);
    const date = String(input.date || ''), start = minutes(input.time), end = start + values.duration;
    if (!validDate(date)) throw new Error('Informe a data do compromisso.');
    if (!Number.isFinite(start)) throw new Error('Informe o horário de início.');
    if (end > 1440) throw new Error('O compromisso deve terminar no mesmo dia nesta demonstração.');
    if (state.commitments.some(e=>e.id!==id && e.date===date && overlaps({start,end},e))) throw new Error('Esse horário coincide com outro compromisso. Escolha outro horário.');
    const next = clone(state);
    const event = {id:id || (local?crypto.randomUUID():'c'+next.nextId++),title:values.title,course:values.course,date,start,end};
    if (id) {
      const index = next.commitments.findIndex(e=>e.id===id);
      if (index < 0) throw new Error('O compromisso não está mais disponível.');
      next.commitments[index] = event;
    } else next.commitments.push(event);
    next.blocks = next.blocks.filter(b=>b.date!==date || !overlaps(b,event));
    next.revision++;
    return next;
  }
  function toggleTask(state, id) {
    if (!state.tasks.some(t=>t.id===id)) throw new Error('Tarefa não encontrada.');
    const next = clone(state);
    next.tasks.find(t=>t.id===id).done = !next.tasks.find(t=>t.id===id).done;
    next.revision++;
    return next;
  }
  function setAvailability(state, input) {
    const date = String(input.date || ''), start = minutes(input.start), end = minutes(input.end);
    if (!validDate(date)) throw new Error('Informe uma data válida.');
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new Error('O fim da janela precisa ser posterior ao início.');
    if (state.commitments.some(e=>e.date===date && overlaps({start,end},e))) throw new Error('Essa janela coincide com um compromisso fixo. Escolha um horário livre.');
    const next = clone(state);
    next.availability = next.availability.filter(w=>w.date!==date).concat({date,start,end});
    next.blocks = next.blocks.filter(b=>b.date!==date || (b.start>=start && b.end<=end));
    next.revision++;
    return next;
  }
  function buildProposal(state, light = false, date = TODAY) {
    const slots = availableIntervals(state,date).map(clone);
    const capacity = slots.reduce((s,w)=>s+w.end-w.start,0);
    const budget = light ? Math.floor(capacity*.6) : capacity;
    const tasks = state.tasks.filter(t=>!t.done).slice().sort((a,b)=>(a.due || '9999-99-99').localeCompare(b.due || '9999-99-99') || a.id.localeCompare(b.id));
    let used = 0;
    const blocks = [], unscheduled = [];
    for (const task of tasks) {
      const slot = slots.find(w=>w.end-w.start>=task.duration);
      if (slot && used+task.duration<=budget) {
        blocks.push({taskId:task.id,date,start:slot.start,end:slot.start+task.duration});
        slot.start += task.duration;
        used += task.duration;
      } else unscheduled.push({taskId:task.id,reason:capacity===0?'Nenhum horário livre informado.':light?'Fora do limite desta proposta mais leve.':'Não cabe na disponibilidade deste dia.'});
    }
    return {sourceRevision:state.revision,date,light,capacity,budget,used,blocks,unscheduled};
  }
  function canApplyProposal(state, proposal) {
    if (!proposal || proposal.sourceRevision !== state.revision) return false;
    const leavingLightMode = state.lightMode && !proposal.light;
    return leavingLightMode || (proposal.capacity > 0 && state.tasks.some(t=>!t.done));
  }
  function applyProposal(state, proposal) {
    if (!proposal || proposal.sourceRevision !== state.revision) throw new Error('Os dados mudaram. Gere uma nova prévia antes de aplicar.');
    if (!canApplyProposal(state, proposal)) throw new Error('Não há tarefas abertas ou disponibilidade para aplicar esta proposta.');
    const next = clone(state);
    next.blocks = next.blocks.filter(b=>b.date!==proposal.date).concat(clone(proposal.blocks));
    next.lightMode = proposal.light;
    next.revision++;
    return next;
  }
  function agendaEntries(state, date) {
    return [
      ...state.commitments.filter(e=>e.date===date).map(e=>({...e,type:'commitment'})),
      ...state.blocks.filter(b=>b.date===date).flatMap(b=>{
        const t=state.tasks.find(t=>t.id===b.taskId && !t.done);
        return t?[{...b,id:t.id,title:t.title,course:t.course,due:t.due,type:'block'}]:[];
      })
    ].sort((a,b)=>a.start-b.start || a.id.localeCompare(b.id));
  }
  return {TODAY,clone,escapeHtml,validDate,minutes,time,overlaps,addDays,formatDate,duration,createState,availableIntervals,stats,upsertTask,upsertCommitment,toggleTask,setAvailability,buildProposal,canApplyProposal,applyProposal,agendaEntries};
})();
