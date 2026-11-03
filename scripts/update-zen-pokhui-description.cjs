// Apply the owner's two description edits once, preserving later edits.
const DESCRIPTION="Protecting my peace is my new personality.\n\nЯ більше не намагаюся все зрозуміти, всіх врятувати та знайти відповіді на кожне запитання.\n\nЯ просто сиджу, красиво дихаю і не їбу, що відбувається.\n\nТрохи дзену, трохи хаосу та абсолютна гармонія з власним пофігізмом.\n\nЦя футболка — для дівчат, які навчилися обирати свій внутрішній спокій замість чужої драми.\n\nБо іноді найвищий рівень усвідомленості — це просто сказати: «Я не їбу».\n\n🎀 Розслаблений оверсайз крій для твоїх найкомфортніших образів.\n\n🎀 М’яка тканина, що дихає та приємно відчувається на тілі.\n\n🎀 Естетичний принт із ноткою іронії та spiritual girl energy.\n\n💋 Склад: 95% бавовна, 5% еластан\n💋 Розмір: універсальний (ONE SIZE)\nЗ любовʼю, Baby Girl 💌";
const SIGNOFF='З любовʼю, Baby Girl 💌';
const RELEASE='zen-pokhui-description-20261103';
function nextDescription(p){
 return p.uid==='tee-ya-ne-yibu'?DESCRIPTION:String(p.description||'').replace(/\s*З любовʼю, Baby Girl 💌\s*$/u,'').trimEnd();
}
async function runRelease(env=process.env,request=fetch){
 if(env.VERCEL_ENV!=='production')return;
 const origin=env.SUPABASE_URL,key=env.SUPABASE_SERVICE_ROLE_KEY;
 if(!origin||!key)throw Error('Catalog service configuration missing');
 async function sb(path,method='GET',body){
  const r=await request(origin+'/rest/v1/'+path,{method,headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json',Prefer:'return=representation'},body:body===undefined?undefined:JSON.stringify(body)});
  if(!r.ok)throw Error('Description update failed: HTTP '+r.status);
  const txt=await r.text();return txt.trim()?JSON.parse(txt):[];
 }
 for(const uid of ['tee-pokhui','tee-ya-ne-yibu']){
  const path='bg_products?uid=eq.'+uid;
  let p=(await sb(path+'&select=uid,description,attrs,updated_at'))[0];
  if(!p)throw Error('Product missing: '+uid);
  if(!p.attrs?.[RELEASE]){
   const description=nextDescription(p);
   const saved=await sb(path+'&updated_at=eq.'+encodeURIComponent(p.updated_at),'PATCH',{description,attrs:{...p.attrs,[RELEASE]:true}});
   if(saved.length!==1||saved[0].description!==description)throw Error('Description verification failed: '+uid);
   p=saved[0];
  }
  await sb('products?bg_uid=eq.'+uid,'PATCH',{description:p.description});
  const check=(await sb(path+'&select=description'))[0];
  const crm=await sb('products?bg_uid=eq.'+uid+'&select=description');
  if(check?.description!==p.description||crm.some(x=>x.description!==p.description))throw Error('Catalog/CRM mismatch: '+uid);
  console.log('Description verified: '+uid);
 }
}
module.exports={runRelease,nextDescription,DESCRIPTION};
if(require.main===module)runRelease().catch(e=>{console.error(e.message);process.exitCode=1;});
