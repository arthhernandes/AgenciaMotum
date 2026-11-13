import { sellerSku } from '../mercadolivre/synchronization/seller-sku';

/** Reports consolidate marketplace families by the verified Bling parent SKU. */
export function reportFamilies(groups:any[],products:any[],business:string){
  const normalize=(sku:unknown)=>typeof sku==='string'?sku.trim().toUpperCase():'';
  // Bling may split one product's size grid into numbered LINHA records.
  const familySku=(sku:unknown)=>normalize(sku).replace(/-LINHA\d+$/,'');
  const bySku=new Map<string,Map<string,any>>(),byProductId=new Map<string,any>();
  for(const product of products){
    byProductId.set(product.id,product);
    for(const sku of [product.sku,...(product.variants??[]).map((v:any)=>v.sku)]){
      const key=normalize(sku);if(!key)continue;
      const parents=bySku.get(key)??new Map();parents.set(familySku(product.sku),product);bySku.set(key,parents);
      const base=familySku(product.sku);if(base!==normalize(product.sku)){const bases=bySku.get(base)??new Map();bases.set(base,product);bySku.set(base,bases);}
    }
  }
  const parent=(listing:any)=>{
    const skus=listing.variants?.length?listing.variants.map((v:any)=>sellerSku(v.rawData)||v.sku):[sellerSku(listing.rawData)];
    const found=new Map<string,any>();
    for(const sku of skus){
      let matches=bySku.get(normalize(sku));
      if(!matches&&/^\d+\.\d+$/.test(normalize(sku)))matches=bySku.get(normalize(sku).split('.')[0]);
      if(matches?.size===1){const product=[...matches.values()][0];found.set(familySku(product.sku),product);}
    }
    if(!found.size)for(const link of listing.links??[]){const product=byProductId.get(link.productVariant?.productId||link.product?.id||link.productId);if(product)found.set(familySku(product.sku),product);}
    return found;
  };
  const merged=new Map<string,any>();
  for(const group of groups){
    const parents=new Map<string,any>();
    for(const child of group.children)for(const [sku,product] of parent(child))parents.set(sku,product);
    const product=parents.size===1?[...parents.values()][0]:null;
    const key=product?business+':sku:'+familySku(product.sku):group.id;
    let result=merged.get(key);
    if(!result){result={...group,id:key,title:product?.title||group.title,baseSku:product?familySku(product.sku):null,children:[],variants:[],parentListings:[]};merged.set(key,result);}
    if(!result.parentListings.some((parent:any)=>parent.id===group.id))result.parentListings.push({id:group.id,status:group.status});
    for(const child of group.children)if(!result.children.some((c:any)=>c.itemId===child.itemId&&c.marketplaceAccountId===child.marketplaceAccountId))result.children.push(child);
    result.variants.push(...group.variants);
  }
  return [...merged.values()].map(group=>{
    const first=group.children[0];return {...group,parentCount:group.parentListings.length,status:group.children.every((c:any)=>c.status===first.status)?first.status:'mixed',availableQuantity:group.children.reduce((sum:number,c:any)=>sum+c.availableQuantity,0),soldQuantity:group.children.reduce((sum:number,c:any)=>sum+c.soldQuantity,0),price:Math.min(...group.children.map((c:any)=>Number(c.price))),maxPrice:Math.max(...group.children.map((c:any)=>Number(c.price)))};
  });
}
