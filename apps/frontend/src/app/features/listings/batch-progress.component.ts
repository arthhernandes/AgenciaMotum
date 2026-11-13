import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface BatchProgress { index: number; total: number; }

@Component({
  selector: 'app-batch-progress', standalone: true, imports: [CommonModule],
  template: `<div *ngIf="progress as step" class="batch-progress" role="status" aria-live="polite"><span>Edição em massa</span><strong>Anúncio {{step.index}} de {{step.total}}</strong></div>`,
  styles: [`:host{display:block;flex-shrink:0}.batch-progress{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin:12px 24px 16px;padding:12px 16px;border:1px solid #cce1ee;border-radius:10px;background:#edf6fb;color:#0d5275;font-size:13px}.batch-progress>span{font-size:12px}.batch-progress strong{font-size:14px}`]
})
export class BatchProgressComponent {
  @Input() progress?: BatchProgress;
}
