export class FinanceHttpError extends Error {
  constructor(public status:number,public resource:string){super('Mercado Livre HTTP '+status+' ('+resource+')');}
}
/** Only allow authenticated reads on the Mercado Livre origin. Never log credentials/buyer payloads. */
export class FinanceApi {
  private active=0;private waiting:Array<()=>void>=[];
  constructor(private token:(refresh?:boolean)=>Promise<string>,private http:typeof fetch=fetch,private pause=(ms:number)=>new Promise<void>(r=>setTimeout(r,ms)),private concurrency=2){
    if(!Number.isInteger(concurrency)||concurrency<1||concurrency>8)throw Error('Invalid request concurrency');
  }
  async get(path:string,params:Record<string,string|number>={},xml=false):Promise<any>{
    if(!path.startsWith('/')||path.startsWith('//')||path.includes('://'))throw Error('Invalid Mercado Livre resource');
    const url=new URL(path,'https://api.mercadolibre.com');for(const [key,value]of Object.entries(params))url.searchParams.set(key,String(value));
    if(url.origin!=='https://api.mercadolibre.com')throw Error('Invalid origin');
    if(this.active>=this.concurrency)await new Promise<void>(resolve=>this.waiting.push(resolve));else this.active++;
    try{
      let refreshed=false;
      for(let attempt=0;;attempt++){
        let response:Response;
        try{response=await this.http(url,{method:'GET',headers:{Authorization:'Bearer '+await this.token(false),'x-format-new':'true',...(path.startsWith('/advertising/')?{'api-version':path==='/advertising/advertisers'?'1':'2'}:{}),Accept:xml?'application/xml':'application/json'},signal:AbortSignal.timeout(20000),redirect:'error'});}
        catch(error){if(attempt>=2)throw new Error('Falha de conexão ao consultar '+url.pathname);await this.pause(500*(attempt+1));continue;}
        if(response.status===401&&!refreshed){await this.token(true);refreshed=true;continue;}
        if(!response.ok){
          if(attempt<2&&(response.status===429||response.status>=500)){const after=response.headers.get('retry-after'),seconds=Number(after),delay=Number.isFinite(seconds)&&seconds>0?seconds*1000:Date.parse(after??'')-Date.now();await this.pause(Math.min(30000,Math.max(1000,Number.isFinite(delay)?delay:1000*(attempt+1))));continue;}
          throw new FinanceHttpError(response.status,url.pathname);
        }
        const text=await response.text();if(text.length>5_000_000)throw Error('Resposta excedeu o tamanho permitido');
        if(xml)return text;try{return JSON.parse(text);}catch{throw Error('Resposta inválida em '+url.pathname);}
      }
    }finally{const next=this.waiting.shift();if(next)next();else this.active--;}
  }
}
