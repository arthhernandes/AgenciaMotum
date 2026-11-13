/** Mercado Livre chart names allow letters, numbers and spaces, up to 60 characters. */
export function sizeChartName(productName:string,createdAt=new Date()){
  const product=productName.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9\s]/g,'').replace(/\s+/g,' ').trim();
  if(!product)throw new Error('Informe o nome do produto para a tabela de medidas.');
  if(!Number.isFinite(createdAt.getTime()))throw new Error('Data de criação inválida.');
  const date=new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',year:'numeric'}).format(createdAt).replace(/\//g,' ');
  return `${product.slice(0,60-date.length-1).trim()} ${date}`;
}
