export function resolveApiUrl(path:string,base:string=''){
  if(!base)return path;
  const url=new URL(base);
  if(url.username||url.password||url.search||url.hash||url.pathname!=='/'||url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname)))throw new Error('Configure uma origem HTTPS válida para a API.');
  if(!path.startsWith('/api/')&&path!=='/api')throw new Error('Caminho de API inválido.');
  return url.origin+path;
}
export function publicApiUrl(path:string){return resolveApiUrl(path,(window as any).OCONSULTOR_CONFIG?.apiOrigin??'');}
