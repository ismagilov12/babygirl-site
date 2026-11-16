const {spawnSync}=require('node:child_process');
// Storefront publication must not depend on historical database releases.
// Run those explicitly with RUN_CATALOG_MAINTENANCE=1 when catalog maintenance is intended.
if(process.env.RUN_CATALOG_MAINTENANCE!=='1'){
 const fs=require('node:fs');
 const vm=require('node:vm');
 const hiddenHoodies = [
  'hoodie-social-club', 'hoodie-bad-girls-club', 'hoodie-too-sexy-stress',
  'hoodie-karma-baby-karma', 'hoodie-hey-arnold', 'hoodie-digital-riot',
  'hoodie-clear', 'hoodie-baby-girl-dtf-20261027'
 ];
 const hiddenMarker = 'var STOREFRONT_HIDDEN = {';
 const hiddenEntries = hiddenHoodies.map(uid => JSON.stringify(uid) + ':1').join(', ');
 const hiddenHeader = hiddenMarker + '\n    ' + hiddenEntries + ',';
 const galleryMarker = "      if (p.uid === 'soft-rebel') p.family = 'tee';";
 const oneNightGallery = `      if (p.uid === 'hoodie-one-night-only'){
        var removedPhoto = 'assets/hoodie-new-one-night-only-flat-black.webp';
        p.photos = (p.photos || []).filter(function(url){ return url !== removedPhoto; });
        (p.colors || []).forEach(function(color){
          if (Array.isArray(color.photos)){
            color.photos = color.photos.filter(function(url){ return url !== removedPhoto; });
          }
          if (color.photo === removedPhoto) color.photo = (color.photos || [])[0] || p.photos[0];
        });
        if (p.photo_main === removedPhoto) p.photo_main = p.photos[0];
      }
`;
 const teePhotos = `      var campaign = {
        'tee-pizdets': { ids: [3441, 3442, 3443, 3444, 3448, 3449] },
        'tee-pokhui': { ids: [3445, 3446, 3447] },
        'tee-ya-ne-yibu': { ids: [3367, 3451] },
        'eminem': { color: 'pink', ids: [185, 186] },
        'pamela-90s': { color: 'black', ids: [978] }
      }[p.uid];
      if (campaign){
        var newPhotos = campaign.ids.map(function(id){ return 'assets/tee-campaign-' + id + '.webp'; });
        var existingPhotos = (Array.isArray(p.photos) && p.photos.length ? p.photos : [p.photo_main]).filter(Boolean);
        p.photos = Array.from(new Set(existingPhotos.concat(newPhotos)));
        (p.colors || []).forEach(function(color){
          if (campaign.color && color.code !== campaign.color) return;
          var photos = Array.isArray(color.photos) && color.photos.length ? color.photos : [color.photo].concat(existingPhotos);
          color.photos = Array.from(new Set(photos.filter(Boolean).concat(newPhotos)));
        });
      }
`;
 for(const file of ['index.html','en.html']){
  const source = fs.readFileSync(file,'utf8');
  if (source.split(hiddenMarker).length !== 2) throw new Error('Storefront visibility list missing in ' + file);
  if (source.split(galleryMarker).length !== 2) throw new Error('Storefront gallery normalization missing in ' + file);
  const withVisibility = source.includes(hiddenHeader) ? source : source.replace(hiddenMarker, hiddenHeader);
  const galleryOverrides = oneNightGallery + teePhotos;
  const withOneNightGallery = withVisibility.includes(oneNightGallery) ? withVisibility
   : withVisibility.replace(galleryMarker, oneNightGallery + galleryMarker);
  const html = withOneNightGallery.includes(teePhotos) ? withOneNightGallery
   : withOneNightGallery.replace(oneNightGallery, galleryOverrides);
  for(const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
   if(/\bsrc\s*=/.test(match[1])||!match[2].trim())continue;
   if(/application\/(?:ld\+)?json/.test(match[1]))JSON.parse(match[2]);
   else if(!/type\s*=\s*["']module["']/.test(match[1]))new vm.Script(match[2],{filename:file});
  }
  fs.writeFileSync(file, html);
 }
 const checked=spawnSync(process.execPath,['--check','assets/babygirl-installments.js'],{stdio:'inherit'});
 if(checked.error)throw checked.error;
 if(checked.status!==0)process.exit(checked.status||1);
 const release=spawnSync(process.execPath,['scripts/release-tee-price-2100.cjs'],{stdio:'inherit'});
 if(release.error)throw release.error;
 if(release.status!==0)process.exit(release.status||1);
 console.log('Storefront validation passed; historical catalog maintenance is opt-in.');
 process.exit(0);
}
const steps=[["scripts/hide-requested-hoodies.cjs"],["--check","assets/babygirl-installments.js"],["scripts/add-suit-video.cjs"],["scripts/seed-bad-baby-long.cjs"],["scripts/price-tee-hoodie-plus135.cjs"],["scripts/price-tops-plus135.cjs"],["scripts/update-bb-price-barb-photo.cjs"],["scripts/update-too-sexy-description.cjs"],["scripts/update-eminem-description.cjs"],["scripts/update-pamela90s-description.cjs"],["scripts/update-tee-footers-pink-hoodie.cjs"],["scripts/update-pokhui-description.cjs"],["scripts/update-zen-pokhui-description.cjs"],["scripts/update-pizdets-description.cjs"],["scripts/hide-good-boy.cjs"],["scripts/update-amy-life-playboy-descriptions.cjs"],["scripts/update-bad-baby-descriptions.cjs"],["scripts/add-bad-baby-shared-video.cjs"],["scripts/update-doja-description.cjs"],["scripts/update-beavis-description.cjs"],["scripts/update-pillow-onlyfans-descriptions.cjs"],["scripts/update-badgirls-description.cjs"],["scripts/update-pornstar-crop-description.cjs"],["scripts/update-long-tee-descriptions.cjs"],["scripts/remove-pamela-skirt.cjs"],["scripts/copy-pamela-long-gallery.cjs"],["scripts/remove-pamela-cap-standard.cjs"],["scripts/remove-too-sexy-missing-video.cjs"],["scripts/add-too-sexy-video.cjs"],["scripts/add-tee-measurements.cjs"]];
steps.unshift(
 ["scripts/seed-damn-im-cute-tee.cjs"],
 ["scripts/seed-hoodie-collection.cjs"],
 ["scripts/migrate-showgirl-price-2000.cjs"]
);
steps.push(["scripts/seed-tableware.cjs"]);
steps.push(["scripts/price-suit-sale-4500.cjs"]);
for(const args of steps){
 const result=spawnSync(process.execPath,args,{stdio:'inherit',env:process.env});
 if(result.error)throw result.error;
 if(result.status!==0)process.exit(result.status||1);
}
