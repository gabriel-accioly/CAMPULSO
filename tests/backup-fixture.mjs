import { emptyBackupData } from '../reference/poc001-domain/backup.js';

export function populatedWorkspace(date) {
  const fixture=emptyBackupData();
  fixture.subjects.push({id:'s',name:'Disciplina',createdAtUtc:date,revision:1});
  fixture.deadlines.push({id:'d',title:'Entrega',subjectId:'s',dueDate:'2026-11-23',revision:1});
  fixture.tasks.push({id:'t',title:'Tarefa',subjectId:'s',deadlineId:'d',estimateMinutes:30,remainingMinutes:30,importance:'media',status:'aberta',createdAtUtc:date,updatedAtUtc:date,revision:1});
  fixture.preferences.push({id:'local',mode:'normal',locale:'pt-BR',timeZone:'America/Sao_Paulo',updatedAtUtc:date});
  fixture.commitments.push({id:'c',title:'Aula',subjectId:'s',startAtUtc:date,endAtUtc:'2026-11-21T13:00:00.000Z',timeZone:'UTC',isFixed:true,revision:1});
  fixture.availabilityRules.push({id:'a',weekday:1,startLocalTime:'10:00',endLocalTime:'11:00',timeZone:'UTC',enabled:true});
  fixture.availabilityExceptions.push({id:'x',localDate:'2026-11-23',type:'disponivel'});
  fixture.planRuns.push({id:'r',createdAtUtc:date,algorithmVersion:'poc',inputRevision:1,mode:'normal',status:'aplicado',summary:'Plano',reasonCodes:[]});
  fixture.planBlocks.push({id:'b',taskId:'t',planRunId:'r',startAtUtc:date,endAtUtc:'2026-11-21T12:30:00.000Z',source:'manual',revision:1});
  fixture.planDecisions.push({id:'p',planRunId:'r',taskId:'t',code:'teste',messageKey:'teste',parameters:{}});
  fixture.appMeta.push({key:'schemaVersion',value:'2'});
  return fixture;
}
