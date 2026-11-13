export function corsOrigins(frontendUrl?:string,configured?:string){
 const values=(configured||frontendUrl||'http://localhost:4200').split(',').map(value=>value.trim()).filter(Boolean);
 return values.map(value=>{const url=new URL(value);if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('Invalid CORS origin');return url.origin;});
}
