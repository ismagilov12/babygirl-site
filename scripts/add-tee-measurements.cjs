const ASSET="assets/size-oversize.webp";
const RELEASE="standard-tee-measurements-20261104";
const STANDARD_FAMILIES=new Set(["tee","icons","self-love","soft-rebel"]);

function isStandardTee(product){
 const uid=String(product&&product.uid||"");
 return Boolean(product)
  &&product.active!==false
  &&STANDARD_FAMILIES.has(product.family)
  &&product.attrs?.version!=="long"
  &&!/^long-/.test(uid)
  &&!/-long$/.test(uid);
}
function withPhoto(value,fallback){
 const list=Array.isArray(value)?value.filter(Boolean):[];
 if(!list.length&&fallback)list.push(fallback);
 return list.includes(ASSET)?list:[...list,ASSET];
}
function addMeasurements(product){
 return {
  ...product,
  photos:withPhoto(product.photos,product.photo_main),
  colors:Array.isArray(product.colors)?product.colors.map(color=>({
   ...color,
   photos:withPhoto(color.photos,color.photo)
  })):product.colors,
  attrs:{...(product.attrs||{}),[RELEASE]:true}
 };
}
function hasMeasurements(product){
 return Array.isArray(product.photos)&&product.photos.includes(ASSET)
  &&(!Array.isArray(product.colors)||product.colors.every(color=>Array.isArray(color.photos)&&color.photos.includes(ASSET)));
}
async function runRelease(env=process.env,request=fetch){
 if(env.VERCEL_ENV!=="production")return;
 const origin=env.SUPABASE_URL,key=env.SUPABASE_SERVICE_ROLE_KEY;
 if(!origin||!key)throw Error("Catalog service configuration missing");
 async function sb(path,method="GET",body){
  const response=await request(origin+"/rest/v1/"+path,{method,headers:{
   apikey:key,Authorization:"Bearer "+key,"Content-Type":"application/json",Prefer:"return=representation"
  },body:body===undefined?undefined:JSON.stringify(body)});
  if(!response.ok)throw Error("Tee measurements update failed: HTTP "+response.status);
  const value=await response.text();
  return value.trim()?JSON.parse(value):[];
 }
 const rows=await sb("bg_products?active=eq.true&select=uid,family,active,photo_main,photos,colors,attrs,updated_at&order=uid.asc");
 const targets=rows.filter(isStandardTee);
 if(!targets.length)throw Error("No standard tees found");
 for(let product of targets){
  const path="bg_products?uid=eq."+encodeURIComponent(product.uid);
  if(!product.attrs?.[RELEASE]||!hasMeasurements(product)){
   const next=addMeasurements(product);
   const saved=await sb(path+"&updated_at=eq."+encodeURIComponent(product.updated_at),"PATCH",{
    photos:next.photos,colors:next.colors,attrs:next.attrs
   });
   if(saved.length!==1)throw Error("Concurrent catalog update: "+product.uid);
   product=saved[0];
  }
  const check=(await sb(path+"&select=uid,photos,colors"))[0];
  if(!check||!hasMeasurements(check))throw Error("Tee measurements verification failed: "+product.uid);
 }
 console.log("Tee measurements verified: "+targets.length);
}
module.exports={runRelease,isStandardTee,addMeasurements,hasMeasurements,ASSET,RELEASE};
if(require.main===module)runRelease().catch(error=>{console.error(error.message);process.exitCode=1;});
