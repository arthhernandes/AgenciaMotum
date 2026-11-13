import { Injectable } from '@angular/core';
import { BehaviorSubject, ReplaySubject, Subject, catchError, concatMap, filter, of, take, tap, timeout } from 'rxjs';
import { ApiService } from '../../core/api.service';

/** Keep pending saves alive when the user navigates away; serialize to avoid stale overwrites. */
@Injectable({providedIn:'root'})
export class ProfitabilityInputStore {
  private queue=new Subject<{input:any;result:ReplaySubject<any>}>();
  private pending=new BehaviorSubject(0);
  constructor(private api:ApiService){
    this.queue.pipe(concatMap(job=>this.api.post<any>('/reports/profitability/inputs',job.input).pipe(
      timeout(15000),catchError(()=>of({saved:false})),
      tap(result=>{job.result.next(result);job.result.complete();this.pending.next(this.pending.value-1);})
    ))).subscribe();
  }
  whenIdle(){return this.pending.pipe(filter(count=>count===0),take(1));}
  save(input:any){const result=new ReplaySubject<any>(1);this.pending.next(this.pending.value+1);this.queue.next({input,result});return result.asObservable();}
}
