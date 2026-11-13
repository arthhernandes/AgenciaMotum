import { CreateListingDialogComponent } from './create-listing-dialog.component';
import { BulkDuplicateListingDialogComponent } from './bulk-duplicate-listing-dialog.component';
import { DuplicateListingDialogComponent } from './duplicate-listing-dialog.component';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormControl } from '@angular/forms';
import { MatMenuModule } from '@angular/material/menu';
import { PageEvent } from '@angular/material/paginator';
import { compareSizes } from './size-order';
import { SkuLinkDialogComponent } from './sku-link-dialog.component';
import { AddVariationsDialogComponent } from './add-variations-dialog.component';
import { ListingFiscalDialogComponent } from './listing-fiscal-dialog.component';
import { SkuActionsDialogComponent } from './sku-actions-dialog.component';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { OperationNoticeComponent, operationNotice } from './operation-notice.component';
import { ListingDetailsComponent, listingPhoto } from './listing-details.component';
import { EMPTY, expand, retry, throwError, Observable, Subject, Subscription, catchError, combineLatest, debounceTime, finalize, from, map, mergeMap, of, startWith, switchMap, takeUntil, tap, timer } from 'rxjs';
import { ApiService, Page } from '../../core/api.service';
import { UI_IMPORTS } from '../../shared/ui';

