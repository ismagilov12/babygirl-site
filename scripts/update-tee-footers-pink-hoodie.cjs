const FOOTER="💋 Склад: 95% бавовна, 5% еластан\n💋 Розмір: універсальний (ONE SIZE)\nЗ любовʼю, Baby Girl 💌";
const SOFT="Ніжність, яка не така вже й проста\nМ’який вигляд з характером😏\nЦей принт про контраст: чистота і трохи провокації🐆\n\n🩷приємна до тіла м’яка тканина\n🩷вільний крій для sexy look образів\n🩷якісний принт,що не стирається";
const PINK='assets/hoodie-new-porn-star-flat-pink.webp';
const FAMILIES=new Set(['tee','icons','self-love','soft-rebel','long']);
function patchFor(p){
 if(p.uid==='hoodie-porn-star'){
  const colors=(p.colors||[]).slice().sort((a,b)=>Number(b.code==='pink')-Number(a.code==='pink'));
  return {photo_main:PINK,photos:[PINK,...(p.photos||[]).filter(x=>x!==PINK)],colors};
 }
 let base=p.uid==='soft-rebel'?SOFT:String(p.description||'').trim();
 const lines=FOOTER.split('\n');base=base.split('\n').filter(line=>!lines.includes(line.trim())).join('\n').trim();
 return {description:base+(base?'\n\n':'')+FOOTER};
}

const RELEASE='tee-footer-pornstar-pink-20261103';
async function runRelease(env=process.env,request=fetch){
 if(env.VERCEL_ENV!=='production')return;
 const origin=env.SUPABASE_URL,key=env.SUPABASE_SERVICE_ROLE_KEY;
 if(!origin||!key)throw Error('Catalog service configuration missing');
 async function sb(path,method='GET',body){
  const r=await request(origin+'/rest/v1/'+path,{method,headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json',Prefer:'return=representation'},body:body===undefined?undefined:JSON.stringify(body)});
  if(!r.ok)throw Error('Catalog update failed: HTTP '+r.status);
  const txt=await r.text();return txt.trim()?JSON.parse(txt):[];
 }
 const all=await sb('bg_products?active=eq.true&select=*&limit=1000');
 if(!all.length||all.length>=1000)throw Error('Unexpected catalog size');
 const targets=all.filter(p=>FAMILIES.has(p.family)||p.uid==='hoodie-porn-star');
 let updated=0;
 for(let p of targets){
  const path='bg_products?uid=eq.'+encodeURIComponent(p.uid);
  if(!p.attrs?.[RELEASE]){
   const patch=patchFor(p);
   const rows=await sb(path+'&updated_at=eq.'+encodeURIComponent(p.updated_at),'PATCH',{...patch,attrs:{...p.attrs,[RELEASE]:true}});
   if(rows.length!==1)throw Error('Concurrent catalog change: '+p.uid);
   p=rows[0];updated++;
   for(const k of Object.keys(patch))if(JSON.stringify(p[k])!==JSON.stringify(patch[k]))throw Error('Catalog verification failed: '+p.uid+' '+k);
  }
  if(p.uid==='hoodie-porn-star'){
   const image='https://www.babygirl.com.ua/'+p.photo_main;
   await sb('products?bg_uid=eq.hoodie-porn-star&sku=eq.BG-hoodie-porn-star','PATCH',{photo:image,image_url:image,images:p.photos.map(x=>/^https?:/.test(x)?x:'https://www.babygirl.com.ua/'+x)});
  }else{
   await sb('products?bg_uid=eq.'+encodeURIComponent(p.uid),'PATCH',{description:p.description});
   const crm=await sb('products?bg_uid=eq.'+encodeURIComponent(p.uid)+'&select=description');
   if(crm.some(x=>x.description!==p.description))throw Error('CRM mismatch: '+p.uid);
  }
 }
 console.log('Tee footers and Porn Star pink main photo verified: '+targets.length+' products; newly updated '+updated);
}
module.exports={patchFor,runRelease,FOOTER,SOFT};
if(require.main===module)runRelease().catch(e=>{console.error(e.message);process.exitCode=1;});
