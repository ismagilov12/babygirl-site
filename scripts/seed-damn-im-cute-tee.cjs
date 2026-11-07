const product = require('../data/damn-im-cute-tee.json');
const {syncProductToCrm,expectedCrmRows} = require('../api/_crm-catalog');
async function main(){
 if(process.env.VERCEL_ENV!=='production')return;
 const origin=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!origin||!key)throw Error('Catalog service configuration missing');
 async function sb(path,options={}){
  const r=await fetch(origin+'/rest/v1/'+path,{method:options.method||'GET',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json',Prefer:'return=representation',...options.headers},body:options.body,signal:AbortSignal.timeout(30000)});
  if(!r.ok)throw Error('Cute tee catalog: HTTP '+r.status);
  const raw=await r.text();return raw.trim()?JSON.parse(raw):[];
 }
 const path='bg_products?uid=eq.'+product.uid;
 let current=(await sb(path+'&select=*'))[0];
 if(current?.attrs?.catalog_release===product.attrs.catalog_release){
  if(current.photo_main===product.photo_main){console.log('Cute tee already registered');return;}
  current=(await sb(path,{method:'PATCH',body:JSON.stringify({photo_main:product.photo_main})}))[0];
  if(!current||current.photo_main!==product.photo_main)throw Error('Cute tee pink main photo update failed');
  await syncProductToCrm(sb,current,{siteOrigin:'https://www.babygirl.com.ua'});
  const crm=await sb('products?bg_uid=eq.'+product.uid+'&select=sku,image_url,is_active');
  const expectedMain='https://www.babygirl.com.ua/'+product.photo_main;
  if(!crm.some(r=>r.sku==='BG-'+product.uid&&r.image_url===expectedMain&&r.is_active))throw Error('Cute tee pink CRM photo verification failed');
  console.log('Cute tee pink main photo verified on storefront and CRM');
  return;
 }
 if(current&&!(current.title===product.title&&current.attrs?.catalog_release===null))throw Error('Cute tee UID already exists; preserving admin changes');
 if(!current)current=(await sb('bg_products?on_conflict=uid',{method:'POST',headers:{Prefer:'return=representation,resolution=ignore-duplicates'},body:JSON.stringify({...product,attrs:{...product.attrs,catalog_release:null}})}))[0];
 if(!current)current=(await sb(path+'&select=*'))[0];
 if(!current||current.title!==product.title||Number(current.price)!==product.price||!current.active||current.colors?.length!==3)throw Error('Cute tee storefront verification failed');
 await syncProductToCrm(sb,current,{siteOrigin:'https://www.babygirl.com.ua'});
 const crm=await sb('products?bg_uid=eq.'+product.uid+'&select=sku,price,is_active');
 if(!expectedCrmRows(current).every(e=>crm.some(r=>r.sku===e.sku&&Number(r.price)===product.price&&r.is_active)))throw Error('Cute tee CRM verification failed');
 await sb(path,{method:'PATCH',body:JSON.stringify({attrs:product.attrs})});
 console.log('Cute tee verified: 3 colors, storefront and CRM synced');
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
