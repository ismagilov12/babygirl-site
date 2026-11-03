// One-time exact product description update.
const DESCRIPTION="Футболка з тим самим крашем із 2000-х\n\nОверсайз крій, нереально м’яка до тіла тканина, що дихає\n\nТрендовий pink колір додає образу ніжності та вайбу нульових 🎀";
const RELEASE='eminem-description-20261103';
async function runRelease(env=process.env,request=fetch){
 if(env.VERCEL_ENV!=='production')return;
 const origin=env.SUPABASE_URL,key=env.SUPABASE_SERVICE_ROLE_KEY;
 if(!origin||!key)throw Error('Catalog service configuration missing');
 async function sb(path,method='GET',body){
  const r=await request(origin+'/rest/v1/'+path,{method,headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json',Prefer:'return=representation'},body:body===undefined?undefined:JSON.stringify(body)});
  if(!r.ok)throw Error('Description update failed: HTTP '+r.status);
  const txt=await r.text();return txt.trim()?JSON.parse(txt):[];
 }
 const path='bg_products?uid=eq.eminem';
 let p=(await sb(path+'&select=uid,description,attrs,updated_at'))[0];
 if(!p)throw Error('Eminem product missing');
 if(!p.attrs?.[RELEASE]){
  const saved=await sb(path+'&updated_at=eq.'+encodeURIComponent(p.updated_at),'PATCH',{description:DESCRIPTION,attrs:{...p.attrs,[RELEASE]:true}});
  if(saved.length!==1||saved[0].description!==DESCRIPTION)throw Error('Description verification failed');
  p=saved[0];
 }
 await sb('products?bg_uid=eq.eminem','PATCH',{description:p.description});
 const check=(await sb(path+'&select=description'))[0];
 const crm=await sb('products?bg_uid=eq.eminem&select=description');
 if(check?.description!==p.description||crm.some(x=>x.description!==p.description))throw Error('Catalog/CRM description mismatch');
 console.log('Eminem description verified in storefront and CRM');
}
module.exports={runRelease,DESCRIPTION};
if(require.main===module)runRelease().catch(e=>{console.error(e.message);process.exitCode=1;});
