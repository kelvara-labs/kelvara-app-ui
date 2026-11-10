(()=>{
 const q=s=>document.querySelector(s),dialog=q('#feedback-dialog'),form=q('#feedback-form');if(!dialog||!form)return;
 const category=q('#feedback-category'),subject=q('#feedback-subject'),message=q('#feedback-message'),status=q('#feedback-status'),submit=q('#feedback-submit'),context=q('#feedback-context'),preview=q('#feedback-context-preview');
 const route=()=>(location.hash||'#overview').slice(1).split('/')[0];
 const demo=()=>Boolean(window.__KELVARA_HARNESS__||window.__KELVARA_STATIC_DEMO__);
 const contextText=()=>{const position=route()==='exitrail'?q('.protection-position-row[aria-selected="true"] strong')?.textContent:route()==='positions'?q('#position-name')?.textContent:'';return `Page: ${route()}${position?` · Position: ${position}`:''}`};
 document.querySelectorAll('#feedback-open,[data-support-open]').forEach(open=>open.addEventListener('click',()=>{status.textContent=demo()?'Demo only. Requests are not sent.':'';preview.textContent=contextText();dialog.showModal();subject.focus()}));
 q('#feedback-close').addEventListener('click',()=>dialog.close());
 dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close()}});
 form.addEventListener('submit',async event=>{
  event.preventDefault();if(submit.disabled)return;if(demo()){status.textContent='Demo only. Request not sent.';return}
  const title=subject.value.trim(),detail=message.value.trim().replace(/[\r\n\t]+/g,' ');if(!title||title.length>120||detail.length<3){status.textContent='Add a subject and message.';return}
  // ponytail: legacy API stores subject and reviewed context in its existing message field; separate fields need a backend schema change.
  const text=`${title} — ${detail}${context.checked?` · ${preview.textContent}`:''}`;
  if(text.length>2000||/[\u0000-\u001f\u007f]/.test(text)){status.textContent='Use plain text without line breaks, up to 2,000 characters including context.';return}
  const page=context.checked?(route()==='exitrail'?'protection':new Set(['overview','positions','governance','safeguards','account']).has(route())?route():'home'):'home';
  const payload={category:category.value,message:text,page};submit.disabled=true;status.textContent='Submitting…';
  try{
   const send=()=>fetch(`${location.hostname==='app.kelvara.xyz'?'https://api.kelvara.xyz':''}/api/feedback`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${JSON.parse(sessionStorage.getItem('kelvara_app_session')||'{}').token||''}`},body:JSON.stringify(payload),signal:AbortSignal.timeout(15000)});
   let response=await send();if(response.status===401&&typeof window.kelvaraRefreshWalletSession==='function'){await window.kelvaraRefreshWalletSession();response=await send()}
   if(!response.ok)throw Error('request_failed');const receipt=await response.json();if(typeof receipt.id!=='string'||!receipt.id.trim())throw Error('receipt_missing');
   status.textContent=`Request submitted · ${receipt.id}`;subject.value='';message.value='';
  }catch{status.textContent='Request not submitted or receipt unavailable. Your draft is preserved.'}finally{submit.disabled=false}
 });
})();
