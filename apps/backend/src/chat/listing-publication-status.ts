import { BadRequestException } from '@nestjs/common';
/** Stock and picture processing can activate a new offer asynchronously. */
export async function confirmPublicationStatus(client:{getItem:Function;updateItem:Function},token:string,id:string,wanted:'active'|'paused',wait:(ms:number)=>Promise<void>=ms=>new Promise(resolve=>setTimeout(resolve,ms))){
  let item=await client.getItem(token,id);
  const automatic=()=>wanted==='active'&&item.status==='paused'&&item.sub_status?.some((status:string)=>['out_of_stock','picture_downloading_pending'].includes(status))&&!item.sub_status.includes('paused_by_seller');
  for(let attempt=0;item.status!==wanted&&automatic()&&attempt<6;attempt++){
    await wait(1000);item=await client.getItem(token,id);
  }
  if(item.status===wanted)return item;
  if(automatic()||!['active','paused'].includes(item.status))throw new BadRequestException(`O anúncio ${id} foi criado, mas o Mercado Livre ainda não confirmou o status ${wanted}. Status atual: ${item.status}. Confira essa oferta antes de publicar outra cópia.`);
  try{await client.updateItem(token,id,{status:wanted});}catch(error){
    // The transition may finish between GET and PUT. Read back; never retry PUT.
    item=await client.getItem(token,id);
    if(item.status===wanted)return item;
    throw error;
  }
  item=await client.getItem(token,id);
  if(item.status!==wanted)throw new BadRequestException(`O anúncio ${id} foi criado, mas seu status final ainda não foi confirmado pelo Mercado Livre.`);
  return item;
}
