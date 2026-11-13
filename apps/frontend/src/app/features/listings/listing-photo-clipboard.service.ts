import { Injectable } from '@angular/core';

export interface CopiedListingPhoto { id:string; url:string; }

/** Share copied photos between dialogs, reloads and tabs for the same user/account. */
@Injectable({providedIn:'root'})
export class ListingPhotoClipboardService {
  private readonly storageKey='consultor.copiedListingPhoto';
  private saved?:{account:string|null;owner:string;picture:CopiedListingPhoto};
  private owner(){
    try{const part=(localStorage.getItem('token')||'').split('.')[1];return String(JSON.parse(atob(part.replace(/-/g,'+').replace(/_/g,'/'))).sub||'');}catch{return '';}
  }
  get picture():CopiedListingPhoto|undefined {
    let saved=this.saved;
    try{const stored=localStorage.getItem(this.storageKey);if(stored)saved=JSON.parse(stored);}catch{}
    return saved?.owner && saved.owner===this.owner() && saved.account===localStorage.getItem('selectedMarketplaceAccountId') && typeof saved.picture?.id==='string' && /^https?:\/\//i.test(saved.picture.url) ? {...saved.picture} : undefined;
  }
  copy(picture:CopiedListingPhoto){
    this.saved={account:localStorage.getItem('selectedMarketplaceAccountId'),owner:this.owner(),picture:{id:picture.id,url:picture.url}};
    try{localStorage.setItem(this.storageKey,JSON.stringify(this.saved));}catch{}
  }
}
