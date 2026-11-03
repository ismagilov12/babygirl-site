// One-time exact product description update.
const DESCRIPTION="ПОХУЙ 🦄🎀\n\nToo pretty to give a fuck.\n\nІноді найкраще, що ти можеш зробити для себе, — просто сказати «похуй» і продовжити сяяти.\n\nРожеві хмаринки, казковий поні та одне маленьке слово, яке здатне врятувати твою нервову систему.\n\nЦя футболка для дівчат, які обирають себе, свій спокій та задоволення від життя.\n\nБо бути ніжною — не означає бути зручною.\n\n🎀 Оверсайз крій — максимум свободи та effortless sexy vibe.\n\n🎀 М’яка, приємна до тіла тканина, що дихає.\n\n🎀 Яскравий принт із казковою естетикою та зухвалим характером.\n\nStay cute. Give zero fucks.\n\nWith love, Baby Girl 💋\n\n💋 Склад: 95% бавовна, 5% еластан\n💋 Розмір: універсальний (ONE SIZE)\nЗ любовʼю, Baby Girl 💌";
const RELEASE='pokhui-description-20261103';
async function runRelease(env=process.env,request=fetch){
 if(env.VERCEL_ENV!=='production')return;
 const origin=env.SUPABASE_URL,key=env.SUPABASE_SERVICE_ROLE_KEY;
 if(!origin||!key)throw Error('Catalog service configuration missing');
 async function sb(path,method='GET',body){
  const r=await request(origin+'/rest/v1/'+path,{method,headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json',Prefer:'return=representation'},body:body===undefined?undefined:JSON.stringify(body)});
  if(!r.ok)throw Error('Description update failed: HTTP '+r.status);
  const txt=await r.text();return txt.trim()?JSON.parse(txt):[];
 }
 const path='bg_products?uid=eq.tee-pokhui';
 let p=(await sb(path+'&select=uid,description,attrs,updated_at'))[0];
 if(!p)throw Error('Pokhui product missing');
 if(!p.attrs?.[RELEASE]){
  const saved=await sb(path+'&updated_at=eq.'+encodeURIComponent(p.updated_at),'PATCH',{description:DESCRIPTION,attrs:{...p.attrs,[RELEASE]:true}});
  if(saved.length!==1||saved[0].description!==DESCRIPTION)throw Error('Description verification failed');
  p=saved[0];
 }
 await sb('products?bg_uid=eq.tee-pokhui','PATCH',{description:p.description});
 const check=(await sb(path+'&select=description'))[0];
 const crm=await sb('products?bg_uid=eq.tee-pokhui&select=description');
 if(check?.description!==p.description||crm.some(x=>x.description!==p.description))throw Error('Catalog/CRM description mismatch');
 console.log('Pokhui description verified in storefront and CRM');
}
module.exports={runRelease,DESCRIPTION};
if(require.main===module)runRelease().catch(e=>{console.error(e.message);process.exitCode=1;});
