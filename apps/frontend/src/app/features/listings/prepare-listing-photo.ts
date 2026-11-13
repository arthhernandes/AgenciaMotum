const MAX_PHOTO_BYTES=10*1024*1024;

/** Inspect the bytes: downloads may be WebP even when named .jpg. */
export async function prepareListingPhoto(file:File):Promise<File>{
  if(!file.size)throw new Error(`O arquivo ${file.name} está vazio. Escolha a imagem novamente.`);
  if(file.size>MAX_PHOTO_BYTES)throw new Error(`A foto ${file.name} tem ${(file.size/1024/1024).toFixed(1)} MB. O limite é 10 MB por foto.`);
  const bytes=new Uint8Array(await file.slice(0,12).arrayBuffer());
  const png=[137,80,78,71,13,10,26,10].every((value,index)=>bytes[index]===value);
  const jpeg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
  const ascii=(start:number,end:number)=>String.fromCharCode(...bytes.slice(start,end));
  const webp=ascii(0,4)==='RIFF'&&ascii(8,12)==='WEBP';
  const avif=ascii(4,8)==='ftyp'&&['avif','avis'].includes(ascii(8,12));
  const base=file.name.replace(/\.[^.]+$/,'')||'foto';
  if(png||jpeg)return new File([file],base+(png?'.png':'.jpg'),{type:png?'image/png':'image/jpeg',lastModified:file.lastModified});
  let image:ImageBitmap;
  try{image=await createImageBitmap(new Blob([file],{type:webp?'image/webp':avif?'image/avif':file.type}));}catch{throw new Error(`Não foi possível abrir ${file.name} como imagem. Exporte a foto como JPG ou PNG e tente novamente.`);}
  try{
    if(!image.width||!image.height||image.width>16384||image.height>16384||image.width*image.height>64_000_000)throw new Error(`A resolução de ${file.name} é muito grande. Reduza a imagem antes de enviar.`);
    const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
    const context=canvas.getContext('2d');if(!context)throw new Error('Não foi possível preparar a imagem neste navegador.');
    context.drawImage(image,0,0);
    const converted=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error(`Não foi possível converter ${file.name}. Exporte a foto como JPG ou PNG.`)),'image/png'));
    if(converted.size>MAX_PHOTO_BYTES)throw new Error(`Após converter ${file.name} para PNG, a foto ultrapassou 10 MB. Reduza a imagem e tente novamente.`);
    return new File([converted],base+'.png',{type:'image/png',lastModified:file.lastModified});
  }finally{image.close();}
}
