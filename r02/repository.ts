import {openDatabase, type CampulsoDexieDB} from '../src/infrastructure/database';
import {STORE_NAMES, type BackupData} from '../src/domain/model';


interface Row {id:string; title:string; course:string}
interface TaskRow extends Row {duration:number; due:string; done:boolean}
interface WindowRow {date:string; start:number; end:number}
interface EventRow extends Row, WindowRow {}
interface BlockRow extends WindowRow {taskId:string}
export interface View {
  scenario:'local'; revision:number; nextId:number; lightMode:boolean;
  tasks:TaskRow[]; commitments:EventRow[]; availability:WindowRow[]; blocks:BlockRow[];
}
const revisionKey='r02.revision';
const zone=()=>Intl.DateTimeFormat().resolvedOptions().timeZone;
const pad=(n:number)=>String(n).padStart(2,'0');
function civil(d:Date){return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());}
function time(n:number){return pad(Math.floor(n/60))+':'+pad(n%60);}
function mins(s:string){const [h,m]=s.split(':').map(Number); return h*60+m;}
function instant(date:string, minute:number) {
  const [y,m,d]=date.split('-').map(Number);
  const expected=new Date(Date.UTC(y,m-1,d,0,minute));
  const wall=expected.toISOString().slice(0,16);
  // Use observed local offsets on both sides of any daylight-saving transition.
  const offsets=new Set([-36,0,36].map(hours=>new Date(expected.getTime()+hours*3600000).getTimezoneOffset()));
  const matches=[...offsets].map(offset=>new Date(expected.getTime()+offset*60000)).filter(local=>
    civil(local)+'T'+pad(local.getHours())+':'+pad(local.getMinutes())===wall);
  if(matches.length!==1)throw Error('Horário inexistente ou ambíguo no fuso deste dispositivo. Escolha outro horário.');
  return matches[0].toISOString();
}
function interval(start:string,end:string):WindowRow{
  const a=new Date(start),b=new Date(end);
  return {date:civil(a),start:a.getHours()*60+a.getMinutes(),end:civil(a)===civil(b)?b.getHours()*60+b.getMinutes():1440};
}
function revision(data:BackupData){return Number(data.appMeta.find(m=>m.key===revisionKey)?.value||1);}
export function project(data:BackupData):View{
  const subjects=new Map(data.subjects.map(s=>[s.id,s.name]));
  const deadlines=new Map(data.deadlines.map(d=>[d.id,d.dueDate]));
  return {
    scenario:'local',revision:revision(data),nextId:0,lightMode:data.preferences[0]?.mode==='leve',
    tasks:data.tasks.map(t=>({id:t.id,title:t.title,course:subjects.get(t.subjectId||'')||'',duration:t.estimateMinutes,
      due:deadlines.get(t.deadlineId||'')||t.dueDate||'',done:t.status==='concluida'})),
    commitments:data.commitments.map(c=>({id:c.id,title:c.title,course:subjects.get(c.subjectId||'')||'',...interval(c.startAtUtc,c.endAtUtc)})),
    availability:data.availabilityExceptions.flatMap(w=>w.type==='r02-janela'&&w.startLocalTime&&w.endLocalTime?
      [{date:w.localDate,start:mins(w.startLocalTime),end:mins(w.endLocalTime)}]:[]),
    blocks:data.planBlocks.map(b=>({taskId:b.taskId,...interval(b.startAtUtc,b.endAtUtc)}))
  };
}
function same(a:unknown,b:unknown){return JSON.stringify(a)===JSON.stringify(b);}
function update(data:BackupData, before:View, next:View, planDate?:string) {
  const now=new Date().toISOString();
  function subject(name:string) {
    if(!name.trim())return undefined;
    const norm=(s:string)=>s.trim().normalize('NFC').toLocaleLowerCase('pt-BR');
    const existing=data.subjects.find(s=>norm(s.name)===norm(name));
    if(existing)return existing.id;
    const id=crypto.randomUUID();
    data.subjects.push({id,name:name.trim(),createdAtUtc:now,revision:1});
    return id;
  }
  for(const row of next.tasks){
    const prior=before.tasks.find(t=>t.id===row.id);
    if(same(prior,row))continue;
    const old=data.tasks.find(t=>t.id===row.id);
    const subjectId=subject(row.course);
    let deadlineId=old?.deadlineId;
    const deadline=data.deadlines.find(d=>d.id===deadlineId);
    if(row.due){
      if(deadline) {
        if(deadline.dueDate!==row.due||deadline.title!==row.title||deadline.subjectId!==subjectId)
          Object.assign(deadline,{title:row.title,dueDate:row.due,subjectId,revision:deadline.revision+1});
      } else {
        deadlineId=crypto.randomUUID();
        data.deadlines.push({id:deadlineId,title:row.title,dueDate:row.due,subjectId,revision:1});
      }
    } else if(deadlineId){
      data.deadlines=data.deadlines.filter(d=>d.id!==deadlineId); deadlineId=undefined;
    }
    const status:BackupData['tasks'][number]['status']=row.done?'concluida':old?.status==='em_andamento'?'em_andamento':'aberta';
    const task={...old,id:row.id,subjectId,deadlineId,title:row.title,importance:old?.importance||'media' as const,
      estimateMinutes:row.duration,remainingMinutes:row.done?0:!prior||prior.done||prior.duration!==row.duration?row.duration:old!.remainingMinutes,
      status,revision:(old?.revision??0)+1,
      createdAtUtc:old?.createdAtUtc||now,updatedAtUtc:now,completedAtUtc:row.done?(old?.completedAtUtc||now):undefined};
    if(old)Object.assign(old,task);else data.tasks.push(task);
  }
  for(const c of next.commitments){
    if(same(before.commitments.find(e=>e.id===c.id),c))continue;
    const old=data.commitments.find(e=>e.id===c.id);
    const item={id:c.id,title:c.title,subjectId:subject(c.course),startAtUtc:instant(c.date,c.start),
      endAtUtc:instant(c.date,c.end),timeZone:zone(),isFixed:true,revision:(old?.revision??0)+1};
    if(old)Object.assign(old,item);else data.commitments.push(item);
  }
  for(const w of next.availability){
    if(same(before.availability.find(v=>v.date===w.date),w))continue;
    const old=data.availabilityExceptions.find(e=>e.localDate===w.date&&e.type==='r02-janela');
    const item={id:old?.id||crypto.randomUUID(),localDate:w.date,type:'r02-janela',startLocalTime:time(w.start),endLocalTime:time(w.end)};
    if(old)Object.assign(old,item);else data.availabilityExceptions.push(item);
  }
  const activeBlocks=next.blocks.filter(b=>next.tasks.some(t=>t.id===b.taskId&&!t.done));
  data.planBlocks=data.planBlocks.filter(b=>next.blocks.some(n=>same(n,{taskId:b.taskId,...interval(b.startAtUtc,b.endAtUtc)})) &&
    (!planDate||interval(b.startAtUtc,b.endAtUtc).date!==planDate));
  if(planDate){
    const id=crypto.randomUUID();
    data.planRuns.push({id,createdAtUtc:now,algorithmVersion:'r02-demo',inputRevision:before.revision,mode:next.lightMode?'leve':'normal',
      status:'aplicado',summary:'Proposta R02 aplicada',reasonCodes:[]});
    for(const b of activeBlocks.filter(b=>b.date===planDate)){
      data.planBlocks.push({id:crypto.randomUUID(),taskId:b.taskId,planRunId:id,startAtUtc:instant(b.date,b.start),endAtUtc:instant(b.date,b.end),source:'automatic',revision:1});
    }
    const pref=data.preferences[0];
    const mode=next.lightMode?'leve' as const:'normal' as const;
    if(pref)Object.assign(pref,{mode,updatedAtUtc:now});
    else data.preferences.push({id:'local',locale:'pt-BR',timeZone:zone(),mode,updatedAtUtc:now});
  }
  data.appMeta=data.appMeta.filter(m=>m.key!==revisionKey);
  data.appMeta.push({key:revisionKey,value:String(next.revision)});
}
export function openR02(){return openDatabase('campulso-poc002-r02');}
export async function commit(db:CampulsoDexieDB,before:View,next:View,planDate?:string):Promise<View>{
  return db.transaction('rw',[...STORE_NAMES],async()=>{
    const data=await db.snapshot();
    if(revision(data)!==before.revision)throw Error('Outra aba alterou os dados. Recarregue antes de editar.');
    if(before.scenario!=='local'||next.scenario!=='local'||next.revision!==before.revision+1)throw Error('Revisão local inválida.');
    update(data,before,next,planDate);
    await db.replaceSnapshot(data);
    return project(data);
  });
}
