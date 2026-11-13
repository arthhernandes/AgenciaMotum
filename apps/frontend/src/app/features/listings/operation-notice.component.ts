import { Component, Inject } from '@angular/core';
import { MAT_SNACK_BAR_DATA, MatSnackBarRef } from '@angular/material/snack-bar';
import { UI_IMPORTS } from '../../shared/ui';

export function operationNotice(message: string, attention: boolean) {
  const count = /^(\d+) de (\d+) vínculo\(s\) confirmados\./.exec(message);
  if (!count) return { title: attention ? 'Atenção à operação' : 'Operação concluída', message, attention };
  const linked = Number(count[1]), total = Number(count[2]);
  const blocked = [...message.matchAll(/(MLB\d+):\s*O Mercado Livre recusou os dados:\s*item\.attributes\.not_modifiable/g)].map(match => match[1]);
  return {
    title: attention ? 'Vinculação com pendências' : 'SKUs vinculados', attention,
    message: `${linked} de ${total} vínculos confirmados.`,
    explanation: blocked.length ? `O Mercado Livre bloqueou a alteração do SKU em ${[...new Set(blocked)].join(', ')}. Os vínculos confirmados foram mantidos.` : attention ? 'Confira os detalhes antes de tentar novamente os itens pendentes.' : 'Os dados dos anúncios foram atualizados no sistema.',
    details: attention ? message : undefined
  };
}

@Component({
  selector: 'app-operation-notice', standalone: true, imports: [...UI_IMPORTS],
  template: `<div class="notice" [class.attention]="data.attention"><span class="notice-icon"><mat-icon>{{data.attention ? 'info' : 'check_circle'}}</mat-icon></span><div class="notice-content"><strong>{{data.title}}</strong><p>{{data.message}}</p><p class="explanation" *ngIf="data.explanation">{{data.explanation}}</p><details *ngIf="data.details"><summary>Detalhes técnicos</summary><p>{{data.details}}</p></details></div><button mat-icon-button (click)="ref.dismiss()" aria-label="Fechar aviso"><mat-icon>close</mat-icon></button></div>`,
  styles: [`:host{display:block}.notice{display:flex;align-items:flex-start;gap:12px;color:#15364a}.notice-icon{display:grid;place-items:center;flex-shrink:0;width:36px;height:36px;border-radius:10px;background:#e8f5ef;color:#168163}.attention .notice-icon{color:#94630c;background:#fff2d7}.notice-content{flex:1;min-width:0;padding-top:2px}.notice-content>strong{font-size:14px}.notice p{font-size:13px;line-height:1.5;margin:6px 0 0;overflow-wrap:anywhere}.notice .explanation{color:#667085;font-size:12px}.notice button{flex-shrink:0;width:32px;height:32px;padding:4px;color:#667085}.notice details{margin-top:10px;font-size:11px;color:#667085}.notice summary{cursor:pointer;color:#0d5275}.notice details p{font-size:11px;white-space:pre-line}`]
})
export class OperationNoticeComponent {
  constructor(@Inject(MAT_SNACK_BAR_DATA) readonly data: ReturnType<typeof operationNotice>, public readonly ref: MatSnackBarRef<OperationNoticeComponent>) {}
}
