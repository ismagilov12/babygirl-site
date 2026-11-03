// Apply the owner's three exact descriptions once, preserving later catalog edits.
const DESCRIPTIONS={"tee-amy-winehouse":"She was never made to fit in.\n\nЕмі Вайнгауз — ікона музики, бунтарства та краси без правил.\n\nТрохи джазу, трохи драми й багато характеру.\n\n💋 Склад: 95% бавовна, 5% еластан\n💋 Розмір: універсальний (ONE SIZE)\nЗ любовʼю, Baby Girl 💌","tee-life-sucks":"Life sucks, but I suck better.\n\nЖиття буває жорстким, але ти завжди можеш бути ще зухвалішою.\n\nТрохи чорного гумору, трохи провокації та максимум bad girl energy.\n\nДля дівчат, які не бояться бути занадто сміливими.\n\nToo hot to behave🔥\n\n💋 Склад: 95% бавовна, 5% еластан\n💋 Розмір: універсальний (ONE SIZE)\nЗ любовʼю, Baby Girl 💌","tee-pamela-playboy":"90s bombshell energy.\n\nПамела Андерсон на культовій обкладинці Playboy — естетика 90-х, абсолютна жіночність і сексуальність поза часом.\n\nForever iconic. Forever sexy. 💋\n\n💋 Склад: 95% бавовна, 5% еластан\n💋 Розмір: універсальний (ONE SIZE)\nЗ любовʼю, Baby Girl 💌"};
const RELEASE='amy-life-playboy-descriptions-20261103';
async function runRelease(env=process.env,request=fetch){
 if(env.VERCEL_ENV!=='production')return;
 const origin=env.SUPABASE_URL,key=env.SUPABASE_SERVICE_ROLE_KEY;
 if(!origin||!key)throw Error('Catalog service configuration missing');
 async function sb(path,method='GET',body){
  const r=await request(origin+'/rest/v1/'+path,{method,headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json',Prefer:'return=representation'},body:body===undefined?undefined:JSON.stringify(body)});
  if(!r.ok)throw Error('Description update failed: HTTP '+r.status);
  const txt=await r.text();return txt.trim()?JSON.parse(txt):[];
 }
 for(const [uid,description] of Object.entries(DESCRIPTIONS)){
  const path='bg_products?uid=eq.'+uid;
  let p=(await sb(path+'&select=uid,active,description,attrs,updated_at'))[0];
  if(!p||!p.active)throw Error('Active product missing: '+uid);
  if(!p.attrs?.[RELEASE]){
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
module.exports={runRelease,DESCRIPTIONS};
if(require.main===module)runRelease().catch(e=>{console.error(e.message);process.exitCode=1;});
