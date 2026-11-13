# Usage (repo root): python3 scripts/swing/wash_sim_aspi.py
"""Rough wash-sale simulation for ASPI across Brokerage + SEP-IRA (IRA losses don't count; IRA buys can be replacements)."""
import json, sys
from datetime import datetime, timedelta
d=json.load(open('app/swing/_data/trades.json'))
D=lambda s: datetime.strptime(s,'%m/%d/%Y')
ev=[e for e in d['executions'] if e['symbol']=='ASPI' and e['type'] in('Buy','Sell')]
ev.sort(key=lambda e:(D(e['date']),0 if e['type']=='Buy' else 1))
def run(cross):
    lots=[]  # dicts: acct,date,qty(remaining),basis_ps,orig_qty,used(replacement shares already used)
    for i,e in enumerate(ev):
        if e['type']=='Buy':
            lots.append(dict(acct=e['account'],date=D(e['date']),qty=e['qty'],ps=-e['amount']/e['qty'],used=0.0,idx=i))
    res=dict(allowed=0.0, deferred=0.0, lost=0.0, gains=0.0, by_year={})
    # replay
    open_lots={'Brokerage':[], 'SEP-IRA':[]}
    pending=[l for l in lots]
    li=0
    for i,e in enumerate(ev):
        dt=D(e['date'])
        if e['type']=='Buy':
            l=next(x for x in lots if x['idx']==i); open_lots[e['account']].append(l); continue
        q=-e['qty']; proceeds_ps=e['amount']/q
        acct=e['account']
        pool=open_lots[acct]
        pool.sort(key=(lambda x:-x['ps']) if acct=='Brokerage' else (lambda x:x['date']))
        sold=[]
        for l in pool:
            if q<=1e-9: break
            t=min(q,l['qty']); 
            if t<=0: continue
            sold.append((l,t)); l['qty']-=t; q-=t
        open_lots[acct]=[l for l in pool if l['qty']>1e-9]
        if acct!='Brokerage': continue
        yr=dt.year; by=res['by_year'].setdefault(yr,dict(allowed=0.0,deferred=0.0,lost=0.0))
        sold_ids={id(l) for l,_ in sold}
        for l,t in sold:
            g=t*(proceeds_ps-l['ps'])
            if g>=0: res['gains']+=g; by['allowed']+=g; continue
            loss_ps=proceeds_ps-l['ps']; need=t
            cands=[x for x in lots if abs((x['date']-dt).days)<=30 and id(x) not in sold_ids and x['orig_qty' if False else 'used']< (x.get('oq') or 0) + 1e18]
            cands=[x for x in cands if (cross or x['acct']=='Brokerage')]
            cands.sort(key=lambda x:x['date'])
            for x in cands:
                if need<=1e-9: break
                oq=x.setdefault('oq', x['qty'] if x['date']>dt else None)
                # capacity: shares of that acquisition not yet used as replacement and still held (or bought later)
                held = x['qty'] if x['date']<=dt else ev[x['idx']]['qty']
                cap=held - x['used']
                if cap<=1e-9: continue
                m=min(need,cap); x['used']+=m; need-=m
                if x['acct']=='Brokerage':
                    x['ps']+= (-loss_ps)*m/ (held) ; by['deferred']+=-loss_ps*m
                else:
                    by['lost']+=-loss_ps*m
            by['allowed']+=loss_ps*need
    for k in ('Brokerage','SEP-IRA'):
        res[k+'_open']=sum(l['qty'] for l in open_lots[k]); res[k+'_basis']=sum(l['qty']*l['ps'] for l in open_lots[k])
    return res
for cross in (False,True):
    r=run(cross)
    print('CROSS' if cross else 'BROKERAGE-ONLY', {y:{k:round(v) for k,v in b.items()} for y,b in r['by_year'].items()}, 'open B', r['Brokerage_open'], round(r['Brokerage_basis']), 'open S', r['SEP-IRA_open'])
