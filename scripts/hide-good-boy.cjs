// Hide this product from the storefront without deleting catalog or order history.
const RELEASE='hide-good-boy-20261103';
async function runRelease(env=process.env,request=fetch){
 if(env.VERCEL_ENV!=='production')return;
 const origin=env.SUPABASE_URL,key=env.SUPABASE_SERVICE_ROLE_KEY;
 if(!origin||!key)throw Error('Catalog service configuration missing');
 async function sb(path,method='GET',body){
  const r=await request(origin+'/rest/v1/'+path,{method,headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json',Prefer:'return=representation'},body:body===undefined?undefined:JSON.stringify(body)});
  if(!r.ok)throw Error('Product hide failed: HTTP '+r.status);
  const txt=await r.text();return txt.trim()?JSON.parse(txt):[];
 }
 const path='bg_products?uid=eq.tee-good-boy';
 let p=(await sb(path+'&select=uid,active,in_grid,featured,attrs,updated_at'))[0];
 if(!p)throw Error('Good Boy product missing');
 if(!p.attrs?.[RELEASE]){
  const saved=await sb(path+'&updated_at=eq.'+encodeURIComponent(p.updated_at),'PATCH',{active:false,in_grid:false,featured:false,attrs:{...p.attrs,feed_enabled:false,[RELEASE]:true}});
  if(saved.length!==1)throw Error('Concurrent product change');
  p=saved[0];
  if(p.active||p.in_grid||p.featured||p.attrs.feed_enabled!==false)throw Error('Product hide verification failed');
 }
 console.log('Good Boy storefront removal verified');
}
module.exports={runRelease};
if(require.main===module)runRelease().catch(e=>{console.error(e.message);process.exitCode=1;});
