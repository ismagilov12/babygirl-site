// Retire only the two requested hoodie models; preserve their order history.
async function runRelease(env=process.env,request=fetch){
 if(env.VERCEL_ENV!=='production')return;
 const origin=env.SUPABASE_URL,key=env.SUPABASE_SERVICE_ROLE_KEY;
 if(!origin||!key)throw Error('Catalog service configuration missing');
 const uids=['hoodie-smile-horny','hoodie-sexual-energy'];
 const path='/rest/v1/bg_products?uid=in.('+uids.join(',')+')';
 const headers={apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json',Prefer:'return=representation'};
 const response=await request(origin+path,{method:'PATCH',headers,body:JSON.stringify({active:false,in_grid:false,featured:false})});
 if(!response.ok)throw Error('Hoodie retirement failed: HTTP '+response.status);
 const rows=await response.json();
 if(rows.length!==2||rows.some(p=>!uids.includes(p.uid)||p.active!==false||p.in_grid!==false||p.featured!==false))throw Error('Hoodie retirement verification failed');
 console.log('Requested hoodie retirement verified: Smile Horny and Sexual Energy');
}
module.exports={runRelease};
if(require.main===module)runRelease().catch(e=>{console.error(e.message);process.exitCode=1;});
