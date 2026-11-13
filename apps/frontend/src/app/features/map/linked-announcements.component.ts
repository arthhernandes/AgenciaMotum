import { Component, Input } from '@angular/core';
import { UI_IMPORTS } from '../../shared/ui';
import { listingPhoto } from '../listings/listing-details.component';
import { compareSizes } from '../listings/size-order';
import { announcementKey } from './announcement-key';

@Component({
  selector: 'app-linked-announcements', standalone: true, imports: UI_IMPORTS,
  template: `
    <div class="families">
      <section class="family" *ngFor="let family of families">
        <header><img *ngIf="family.photo; else placeholder" [src]="family.photo" [alt]="family.title" loading="lazy" (error)="family.photo = ''"><ng-template #placeholder><span class="placeholder"><mat-icon>image</mat-icon></span></ng-template><div class="family-title"><strong>{{ family.title }}</strong><small>{{ family.account }} · {{ family.items.length }} {{ family.items.length === 1 ? 'variação vinculada' : 'variações vinculadas' }}</small><span>{{ family.minPrice | currency:'BRL' }}<span *ngIf="family.maxPrice > family.minPrice"> a {{ family.maxPrice | currency:'BRL' }}</span></span></div><button mat-stroked-button (click)="toggle(family.id)" [attr.aria-expanded]="expanded.has(family.id)"><mat-icon>{{ expanded.has(family.id) ? 'expand_less' : 'expand_more' }}</mat-icon>Variações</button></header>
        <div class="family-content" *ngIf="expanded.has(family.id)"><section *ngFor="let color of family.colors"><h4>{{ color.name }}</h4><div class="items"><article *ngFor="let item of color.items"><div class="item-top"><strong>{{ item.size }}</strong><span class="status-chip" [class]="statusClass(item.status)">{{ statusLabel(item.status) }}</span></div><small>SKU {{ item.sku || 'não informado' }}</small><div class="numbers"><span><small>Estoque ML</small><strong>{{ item.stock }}</strong><small class="bling-stock-label">Estoque disponível Bling</small><strong>{{ item.blingStock ?? item.stockMissingLabel }}</strong></span><span><small>Preço</small><strong>{{ item.price | currency:'BRL' }}</strong></span></div><a *ngIf="item.url; else itemId" [href]="item.url" target="_blank" rel="noopener noreferrer">{{ item.itemId }} <mat-icon>open_in_new</mat-icon></a><ng-template #itemId><small>{{ item.itemId }}</small></ng-template></article></div></section></div>
      </section>
    </div>
  `,
  styles: [`
    .families{display:grid;gap:12px;margin-top:12px}.family{border:1px solid #e4e7ec;border-radius:12px;background:#fff;overflow:hidden}.family>header{display:flex;gap:14px;align-items:center;padding:16px}.family img,.placeholder{width:64px;height:64px;border-radius:10px;border:1px solid #e4e7ec;object-fit:contain;flex-shrink:0}.placeholder{display:grid;place-items:center;color:#98a2b3}.family-title{display:grid;gap:6px;flex:1;min-width:0;line-height:1.4}.family-title>strong{font-size:15px}.family-title>span{font-weight:600;font-size:13px}small{display:block;color:#697386;font-size:12px}.family button{white-space:nowrap}.family-content{padding:0 16px 16px;background:#f8faff;border-top:1px solid #e4e7ec}h4{font-size:14px;margin:16px 0 10px}.items{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px}.items article{padding:14px;background:white;border:1px solid #e4e7ec;border-radius:10px;display:grid;gap:10px}.item-top,.numbers{display:flex;align-items:center;justify-content:space-between;gap:8px}.numbers strong{display:block;margin-top:4px}.bling-stock-label{margin-top:12px}.items a{font-size:12px;color:#155eef;display:flex;align-items:center;gap:5px}.items a mat-icon{font-size:14px;width:14px;height:14px}@media(max-width:650px){.family>header{flex-wrap:wrap}.family button{margin-left:78px}.items{grid-template-columns:1fr}}
  `]
})
export class LinkedAnnouncementsComponent {
  families: any[] = [];
  expanded = new Set<string>();
  @Input() set links(links: any[]) {
    const groups = new Map<string, any[]>();
    const seen = new Set<string>();
    for (const link of links || []) {
      const item = link.listing;
      if (!item) continue;
      const variant = link.listingVariant;
      const unique = `${item.id}:${variant?.id || ''}`;
      if (seen.has(unique)) continue;
      seen.add(unique);
      const id = announcementKey(item);
      const attrs = [...(variant?.rawData?.attributes || []), ...(variant?.attributes?.attribute_combinations || []), ...(item.rawData?.attributes || [])];
      const attribute = (key: string) => attrs.find((a: any) => a.id === key)?.value_name;
      const data = { itemId: item.itemId, title: item.title, familyTitle: item.rawData?.family_name || item.title, photo: listingPhoto(item), account: item.marketplaceAccount?.name || 'Mercado Livre', sku: attribute('SELLER_SKU') || variant?.sku || item.rawData?.seller_custom_field, size: attribute('SIZE') || attribute('SHOE_SIZE') || attribute('APPAREL_SIZE') || 'Sem tamanho', color: attribute('COLOR') || 'Sem cor informada', stock: variant?.availableQuantity ?? item.availableQuantity, blingStock: link.productVariant?.stock ?? null, stockMissingLabel: 'N?o vinculado ? varia??o', price: Number(variant?.rawData?.price ?? item.price), status: item.status, url: /^https?:\/\//i.test(item.permalink || '') ? item.permalink : '' };
      if (!groups.has(id)) groups.set(id, []);
      groups.get(id)!.push(data);
    }
    this.families = Array.from(groups, ([id, items]) => {
      const colors = new Map<string, any[]>();
      for (const item of items) { if (!colors.has(item.color)) colors.set(item.color, []); colors.get(item.color)!.push(item); }
      return { id, title: items[0].familyTitle, photo: items[0].photo, account: items[0].account, items, minPrice: Math.min(...items.map(i => i.price)), maxPrice: Math.max(...items.map(i => i.price)), colors: Array.from(colors, ([name, variants]) => ({ name, items: variants.sort((a,b) => compareSizes(a.size,b.size)) })) };
    });
  }
  toggle(id: string) { if (this.expanded.has(id)) this.expanded.delete(id); else this.expanded.add(id); }
  statusLabel(status: string) { return ({ active: 'Ativo', paused: 'Pausado', closed: 'Encerrado', under_review: 'Em análise', inactive: 'Inativo' } as Record<string,string>)[status] || status; }
  statusClass(status: string) { return status === 'active' ? 'ok' : status === 'paused' ? 'attention' : 'error'; }
}
