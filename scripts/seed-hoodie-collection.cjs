const products=require('../data/hoodie-collection-20261107.json');
const {syncProductToCrm,expectedCrmRows}=require('../api/_crm-catalog');
async function main(){
 if(process.env.VERCEL_ENV!=='production')return;
 const origin=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!origin||!key)throw Error('Catalog service configuration missing');
 async function sb(path,options={}){
  const r=await fetch(origin+'/rest/v1/'+path,{method:options.method||'GET',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json',Prefer:'return=representation',...options.headers},body:options.body,signal:AbortSignal.timeout(30000)});
  if(!r.ok)throw Error('Hoodie catalog request: HTTP '+r.status);
  const text=await r.text();return text.trim()?JSON.parse(text):[];
 }
 for(const base of products){
  const path='bg_products?uid=eq.'+base.uid;
  let current=(await sb(path+'&select=*'))[0];
  if(current?.attrs?.catalog_release===base.attrs.catalog_release){console.log(base.uid+' already registered');continue;}
  if(current&&(current.title!==base.title||Number(current.price)!==2990))throw Error(base.uid+' differs from release; preserving admin changes');
  const p=structuredClone(base);
  if(p.uid==='hoodie-pillow-talk'){
   const tee=(await sb('bg_products?uid=eq.pillow-talk&select=photos,colors'))[0];
   if(!tee)throw Error('Pillow Talk tee missing');
   const extra=[...new Set([...(tee.photos||[]),...(tee.colors||[]).flatMap(c=>[c.photo,...(c.photos||[])])].filter(s=>typeof s==='string'&&!/size-|measurements|sizeguide/i.test(s)))];
   p.photos=[p.colors[0].photo,p.colors[1].photo,...extra,'assets/hoodie-size-guide-ua.webp'];
   p.colors.forEach(c=>c.photos=[c.photo,...p.photos.filter(s=>s!==c.photo)]);
  }
  if(!current)current=(await sb('bg_products?on_conflict=uid',{method:'POST',headers:{Prefer:'return=representation,resolution=ignore-duplicates'},body:JSON.stringify({...p,attrs:{...p.attrs,catalog_release:null}})}))[0];
  if(!current||Number(current.price)!==2990||!current.active||current.colors?.length!==2)throw Error(p.uid+' storefront verification failed');
  await syncProductToCrm(sb,current,{siteOrigin:'https://www.babygirl.com.ua'});
  const crm=await sb('products?bg_uid=eq.'+p.uid+'&select=sku,price,is_active');
  if(!expectedCrmRows(current).every(e=>crm.some(r=>r.sku===e.sku&&Number(r.price)===2990&&r.is_active)))throw Error(p.uid+' CRM verification failed');
  await sb(path,{method:'PATCH',body:JSON.stringify({attrs:p.attrs})});
  console.log(p.uid+' verified: 2990 UAH, pink/black, CRM synced');
 }
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
