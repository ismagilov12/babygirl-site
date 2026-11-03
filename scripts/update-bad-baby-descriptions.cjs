const DESCRIPTIONS={"bad-baby":"🍼Bad Baby 🍼— колекція для дівчат, які виросли, але не втратили любов до рожевого кольору, дитячих деталей і сміливого стилю. Соски, пляшечки, леопардовий принт, шипи та пірсинг перетворюють знайомі символи дитинства на модний statement. Ніжність і зухвалість в одному образі❤️‍🔥\n\n🧸Поєднання дитячої естетики та дорослого характеру\n💋Sexy look\n💘Oversized \n🐆Мʼяка дихаюча тканина та якісний принт\n\n💋 Склад: 95% бавовна, 5% еластан\n💋 Розмір: універсальний (ONE SIZE)\nЗ любовʼю, Baby Girl 💌","crop-bad-baby":"🍼Bad Baby 🍼— колекція для дівчат, які виросли, але не втратили любов до рожевого кольору, дитячих деталей і сміливого стилю. Соски, пляшечки, леопардовий принт, шипи та пірсинг перетворюють знайомі символи дитинства на модний statement. Ніжність і зухвалість в одному образі❤️‍🔥\n\n🧸Поєднання дитячої естетики та дорослого характеру\n💋Sexy look\n💘Oversized \n🐆Мʼяка дихаюча тканина та якісний принт"};
const RELEASE='bad-baby-copy-20261103';
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
