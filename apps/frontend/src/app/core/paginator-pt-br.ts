import { MatPaginatorIntl } from '@angular/material/paginator';

export function paginatorPtBr(){
  const labels=new MatPaginatorIntl();
  labels.itemsPerPageLabel='Itens por página:';
  labels.nextPageLabel='Próxima página';
  labels.previousPageLabel='Página anterior';
  labels.firstPageLabel='Primeira página';
  labels.lastPageLabel='Última página';
  labels.getRangeLabel=(page,pageSize,total)=>{
    const length=Math.max(total,0);
    if(!length||!pageSize)return '0 de '+length;
    const start=Math.min(page*pageSize,length-1);
    return `${start+1}–${Math.min(start+pageSize,length)} de ${length}`;
  };
  return labels;
}
