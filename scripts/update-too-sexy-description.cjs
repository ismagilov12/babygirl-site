// One-time exact product description update.
const DESCRIPTION="TOO SEXY FOR ALL THIS STRESS 💋\n\nЗанадто сексуальна, щоб витрачати своє життя на стрес.\n\nЦя футболка — не просто річ у гардеробі, а твій особистий маніфест.\n\nМенше драми, більше любові до себе. Менше зайвих думок, більше задоволення від життя.\n\nТи не створена для того, щоб перейматися дрібницями. Ти створена, щоб сяяти, закохувати в себе та насолоджуватися кожним моментом.\n\nToo sexy for all this stress — нагадування про те, що твоя енергія занадто цінна, щоб витрачати її на зайве.\n\nStay hot. Stay unbothered. Stay Baby Girl. 🎀";
const RELEASE='too-sexy-description-20261103';
async function runRelease(env=process.env,request=fetch){
 if(env.VERCEL_ENV!=='production')return;
 const origin=env.SUPABASE_URL,key=env.SUPABASE_SERVICE_ROLE_KEY;
 if(!origin||!key)throw Error('Catalog service configuration missing');
 async function sb(path,method='GET',body){
  const r=await request(origin+'/rest/v1/'+path,{method,headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json',Prefer:'return=representation'},body:body===undefined?undefined:JSON.stringify(body)});
  if(!r.ok)throw Error('Description update failed: HTTP '+r.status);
  const txt=await r.text();return txt.trim()?JSON.parse(txt):[];
 }
 const path='bg_products?uid=eq.tee-too-sexy-stress';
 let p=(await sb(path+'&select=uid,description,attrs,updated_at'))[0];
 if(!p)throw Error('Too Sexy product missing');
 if(!p.attrs?.[RELEASE]){
  const saved=await sb(path+'&updated_at=eq.'+encodeURIComponent(p.updated_at),'PATCH',{description:DESCRIPTION,attrs:{...p.attrs,[RELEASE]:true}});
  if(saved.length!==1||saved[0].description!==DESCRIPTION)throw Error('Description verification failed');
  p=saved[0];
 }
 await sb('products?bg_uid=eq.tee-too-sexy-stress','PATCH',{description:p.description});
 const check=(await sb(path+'&select=description'))[0];
 const crm=await sb('products?bg_uid=eq.tee-too-sexy-stress&select=description');
 if(check?.description!==p.description||crm.some(x=>x.description!==p.description))throw Error('Catalog/CRM description mismatch');
 console.log('Too Sexy description verified in storefront and CRM');
}
module.exports={runRelease,DESCRIPTION};
if(require.main===module)runRelease().catch(e=>{console.error(e.message);process.exitCode=1;});
