const RELEASE='copy-long-pamela-gallery-20261103';
const EXCLUDED=['assets/size-long.webp','assets/pamela-90s-1.webp','https://fsihlzzjewhxpogvjapu.supabase.co/storage/v1/object/public/product-photos/long-barbwire-1779398186998-81kxk.webp'];
async function runRelease(){
 if(process.env.VERCEL_ENV!=='production')return;
 const origin=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!origin||!key)throw Error('Catalog configuration missing');
 async function sb(path,method='GET',body){
  const r=await fetch(origin+'/rest/v1/'+path,{method,headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json',Prefer:'return=representation'},body:body===undefined?undefined:JSON.stringify(body)});
  if(!r.ok)throw Error('Gallery update HTTP '+r.status);return r.json();
 }
 const source=(await sb('bg_products?uid=eq.long-barbwire&select=uid,photos,colors'))[0];
 const path='bg_products?uid=eq.pamela-90s';
 let target=(await sb(path+'&select=uid,photos,colors,attrs,updated_at'))[0];
 if(!source||!target)throw Error('Pamela product missing');
 const media=[...new Set([...(source.photos||[]),...(source.colors||[]).flatMap(c=>c.photos||[])])].filter(x=>!EXCLUDED.includes(x));
 if(!target.attrs?.[RELEASE]){
  const photos=[...new Set([...(target.photos||[]),...media])];
  const colors=(target.colors||[]).map(c=>({...c,photos:[...new Set([...(c.photos||[]),...media])]}));
  const saved=await sb(path+'&updated_at=eq.'+encodeURIComponent(target.updated_at),'PATCH',{photos,colors,attrs:{...target.attrs,[RELEASE]:true}});
  if(saved.length!==1)throw Error('Concurrent gallery change');
  target=saved[0];
 }
 if(!media.every(x=>target.photos.includes(x)))throw Error('Gallery copy verification failed');
 console.log('Pamela long media copied to standard tee and verified');
}
if(require.main===module)runRelease().catch(e=>{console.error(e.message);process.exitCode=1;});
