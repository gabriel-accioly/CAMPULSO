import {model as M} from './model.js';
import {taskLists} from './TaskList';
/* CAMPULSO UI R02. Todos os dados e alterações existem somente nesta página. */
export function mountR02(initial, persist) {
  'use strict';
  const h = M.escapeHtml;
  const lists = taskLists();
  const names = {today:'Meu dia',agenda:'Agenda',tasks:'Tarefas',subjects:'Disciplinas',availability:'Disponibilidade',preview:'Prévia do planejamento',light:'Modo leve',settings:'Ajustes',data:'Dados e recuperação',restore:'Restaurar dados',help:'Ajuda'};
  const svg = paths => `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
  const I = {
    plus:svg('<path d="M12 5v14M5 12h14"/>'),
    arrow:svg('<path d="M5 12h14m-5-5 5 5-5 5"/>'),
    calendar:svg('<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 11h18"/>'),
    clock:svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
    check:svg('<path d="m5 12 4 4L19 6"/>'),
    moon:svg('<path d="M20.8 13A9 9 0 0 1 11 3.2 9 9 0 1 0 20.8 13Z"/>'),
    close:svg('<path d="m6 6 12 12M18 6 6 18"/>'),
    left:svg('<path d="m14 6-6 6 6 6"/>'),
    right:svg('<path d="m10 6 6 6-6 6"/>')
  };
  let state = initial;
  let writing = false;
  async function publish(next, planDate) {
    if (!persist) {state=next;return;}
    if (writing) throw Error('Aguarde a gravação atual.');
    writing=true;
    try {state=await persist(state,next,planDate);} finally {writing=false;}
  }
  let currentPage = 'today', agendaDate = M.TODAY, agendaView = 'day';
  let taskFilter = 'open', courseFilter = '', proposal = null, restoreExample = '', restoreStage = 0;
  let toastTimer, editorOpener = null, editorFocusDetails = null;
  const editor = document.getElementById('editor');
  editor.classList.add('modal');
  const byId = id => document.getElementById(id);
  const button = (label, action, extra = '', kind = '') => `<button type="button" class="btn ${kind}" data-action="${action}" ${extra}>${label}</button>`;
  const navButton = (label, page, kind = '') => `<button type="button" class="btn ${kind}" data-page="${page}">${label}</button>`;
  function head(page, subtitle, actions = '', eyebrow = '') {
    return `<div class="page-head"><div>${eyebrow?`<div class="eyebrow">${eyebrow}</div>`:''}<h1 id="${page}-title" tabindex="-1">${names[page]}</h1><p class="subhead">${subtitle}</p></div>${actions?`<div class="head-actions">${actions}</div>`:''}</div>`;
  }
  function dateTitle(date) {
    return new Intl.DateTimeFormat('pt-BR',{weekday:'long',day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(date+'T12:00:00Z'));
  }
  function dueLabel(task) {
    if (!task.due) return 'Sem prazo';
    const prefix = task.due === M.TODAY ? 'Hoje' : task.due < M.TODAY ? 'Prazo vencido' : task.due === M.addDays(M.TODAY,1) ? 'Amanhã' : 'Prazo';
    return `${prefix} · ${M.formatDate(task.due)}`;
  }
  function empty(title, detail, action = '') {
    return `<div class="empty-state"><h3>${title}</h3><p>${detail}</p>${action}</div>`;
  }
  function taskRows(tasks) {
    if (!tasks.length) return empty('Nenhuma tarefa nesta lista.', 'Você pode criar uma tarefa sem vinculá-la a uma disciplina.', button(I.plus+' Nova tarefa','new-task'));
    return lists.placeholder({tasks,today:M.TODAY,dueLabel,duration:M.duration});
  }
  function timeline(date) {
    const entries = M.agendaEntries(state,date);
    if (!entries.length) return empty('Este dia está livre de horários.', 'Compromissos e blocos aplicados aparecerão aqui.', button('Adicionar compromisso','new-commitment',`data-date="${date}"`));
    return `<div class="timeline">${entries.map(entry=>`<div class="timeline-item"><div class="time">${M.time(entry.start)}<small>${M.time(entry.end)}</small></div><div class="time-dot" aria-hidden="true"></div><div class="event ${entry.type==='commitment'?'fixed':'flexible'}"><div class="event-meta"><span class="tag ${entry.type==='commitment'?'fixed':'task'}">${entry.type==='commitment'?'Compromisso fixo':'Bloco flexível'}</span><span>${M.duration(entry.end-entry.start)}</span></div><button class="task-title-button event-title" type="button" data-action="${entry.type==='commitment'?'edit-commitment':'edit-task'}" data-id="${entry.id}" data-focus="entry-${entry.id}">${h(entry.title)}</button><div class="event-meta">${h(entry.course || 'Sem disciplina')}${entry.type==='block'?' · '+h(dueLabel(entry)):''}</div></div></div>`).join('')}</div>`;
  }
  function capacityCard() {
    const s=M.stats(state), pct=s.capacity?Math.min(100,s.planned/s.capacity*100):0;
    return `<section class="card"><div class="card-title"><h2>Espaço no seu dia</h2>${I.clock}</div>${s.capacity?`<div class="capacity-value"><strong>${M.duration(s.free)}</strong><span>ainda livres na janela informada</span></div><div class="capacity-bar" aria-hidden="true"><span style="width:${pct}%"></span></div><div class="capacity-caption"><span>${M.duration(s.planned)} em blocos</span><span>${M.duration(s.capacity)} disponíveis</span></div>`:`<p class="subhead">Você ainda não informou um horário livre. Nenhum bloco será sugerido antes disso.</p>`}<div class="card-footer">${navButton(s.capacity?'Ajustar disponibilidade':'Definir disponibilidade','availability','small')}</div></section>`;
  }
  function renderToday() {
    const s=M.stats(state), open=state.tasks.filter(t=>!t.done), urgent=open.filter(t=>t.due).sort((a,b)=>a.due.localeCompare(b.due)).slice(0,3);
    const overload=s.criticalMinutes>s.capacity && s.critical>0;
    return head('today','O que importa agora, com espaço para ajustar.',button(I.plus+' Nova tarefa','new-task','','primary')+button('Rever meu plano '+I.arrow,'preview-normal'),h(dateTitle(M.TODAY)))+
      `<div class="day-summary"><div class="summary-item"><span>Compromissos hoje</span><strong>${s.commitments}</strong><small>Horários que você definiu</small></div><div class="summary-item"><span>Tarefas abertas</span><strong id="task-count">${s.open}</strong><small>${s.critical?`${s.critical} com prazo até hoje`:'Prazos sempre visíveis'}</small></div><div class="summary-item"><span>Disponibilidade informada</span><strong>${s.capacity?M.duration(s.capacity):'Não definida'}</strong><small>${s.capacity?'Para tarefas flexíveis':'Você escolhe seus horários'}</small></div></div>`+
      (overload?`<section class="overload-notice" aria-label="Conflito de capacidade"><strong>Há mais tarefas com prazo próximo do que espaço hoje.</strong><p>${M.duration(s.criticalMinutes)} de tarefas com prazo até hoje para ${M.duration(s.capacity)} disponíveis. Os prazos foram mantidos. Você pode rever a disponibilidade ou manter tarefas sem horário.</p>${navButton('Rever disponibilidade','availability','small')}${button('Revisar proposta','preview-normal','','small')}</section>`:'')+
      `<div class="grid-main"><div class="stack"><section class="card"><div class="card-title"><div><div class="section-kicker">Agenda de hoje</div><h2>Seu dia em sequência</h2></div>${navButton('Ver agenda '+I.arrow,'agenda','small')}</div>${timeline(M.TODAY)}</section><section class="card"><div class="card-title"><div><div class="section-kicker">Uma coisa de cada vez</div><h2>Tarefas e prazos</h2></div>${navButton('Ver todas','tasks','small')}</div>${taskRows(open)}</section></div><aside class="stack" aria-label="Seu planejamento">${capacityCard()}<section class="card focus-card"><div class="mode-icon">${I.moon}</div><div class="section-kicker">Seu ritmo importa</div><h2>${state.lightMode?'Modo leve aplicado':'Precisa de mais espaço?'}</h2><p>O Modo leve reduz os blocos flexíveis. Compromissos e prazos continuam visíveis.</p>${navButton(state.lightMode?'Rever o Modo leve':'Conhecer o Modo leve','light','small')}</section><section class="card"><div class="card-title"><h2>Próximos prazos</h2></div>${urgent.length?`<ul class="compact-list">${urgent.map(t=>`<li><button type="button" class="task-title-button" data-action="edit-task" data-id="${t.id}" data-focus="deadline-${t.id}">${h(t.title)}</button><small>${h(dueLabel(t))}</small></li>`).join('')}</ul>`:'<p class="subhead">Quando você informar um prazo, ele aparecerá aqui.</p>'}<p class="micro-note">Replanejar muda o horário de estudo, nunca a data de entrega.</p></section></aside></div>`;
  }
  function renderAgenda() {
    const weekdays=['Seg','Ter','Qua','Qui','Sex','Sáb','Dom'];
    const dayIndex=(new Date(agendaDate+'T12:00:00Z').getUTCDay()+6)%7;
    const weekStart=M.addDays(agendaDate,-dayIndex);
    const days=Array.from({length:7},(_,i)=>M.addDays(weekStart,i));
    return head('agenda','Compromissos fixos e blocos flexíveis, em uma sequência clara.',button(I.plus+' Novo compromisso','new-commitment',`data-date="${agendaDate}"`,'primary'))+
      `<div class="agenda-toolbar"><div class="date-nav">${button(I.left,'agenda-prev','aria-label="Período anterior"','small')}<strong>${agendaView==='day'?M.formatDate(agendaDate,true):`${M.formatDate(days[0])} — ${M.formatDate(days[6])}`}</strong>${button(I.right,'agenda-next','aria-label="Próximo período"','small')}${button('Dia de exemplo','agenda-today','','small')}</div><div class="filters" role="group" aria-label="Visualização da agenda"><button type="button" data-action="agenda-day" aria-pressed="${agendaView==='day'}" class="${agendaView==='day'?'active':''}">Dia</button><button type="button" data-action="agenda-week" aria-pressed="${agendaView==='week'}" class="${agendaView==='week'?'active':''}">Semana</button></div></div>`+
      (agendaView==='day'?`<section class="card"><div class="card-title"><h2>${h(dateTitle(agendaDate))}</h2></div>${timeline(agendaDate)}</section>`:`<div class="week-list">${days.map((d,i)=>`<section class="card week-day"><div class="card-title"><h2>${weekdays[i]} · ${M.formatDate(d)}</h2>${button('Abrir dia','agenda-select',`data-date="${d}"`,'small')}</div>${timeline(d)}</section>`).join('')}</div>`);
  }
  function renderTasks() {
    const courses=[...new Set(state.tasks.map(t=>t.course).filter(Boolean))].sort();
    if (courseFilter && !courses.includes(courseFilter)) courseFilter='';
    const tasks=state.tasks.filter(t=>(taskFilter==='all'||(taskFilter==='done'?t.done:!t.done))&&(!courseFilter||t.course===courseFilter));
    return head('tasks','Prazos e estimativas sob seu controle.',button(I.plus+' Nova tarefa','new-task','','primary'))+
      `<div class="agenda-toolbar"><div class="filters" role="group" aria-label="Filtrar tarefas">${[['open','Abertas'],['done','Concluídas'],['all','Todas']].map(([v,l])=>`<button type="button" data-action="filter-tasks" data-value="${v}" data-focus="filter-${v}" class="${taskFilter===v?'active':''}" aria-pressed="${taskFilter===v}">${l}</button>`).join('')}</div><div class="field compact-field"><label for="task-course-filter">Disciplina</label><select id="task-course-filter" data-focus="course-filter"><option value="">Todas as disciplinas</option>${courses.map(c=>`<option value="${h(c)}" ${courseFilter===c?'selected':''}>${h(c)}</option>`).join('')}</select></div></div><section class="card">${taskRows(tasks)}</section>`;
  }
  function renderSubjects() {
    const courses=[...new Set(state.tasks.map(t=>t.course).concat(state.commitments.map(e=>e.course)).filter(Boolean))].sort();
    return head('subjects','Organize suas tarefas por disciplina. Vincular uma tarefa é opcional.',button('Criar tarefa com disciplina','new-task','','primary'))+
      (courses.length?`<div class="three-col">${courses.map((course,i)=>`<section class="card course-card"><div class="course-mark" aria-hidden="true"></div><h2>${h(course)}</h2><p class="subhead">${state.tasks.filter(t=>t.course===course&&!t.done).length} tarefas abertas</p><div class="card-footer">${button('Ver tarefas '+I.arrow,'subject-tasks',`data-course="${h(course)}"`,'small')}</div></section>`).join('')}</div>`:`<section class="card">${empty('Suas disciplinas aparecerão aqui.','Ao criar uma tarefa ou um compromisso, você pode informar o nome da disciplina.')}</section>`);
  }
  function renderAvailability() {
    const w=state.availability.find(w=>w.date===M.TODAY);
    return head('availability','Informe o tempo que você realmente quer reservar para tarefas.')+
      `<div class="two-col"><section class="card"><h2>Janela de tempo livre</h2><p class="subhead">Uma janela por dia nesta prévia. Horários de compromissos fixos são protegidos.</p><form id="availability-form" class="form-grid"><div class="field"><label for="availability-date">Data</label><input id="availability-date" name="date" type="date" value="${M.TODAY}" required></div><div class="two-col"><div class="field"><label for="availability-start">Início</label><input id="availability-start" name="start" type="time" value="${w?M.time(w.start):''}" required></div><div class="field"><label for="availability-end">Fim</label><input id="availability-end" name="end" type="time" value="${w?M.time(w.end):''}" required></div></div><p class="form-error" id="availability-error" role="alert" tabindex="-1" hidden></p><div class="modal-actions">${navButton('Voltar','today')}<button type="submit" class="btn primary">${persist?'Salvar disponibilidade':'Usar nesta sessão'}</button></div></form></section><section class="card"><h2>Horários informados</h2>${state.availability.length?`<ul class="compact-list">${state.availability.slice().sort((a,b)=>a.date.localeCompare(b.date)).map(w=>`<li><strong>${M.formatDate(w.date)}</strong><small>${M.time(w.start)}–${M.time(w.end)} · ${M.duration(w.end-w.start)}</small></li>`).join('')}</ul>`:'<p class="subhead">Nenhuma disponibilidade informada. O CAMPULSO não presume que um intervalo vazio esteja livre.</p>'}<div class="note-box">Ao atualizar a janela, blocos que ficarem fora dela voltam a ficar sem horário. As tarefas e os prazos são preservados. Novos blocos exigem revisar e aplicar uma proposta.</div></section></div>`;
  }
  function planRows(blocks, placeholder) {
    if (!blocks.length) return `<p class="subhead">${placeholder}</p>`;
    return `<ul class="compact-list">${blocks.map(b=>{const t=state.tasks.find(t=>t.id===b.taskId);return t?`<li><strong>${M.time(b.start)}–${M.time(b.end)} · ${h(t.title)}</strong><small>${h(dueLabel(t))}</small></li>`:'';}).join('')}</ul>`;
  }
  function renderPreview() {
    const proposalView=proposal || M.buildProposal(state,state.lightMode);
    return previewContent(proposalView);
  }
  function previewContent(proposal) {
    const before=state.blocks.filter(b=>b.date===proposal.date&&state.tasks.some(t=>t.id===b.taskId&&!t.done));
    const criticalNotPlanned=proposal.unscheduled.some(b=>{const t=state.tasks.find(t=>t.id===b.taskId);return t.due&&t.due<=M.TODAY;});
    const leavingLightMode=state.lightMode&&!proposal.light;
    return head('preview',proposal.light?'Uma proposta com menos tempo de tarefas flexíveis.':'Confira o que mudaria antes de aplicar.', '', 'Demonstração de planejamento')+
      `<div class="note-box">${persist?'Prévia montada com os dados locais do ensaio.':'Prévia montada com dados de exemplo.'} Nada muda até você aplicar. Compromissos fixos, prazos e conclusões são preservados.</div><div class="day-summary"><div class="summary-item"><span>Antes</span><strong>${M.duration(before.reduce((s,b)=>s+b.end-b.start,0))}</strong><small>Em blocos flexíveis</small></div><div class="summary-item"><span>Nesta proposta</span><strong>${M.duration(proposal.used)}</strong><small>${proposal.light?'Modo leve · limite de '+M.duration(proposal.budget):'Dentro da disponibilidade informada'}</small></div><div class="summary-item"><span>Sem horário nesta proposta</span><strong>${proposal.unscheduled.length}</strong><small>As tarefas continuam abertas</small></div></div>`+
      `<div class="compare two-col"><section class="card compare-panel"><h2>Antes</h2>${planRows(before,'Nenhum bloco aplicado para este dia.')}</section><section class="card compare-panel proposed"><h2>Proposta para ${M.formatDate(proposal.date)}</h2>${planRows(proposal.blocks,'Nenhum bloco cabe no horário informado.')}</section></div>`+
      (proposal.unscheduled.length?`<section class="card ${criticalNotPlanned?'overload-notice':''}"><div class="card-title"><h2>Tarefas que continuam sem horário</h2></div><ul class="compact-list">${proposal.unscheduled.map(u=>{const t=state.tasks.find(t=>t.id===u.taskId);return `<li><strong>${h(t.title)}</strong><small>${h(dueLabel(t))} · ${M.duration(t.duration)}</small><p>${h(u.reason)}</p></li>`;}).join('')}</ul>${criticalNotPlanned?'<p><strong>Há prazo até hoje sem espaço nesta proposta.</strong> Reveja sua disponibilidade ou mantenha a tarefa sem horário, com o prazo visível.</p>':''}${navButton('Rever disponibilidade','availability','small')}</section>`:'')+
      `<section class="card"><h2>Por que esta proposta?</h2><p class="subhead">Neste exemplo, tarefas abertas são consideradas pela ordem dos prazos e encaixadas nas janelas informadas. O Modo leve limita os blocos a 60% do tempo disponível. Isso demonstra a interação; o motor definitivo ainda precisa de validação técnica.</p>${leavingLightMode?'<p class="micro-note">Aplicar esta revisão desativa o Modo leve, inclusive quando todas as tarefas estão concluídas ou não há disponibilidade. Tarefas concluídas não são reabertas e nenhum horário livre é presumido.</p>':''}</section><div class="preview-actions">${button('Descartar proposta','discard-proposal')}${button(proposal.light?'Aplicar Modo leve nesta sessão':leavingLightMode?'Voltar ao plano normal nesta sessão':'Aplicar proposta nesta sessão','apply-proposal',M.canApplyProposal(state,proposal)?'':'disabled','primary')}</div>`;
  }
  function renderLight() {
    const s=M.stats(state);
    return head('light','Você escolhe quando reservar mais espaço no seu dia.')+
      `<div class="two-col"><section class="card focus-card"><div class="mode-icon">${I.moon}</div><span class="tag">${state.lightMode?'Aplicado nesta sessão':'Ainda não aplicado'}</span><h2>Um plano mais leve, por sua escolha.</h2><p>Veja uma proposta com menos blocos flexíveis. Aulas, compromissos e prazos continuam visíveis. Ativar esse modo não conclui tarefas nem muda suas datas de entrega.</p>${button(state.lightMode?'Rever plano normal':'Ver proposta mais leve',state.lightMode?'preview-normal':'preview-light','','primary')}</section><section class="card"><h2>O que você poderá conferir</h2><ul class="compact-list"><li>O plano atual e a proposta, lado a lado.</li><li>Quais tarefas continuam sem horário e seus prazos.</li><li>O tempo reservado antes e depois.</li><li>As opções de aplicar ou descartar.</li></ul>${!s.capacity?`<div class="note-box">${state.lightMode?'Você pode voltar ao plano normal mesmo sem disponibilidade. Para criar novos blocos, informe um horário livre.':'Informe sua disponibilidade para experimentar uma proposta.'}</div>`:''}<p class="micro-note">É uma preferência de organização. Não há avaliação de saúde ou inferência de como você está se sentindo.</p></section></div>`;
  }
  function renderSettings() {
    return head('settings','Escolhas simples para organizar seu espaço.')+`<div class="two-col"><section class="card"><h2>Sua organização</h2><div class="settings-list"><div class="setting"><div class="setting-main"><strong>Disponibilidade</strong><span>Janelas de tempo informadas por você.</span></div>${navButton('Abrir','availability','small')}</div><div class="setting"><div class="setting-main"><strong>Modo leve</strong><span>${state.lightMode?'Aplicado nesta sessão.':'Uma proposta com menos blocos flexíveis.'}</span></div>${navButton('Abrir','light','small')}</div></div></section><section class="card"><h2>Privacidade e orientação</h2><div class="settings-list"><div class="setting"><div class="setting-main"><strong>Dados e recuperação</strong><span>Conheça o fluxo previsto de cópia e restauração.</span></div>${navButton('Abrir','data','small')}</div><div class="setting"><div class="setting-main"><strong>Ajuda</strong><span>Entenda tarefas, compromissos e planejamento.</span></div>${navButton('Abrir','help','small')}</div></div></section></div><div class="note-box">${persist?'As alterações do ensaio ficam neste navegador. Recarregar permite reler os dados.':'Esta prévia funciona apenas com dados em memória. Recarregar a página restaura o cenário inicial. Nenhum cadastro, conta ou envio de dados é necessário.'}</div>`;
  }
  function renderData() {
    return head('data','Conheça como seus dados serão exportados e recuperados.')+`<div class="note-box">${persist?'Exportação e restauração ilustrativas. Os dados de ensaio ficam neste navegador.':'Fluxo ilustrativo da interface. Nesta versão, não existe gravação, exportação ou restauração de dados reais.'}</div><div class="two-col"><section class="card"><h2>Exportar uma cópia</h2><p class="subhead">No MVP, o arquivo permitirá guardar suas disciplinas, tarefas e compromissos fora do navegador.</p><ol class="compact-list"><li>Gerar o arquivo e conferir o resultado.</li><li>Guardar em um local escolhido por você.</li><li>Manter uma cópia antes de substituir os dados.</li></ol>${button('Entender a exportação','explain-export','','primary')}</section><section class="card"><h2>Restaurar com conferência</h2><p class="subhead">O fluxo prevê validar o arquivo e mostrar um resumo antes de pedir confirmação para substituir informações.</p><div class="card-footer">${navButton('Explorar exemplo de recuperação','restore','primary')}</div></section></div>`;
  }
  function renderRestore() {
    const controls=button('Exemplo compatível','restore-valid','','primary')+button('Exemplo incompatível','restore-invalid');
    let body=`<h2>Escolha um exemplo para visualizar</h2><p class="subhead">Nenhum arquivo pessoal será aberto. Os dois exemplos são fictícios e apenas apresentam os estados da interface.</p><div class="head-actions">${controls}</div>`;
    if (restoreStage===1 && restoreExample==='invalid') body=`<div class="form-error" role="alert"><strong>O exemplo não é compatível.</strong><p>O formato ou a versão não corresponde ao esperado. Nenhuma informação foi alterada.</p></div><div class="head-actions">${controls}</div>`;
    if (restoreStage===1 && restoreExample==='valid') body=`<span class="tag">Resumo fictício</span><h2>Conferir antes de continuar</h2><ul class="compact-list"><li>Arquivo de exemplo: backup-campulso.json</li><li>4 tarefas, 2 compromissos e 4 disciplinas.</li><li>Data do exemplo: ${M.formatDate(M.TODAY)}.</li></ul><div class="note-box">No produto, continuar substituirá os dados atuais e exigirá confirmação. Nesta prévia, o próximo botão demonstra essa etapa sem alterar informações.</div><div class="modal-actions">${button('Cancelar','restore-cancel')}${button('Ver confirmação ilustrativa','restore-confirm','','primary')}</div>`;
    if (restoreStage===2) body=`<h2>Fim do exemplo de recuperação</h2><p class="subhead">Este é o estado de confirmação previsto para o produto. <strong>Nenhum dado foi restaurado ou substituído nesta prévia.</strong></p><div class="head-actions">${button('Rever exemplos','restore-cancel')}${navButton('Voltar aos dados','data','primary')}</div>`;
    return head('restore','Validação, resumo e confirmação antes de qualquer substituição.')+`<section class="card">${body}</section>`;
  }
  function renderHelp() {
    const questions=[
      ['Qual é a diferença entre tarefa e compromisso?','Compromisso tem data e horário fixos, informados por você. Tarefa é uma atividade flexível, com duração estimada e prazo opcional. Uma tarefa pode continuar sem horário.'],
      ['Uma proposta muda minha agenda automaticamente?','Não. Abrir e descartar uma prévia não altera o plano. Aplicar muda somente os blocos flexíveis desta sessão. Compromissos, prazos e conclusões permanecem iguais.'],
      ['O que acontece quando não há tempo suficiente?','As tarefas que não cabem continuam abertas e com os prazos visíveis. Você pode revisar a disponibilidade ou manter essas tarefas sem horário.'],
      ['Como funciona o Modo leve nesta prévia?','Você revisa uma proposta que limita os blocos flexíveis a 60% da disponibilidade informada e escolhe aplicar ou descartar. É um exemplo de interação, não uma avaliação de saúde.'],
      ['Meus dados ficam salvos?',persist?'Sim. As alterações do ensaio ficam neste navegador. Exportação e restauração são ilustrativas.':'Não nesta prévia. Tudo fica em memória enquanto a página estiver aberta. Ao recarregar, os exemplos são restaurados. Persistência, exportação e recuperação reais fazem parte da etapa de desenvolvimento do MVP.'],
      ['Posso usar o CAMPULSO em qualquer graduação?','Sim. A estrutura é comum a todas as graduações. Os nomes de disciplinas desta demonstração são exemplos e podem ser substituídos livremente.']
    ];
    return head('help','Orientações para usar a prévia com autonomia.')+`<section class="card">${questions.map(([q,a],i)=>`<details class="faq" ${i===0?'open':''}><summary>${q}</summary><p>${a}</p></details>`).join('')}</section>`;
  }
  const renders={today:renderToday,agenda:renderAgenda,tasks:renderTasks,subjects:renderSubjects,availability:renderAvailability,preview:renderPreview,light:renderLight,settings:renderSettings,data:renderData,restore:renderRestore,help:renderHelp};
  function showPage(focus=false) {
    document.querySelectorAll('.page').forEach(node=>{const active=node.id==='page-'+currentPage;node.classList.toggle('active',active);node.hidden=!active;});
    document.querySelectorAll('[data-page]').forEach(node=>{
      const active=node.dataset.page===currentPage;
      node.classList.toggle('active',active);
      if (active) node.setAttribute('aria-current','page'); else node.removeAttribute('aria-current');
    });
    const more=byId('more-btn');
    more.classList.toggle('active',!['today','agenda','tasks'].includes(currentPage));
    if (!['today','agenda','tasks'].includes(currentPage)) more.setAttribute('aria-current','page'); else more.removeAttribute('aria-current');
    byId('crumb-name').textContent=names[currentPage];
    document.title=`CAMPULSO · ${names[currentPage]} · Prévia R02`;
    if(focus) byId(currentPage+'-title')?.focus({preventScroll:true});
  }
  function renderAll(focusKey) {
    lists.reset();
    for (const [page,render] of Object.entries(renders)) {
      byId('page-'+page).innerHTML=render();
      byId('page-'+page).setAttribute('aria-labelledby',page+'-title');
    }
    lists.render();
    showPage();
    if (focusKey) {
      const target=Array.from(byId('page-'+currentPage).querySelectorAll('[data-focus]')).find(n=>n.dataset.focus===focusKey);
      (target || byId(currentPage+'-title'))?.focus({preventScroll:true});
    }
  }
  function closeMore(returnFocus=false) {
    byId('more-menu').classList.remove('open');
    byId('more-menu').hidden=true;
    byId('more-btn').setAttribute('aria-expanded','false');
    if(returnFocus) byId('more-btn').focus();
  }
  function go(page) {
    if(!names[page]) return;
    currentPage=page;
    if(page==='preview'&&!proposal) proposal=M.buildProposal(state,state.lightMode);
    renderAll();
    closeMore();
    showPage(true);
    window.scrollTo({top:0,behavior:'instant'});
  }
  function showToast(text, undoId) {
    const toast=byId('toast');
    toast.textContent=persist?text.replace(/somente nesta sessão|nesta sessão/g,'no banco de ensaio'):text;
    if (undoId) {
      const undo=document.createElement('button');
      undo.type='button'; undo.className='toast-undo'; undo.textContent='Desfazer';
      undo.addEventListener('click',async()=>{
        try {
          await publish(M.toggleTask(state,undoId));proposal=null;
          renderAll('toggle-'+undoId);showToast('Alteração desfeita.');
        } catch(error) {showToast(error.message);}
      });
      toast.append(undo);
    }
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer=setTimeout(()=>{if(!toast.contains(document.activeElement)) toast.classList.remove('show');},7000);
  }
  function focusEditorOrigin() {
    if(editorOpener?.isConnected) editorOpener.focus({preventScroll:true});
    else {
      const candidates=Array.from(byId('page-'+currentPage).querySelectorAll('button'));
      const origin=editorFocusDetails || {};
      const target=(origin.focus?candidates.find(n=>n.dataset.focus===origin.focus):null) ||
        (origin.action?candidates.find(n=>n.dataset.action===origin.action && (n.dataset.id || '')===origin.id):null);
      (target || byId(currentPage+'-title'))?.focus({preventScroll:true});
    }
  }
  function openModal(type='task', id, date) {
    const item=id?(type==='task'?state.tasks:state.commitments).find(x=>x.id===id):null;
    if(id&&!item) return showToast('Este item não está mais disponível.');
    editorOpener=document.activeElement;
    editorFocusDetails={focus:editorOpener?.dataset.focus,action:editorOpener?.dataset.action,id:editorOpener?.dataset.id || ''};
    const isTask=type==='task', title=(id?'Editar ':'Nova ')+(isTask?'tarefa':'compromisso');
    const actualTitle=isTask?title:(id?'Editar compromisso':'Novo compromisso');
    editor.innerHTML=`<div class="editor-header"><div><div class="eyebrow">${isTask?'Atividade flexível':'Horário fixo'}</div><h2 id="editor-title">${actualTitle}</h2></div><button class="editor-close icon-btn" type="button" data-action="close-editor" aria-label="Fechar formulário">${I.close}</button></div><p id="editor-description" class="subhead">Alterações válidas apenas nesta sessão de demonstração.</p><form id="editor-form" class="form-grid" data-type="${type}" data-id="${id || ''}"><div class="field"><label for="item-title">Título</label><input id="item-title" name="title" maxlength="160" required value="${h(item?.title || '')}" placeholder="Ex.: revisar referências do trabalho" autocomplete="off"></div><div class="field"><label for="item-course">Disciplina <span class="muted">(opcional)</span></label><input id="item-course" name="course" maxlength="100" value="${h(item?.course || '')}" placeholder="Pode deixar em branco" autocomplete="off"></div><div class="two-col"><div class="field"><label for="item-date">${isTask?'Prazo (opcional)':'Data'}</label><input id="item-date" name="date" type="date" ${isTask?'':'required'} value="${isTask?(item?.due || ''):(item?.date || date || (currentPage==='agenda'?agendaDate:M.TODAY))}"></div><div class="field"><label for="item-duration">Duração em minutos</label><input id="item-duration" name="duration" type="number" min="1" max="480" step="1" required value="${isTask?(item?.duration || 30):(item?item.end-item.start:60)}" inputmode="numeric"></div></div>${isTask?'':`<div class="field"><label for="item-time">Horário de início</label><input id="item-time" name="time" type="time" required value="${item?M.time(item.start):''}"></div>`}<p id="editor-error" class="form-error" role="alert" tabindex="-1" hidden></p><div class="modal-actions">${button('Cancelar','close-editor')}<button type="submit" class="btn primary">${id?'Atualizar nesta sessão':'Adicionar à demonstração'}</button></div></form>`;
    if (persist) {
      byId('editor-description').textContent='Dados locais deste ensaio.';
      if (isTask) byId('item-duration').min='15';
    }
    editor.setAttribute('aria-labelledby','editor-title');
    editor.setAttribute('aria-describedby','editor-description');
    editor.showModal();
    document.body.classList.add('modal-open');
    byId('item-title').focus();
  }
  function propose(light) {
    proposal=M.buildProposal(state,light);
    go('preview');
  }
  async function changeState(next, message, focusKey) {
    await publish(next); proposal=null;
    renderAll(focusKey);
    showToast(message);
  }
  document.addEventListener('click',async event=>{
    if(event.target.closest('a[href="#today"]')) {event.preventDefault();go('today');return;}
    const el=event.target.closest('button,[data-page]');
    if(!el || el.disabled) return;
    if(el.dataset.page) {go(el.dataset.page);return;}
    const action=el.dataset.action;
    try {
      switch(action) {
        case 'new-task': openModal('task'); break;
        case 'new-commitment': openModal('commitment',undefined,el.dataset.date); break;
        case 'edit-task': openModal('task',el.dataset.id); break;
        case 'edit-commitment': openModal('commitment',el.dataset.id); break;
        case 'close-editor': editor.close(); break;
        case 'toggle-task': {
          await publish(M.toggleTask(state,el.dataset.id)); proposal=null;
          const done=state.tasks.find(t=>t.id===el.dataset.id).done;
          renderAll(el.dataset.focus);
          showToast(done?'Tarefa concluída nesta sessão.':'Tarefa reaberta nesta sessão.',el.dataset.id);
          break;
        }
        case 'preview-normal': propose(false); break;
        case 'preview-light': propose(true); break;
        case 'discard-proposal': proposal=null; go('today'); showToast('Prévia descartada. Seu plano permanece igual.'); break;
        case 'apply-proposal': await publish(M.applyProposal(state,proposal),proposal.date); proposal=null; renderAll(); go('today'); showToast('Proposta aplicada somente nesta sessão. Prazos e compromissos preservados.'); break;
        case 'agenda-prev': agendaDate=M.addDays(agendaDate,agendaView==='week'?-7:-1); go('agenda'); break;
        case 'agenda-next': agendaDate=M.addDays(agendaDate,agendaView==='week'?7:1); go('agenda'); break;
        case 'agenda-today': agendaDate=M.TODAY; go('agenda'); break;
        case 'agenda-select': agendaDate=el.dataset.date; agendaView='day'; go('agenda'); break;
        case 'agenda-day': agendaView='day'; go('agenda'); break;
        case 'agenda-week': agendaView='week'; go('agenda'); break;
        case 'filter-tasks': taskFilter=el.dataset.value; renderAll(el.dataset.focus); break;
        case 'subject-tasks': courseFilter=el.dataset.course; taskFilter='all'; go('tasks'); break;
        case 'explain-export': showToast('No MVP, a exportação criará um arquivo para você guardar. Nenhum arquivo é gerado nesta prévia.'); break;
        case 'restore-valid': restoreExample='valid'; restoreStage=1; go('restore'); break;
        case 'restore-invalid': restoreExample='invalid'; restoreStage=1; go('restore'); break;
        case 'restore-confirm': restoreStage=2; go('restore'); break;
        case 'restore-cancel': restoreStage=0; restoreExample=''; go('restore'); break;
      }
    } catch(error) {showToast(error.message);}
  });
  document.addEventListener('submit',async event=>{
    if(event.target.id==='editor-form') {
      event.preventDefault();
      const f=event.target, values=Object.fromEntries(new FormData(f));
      try {
        const beforeBlocks=state.blocks.length;
        await publish(f.dataset.type==='task'?M.upsertTask(state,{...values,due:values.date},f.dataset.id):M.upsertCommitment(state,values,f.dataset.id));
        proposal=null;
        editor.close();
        renderAll();
        requestAnimationFrame(focusEditorOrigin);
        const removed=beforeBlocks-state.blocks.length;
        showToast(removed>0?`Alteração aplicada nesta sessão. ${removed} ${removed===1?'bloco ficou':'blocos ficaram'} sem horário para respeitar a duração ou o compromisso. Prazos preservados.`:'Alteração aplicada somente nesta sessão.');
      } catch(error) {
        const node=byId('editor-error');node.hidden=false;node.textContent=error.message;node.focus();
      }
    }
    if(event.target.id==='availability-form') {
      event.preventDefault();
      try {
        const values=Object.fromEntries(new FormData(event.target));
        const next=M.setAvailability(state,values), removed=state.blocks.length-next.blocks.length;
        await changeState(next,removed>0?`Disponibilidade atualizada. ${removed} ${removed===1?'bloco fora da janela ficou':'blocos fora da janela ficaram'} sem horário. Tarefas e prazos preservados.`:'Disponibilidade atualizada nesta sessão. Revise uma proposta para criar novos blocos.');
        byId('availability-title').focus({preventScroll:true});
      } catch(error) {const node=byId('availability-error');node.hidden=false;node.textContent=error.message;node.focus();}
    }
  });
  document.addEventListener('change',event=>{
    if(event.target.id==='task-course-filter') {courseFilter=event.target.value;renderAll('course-filter');}
    if(event.target.id==='availability-date') {
      const w=state.availability.find(w=>w.date===event.target.value);
      byId('availability-start').value=w?M.time(w.start):'';
      byId('availability-end').value=w?M.time(w.end):'';
    }
  });
  byId('more-btn').addEventListener('click',()=>{
    const menu=byId('more-menu'), open=!menu.classList.contains('open');
    menu.classList.toggle('open',open);menu.hidden=!open;
    byId('more-btn').setAttribute('aria-expanded',String(open));
    if(open) menu.querySelector('button')?.focus();
  });
  document.addEventListener('click',event=>{
    if(!event.target.closest('#more-menu,#more-btn'))closeMore();
  });
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&byId('more-menu').classList.contains('open')) {event.preventDefault();closeMore(true);}
  });
  editor.addEventListener('close',()=>{document.body.classList.remove('modal-open');focusEditorOrigin();});
  editor.addEventListener('click',event=>{
    if(event.target===editor) {const r=editor.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)editor.close();}
  });
  window.go=go;window.openModal=openModal;window.showToast=showToast;
  window.CAMPULSO_DEMO=Object.freeze({version:'R02',getState:()=>M.clone(state),getProposal:()=>M.clone(proposal)});
  renderAll();closeMore();
}
