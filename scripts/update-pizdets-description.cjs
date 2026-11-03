// One-time exact product description update.
const DESCRIPTION="Pretty girls have bad days too.\n\nНавіть коли навколо повний піздець, ти все одно можеш виглядати як найніжніша квіточка.\n\nРожеві троянди, метелик і слово, яке іноді описує життя краще за тисячу інших.\n\nТрохи романтики, трохи сарказму і той самий Baby Girl attitude.\n\nДля дівчат, які можуть одночасно любити рожевий, плакати під улюблену пісню та послати все до біса.\n\n🎀 Вільний оверсайз крій — комфорт без компромісів.\n\n🎀 Ніжна до тіла тканина, яка дозволяє шкірі дихати.\n\n🎀 Контрастний принт — солодка естетика з характером.\n\nLife is a mess, but at least I’m cute.\n\n💋 Склад: 95% бавовна, 5% еластан\n💋 Розмір: універсальний (ONE SIZE)\nЗ любовʼю, Baby Girl 💌";
const RELEASE='pizdets-description-20261103';
async function runRelease(env=process.env,request=fetch){
 if(env.VERCEL_ENV!=='production')return;
 const origin=env.SUPABASE_URL,key=env.SUPABASE_SERVICE_ROLE_KEY;
 if(!origin||!key)throw Error('Catalog service configuration missing');
 async function sb(path,method='GET',body){
  const r=await request(origin+'/rest/v1/'+path,{method,headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json',Prefer:'return=representation'},body:body===undefined?undefined:JSON.stringify(body)});
  if(!r.ok)throw Error('Description update failed: HTTP '+r.status);
  const txt=await r.text();return txt.trim()?JSON.parse(txt):[];
 }
 const path='bg_products?uid=eq.tee-pizdets';
 let p=(await sb(path+'&select=uid,description,attrs,updated_at'))[0];
 if(!p)throw Error('Pizdets product missing');
 if(!p.attrs?.[RELEASE]){
  const saved=await sb(path+'&updated_at=eq.'+encodeURIComponent(p.updated_at),'PATCH',{description:DESCRIPTION,attrs:{...p.attrs,[RELEASE]:true}});
  if(saved.length!==1||saved[0].description!==DESCRIPTION)throw Error('Description verification failed');
  p=saved[0];
 }
 await sb('products?bg_uid=eq.tee-pizdets','PATCH',{description:p.description});
 const check=(await sb(path+'&select=description'))[0];
 const crm=await sb('products?bg_uid=eq.tee-pizdets&select=description');
 if(check?.description!==p.description||crm.some(x=>x.description!==p.description))throw Error('Catalog/CRM description mismatch');
 console.log('Pizdets description verified in storefront and CRM');
}
module.exports={runRelease,DESCRIPTION};
if(require.main===module)runRelease().catch(e=>{console.error(e.message);process.exitCode=1;});
