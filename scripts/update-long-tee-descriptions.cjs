const DESCRIPTIONS={"long-eminem":"Футболка з тим самим крашем із 2000-х\n\nОверсайз крій, нереально м’яка до тіла тканина, що дихає\n\nТрендовий pink колір додає образу ніжності та вайбу нульових 🎀\n\n🎀 Подовжена версія футболки, яку можна носити як мінісукню.\n\n💋 Склад: 95% бавовна, 5% еластан\n💋 Розмір: універсальний (ONE SIZE)\nЗ любовʼю, Baby Girl 💌","long-barbwire":"Культова Памела Андерсон на принті — символ впевненості, жіночності та зухвалої сексуальності, яка ніколи не виходить з моди!\n\nТрохи 90s nostalgia, трохи bad girl energy і максимум сексуальності без жодних правил.\n\n🎀 Оверсайз крій — щоб ти почувалася максимально вільно та водночас very sexy.\n\n🎀 Якісний принт — стійкий до стирання та створений, щоб залишатися яскравим.\n\n🎀 Тканина дихає — комфорт навіть у найгарячіші дні.\n\nNot just a T-shirt. It’s a whole attitude.\n\n🎀 Подовжена версія футболки, яку можна носити як мінісукню.\n\n💋 Склад: 95% бавовна, 5% еластан\n💋 Розмір: універсальний (ONE SIZE)\nЗ любовʼю, Baby Girl 💌","long-soft-rebel":"Ніжність, яка не така вже й проста\nМ’який вигляд з характером😏\nЦей принт про контраст: чистота і трохи провокації🐆\n\n🩷приємна до тіла м’яка тканина\n🩷вільний крій для sexy look образів\n🩷якісний принт,що не стирається\n\n🎀 Подовжена версія футболки, яку можна носити як мінісукню.\n\n💋 Склад: 95% бавовна, 5% еластан\n💋 Розмір: універсальний (ONE SIZE)\nЗ любовʼю, Baby Girl 💌"};
const RELEASE='long-tee-descriptions-20261103';
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
