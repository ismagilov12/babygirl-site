// Run existing catalog build steps in their established order.
const {spawnSync}=require('node:child_process');
const steps=[["--check","assets/babygirl-installments.js"],["scripts/add-suit-video.cjs"],["scripts/seed-bad-baby-long.cjs"],["scripts/price-tee-hoodie-plus135.cjs"],["scripts/price-tops-plus135.cjs"],["scripts/update-bb-price-barb-photo.cjs"],["scripts/update-too-sexy-description.cjs"],["scripts/update-eminem-description.cjs"],["scripts/update-pamela90s-description.cjs"],["scripts/update-tee-footers-pink-hoodie.cjs"],["scripts/update-pokhui-description.cjs"],["scripts/update-zen-pokhui-description.cjs"],["scripts/update-pizdets-description.cjs"],["scripts/hide-good-boy.cjs"],["scripts/update-amy-life-playboy-descriptions.cjs"],["scripts/update-bad-baby-descriptions.cjs"],["scripts/add-bad-baby-shared-video.cjs"],["scripts/update-doja-description.cjs"],["scripts/update-beavis-description.cjs"]];
for(const args of steps){
 const result=spawnSync(process.execPath,args,{stdio:'inherit',env:process.env});
 if(result.error)throw result.error;
 if(result.status!==0)process.exit(result.status||1);
}
