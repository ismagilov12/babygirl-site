const ASSET="https://fsihlzzjewhxpogvjapu.supabase.co/storage/v1/object/public/product-photos/babygirl/too-sexy-video-20261104.mp4";
const UIDS=["tee-too-sexy-stress"];
const RELEASE="too-sexy-video-20261104";

function withVideo(value){
 const list=Array.isArray(value)?value.filter(Boolean):[];
 return list.includes(ASSET)?list:[...list,ASSET];
}
function addAsset(product){
 return {
  ...product,
  photos:withVideo(product.photos),
  colors:Array.isArray(product.colors)?product.colors.map(color=>({...color,photos:withVideo(color.photos)})):product.colors,
  attrs:{...(product.attrs||{}),[RELEASE]:true}
 };
}
function hasAsset(product){
 return Array.isArray(product.photos)&&product.photos.includes(ASSET)
  &&Array.isArray(product.colors)&&product.colors.every(color=>Array.isArray(color.photos)&&color.photos.includes(ASSET));
}
async function runRelease(env=process.env,request=fetch){
 if(env.VERCEL_ENV!=='production')return;
 const origin=env.SUPABASE_URL,key=env.SUPABASE_SERVICE_ROLE_KEY;
 if(!origin||!key)throw Error('Catalog service configuration missing');
 async function sb(path,method='GET',body){
  const response=await request(origin+'/rest/v1/'+path,{method,headers:{
   apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json',Prefer:'return=representation'
  },body:body===undefined?undefined:JSON.stringify(body)});
  if(!response.ok)throw Error('Too Sexy video update failed: HTTP '+response.status);
  const value=await response.text();
  return value.trim()?JSON.parse(value):[];
 }
 for(const uid of UIDS){
  const path='bg_products?uid=eq.'+uid;
  let product=(await sb(path+'&select=uid,active,photos,colors,attrs,updated_at'))[0];
  if(!product||!product.active)throw Error('Active product missing: '+uid);
  if(!product.attrs?.[RELEASE]){
   const next=addAsset(product);
   const saved=await sb(path+'&updated_at=eq.'+encodeURIComponent(product.updated_at),'PATCH',{
    photos:next.photos,colors:next.colors,attrs:next.attrs
   });
   if(saved.length!==1)throw Error('Concurrent catalog update: '+uid);
   product=saved[0];
  }
  const check=(await sb(path+'&select=uid,photos,colors'))[0];
  if(!check||!hasAsset(check))throw Error('Too Sexy video verification failed: '+uid);
  console.log('Too Sexy video verified: '+uid);
 }
}
module.exports={runRelease,addAsset,hasAsset,ASSET,UIDS};
if(require.main===module)runRelease().catch(error=>{console.error(error.message);process.exitCode=1;});