@Component({
  selector: 'app-listings',
  standalone: true,
  imports: [...UI_IMPORTS, MatDialogModule, MatSnackBarModule, MatMenuModule],
  template: `
    <header class="page-header">
      <h1>Anúncios <small class="total-label">{{ loadingListings ? 'Buscando anúncios…' : totalListings + ' encontrados' }}</small></h1>
      <div class="header-actions"><button class="import-button" mat-flat-button color="primary" appPermission="listings.manage" (click)="createListing()"><mat-icon>add</mat-icon>Criar anúncio</button><button class="import-button" mat-stroked-button appPermission="sync.manage" (click)="syncNewListings()" [disabled]="importing" matTooltip="Sincroniza somente anúncios criados hoje, pelo horário de Brasília"><mat-icon>update</mat-icon>{{importing && syncingToday?'Sincronizando novos...':'Sincronizar anúncios novos'}}</button><button class="import-button" mat-stroked-button appPermission="sync.manage" (click)="syncListings()" [disabled]="importing"><mat-icon>sync</mat-icon>{{ importing && syncing && !syncingToday ? 'Sincronizando...' : 'Sincronizar anúncios' }}</button></div>
      <mat-form-field appearance="outline" subscriptSizing="dynamic" class="search"><mat-label>Buscar família, MLB, SKU ou título</mat-label><input matInput [formControl]="search"></mat-form-field>
    </header>
    <section *ngIf="importing || progressPercent === 100" class="sync-progress" aria-live="polite">
      <div class="sync-progress-heading"><span><mat-icon>{{ importing ? 'sync' : 'info' }}</mat-icon><strong>{{ importing ? (syncingToday?'Sincronizando anúncios novos de hoje':'Sincronizando anúncios') : 'Processamento finalizado' }}</strong></span><strong class="sync-percent">{{ progressPercent }}%</strong></div>
      <mat-progress-bar [mode]="progressTotal === null && importing ? 'indeterminate' : 'determinate'" [value]="progressPercent" aria-label="Progresso da sincronização"></mat-progress-bar>
      <small>{{ progressProcessed }}{{ progressTotal === null ? '' : ' de ' + progressTotal }} {{syncingToday?'anúncios criados hoje processados':'anúncios processados'}}{{ importing && progressPercent === 99 ? ' · Finalizando vínculos e auditoria...' : '' }}</small>
    </section>
    <p role="alert" *ngIf="listError">{{ listError }} <button mat-button (click)="retryList()">Tentar novamente</button></p>
    <div class="listing-controls" id="listing-filters" [hidden]="!filtersExpanded">
    <section class="filter-row">
      <div class="listing-filter"><span id="filter-skuMatch">SKU na Bling</span><mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-select aria-labelledby="filter-skuMatch" [formControl]="skuMatch"><mat-option value="">Todos</mat-option><mat-option value="found">COM SKU — todas as variações</mat-option><mat-option value="partial">SKU PARCIAL</mat-option><mat-option value="missing">SKU não encontrado na Bling</mat-option><mat-option value="no_sku">Sem SKU no anúncio</mat-option></mat-select></mat-form-field></div>
      <div class="listing-filter"><span id="filter-status">Status</span><mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-select aria-labelledby="filter-status" [formControl]="status"><mat-option value="">Todos</mat-option><mat-option value="active">Ativo</mat-option><mat-option value="paused">Pausado</mat-option><mat-option value="under_review">Em análise</mat-option><mat-option value="inactive">Inativo</mat-option><mat-option value="closed">Finalizado</mat-option></mat-select></mat-form-field></div>
      <div class="listing-filter"><span id="filter-promotion">Promoção</span><mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-select aria-labelledby="filter-promotion" [formControl]="promotion"><mat-option value="">Todos</mat-option><mat-option value="with">Com promoção</mat-option><mat-option value="without">Sem promoção</mat-option><mat-option value="unknown">Preço não confirmado</mat-option></mat-select></mat-form-field></div>
      <div class="listing-filter"><span id="filter-full">Logística</span><mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-select aria-labelledby="filter-full" [formControl]="full"><mat-option value="">Todos</mat-option><mat-option value="true">Com Full</mat-option><mat-option value="false">Sem Full</mat-option></mat-select></mat-form-field></div>
      <div class="listing-filter"><span id="filter-linked">Vínculo manual salvo</span><mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-select aria-labelledby="filter-linked" [formControl]="linked"><mat-option value="">Todos</mat-option><mat-option value="true">Com vínculo salvo</mat-option><mat-option value="false">Sem vínculo salvo</mat-option></mat-select></mat-form-field></div>
      <div class="listing-filter" appPermission="costs.view"><span id="filter-fiscal">Dados fiscais</span><mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-select aria-labelledby="filter-fiscal" [formControl]="fiscalStatus"><mat-option value="">Todos</mat-option><mat-option value="incomplete">Incompletos</mat-option><mat-option value="complete">Completos</mat-option><mat-option value="cost_above_bling">Preço de custo acima do da Bling</mat-option></mat-select></mat-form-field></div>

    </section>
    <p class="fiscal-check" *ngIf="fiscalStatus.value==='cost_above_bling'">Compara o custo fiscal do Mercado Livre com o preço de custo da Bling para o mesmo SKU. Somente valores confirmados nas duas plataformas.</p><div class="fiscal-check" *ngIf="fiscalStatus.value && fiscalCheck" role="status"><span>{{fiscalCheck.remaining ? (fiscalStatus.value==='cost_above_bling'?'Comparando custos ML e Bling: ':'Conferindo dados fiscais: ')+fiscalCheck.checked+' de '+fiscalCheck.total+' SKUs' : 'Conferência fiscal concluída: '+fiscalCheck.checked+' SKUs'}}</span><small *ngIf="fiscalCheck.unavailable">A conferência continua automaticamente até validar todos os SKUs.</small><mat-progress-bar *ngIf="fiscalCheck.remaining" mode="determinate" [value]="fiscalCheck.total?100*fiscalCheck.checked/fiscalCheck.total:0"></mat-progress-bar></div>
    <div class="fiscal-check" *ngIf="promotion.value && promotionCheck" role="status"><span>Preços conferidos: {{promotionCheck.checked}} de {{promotionCheck.total}}</span><mat-progress-bar *ngIf="promotionCheck.remaining" mode="determinate" [value]="promotionCheck.total?100*promotionCheck.checked/promotionCheck.total:0"></mat-progress-bar><small *ngIf="promotionCheck.unavailable">{{promotionCheck.unavailable}} preços não confirmados. Não são classificados como sem promoção.</small></div>
    <section class="visits-period" aria-label="Período de visitas e vendas">
      <div class="visits-period-summary"><span class="visits-period-icon"><mat-icon>date_range</mat-icon></span><div><strong>Período de visitas e vendas</strong><small>{{visitsPeriodLabel}}</small></div></div>
      <div class="visits-period-controls">
        <label>Data inicial<input type="date" [formControl]="visitsFrom" [max]="visitsToday"></label>
        <label>Data final<input type="date" [formControl]="visitsTo" [max]="visitsToday"></label>
        <button mat-flat-button color="primary" (click)="applyVisitsPeriod()"><mat-icon>search</mat-icon>Consultar período</button>
      </div>
      <small *ngIf="visitsPeriodError" role="alert" class="visits-period-error">{{visitsPeriodError}}</small>
    </section>
    </div><div class="listing-toolbar"><div class="filters-heading"><button mat-stroked-button (click)="filtersExpanded = !filtersExpanded" [attr.aria-expanded]="filtersExpanded" aria-controls="listing-filters"><mat-icon>tune</mat-icon>{{filtersExpanded ? "Recolher filtros" : "Mostrar filtros"}}</button><span>Visitas e vendas: {{visitsPeriodLabel}}</span></div><div class="bulk-toolbar compact-bulk-toolbar" appPermission="listings.manage"><span class="bulk-toolbar-title">Ações dos anúncios</span><button mat-stroked-button appPermission="listings.manage" (click)="openSelectedActions()" [disabled]="!bulkSelection.size"><mat-icon>edit_note</mat-icon>Edição em massa</button><button mat-stroked-button appPermission="listings.manage" (click)="openSkuActions()"><mat-icon>inventory_2</mat-icon>Por SKU pai</button><button mat-stroked-button appPermission="listings.manage" (click)="duplicateSelected()" [disabled]="!bulkSelection.size"><mat-icon>content_copy</mat-icon>Duplicar</button><small class="selection-count" aria-live="polite">Selecionados: {{bulkSelection.size}}</small><button mat-icon-button *ngIf="bulkSelection.size" (click)="bulkSelection.clear()" matTooltip="Limpar seleção" aria-label="Limpar seleção"><mat-icon>close</mat-icon></button></div>
    </div>
    <div class="search-progress" *ngIf="loadingListings" role="status" aria-live="polite"><span>{{sortBy==='sold' ? 'Consultando vendas de todos os anúncios para ordenar...' : search.value?.trim() ? 'Buscando anúncios para “' + search.value?.trim() + '”…' : 'Carregando anúncios…'}} {{retryingListings ? 'A consulta está demorando. Tentando novamente automaticamente…' : 'Aguarde o resultado.'}}</span><div *ngIf="sortBy==='sold'" class="ranking-progress-count"><span>{{rankingTotal ? rankingCompleted+' de '+rankingTotal+' períodos consultados' : 'Preparando consulta'}}</span><strong>{{rankingPercent}}%</strong></div><mat-progress-bar [mode]="sortBy==='sold' ? 'determinate' : 'indeterminate'" [value]="rankingPercent" aria-label="Progresso da consulta de anúncios"></mat-progress-bar></div>
    <div class="list-scroll" [attr.aria-busy]="loadingListings" [class.list-loading]="loadingListings" [attr.inert]="loadingListings ? '' : null">
    <table mat-table [dataSource]="listings" multiTemplateDataRows class="data-table">
      <ng-container matColumnDef="select"><th mat-header-cell *matHeaderCellDef class="selection-cell"><input type="checkbox" [checked]="allPageSelected" [indeterminate]="somePageSelected && !allPageSelected" (change)="togglePageSelection()" aria-label="Selecionar anúncios desta página" title="Selecionar anúncios desta página" [disabled]="!listings.length"></th><td mat-cell *matCellDef="let row" class="selection-cell"><input type="checkbox" [checked]="bulkSelection.has(row.id)" (change)="toggleBulk(row)" [disabled]="row.interactionBlocked" [attr.aria-label]="'Selecionar '+row.title"></td></ng-container>
      <ng-container matColumnDef="item"><th mat-header-cell *matHeaderCellDef>Anúncio</th><td mat-cell *matCellDef="let row"><div class="listing-product"><img *ngIf="photo(row) && !row.imageFailed; else noPhoto" [src]="photo(row)" [alt]="row.title" loading="lazy" (error)="row.imageFailed = true"><ng-template #noPhoto><span class="photo-placeholder"><mat-icon>image</mat-icon></span></ng-template><div><button class="title-link" (click)="showDetails(row)">{{ row.title }}</button><small>SKU pai: {{ row.parentSkus?.length ? row.parentSkus.join(', ') : 'Não identificado' }} · {{ row.familyId ? 'Família: ' + row.familyId : this.actionReference(row) }}</small><small *ngIf="row.variants?.length">{{ row.variants.length }} variações</small></div></div></td></ng-container>
      <ng-container matColumnDef="account"><th mat-header-cell *matHeaderCellDef>Conta</th><td mat-cell *matCellDef="let row">{{ row.marketplaceAccount?.name }}</td></ng-container>
      <ng-container matColumnDef="status"><th mat-header-cell *matHeaderCellDef>Status</th><td mat-cell *matCellDef="let row"><span class="status-chip" [class]="row.status === 'active' ? 'ok' : 'attention'">{{ row.finalized ? 'Finalizado' : statusLabel(row.status) }}</span><span class="full-badge" *ngIf="row.hasFull" [matTooltip]="row.fullCount+' de '+row.fullTotal+' anúncios com Mercado Envios Full'"><mat-icon aria-hidden="true">bolt</mat-icon>{{row.isFull?'Full':'Full em parte'}}</span><small>{{ typeLabel(row.listingTypeId) }}</small><small *ngIf="row.blockedCount && !row.interactionBlocked">{{row.blockedCount}} oferta(s) bloqueada(s); demais disponíveis</small><small *ngIf="row.interactionBlocked" [matTooltip]="row.interactionBlockReason" class="listing-block-note">Alterações indisponíveis</small></td></ng-container>
      <ng-container matColumnDef="stock"><th mat-header-cell *matHeaderCellDef [attr.aria-sort]="sortAria('stock')"><button class="sort-column" (click)="sort('stock')" [attr.aria-label]="sortLabel('stock','estoque')">Estoque<mat-icon>{{sortIcon('stock')}}</mat-icon></button></th><td mat-cell *matCellDef="let row">{{ row.availableQuantity }}</td></ng-container>
      <ng-container matColumnDef="price"><th mat-header-cell *matHeaderCellDef [attr.aria-sort]="sortAria('price')"><button class="sort-column" (click)="sort('price')" [attr.aria-label]="sortLabel('price','preço')" title="Ordenar pelo preço cadastrado inicial da família">Preço<mat-icon>{{sortIcon('price')}}</mat-icon></button></th><td mat-cell *matCellDef="let row"><div class="listing-price" [class.promotion-price]="row.salePriceComplete && row.hasPromotion"><span class="price-promo-label" *ngIf="row.salePriceComplete && row.hasPromotion">Em promoção</span><div class="price-main"><strong>{{priceMoney(row.salePriceComplete ? row.saleMin : row.price)}}</strong><span *ngIf="(row.salePriceComplete ? row.saleMax : row.maxPrice) > (row.salePriceComplete ? row.saleMin : row.price)">até {{priceMoney(row.salePriceComplete ? row.saleMax : row.maxPrice)}}</span></div><div class="price-base" *ngIf="row.salePriceComplete && row.hasPromotion"><span>Preço cadastrado</span><span>{{priceMoney(row.price)}}<ng-container *ngIf="row.maxPrice>row.price"> a {{priceMoney(row.maxPrice)}}</ng-container></span></div><span *ngIf="row.salePriceLoading" class="price-query">Consultando preço vigente...</span><span *ngIf="row.salePriceError" class="price-query">Preço vigente não confirmado</span></div></td></ng-container>
      <ng-container matColumnDef="visits"><th mat-header-cell *matHeaderCellDef [attr.aria-sort]="sortAria('visits')"><span class="visits-heading"><button class="sort-column" (click)="sort('visits')" [attr.aria-label]="sortLabel('visits','visitas')" matTooltip="Ordenar as visitas dos anúncios desta página">Visitas<mat-icon>{{sortIcon('visits')}}</mat-icon></button></span></th><td mat-cell *matCellDef="let row" [matTooltip]="row.visitsTooltip"><span *ngIf="row.visitsLoading;else visitsValue" class="muted">Consultando…</span><ng-template #visitsValue>{{visitsLabel(row.visitCount)}}<small *ngIf="row.visitCount===null">Não foi possível concluir</small><button *ngIf="row.visitCount===null" mat-button class="visits-retry" (click)="loadVisits()">Consultar novamente</button></ng-template></td></ng-container>
      <ng-container matColumnDef="sold"><th mat-header-cell *matHeaderCellDef [attr.aria-sort]="sortAria('sold')"><button class="sort-column" (click)="sort('sold')" [attr.aria-label]="sortLabel('sold','vendidos no período')" matTooltip="Ordenar pelas unidades vendidas no período selecionado">Vendidos<mat-icon>{{sortIcon('sold')}}</mat-icon></button></th><td mat-cell *matCellDef="let row"><div class="sold-metrics"><div class="sold-period" [matTooltip]="'Unidades em pedidos pagos de '+visitsPeriodLabel"><span class="sold-label">No período</span><span *ngIf="row.salesLoading;else salesValue" class="muted">Consultando…</span><ng-template #salesValue><strong>{{visitsLabel(row.periodSoldQuantity)}}</strong><small *ngIf="row.periodSoldQuantity===null">Não foi possível concluir</small><button *ngIf="row.periodSoldQuantity===null" mat-button class="visits-retry" (click)="loadSales()">Consultar novamente</button></ng-template></div><div class="sold-total" matTooltip="Total acumulado informado pelo Mercado Livre, independentemente do período selecionado"><span class="sold-label">Total acumulado</span><span class="sold-total-value">{{visitsLabel(row.soldQuantity)}}</span></div></div></td></ng-container>
      <ng-container matColumnDef="actions"><th mat-header-cell *matHeaderCellDef>Ações</th><td mat-cell *matCellDef="let row"><div class="row-actions compact-row-actions"><button mat-stroked-button [matMenuTriggerFor]="rowMenu" [attr.aria-label]="'Ações de '+row.title">Ações<mat-icon>expand_more</mat-icon></button><mat-menu #rowMenu="matMenu"><button mat-menu-item class="add-variants-action" appPermission="listings.manage" (click)="addVariations(row)" [disabled]="row.interactionBlocked"><mat-icon>playlist_add</mat-icon>Adicionar variações</button><button mat-menu-item class="fiscal-action" appPermission="listings.manage costs.view" (click)="editFiscal(row)" [disabled]="row.interactionBlocked"><mat-icon>receipt_long</mat-icon>Dados fiscais</button><button mat-menu-item class="duplicate-action" appPermission="listings.manage" (click)="duplicateListing(row)" [disabled]="row.interactionBlocked"><mat-icon>content_copy</mat-icon>Duplicar anúncio</button><button mat-menu-item class="link-sku-action" appPermission="listings.manage" (click)="linkSku(row)" [disabled]="row.interactionBlocked"><mat-icon>link</mat-icon>Vincular SKU</button></mat-menu><button mat-icon-button class="details-action" (click)="showDetails(row)" [attr.aria-label]="'Ver detalhes de ' + row.title" matTooltip="Ver detalhes"><mat-icon>visibility</mat-icon></button><small class="fiscal-note" *ngIf="row.costAboveBlingCount">{{row.costAboveBlingCount}} variação(ões) com custo acima da Bling</small><small class="fiscal-note" *ngIf="row.fiscalIncompleteCount" [matTooltip]="row.fiscalReasons.join('; ')">{{row.fiscalIncompleteCount}} variação(ões) com pendência fiscal</small></div></td></ng-container>
      <ng-container matColumnDef="links"><th mat-header-cell *matHeaderCellDef>SKU Bling</th><td mat-cell *matCellDef="let row"><span class="status-chip" [class]="row.skuStatus==='found'?'ok':row.skuStatus==='partial'?'attention':'review'" [matTooltip]="row.foundSkuCount+' variação(ões) com SKU encontrado na Bling; '+row.missingSkuCount+' não encontrado(s); '+row.absentSkuCount+' sem SKU informado.'">{{ row.skuStatus==='found'?'COM SKU':row.skuStatus==='partial'?'SKU PARCIAL':row.skuStatus==='missing'?'SKU FORA DA BLING':'SEM SKU' }}</span></td></ng-container>
      <ng-container matColumnDef="variants"><th mat-header-cell *matHeaderCellDef>Variações</th><td mat-cell *matCellDef="let row"><button mat-stroked-button class="variant-button" (click)="toggleVariants(row)" [disabled]="!row.variants?.length" [attr.aria-expanded]="selected?.id === row.id"><mat-icon>{{ selected?.id === row.id ? 'expand_less' : 'expand_more' }}</mat-icon>{{ row.variants?.length || 0 }} variações</button></td></ng-container>
      <ng-container matColumnDef="expandedDetail"><td mat-cell *matCellDef="let row" [attr.colspan]="columns.length"><section class="variant-panel" *ngIf="selected?.id === row.id"><header><div><small>VARIAÇÕES DA FAMÍLIA</small><h2>{{ row.title }}</h2></div><button mat-icon-button (click)="selected = null" aria-label="Fechar variações"><mat-icon>close</mat-icon></button></header><section class="color-group" *ngFor="let group of groupVariants(row.variants)"><h3>{{ group.color }} <small>· {{ group.variants.length }} variações</small></h3><div class="variant-grid"><article *ngFor="let variant of group.variants"><div><div class="variant-heading"><strong>{{ variant.size }}</strong><span class="variant-status" [attr.data-status]="variant.status"><mat-icon>{{variant.status==='active'?'check_circle':variant.status==='paused'?'pause_circle':variant.status==='under_review'?'pending':'cancel'}}</mat-icon>{{statusLabel(variant.status)}}</span></div><span class="full-badge" *ngIf="variant.isFull" matTooltip="Mercado Envios Full"><mat-icon aria-hidden="true">bolt</mat-icon>Full</span><small>SKU {{ variantDisplaySku(variant) }}</small><small>MLB {{ variant.itemId || variant.variationId }}</small><small class="fiscal-note" *ngIf="variant.costAboveBling">Custo ML: {{variant.fiscalCost | currency:'BRL'}} · Bling: {{variant.blingCost | currency:'BRL'}}</small><small class="fiscal-note" *ngIf="variant.fiscalStatus==='incomplete'">{{variant.fiscalReasons.join('; ')}}</small></div><div><small>Estoque</small><strong>{{ variant.availableQuantity }}</strong><small>{{ visitsLabel(variant.periodSoldQuantity) }} vendidos no período</small><small>{{visitsLabel(variant.soldQuantity)}} vendidos no total</small><small *ngIf="!row.visitsLoading">Visitas no período: {{visitsLabel(variant.visitCount)}}</small><small>Preço: {{ (variant.salePrice ?? variant.price) | currency:'BRL' }}</small><button mat-button (click)="showDetails(variant.listingData)" *ngIf="variant.listingData">Ver anúncio</button></div></article></div></section></section></td></ng-container>
      <tr mat-header-row *matHeaderRowDef="columns"></tr><tr mat-row *matRowDef="let row; columns: columns"></tr>
      <tr mat-row *matRowDef="let row; columns: ['expandedDetail']" class="detail-row"></tr>
    </table>
    <p class="empty-state" *ngIf="!loadingListings && !listings.length && !listError">Nenhum anúncio encontrado. Ajuste os filtros ou sincronize a conta selecionada.</p>
    </div>
    <mat-paginator [disabled]="loadingListings" [length]="totalListings" [pageIndex]="pageIndex" [pageSize]="pageSize" [pageSizeOptions]="[25, 50, 100, 200]" (page)="changePage($event)" showFirstLastButtons aria-label="Páginas de anúncios"></mat-paginator>
  `,
  styles: [`
    .variant-heading{display:flex;align-items:center;justify-content:space-between;gap:10px;min-width:0}.variant-heading>strong{font-size:14px}.variant-status{display:inline-flex;align-items:center;gap:6px;flex-shrink:0;padding:7px 11px;border:1px solid #d0d5dd;border-radius:8px;background:#f2f4f7;color:#475467;font-size:12px;font-weight:700;line-height:18px;white-space:nowrap}.variant-status mat-icon{font-size:18px;width:18px;height:18px}.variant-status[data-status=active]{background:#dcfae6;color:#067647;border-color:#75e0a7}.variant-status[data-status=paused]{background:#fff4d6;color:#934900;border-color:#f5c451}.variant-status[data-status=under_review]{background:#eff4ff;color:#3538cd;border-color:#a4bcfd}.variant-status[data-status=closed],.variant-status[data-status=inactive]{background:#fee4e2;color:#b42318;border-color:#fda29b}
    .visits-period{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:16px 24px;box-sizing:border-box;width:fit-content;max-width:100%;margin:0 0 18px auto;padding:16px 18px;background:#f1f7fb;border:1px solid #d6e5ef;border-radius:12px}.visits-period-summary{display:flex;align-items:center;gap:10px}.visits-period-icon{display:grid;place-items:center;width:38px;height:38px;border-radius:10px;background:#fff;color:#0d5275;border:1px solid #e0ebf3}.visits-period-icon mat-icon{width:21px;height:21px;font-size:21px}.visits-period-summary>div{display:grid;gap:4px}.visits-period-summary strong{font-size:13px;color:#163f56;white-space:nowrap}.visits-period-summary small{font-size:11px;color:#66758a;white-space:nowrap}.visits-period-controls{display:flex;align-items:flex-end;gap:10px;flex-wrap:wrap}.visits-period-controls label{display:grid;gap:6px;font-size:11px;font-weight:500;color:#475467}.visits-period-controls input{box-sizing:border-box;width:156px;height:40px;border:1px solid #c6d7e4;border-radius:8px;background:#fff;color:#15374c;padding:8px 10px;font:inherit;font-size:13px;outline:none;min-width:0}.visits-period-controls input:focus{border-color:#0d658f;box-shadow:0 0 0 3px #0d658f1a}.visits-period-controls button{height:40px;border-radius:8px;white-space:nowrap;font-size:12px}.visits-period-error{flex-basis:100%;font-size:12px;color:#b42318}@media(max-width:700px){.visits-period{width:100%;padding:14px}.visits-period-controls{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);width:100%}.visits-period-controls input{width:100%}.visits-period-controls button{grid-column:1/-1}}
    .visits-heading{display:flex;flex-direction:column;gap:4px;min-width:96px;line-height:1.4}.visits-heading small{display:block;font-size:10px;font-weight:400;text-transform:none;letter-spacing:0}.mat-column-visits small{display:block;white-space:nowrap}.visits-retry{font-size:11px;padding:0 4px;min-width:0}
    .fiscal-check{padding:10px 0;color:#475467;font-size:12px}.fiscal-check small{display:block;margin:5px 0;color:#855800}.fiscal-check mat-progress-bar{margin-top:8px}.fiscal-note{color:#855800;font-size:11px;line-height:1.4}
    .filter-row{display:flex;gap:14px;align-items:flex-start;flex-wrap:wrap}.bulk-toolbar{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin-left:auto;min-height:56px;padding:0 0 20px}.bulk-toolbar>span{display:grid;grid-template-columns:22px auto;column-gap:6px;align-items:center;font-size:12px;color:#0d5275;margin-right:5px}.bulk-toolbar>span>small{grid-column:1 / -1;font-size:10px;color:#667085;margin-top:4px}.bulk-toolbar>span mat-icon{font-size:20px;width:22px;height:22px}.selection-count{font-size:12px;color:#667085;white-space:nowrap;padding:0 6px}.bulk-toolbar button{border-radius:9px;white-space:nowrap;font-size:12px}.selection-cell{width:40px;padding-left:14px!important;padding-right:8px!important}.selection-cell input{width:17px;height:17px;accent-color:#0d5275;cursor:pointer}@media(max-width:1100px){.bulk-toolbar{margin-left:0;width:100%;padding-bottom:10px}}.row-actions{display:grid;gap:7px;min-width:184px;padding:12px 0}.row-actions button{font-size:12px;white-space:nowrap;letter-spacing:0;border-radius:9px}.row-actions .add-variants-action{height:35px;background:#e7f2f8;color:#0d5275;border:1px solid #c8e1ef;box-shadow:none;justify-content:flex-start}.row-actions .fiscal-action{height:34px;border-color:#dce3eb;color:#475467;background:#fff;justify-content:flex-start}.row-actions .fiscal-action mat-icon{font-size:17px;width:18px;height:18px}.row-actions .add-variants-action:hover{background:#d7ebf5}.secondary-actions{display:flex;align-items:center;gap:7px}.row-actions .link-sku-action{height:34px;flex:1;border-color:#dce3eb;color:#475467;background:#fff}.row-actions .details-action{width:34px;height:34px;padding:6px;border:1px solid #e1e6ed;color:#667085;background:#fff}.row-actions .details-action mat-icon{font-size:19px;width:20px;height:20px}.row-actions .add-variants-action mat-icon,.row-actions .link-sku-action mat-icon{font-size:17px;width:18px;height:18px}.variant-button{height:32px!important;border-radius:9px!important;border-color:#d7e2eb!important;background:#f4f8fc!important;font-size:12px!important}.import-button{border-radius:10px!important;height:38px!important}.list-scroll{border-radius:14px}.data-table td{border-bottom-color:#e8edf3!important}
    .sync-progress{max-width:560px;box-sizing:border-box;margin:0 0 24px;padding:14px 18px;background:#f0f7fb;border:1px solid #d4e5ef;border-radius:12px;display:grid;gap:10px}.sync-progress-heading{display:flex;align-items:center;justify-content:space-between;gap:16px;color:#0d5275;font-size:13px}.sync-progress-heading>span{display:flex;align-items:center;gap:8px}.sync-progress-heading mat-icon{font-size:19px;width:19px;height:19px}.sync-percent{font-variant-numeric:tabular-nums}.sync-progress small{color:#667085;font-size:12px;line-height:1.5}.sync-progress mat-progress-bar{border-radius:4px;overflow:hidden}
    .page-header { flex-wrap: wrap; gap: 16px; }
    .header-actions { display:flex; gap:8px; flex-wrap:wrap; }
    .import-button { flex-shrink: 0; white-space: nowrap; }
    .sort-column{display:inline-flex;align-items:center;gap:4px;padding:6px 0;border:0;background:transparent;color:inherit;font:inherit;font-weight:inherit;text-transform:inherit;cursor:pointer;white-space:nowrap}.sort-column mat-icon{width:15px;height:15px;font-size:15px;color:#0b577b}.sort-column:focus-visible{outline:2px solid #0b577b;outline-offset:3px;border-radius:3px}.variant-button{white-space:nowrap}.detail-row{height:0}.detail-row td{padding:0!important;border-bottom-width:0}.variant-panel{padding:20px 24px;background:#f8faff;border-block:1px solid #d6e4ff}.variant-panel header{display:flex;justify-content:space-between;gap:12px}.variant-panel h2{font-size:18px;margin:6px 0 20px}.variant-panel small{color:#697386}.color-group{background:white;border:1px solid #d6e4ff;border-radius:12px;padding:14px;margin-bottom:16px}.color-group h3{margin:0 0 12px;font-size:15px}.variant-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr));gap:12px}.variant-grid article{display:flex;flex-direction:column;gap:14px;min-width:0;border:1px solid #eaecf0;border-radius:9px;padding:14px;background:#f9fafb}.variant-grid article>div{display:grid;gap:6px;min-width:0;overflow-wrap:break-word}.variant-grid article>div:first-child>strong{font-size:14px}.variant-grid article>div:last-child{text-align:left;border-top:1px solid #eaecf0;padding-top:12px}.variant-grid article small{white-space:normal;line-height:1.5}.variant-grid article button{justify-self:start}@media(max-width:600px){.variant-panel{padding:14px 10px}.color-group{padding:10px}}

    .listing-controls{display:grid;gap:12px;padding:14px 16px;margin-bottom:16px;border:1px solid #dce5ee;border-radius:12px;background:#fff}
    .listing-controls .filter-row{align-items:flex-end;gap:10px}
    .listing-filter{display:grid;gap:6px;width:190px;min-width:0}.listing-filter>span{font-size:11px;font-weight:500;color:#475467}.listing-filter mat-form-field{width:100%;--mdc-outlined-text-field-container-shape:8px;--mdc-outlined-text-field-outline-color:#c6d7e4;--mdc-outlined-text-field-hover-outline-color:#91b4cc;--mdc-outlined-text-field-focus-outline-color:#0d658f;--mat-form-field-container-height:36px;--mat-form-field-container-vertical-padding:7px;--mat-form-field-container-text-size:13px;--mat-select-trigger-text-size:13px;--mat-select-enabled-trigger-text-color:#15374c;--mat-select-enabled-arrow-color:#66758a}
    :host ::ng-deep .listing-filter .mat-mdc-text-field-wrapper{height:36px;background:#fff;border-radius:8px;padding:0 10px}
    :host ::ng-deep .listing-filter .mat-mdc-form-field-infix{min-height:36px;padding-top:7px;padding-bottom:7px;box-sizing:border-box}

    .listing-controls .bulk-toolbar{margin-left:auto;min-height:36px;padding:0;width:auto;gap:8px}
    .listing-controls .visits-period{width:100%;max-width:none;margin:0;padding:12px 0 0;background:transparent;border:0;border-top:1px solid #e6edf3;border-radius:0;gap:12px;justify-content:space-between}
    .listing-controls .visits-period-icon{background:#edf5fa;border:0;width:34px;height:34px;border-radius:8px}
    .listing-controls .visits-period-controls input{height:36px;border-radius:8px}
    .listing-controls button:not(.mat-mdc-icon-button),.page-header .import-button,.row-actions button:not(.mat-mdc-icon-button),.variant-button{height:36px!important;border-radius:8px!important;font-size:12px!important;font-weight:500;letter-spacing:0;box-shadow:none}
    .listing-controls button mat-icon,.page-header .import-button mat-icon,.row-actions button mat-icon{width:18px;height:18px;font-size:18px}
    .listing-controls button[mat-stroked-button]:not(:disabled),.row-actions button:not(.mat-mdc-icon-button):not(:disabled),.variant-button:not(:disabled){border:1px solid #cad8e3!important;background:#fff!important;color:#0d5275!important}
    .listing-controls button[mat-stroked-button]:not(:disabled):hover,.row-actions button:not(.mat-mdc-icon-button):not(:disabled):hover,.variant-button:not(:disabled):hover{background:#eef5fa!important;border-color:#91b4cc!important}
    .row-actions .details-action{width:36px;height:36px;border-radius:8px}
    .row-actions .add-variants-action,.row-actions .fiscal-action,.row-actions .duplicate-action,.row-actions .link-sku-action{justify-content:flex-start}
    @media(max-width:1100px){.listing-controls .bulk-toolbar{margin-left:0}.listing-controls .visits-period-controls{gap:8px}}
    @media(max-width:700px){.listing-controls{padding:12px}.listing-controls .filter-row>.listing-filter{flex:1 1 140px;min-width:0}.listing-controls .bulk-toolbar{width:100%}.listing-controls .visits-period{padding-top:12px}.listing-controls .visits-period-controls{width:100%}}

    .mat-column-price{min-width:170px}.listing-price{display:grid;gap:9px;padding:12px 0;font-variant-numeric:tabular-nums;line-height:1.4}.price-main{display:grid;gap:2px}.price-main strong{font-size:17px;font-weight:650;letter-spacing:-.3px;color:#20364a;white-space:nowrap}.price-main>span{font-size:12px;font-weight:500;color:#52677a;white-space:nowrap}.price-promo-label{justify-self:start;padding:3px 8px;background:#e5f4eb;border:1px solid #cbe7d6;border-radius:5px;color:#087443;font-size:10px;font-weight:600;letter-spacing:.15px}.promotion-price .price-main strong{color:#087443;font-size:19px}.promotion-price .price-main>span{color:#176b45}.price-base{display:grid;gap:2px;border-top:1px solid #e4eaf0;padding-top:8px;max-width:185px}.price-base>span:first-child{font-size:10px;color:#7a8795}.price-base>span:last-child{font-size:11px;color:#677788;line-height:1.5}.price-query{font-size:10px;color:#7a8795;max-width:160px}
    .full-badge{display:flex;align-items:center;gap:3px;width:fit-content;padding:3px 7px;margin-top:6px;border-radius:5px;background:#e7f6ee;color:#00834b;border:1px solid #c9e9d9;font-size:11px;font-weight:700;line-height:1.25;white-space:nowrap}.full-badge mat-icon{font-size:15px;width:15px;height:15px}.variant-grid .full-badge{margin:7px 0}
    .data-table th.mat-mdc-header-cell:not(:last-child),.data-table td.mat-mdc-cell:not(:last-child){border-right:1px solid #cbd8e4}.data-table th.mat-mdc-header-cell:not(:last-child){border-right-color:#bdcddd}.data-table .detail-row td.mat-mdc-cell{border-right:0}
    .listing-controls{gap:14px;padding:16px 18px}.listing-controls .filter-row{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));align-items:end;gap:12px}.listing-controls .filter-row>.listing-filter{width:auto;min-width:0}.listing-controls .bulk-toolbar{width:100%;min-height:36px;box-sizing:border-box;margin:0;padding:12px 0 0;border-top:1px solid #e6edf3;display:flex;align-items:center;gap:8px;flex-wrap:wrap}.listing-controls .bulk-toolbar-title{display:block;order:-2;font-size:12px;font-weight:600;color:#34475b;margin-right:5px}.listing-controls .bulk-toolbar .selection-count{order:-1;margin-right:auto;padding:5px 9px;border-radius:6px;background:#f0f5f9;color:#617184;white-space:nowrap}.listing-controls .visits-period{padding:14px 0 0;margin:0;align-items:center}.listing-controls .visits-period-controls{display:flex;align-items:flex-end;gap:10px;flex-wrap:wrap}.listing-controls .visits-period-controls label{margin:0}.listing-controls .visits-period-controls button{margin:0;min-width:170px}.listing-controls .bulk-toolbar button{margin:0}.listing-controls .bulk-toolbar button[mat-icon-button]{flex-shrink:0}
    @media(max-width:1100px){.listing-controls .filter-row{grid-template-columns:repeat(3,minmax(0,1fr))}.listing-controls .visits-period{gap:14px}.listing-controls .visits-period-controls{justify-content:flex-start}.listing-controls .bulk-toolbar{margin:0;width:100%}}
    @media(max-width:700px){.listing-controls{padding:14px}.listing-controls .filter-row{grid-template-columns:repeat(2,minmax(0,1fr))}.listing-controls .visits-period-controls{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));width:100%;gap:10px}.listing-controls .visits-period-controls input{width:100%;min-width:0;box-sizing:border-box}.listing-controls .visits-period-controls button{grid-column:1/-1;width:100%;min-width:0}.listing-controls .bulk-toolbar-title{flex-basis:calc(100% - 145px);margin:0}.listing-controls .bulk-toolbar .selection-count{margin:0 0 4px auto}.listing-controls .bulk-toolbar button:not([mat-icon-button]){flex:1 1 140px}}
    .sold-metrics{display:grid;gap:10px;padding:10px 0;min-width:82px;font-variant-numeric:tabular-nums}.sold-period,.sold-total{display:grid;gap:4px}.sold-metrics .sold-label{font-size:10px;color:#758293;line-height:1.3;white-space:nowrap}.sold-period strong{font-size:16px;font-weight:650;color:#173f5b}.sold-total{border-top:1px solid #e3eaf0;padding-top:8px}.sold-total-value{font-size:13px;font-weight:500;color:#53677c}
    .total-label{display:block;font-size:13px;font-weight:400;color:#697386;margin-top:6px}.listing-product{display:flex;align-items:center;gap:14px;padding:12px 0;min-width:300px;max-width:480px}.listing-product img,.photo-placeholder{width:64px;height:64px;flex-shrink:0;border:1px solid #e4e7ec;border-radius:10px;background:#fff;object-fit:contain}.photo-placeholder{display:grid;place-items:center;color:#98a2b3}.title-link{background:none;border:0;padding:0;text-align:left;font-weight:600;color:#172033;cursor:pointer;line-height:1.45}.title-link:hover{color:#4f46e5;text-decoration:underline}.listing-product small{margin-top:4px}.listing-block-note{display:block;margin-top:5px;color:#7a6a57;font-size:10px;line-height:1.4}.empty-state{text-align:center;padding:32px;color:#697386}
    .list-scroll{min-width:0;max-width:100%}.list-scroll .data-table{display:table;table-layout:fixed;width:100%;min-width:0;max-width:100%}.data-table th.mat-mdc-header-cell,.data-table td.mat-mdc-cell{min-width:0;padding:10px 8px;box-sizing:border-box;white-space:normal;overflow-wrap:anywhere}.data-table .mat-column-select{width:3%;padding-left:8px!important;padding-right:4px!important}.data-table .mat-column-item{width:25%}.data-table .mat-column-variants{width:11%}.data-table .mat-column-status{width:7%}.data-table .mat-column-stock{width:7%}.data-table .mat-column-sold{width:8%}.data-table .mat-column-visits{width:6%}.data-table .mat-column-price{width:11%;min-width:0}.data-table .mat-column-links{width:6%}.data-table .mat-column-actions{width:16%}.listing-product{min-width:0;max-width:100%;gap:10px}.listing-product>div{min-width:0}.title-link{overflow-wrap:anywhere}.row-actions{min-width:0;width:100%}.row-actions button:not(.mat-mdc-icon-button){min-width:0;max-width:100%;white-space:normal;height:auto!important;min-height:36px;padding:6px 8px;line-height:1.35}.secondary-actions{flex-wrap:wrap}.secondary-actions .link-sku-action{flex:1 1 90px}.row-actions .details-action{flex-shrink:0}.visits-heading,.sold-metrics{min-width:0}.sold-metrics .sold-label,.mat-column-visits small,.sort-column,.full-badge{white-space:normal}.variant-button{min-width:0;max-width:100%;white-space:normal;padding:4px 6px}.price-main strong,.price-main>span{white-space:normal}.status-chip{max-width:100%;box-sizing:border-box;overflow-wrap:anywhere}@media(max-width:1100px){.data-table th.mat-mdc-header-cell,.data-table td.mat-mdc-cell{padding:8px 5px;font-size:11px}.listing-product{align-items:flex-start;flex-direction:column}.listing-product img,.photo-placeholder{width:44px;height:44px}.row-actions button:not(.mat-mdc-icon-button){font-size:11px!important}.price-main strong,.promotion-price .price-main strong{font-size:14px}}

.filters-heading{display:flex;align-items:center;gap:14px;margin-bottom:8px;flex-shrink:0}.filters-heading>span{font-size:12px;color:#617184}.filters-heading button{height:32px;font-size:12px;letter-spacing:0}.listing-controls[hidden]{display:none}.listing-controls{gap:8px;padding:10px 14px;margin-bottom:8px}.listing-controls .visits-period{padding-top:8px}.compact-bulk-toolbar{flex:0 0 auto;min-height:36px;margin:0 0 8px;padding:0;gap:8px}.compact-bulk-toolbar .bulk-toolbar-title{display:none}.compact-bulk-toolbar .selection-count{margin-right:auto;order:-1}.compact-bulk-toolbar button{height:32px;font-size:12px}.page-header{margin-bottom:12px;gap:12px}.total-label{margin-top:2px}.listing-product{padding:4px 0;gap:10px}.listing-product img,.photo-placeholder{width:48px;height:48px}.listing-product small{font-size:11px;line-height:1.35;margin-top:2px}.data-table td.mat-mdc-cell{padding-top:7px;padding-bottom:7px}.data-table tr.mat-mdc-row:not(.detail-row){height:88px}.data-table tr.mat-mdc-header-row{height:42px}.compact-row-actions{display:flex;align-items:center;flex-wrap:wrap;gap:6px;padding:0}.compact-row-actions .fiscal-note{flex-basis:100%;margin:0}.sold-metrics{gap:4px;padding:0}.sold-total{padding-top:4px}.sold-period,.sold-total{gap:2px}.listing-price{gap:4px;padding:0}.price-base{padding-top:4px}.data-table .mat-column-item{width:29%}.data-table .mat-column-variants{width:9%}.data-table .mat-column-actions{width:14%}.data-table .status-chip{border-radius:6px;padding:4px 6px;font-size:10px;line-height:1.4}.data-table tr.mat-mdc-row:not(.detail-row):hover{background:#f3f8fc}@media(max-width:1100px){.listing-product{flex-direction:row;align-items:center}.list-scroll .data-table{min-width:1100px}.filters-heading{flex-wrap:wrap}.compact-bulk-toolbar{width:auto}}

    /* Give the listing table the remaining viewport after a compact toolbar. */
    .page-header{min-height:40px;margin-bottom:10px;flex-wrap:nowrap;gap:16px}.page-header h1{font-size:25px;flex-shrink:0}.total-label{font-size:11px;margin-top:2px}.page-header .search{width:clamp(240px,30vw,440px);--mat-form-field-container-height:36px;--mat-form-field-container-vertical-padding:7px;--mat-form-field-container-text-size:13px}.header-actions{flex-wrap:nowrap;gap:6px}.page-header .import-button{height:32px!important;padding:0 10px;font-size:11px!important}
    .listing-controls{padding:8px 10px;gap:8px;margin-bottom:6px}.listing-filter{gap:3px}.listing-controls .filter-row{gap:8px}.listing-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;flex:0 0 auto;margin-bottom:6px}.filters-heading{gap:10px;margin:0}.filters-heading>span{font-size:11px}.filters-heading button{height:30px}.compact-bulk-toolbar{margin:0;min-height:30px;gap:6px}.compact-bulk-toolbar button{height:30px;padding:0 10px;font-size:11px}.compact-bulk-toolbar .selection-count{font-size:11px;padding:0}
    @media(min-width:1350px){.listing-controls{grid-template-columns:minmax(0,1fr) auto;align-items:end;column-gap:12px}.listing-controls .filter-row{grid-template-columns:repeat(6,minmax(0,1fr))}.listing-controls .visits-period{width:auto;padding:0;border:0;margin:0}.listing-controls .visits-period-summary{display:none}.listing-controls .visits-period-controls{gap:6px;flex-wrap:nowrap}.listing-controls .visits-period-controls label{gap:3px}.listing-controls .visits-period-controls input{width:132px}.listing-controls .visits-period-controls button{min-width:0;padding:0 10px}.fiscal-check{grid-column:1/-1}}
    @media(max-width:1349px){.page-header{flex-wrap:wrap}.page-header .search{flex:1;min-width:240px}.listing-controls .visits-period{padding-top:6px}.listing-toolbar{flex-wrap:wrap}.compact-bulk-toolbar{width:auto;margin-left:auto}}
    @media(max-width:700px){.page-header{align-items:stretch}.page-header .search{width:100%;min-width:0}.header-actions{flex-wrap:wrap}.listing-toolbar{align-items:flex-start}.filters-heading{flex-wrap:wrap;gap:6px}.compact-bulk-toolbar{flex-wrap:wrap}.listing-controls .visits-period-summary{display:none}}
    .search-progress{flex:0 0 auto;display:grid;gap:5px;margin:0 0 6px;color:#0d5275;font-size:12px}.search-progress span{padding:0 4px}.ranking-progress-count{display:flex;align-items:center;justify-content:space-between;gap:12px}.ranking-progress-count strong{font-size:16px;font-variant-numeric:tabular-nums}.search-progress mat-progress-bar{height:8px;border-radius:5px}.list-loading .data-table{opacity:.45;pointer-events:none}
  `]
})
export class ListingsComponent implements OnInit, OnDestroy {
  filtersExpanded = true;
  search = new FormControl('');
  skuMatch = new FormControl('');
  status = new FormControl('');
  linked = new FormControl('');
  fiscalStatus = new FormControl('');
  full = new FormControl('');
  promotion = new FormControl('');
  promotionCheck?:{checked:number;total:number;remaining:number;unavailable:number;nextRetryMs?:number};
  fiscalCheck?:{checked:number;total:number;remaining:number;unavailable:number;nextRetryMs?:number};
  listings: any[] = [];
  selected: any | null = null;
  totalListings = 0;
  pageIndex = 0;
  pageSize = 50;
  importing = false;
  syncing = false;syncingToday=false;
  progressPercent = 0;
  progressProcessed = 0;
  progressTotal: number | null = null;
  private progressSubscription?: Subscription;
  listError = '';
  loadingListings = true;
  rankingPercent=0;
  rankingCompleted=0;
  rankingTotal=0;
  private rankingProgressSubscription?:Subscription;
  private trackRankingProgress(progressId:string){
    this.rankingProgressSubscription=timer(0,700).pipe(switchMap(()=>this.api.get<any>('/listings/sales-progress',{progressId})),catchError(()=>EMPTY),takeUntil(this.destroyed)).subscribe(progress=>{
      if(!this.loadingListings)return;
      this.rankingPercent=Math.max(0,Math.min(99,Number(progress.percent)||0));this.rankingCompleted=progress.completed||0;this.rankingTotal=progress.total||0;
    });
  }
  retryingListings = false;
  retryList(){this.refresh.next();}
  private readonly refresh = new Subject<void>();
  columns = ['select','item', 'variants', 'status', 'stock', 'sold', 'visits', 'price', 'links', 'actions'];
  private readonly destroyed=new Subject<void>();private visitsSubscription?:Subscription;
  readonly bulkSelection=new Map<string,any>();
  get allPageSelected(){return this.listings.length>0&&this.listings.filter(row=>!row.interactionBlocked).length>0&&this.listings.filter(row=>!row.interactionBlocked).every(row=>this.bulkSelection.has(row.id));}
  get somePageSelected(){return this.listings.some(row=>this.bulkSelection.has(row.id));}
  toggleBulk(row:any){if(row.interactionBlocked)return;if(this.bulkSelection.has(row.id))this.bulkSelection.delete(row.id);else this.bulkSelection.set(row.id,row);}
  togglePageSelection(){const clear=this.allPageSelected;for(const row of this.listings.filter(row=>!row.interactionBlocked)){if(clear)this.bulkSelection.delete(row.id);else this.bulkSelection.set(row.id,row);}}
  openSelectedActions(){if(!this.bulkSelection.size)return;const initialAnnouncements=[...this.bulkSelection.values()].map(row=>({id:row.id,reference:this.actionReference(row),title:row.title,items:(row.children??[row]).map((child:any)=>child.itemId),variations:row.variants?.length??0,conflict:false}));this.dialog.open(SkuActionsDialogComponent,{data:{initialAnnouncements,onUpdated:()=>this.refresh.next()},width:'1100px',maxWidth:'97vw',maxHeight:'94vh'}).afterClosed().subscribe(()=>this.refresh.next());}
  sortBy:'stock'|'sold'|'price'|'visits'|undefined;sortDirection:'asc'|'desc'='desc';
  sort(field:'stock'|'sold'|'price'|'visits'){this.sortDirection=this.sortBy===field&&this.sortDirection==='desc'?'asc':'desc';this.sortBy=field;if(field==='visits'){this.sortVisits();return;}this.pageIndex=0;this.refresh.next();}
  sortIcon(field:string){return this.sortBy===field?(this.sortDirection==='desc'?'arrow_downward':'arrow_upward'):'unfold_more';}
  sortAria(field:string){return this.sortBy===field?(this.sortDirection==='desc'?'descending':'ascending'):'none';}
  sortLabel(field:string,label:string){return 'Ordenar '+label+' '+(this.sortBy===field&&this.sortDirection==='desc'?'do menor para o maior':'do maior para o menor');}
  constructor(private readonly api: ApiService, private readonly dialog: MatDialog,private readonly notifications:MatSnackBar) {}
  createListing(){this.dialog.open(CreateListingDialogComponent,{width:'1000px',maxWidth:'97vw',maxHeight:'94vh',ariaLabel:'Criar anúncio com SKU Bling'}).afterClosed().subscribe(()=>this.refresh.next());}
  private notify(message:string,attention=false){this.notifications.openFromComponent(OperationNoticeComponent,{data:operationNotice(message,attention),panelClass:'operation-notice-panel',duration:attention?0:8000,horizontalPosition:'right',verticalPosition:'bottom',politeness:'polite'});}
  actionReference(row:any){return (row.children??[]).find((child:any)=>!child.interactionBlocked&&child.status!=='closed'&&!child.rawData?.sub_status?.some((status:string)=>['deleted','forbidden'].includes(status)))?.itemId||row.itemId;}
  linkSku(row: any) { this.dialog.open(SkuLinkDialogComponent, { data: { reference: this.actionReference(row), title: row.title, onUpdated: () => this.refresh.next() }, width: '1000px', maxWidth: '96vw', maxHeight: '90vh' }).afterClosed().subscribe(result => { if (result?.message) this.notify(result.message,!result.success); this.refresh.next(); }); }
  addVariations(row: any) { this.dialog.open(AddVariationsDialogComponent, { data: { reference: this.actionReference(row), title: row.title, onUpdated: () => this.refresh.next() }, width: '1050px', maxWidth: '96vw', maxHeight: '92vh' }).afterClosed().subscribe(() => this.refresh.next()); }
  editFiscal(row: any) { this.dialog.open(ListingFiscalDialogComponent, { data: { reference: this.actionReference(row), title: row.title, onUpdated: () => this.refresh.next() }, width: '1150px', maxWidth: '97vw', maxHeight: '94vh' }).afterClosed().subscribe(() => this.refresh.next()); }
  openSkuActions() { this.dialog.open(SkuActionsDialogComponent, { data: { onUpdated: () => this.refresh.next() }, width: '1000px', maxWidth: '96vw', maxHeight: '92vh' }).afterClosed().subscribe(() => this.refresh.next()); }
  photo = listingPhoto;
  toggleVariants(row: any) { this.selected = this.selected?.id === row.id ? null : row; }
  variantDisplaySku(variant:any){
    const links=(variant.listingData?.links??[]).filter((link:any)=>link.productVariant?.sku && (variant.listingData?.variants?.length ? link.listingVariantId===variant.id : !link.listingVariantId));
    const skus=[...new Set<string>(links.map((link:any)=>link.productVariant.sku))];
    return skus.length ? skus.join(', ') : variant.sku || 'não informado';
  }
  groupVariants(variants: any[]) {
    const groups = new Map<string, any[]>();
    for (const variant of variants || []) {
      const attrs = variant.attributes?.attribute_combinations || variant.rawData?.attribute_combinations || [];
      const color = attrs.find((a: any) => a.id === 'COLOR' || a.name?.toLowerCase() === 'cor')?.value_name || 'Sem cor informada';
      const size = attrs.find((a: any) => ['SIZE', 'SHOE_SIZE', 'APPAREL_SIZE'].includes(a.id) || a.name?.toLowerCase() === 'tamanho')?.value_name;
      const options = attrs.filter((a: any) => a.id !== 'COLOR' && a.name?.toLowerCase() !== 'cor').map((a: any) => a.value_name).filter(Boolean).join(' · ');
      if (!groups.has(color)) groups.set(color, []);
      groups.get(color)!.push({ ...variant, size: /^(UN|unico|único)$/i.test((size||'').trim())?'Único':size || options || 'Variação sem tamanho' });
    }
    return Array.from(groups, ([color, variants]) => ({ color, variants: variants.sort((a, b) => compareSizes(a.size, b.size)) }));
  }
  displaySku(row:any){const attribute=row.rawData?.attributes?.find((value:any)=>value.id==='SELLER_SKU');return row.variants?.[0]?.sku || attribute?.value_name || attribute?.values?.[0]?.name || row.rawData?.seller_custom_field || 'SKU não informado';}
  statusLabel(status: string) { return ({mixed:'Status variados',active:'Ativo',paused:'Pausado',closed:'Finalizado',under_review:'Em análise',inactive:'Inativo'} as Record<string,string>)[status] || status; }
  typeLabel(type: string) { return ({gold_special:'Clássico',gold_pro:'Premium',free:'Grátis'} as Record<string,string>)[type] || type || ''; }
  duplicateSelected(){if(!this.bulkSelection.size)return;this.dialog.open(BulkDuplicateListingDialogComponent,{data:[...this.bulkSelection.values()],width:'960px',maxWidth:'97vw',maxHeight:'94vh',ariaLabel:'Duplicar selecionados'}).afterClosed().subscribe(()=>this.refresh.next());}
  duplicateListing(row:any){this.dialog.open(DuplicateListingDialogComponent,{data:{...row,children:row.children?[...row.children].sort((a:any,b:any)=>Number(a.itemId!==this.actionReference(row))-Number(b.itemId!==this.actionReference(row))):undefined},width:'920px',maxWidth:'97vw',maxHeight:'94vh',ariaLabel:'Duplicar anúncio'}).afterClosed().subscribe(()=>this.refresh.next());}
  showDetails(row: any) { this.dialog.open(ListingDetailsComponent, { data: {...row,itemId:this.actionReference(row),children:row.children?[...row.children].sort((a:any,b:any)=>Number(a.itemId!==this.actionReference(row))-Number(b.itemId!==this.actionReference(row))):undefined}, width: '1150px', maxWidth: '97vw', maxHeight: '94vh', ariaLabel: 'Detalhes do anúncio pai e variações' }).afterClosed().subscribe(()=>this.refresh.next()); }
  ngOnInit() {
    combineLatest([
      this.search.valueChanges.pipe(startWith(''), tap(() => {this.pageIndex = 0;this.bulkSelection.clear();})),
      this.status.valueChanges.pipe(startWith(''), tap(() => {this.pageIndex = 0;this.bulkSelection.clear();})),
      this.full.valueChanges.pipe(startWith(''), tap(() => {this.pageIndex=0;this.bulkSelection.clear();this.fiscalCheck=undefined;})),
      this.linked.valueChanges.pipe(startWith(''), tap(() => {this.pageIndex = 0;this.bulkSelection.clear();})),
      this.skuMatch.valueChanges.pipe(startWith(''), tap(() => {this.pageIndex = 0;this.bulkSelection.clear();})),
      this.fiscalStatus.valueChanges.pipe(startWith(''), tap(() => {this.pageIndex = 0;this.bulkSelection.clear();this.fiscalCheck=undefined;})),
      this.promotion.valueChanges.pipe(startWith(''),tap(()=>{this.pageIndex=0;this.bulkSelection.clear();this.promotionCheck=undefined;})),
      this.refresh.pipe(startWith(undefined))
    ]).pipe(tap(()=>{this.rankingProgressSubscription?.unsubscribe();this.rankingPercent=0;this.rankingCompleted=0;this.rankingTotal=0;this.loadingListings=true;this.retryingListings=false;this.listError='';}), switchMap(([search, status, full, linked, skuMatch, fiscalStatus, promotion]) => {const progressId=this.sortBy==='sold'?(globalThis.crypto?.randomUUID?.()??Date.now()+'-'+Math.random().toString(36).slice(2)):undefined;if(progressId)this.trackRankingProgress(progressId);const params={
      search: search ?? '',
      status: status ?? '',
      full: full ?? '',
      linked: linked ?? '',
      skuMatch: skuMatch ?? '',
      promotion:promotion ?? '',
      fiscalStatus:fiscalStatus ?? '',
      sortBy:this.sortBy==='visits'?undefined:this.sortBy,
      dateFrom:this.visitsPeriod.dateFrom,dateTo:this.visitsPeriod.dateTo,
      progressId,
      sortDirection:this.sortDirection,
      page: this.pageIndex + 1,
      limit: this.pageSize
    };const fetch=()=>this.api.get<Page<any> & {promotionCheck?:{checked:number;total:number;remaining:number;unavailable:number;nextRetryMs?:number};fiscalCheck?:{checked:number;total:number;remaining:number;unavailable:number;nextRetryMs?:number}}>('/listings/grouped',params).pipe(retry({delay:(failure,attempt)=>{if([400,401,403,404,422].includes(failure.status))return throwError(()=>failure);this.retryingListings=true;return timer(Math.min(30000,1000*2**Math.min(attempt-1,5)));}}));return timer(300).pipe(switchMap(()=>fetch().pipe(expand(page=>page.fiscalCheck?.remaining||page.promotionCheck?.remaining?timer(page.fiscalCheck?.nextRetryMs??page.promotionCheck?.nextRetryMs??2000).pipe(switchMap(fetch)):EMPTY),catchError(() => {
      this.loadingListings = false;
      this.rankingProgressSubscription?.unsubscribe();
      this.retryingListings = false;
      this.listings = [];
      this.totalListings = 0;
      this.listError = 'Não foi possível carregar a lista. Tente atualizar a página.';
      return EMPTY;
    }))));})).pipe(takeUntil(this.destroyed)).subscribe((page) => {
      this.rankingProgressSubscription?.unsubscribe();this.rankingPercent=100;
      this.loadingListings = false;
      this.retryingListings = false;
      this.listError = '';
      this.listings = page.data;
      for(const row of this.listings)if(row.interactionBlocked)this.bulkSelection.delete(row.id);
      this.fiscalCheck=page.fiscalCheck;this.promotionCheck=page.promotionCheck;
      if(!this.fiscalCheck?.remaining){this.loadVisits();this.loadPrices();}
      this.selected = this.listings.find(row => row.id === this.selected?.id) ?? null;
      this.totalListings = page.pagination.total;
    });
  }
  changePage(event: PageEvent) {
    this.pageIndex = event.pageIndex;
    this.pageSize = event.pageSize;
    this.refresh.next();
  }
  private sortVisits(){
    if(this.sortBy!=='visits')return;const field='visitCount';
    this.listings=[...this.listings].sort((a,b)=>{
      const av=Number.isSafeInteger(a[field])?a[field]:null,bv=Number.isSafeInteger(b[field])?b[field]:null;
      if(av===null)return bv===null?0:1;if(bv===null)return -1;
      return (av-bv)*(this.sortDirection==='desc'?-1:1);
    });
  }
  priceMoney(value:unknown){if(value===null||value===undefined||value==='')return '—';const amount=Number(value);return Number.isFinite(amount)?amount.toLocaleString('pt-BR',{style:'currency',currency:'BRL'}):'—';}
  visitsLabel(value:unknown){return Number.isSafeInteger(value)?Number(value).toLocaleString('pt-BR'):'—';}
  readonly visitsToday=new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'});
  private dateOffset(days:number){return new Date(Date.parse(this.visitsToday)+days*86400000).toISOString().slice(0,10);}
  readonly visitsFrom=new FormControl(this.dateOffset(-30),{nonNullable:true});
  readonly visitsTo=new FormControl(this.dateOffset(-1),{nonNullable:true});
  private visitsPeriod={dateFrom:this.visitsFrom.value,dateTo:this.visitsTo.value};
  visitsPeriodError='';
  get visitsPeriodLabel(){const format=(date:string)=>date.split('-').reverse().join('/');return format(this.visitsPeriod.dateFrom)+' a '+format(this.visitsPeriod.dateTo);}
  applyVisitsPeriod(){
    const from=this.visitsFrom.value,to=this.visitsTo.value;
    if(!from||!to||!Number.isFinite(Date.parse(from))||!Number.isFinite(Date.parse(to))||from>to||to>this.visitsToday){this.visitsPeriodError='Informe datas válidas, em ordem e sem datas futuras.';return;}
    if((Date.parse(to)-Date.parse(from))/86400000+1>150){this.visitsPeriodError='Selecione um intervalo de até 150 dias.';return;}
    this.visitsPeriodError='';this.visitsPeriod={dateFrom:from,dateTo:to};if(this.sortBy==='sold'){this.pageIndex=0;this.refresh.next();}else this.loadVisits();
  }
  private visitIds(row:any):string[]{return [...new Set<string>((row.children?.length?row.children:[row]).map((child:any)=>child.itemId).filter((id:any)=>/^MLB\d+$/.test(id)))];}
  private pricesSubscription?:Subscription;
  private salesSubscription?:Subscription;
  loadSales(){
    this.salesSubscription?.unsubscribe();const period={...this.visitsPeriod},rows=this.listings.filter(row=>row.periodSalesFrom!==period.dateFrom||row.periodSalesTo!==period.dateTo||!Number.isSafeInteger(row.periodSoldQuantity)),metrics=new Map<string,any>(),ids=[...new Set(rows.flatMap(row=>this.visitIds(row)))],batches:string[][]=[];
    for(let i=0;i<ids.length;i+=20)batches.push(ids.slice(i,i+20));
    for(const row of rows){row.periodSoldQuantity=null;row.salesLoading=true;for(const variant of row.variants??[])variant.periodSoldQuantity=null;}
    this.salesSubscription=from(batches).pipe(mergeMap(ids=>this.api.post<any>('/listings/sales',{ids,...period}).pipe(catchError(()=>of({items:ids.map(itemId=>({itemId,soldQuantity:null}))}))),2),takeUntil(this.destroyed)).subscribe(response=>{
      for(const item of response.items??[])metrics.set(item.itemId,item);
      for(const row of rows){const members=this.visitIds(row);if(!members.every(id=>metrics.has(id)))continue;row.salesLoading=false;
        row.periodSoldQuantity=members.every(id=>Number.isSafeInteger(metrics.get(id).soldQuantity))?members.reduce((sum,id)=>sum+metrics.get(id).soldQuantity,0):null;
        for(const variant of row.variants??[]){const metric=metrics.get(variant.itemId);if(!Number.isSafeInteger(metric?.soldQuantity))continue;
          variant.periodSoldQuantity=String(variant.variationId)===variant.itemId?metric.soldQuantity:metric.variations?.find((value:any)=>String(value.variationId)===String(variant.variationId))?.soldQuantity??0;
        }
      }this.sortVisits();
    });
  }
  loadPrices(){
    this.pricesSubscription?.unsubscribe();const rows=this.listings,prices=new Map<string,any>(),ids=[...new Set(rows.flatMap(row=>this.visitIds(row)))],batches:string[][]=[];
    for(let i=0;i<ids.length;i+=20)batches.push(ids.slice(i,i+20));
    for(const row of rows){row.salePriceLoading=true;row.salePriceComplete=false;row.salePriceError=false;}
    this.pricesSubscription=from(batches).pipe(mergeMap(ids=>this.api.post<any>('/listings/prices',{ids}).pipe(catchError(()=>of({items:ids.map(itemId=>({itemId,amount:null}))}))),2),takeUntil(this.destroyed)).subscribe(response=>{
      for(const item of response.items??[])prices.set(item.itemId,item);
      for(const row of rows){const members=this.visitIds(row);if(!members.every(id=>prices.has(id)))continue;
        row.salePriceLoading=false;row.salePriceComplete=members.every(id=>typeof prices.get(id).amount==='number');row.salePriceError=!row.salePriceComplete;
        if(row.salePriceComplete){row.saleMin=Math.min(...members.map(id=>prices.get(id).amount));row.saleMax=Math.max(...members.map(id=>prices.get(id).amount));row.hasPromotion=members.some(id=>prices.get(id).promotional);}
        for(const variant of row.variants??[])variant.salePrice=prices.get(variant.itemId)?.amount??null;
      }
    });
  }
  private fetchVisits(ids:string[],period:{dateFrom:string;dateTo:string},attempt=0):Observable<any>{
    return this.api.post<any>('/listings/visits',{ids,...period}).pipe(
      catchError(()=>of({items:ids.map(itemId=>({itemId,visits:null}))})),
      switchMap(response=>{
        const items=response.items??[],missing=ids.filter(id=>!items.some((item:any)=>item.itemId===id&&Number.isSafeInteger(item.visits)));
        if(!missing.length||attempt>=2)return of(response);
        return timer(1000*(attempt+1)).pipe(switchMap(()=>this.fetchVisits(missing,period,attempt+1)),map(retry=>({items:[...items.filter((item:any)=>!missing.includes(item.itemId)),...(retry.items??[])]})));
      }));
  }
  loadVisits(){this.loadSales();
    this.visitsSubscription?.unsubscribe();const rows=this.listings;const metrics=new Map<string,any>();
    const period={...this.visitsPeriod};const ids=[...new Set(rows.flatMap(row=>this.visitIds(row)))];const batches:string[][]=[];
    for(let i=0;i<ids.length;i+=20)batches.push(ids.slice(i,i+20));
    for(const row of rows){row.visitCount=null;row.visitsPartial=false;row.visitsLoading=this.visitIds(row).length>0;row.visitsTooltip='Consultando visitas de '+this.visitsPeriodLabel+'.';}
    this.visitsSubscription=from(batches).pipe(mergeMap(ids=>this.fetchVisits(ids,period),2),takeUntil(this.destroyed)).subscribe(value=>{
      for(const item of value.items??[])metrics.set(item.itemId,item);
      for(const row of rows){const children=this.visitIds(row);if(!children.every(id=>metrics.has(id)))continue;row.visitsLoading=false;
        const known=children.filter(id=>Number.isSafeInteger(metrics.get(id).visits));
        row.visitsKnown=known.length;row.visitsTotal=children.length;row.visitsPartial=known.length>0&&known.length<children.length;
        row.visitCount=known.length?known.reduce((sum,id)=>sum+metrics.get(id).visits,0):null;
        row.visitsTooltip=row.visitCount===null?'Não foi possível consultar as visitas. Tente novamente.':'Soma das visitas encontradas no período selecionado. Não representa visitantes únicos.';
        const first=metrics.get(children[0]);if(first?.dateFrom&&first?.dateTo)row.visitsTooltip+=' Período: '+new Date(first.dateFrom).toLocaleDateString('pt-BR',{timeZone:'UTC'})+' a '+new Date(first.dateTo).toLocaleDateString('pt-BR',{timeZone:'UTC'})+'.';if(first?.checkedAt)row.visitsTooltip+=' Consultado em '+new Date(first.checkedAt).toLocaleString('pt-BR')+'.';
        for(const variant of row.variants??[])variant.visitCount=metrics.get(variant.itemId)?.visits??null;
      }
      this.sortVisits();
    });
  }
  syncListings() {
    this.runImport(true);
  }
  syncNewListings(){this.runImport(true,true);}
  private runImport(syncing: boolean,today=false) {
    if (this.importing) return;
    this.importing = true;
    this.syncing = syncing;this.syncingToday=today;
    this.progressPercent = 0;
    this.progressProcessed = 0;
    this.progressTotal = null;
    const endpoint = today ? '/sync/mercadolivre/sync-new-today' : syncing ? '/sync/mercadolivre/sync-selected' : '/sync/mercadolivre/import-test';
    this.api.get<{ id: string } | null>('/sync/mercadolivre/progress').pipe(switchMap(previous => {
      this.progressSubscription = timer(500, 1000).pipe(switchMap(() => this.api.get<{ id: string; processed: number; total: number | null; percent: number }>('/sync/mercadolivre/progress').pipe(catchError(() => EMPTY)))).subscribe(progress => {
        if (!progress || progress.id === previous?.id) return;
        this.progressPercent = progress.percent;
        this.progressProcessed = progress.processed;
        this.progressTotal = progress.total;
      });
      return this.api.post<{ processed: number; errors: unknown[] }>(endpoint);
    }), finalize(() => { this.importing = false; this.progressSubscription?.unsubscribe(); })).subscribe({
      next: (result) => {
        this.progressPercent = 100;
        this.progressProcessed = result.processed;
        this.progressTotal = result.processed + result.errors.length;
        this.notify(`${result.processed} anúncio(s) ${today?'criado(s) hoje ':''}${syncing ? 'sincronizado(s)' : 'importado(s)'}.${result.errors.length ? ` ${result.errors.length} anúncio(s) não puderam ser atualizados.` : ''}`,result.errors.length>0);
        this.refresh.next();
      },
      error: (error) => {
        const message = error.error?.message;
        this.notify(typeof message === 'string' ? message : 'Não foi possível importar. Verifique a conexão do Mercado Livre em Contas conectadas.',true);
        this.refresh.next();
      }
    });
  }
  ngOnDestroy() { this.rankingProgressSubscription?.unsubscribe();this.progressSubscription?.unsubscribe();this.visitsSubscription?.unsubscribe();this.pricesSubscription?.unsubscribe();this.salesSubscription?.unsubscribe();this.destroyed.next();this.destroyed.complete(); }
}
