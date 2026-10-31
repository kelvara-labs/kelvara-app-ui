const KEY='kelvara_action_debug_v1',LIMIT=50,SAFE_FIELDS=['httpStatus','signature','requestId','error'];
const clipped=value=>String(value??'').slice(0,240);
export function sanitizeActionError(error){const result={error:clipped(error?.message||error||'Unknown error')};if(Number.isInteger(error?.status))result.httpStatus=error.status;if(error?.requestId)result.requestId=clipped(error.requestId);return result}
export function createActionJournal({storage=sessionStorage,now=Date.now,random=()=>crypto.randomUUID()}={}){
 let entries=[];try{const parsed=JSON.parse(storage.getItem(KEY)||'[]');if(Array.isArray(parsed))entries=parsed.slice(0,LIMIT)}catch{}
 const save=()=>storage.setItem(KEY,JSON.stringify(entries.slice(0,LIMIT)));
 const notify=()=>globalThis.dispatchEvent?.(new CustomEvent('kelvara-action-debug',{detail:entries}));
 return{
  start(key){const split=String(key).indexOf(':'),entry={id:random(),action:split<0?String(key):String(key).slice(0,split),target:split<0?'':String(key).slice(split+1),state:'started',startedAt:now(),updatedAt:now()};entries.unshift(entry);entries=entries.slice(0,LIMIT);save();notify();return entry.id},
  update(id,state,data={}){const entry=entries.find(item=>item.id===id);if(!entry)return;entry.state=state;entry.updatedAt=now();for(const field of SAFE_FIELDS)if(data[field]!=null)entry[field]=field==='httpStatus'?Number(data[field]):clipped(data[field]);save();notify()},
  list:()=>entries.map(entry=>({...entry})),clear(){entries=[];save();notify()}
 }
}
