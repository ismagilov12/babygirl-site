// Run existing catalog build steps in their established order.
const {spawnSync}=require('node:child_process');
const pillowRelease=spawnSync(process.execPath,['scripts/seed-hoodie-collection.cjs'],{stdio:'inherit',env:process.env});
if(pillowRelease.error)throw pillowRelease.error;
if(pillowRelease.status!==0)process.exit(pillowRelease.status||1);
// Storefront publication must not depend on historical database releases.
// Run those explicitly with RUN_CATALOG_MAINTENANCE=1 when catalog maintenance is intended.
if(process.env.RUN_CATALOG_MAINTENANCE!=='1'){
 const fs=require('node:fs');
 const vm=require('node:vm');
 for(const file of ['index.html','en.html']){
  const html=fs.readFileSync(file,'utf8');
  for(const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
   if(/\bsrc\s*=/.test(match[1])||!match[2].trim())continue;
   if(/application\/(?:ld\+)?json/.test(match[1]))JSON.parse(match[2]);
   else if(!/type\s*=\s*["']module["']/.test(match[1]))new vm.Script(match[2],{filename:file});
  }
 }
 const checked=spawnSync(process.execPath,['--check','assets/babygirl-installments.js'],{stdio:'inherit'});
 if(checked.error)throw checked.error;
 if(checked.status!==0)process.exit(checked.status||1);
 console.log('Storefront validation passed; historical catalog maintenance is opt-in.');
 process.exit(0);
}
const steps=[["scripts/hide-requested-hoodies.cjs"],["--check","assets/babygirl-installments.js"],["scripts/add-suit-video.cjs"],["scripts/seed-bad-baby-long.cjs"],["scripts/price-tee-hoodie-plus135.cjs"],["scripts/price-tops-plus135.cjs"],["scripts/update-bb-price-barb-photo.cjs"],["scripts/update-too-sexy-description.cjs"],["scripts/update-eminem-description.cjs"],["scripts/update-pamela90s-description.cjs"],["scripts/update-tee-footers-pink-hoodie.cjs"],["scripts/update-pokhui-description.cjs"],["scripts/update-zen-pokhui-description.cjs"],["scripts/update-pizdets-description.cjs"],["scripts/hide-good-boy.cjs"],["scripts/update-amy-life-playboy-descriptions.cjs"],["scripts/update-bad-baby-descriptions.cjs"],["scripts/add-bad-baby-shared-video.cjs"],["scripts/update-doja-description.cjs"],["scripts/update-beavis-description.cjs"],["scripts/update-pillow-onlyfans-descriptions.cjs"],["scripts/update-badgirls-description.cjs"],["scripts/update-pornstar-crop-description.cjs"],["scripts/update-long-tee-descriptions.cjs"],["scripts/remove-pamela-skirt.cjs"],["scripts/copy-pamela-long-gallery.cjs"],["scripts/remove-pamela-cap-standard.cjs"],["scripts/remove-too-sexy-missing-video.cjs"],["scripts/add-too-sexy-video.cjs"],["scripts/add-tee-measurements.cjs"]];
steps.push(["scripts/seed-tableware.cjs"]);
steps.push(["scripts/price-suit-sale-4500.cjs"]);
for(const args of steps){
 const result=spawnSync(process.execPath,args,{stdio:'inherit',env:process.env});
 if(result.error)throw result.error;
 if(result.status!==0)process.exit(result.status||1);
}
