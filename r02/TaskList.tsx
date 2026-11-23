import {createRoot, type Root} from 'react-dom/client';
import {flushSync} from 'react-dom';
import type {View} from './repository';

type Task = View['tasks'][number];
interface Props {tasks:Task[]; today:string; dueLabel:(task:Task)=>string; duration:(n:number)=>string}
function TaskList({tasks,today,dueLabel,duration}:Props){
  return tasks.map(task=>
    <article key={task.id} className={'task-row '+(task.done?'is-done':'')} role="listitem">
      <button type="button" className={'check '+(task.done?'done':'')} data-action="toggle-task" data-id={task.id}
        data-focus={'toggle-'+task.id} aria-pressed={task.done} aria-label={(task.done?'Reabrir: ':'Concluir: ')+task.title}>
        <span aria-hidden="true" />
      </button>
      <div className="task-main">
        <button type="button" className="task-title-button" data-action="edit-task" data-id={task.id} data-focus={'edit-'+task.id}>{task.title}</button>
        <div className="task-meta">{task.course || 'Sem disciplina'} · {duration(task.duration)}</div>
        <div className={'task-due '+(task.due && task.due<=today && !task.done?'today':'')}>{dueLabel(task)}</div>
      </div>
      {task.done && <span className="tag">Concluída</span>}
    </article>
  );
}

// The original shell refreshes several pages together. Mount lists before restoring keyboard focus.
export function taskLists(){
  const roots:Root[]=[];
  const groups:Props[]=[];
  return {
    reset(){for(const root of roots.splice(0))root.unmount();groups.length=0;},
    placeholder(props:Props){
      const index=groups.push(props)-1;
      return '<div class="task-list" role="list" data-r02-list="'+index+'"></div>';
    },
    render(){
      flushSync(()=>{
        document.querySelectorAll<HTMLElement>('[data-r02-list]').forEach(el=>{
          const root=createRoot(el); roots.push(root);
          root.render(<TaskList {...groups[Number(el.dataset.r02List)]}/>);
        });
      });
    }
  };
}
