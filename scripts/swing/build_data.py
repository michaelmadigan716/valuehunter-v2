"""Trade Ledger data build, v2 — anchored to Vanguard's own records.

Sources
  vanguard_transactions.csv   full transaction history (2,571 rows, 05/15/2019 → 08/28/2026)
  vg_realized_YYYY.txt        Vanguard "Cost basis → Realized gains/losses" pages, 2020–2026:
                              SUM rows = per-security taxable totals (+ wash-sale disallowed amount)
                              lot rows = every sold lot: acct|sym|date_sold|date_acq|event|qty|cost|proceeds|gain
  vg_performance_monthly.txt  Vanguard "Performance details" table, monthly since inception
  prices.json                 closing prices / account value / cash as of AS_OF (Holdings page)

Method
  * Lot assignment for every sale from 2020 on is Vanguard's (the same lots that appear on the 1099-B).
  * Economic P&L per lot = proceeds − the lot's ORIGINAL purchase cost from the ledger. Vanguard's lot cost
    can include wash-sale basis adjustments; those are a tax-timing artefact, so they are stripped out here
    and reported separately as "taxable" figures.
  * 2019 sales (Vanguard's report does not go back that far) are matched FIFO against 2019 purchases,
    after reserving the 2019-acquired lots that Vanguard later sold in 2020.
  * Round-trip positions, executions, per-year and per-ticker figures are all derived from these lots, so
    realized + unrealized + income equals Vanguard's reported investment return.
"""
import json, os, glob, re
from collections import defaultdict, deque
import pandas as pd

AS_OF = '08/28/2026'
GENERATED = '08/30/2026'

def num(s):
    if s is None: return 0.0
    s = str(s).strip()
    if s in ('', '—', 'dash —', 'nan'): return 0.0
    neg = s.startswith('-') or s.startswith('−')
    v = float(re.sub(r'[^0-9.]', '', s) or 0)
    return -v if neg else v

# ---------------------------------------------------------------- ledger
df = pd.read_csv('vanguard_transactions.csv')
df['d'] = pd.to_datetime(df.date)

SYMBOL_FIX = {'PIEDMONT LITHIUM INC CHG': 'PLL', 'BRK B': 'BRK'}
def fix_symbol(row):
    s = row.symbol if isinstance(row.symbol, str) and row.symbol.strip() else None
    if s in SYMBOL_FIX: return SYMBOL_FIX[s]
    if s: return s
    if row['name'] in SYMBOL_FIX: return SYMBOL_FIX[row['name']]
    # Vanguard blanks the symbol on the post-reverse-split AGL CUSIP in the Brokerage account
    if row['name'] == '—' and row.type in ('Buy', 'Sell') and pd.Timestamp('2025-08-01') <= row.d <= pd.Timestamp('2026-05-31'):
        return 'AGL'
    return None
df['symbol'] = df.apply(fix_symbol, axis=1)
df['acct'] = df.account.map({'Brokerage': 'BRK', 'SEP-IRA': 'SEP'})
rank = {'Transfer (incoming)': 0, 'Transfer (Outgoing)': 0, 'Stock split': 1, 'Buy': 2, 'Reinvestment': 2, 'Sell-Cancel': 3, 'Sell': 4}
df['ord'] = df.type.map(rank).fillna(5)
df = df.sort_values(['d', 'ord'], kind='stable').reset_index(drop=True)

# drop same-day journal pairs (transfer out + in of the same quantity in the same account)
drop = set()
tr = df[df.type.str.startswith('Transfer') & df.quantity.notna() & df.symbol.notna()]
for (d, a, s_), g in tr.groupby(['d', 'acct', 'symbol']):
    outs = list(g[g.quantity < 0].index); ins = list(g[g.quantity > 0].index)
    for o in outs:
        m = next((i for i in ins if abs(df.at[i, 'quantity'] + df.at[o, 'quantity']) < 1e-6 and i not in drop), None)
        if m is not None: drop.update([o, m])
df = df.drop(index=list(drop)).reset_index(drop=True)

names = {}
for r in df.itertuples():
    if r.symbol and isinstance(r.name, str) and r.name != '—':
        names.setdefault(r.symbol, r.name)
names['AGL'] = 'AGILON HEALTH INC'; names['PLL'] = 'PIEDMONT LITHIUM INC'; names['BRK'] = 'BERKSHIRE HATHAWAY INC CL B'

# purchases (day lots) — Buy, stock dividend reinvestment, in-kind transfer with a recorded value
buys = defaultdict(list)      # (acct, sym, date) -> list of [qty_remaining, price, qty_orig]
for r in df.itertuples():
    if not r.symbol or pd.isna(r.quantity): continue
    if r.type == 'Buy' or (r.type == 'Reinvestment' and r.symbol != 'VMFXX'):
        buys[(r.acct, r.symbol, r.date)].append([float(r.quantity), -float(r.amount) / float(r.quantity), float(r.quantity)])
    elif r.type == 'Transfer (incoming)' and float(r.quantity) > 0 and not pd.isna(r.amount) and float(r.amount) > 0:
        buys[(r.acct, r.symbol, r.date)].append([float(r.quantity), float(r.amount) / float(r.quantity), float(r.quantity)])

# ---------------------------------------------------------------- Vanguard lot rows
vg_lots = []            # dicts
taxable = defaultdict(lambda: dict(gain=0.0, disallowed=0.0))   # (year, acct, sym)
for f in sorted(glob.glob('vg_realized_20??.txt')):
    year = re.search(r'(\d{4})', f).group(1)
    for line in open(f):
        p = line.rstrip('\n').split('|')
        if p[0] == 'SUM':
            k = (year, p[1], p[2]); taxable[k]['gain'] += num(p[6]); taxable[k]['disallowed'] += num(p[7]) if len(p) > 7 else 0.0
            continue
        if len(p) < 9: continue
        acq = p[3].replace('Noncovered', '').strip()
        vg_lots.append(dict(acct=p[0], sym=p[1], sold=p[2], acq=acq, event=p[4], qty=num(p[5]), cost=num(p[6]),
                            proceeds=num(p[7]), gain=num(p[8]), year=year, noncovered='Noncovered' in p[3]))
print('vanguard lot rows', len(vg_lots), 'years', sorted({l['year'] for l in vg_lots}))

# ---------------------------------------------------------------- economic cost per lot
def take_from_day(key, qty, target_ps=None):
    """consume qty from that day's purchase sub-lots; prefer the sub-lot priced closest to target_ps (Vanguard's
    cost/share) so that same-day buys at different prices are matched the way Vanguard matched them."""
    subs = buys.get(key)
    if not subs: return 0.0, 0.0
    order = sorted(subs, key=lambda s: abs(s[1] - target_ps)) if target_ps is not None else list(subs)
    cost = 0.0; got = 0.0
    for s in order:
        if qty - got <= 1e-9: break
        use = min(s[0], qty - got)
        if use <= 0: continue
        s[0] -= use; got += use; cost += use * s[1]
    return cost, got

# Vanguard's performance page values the March-2020 in-kind transfers into the Brokerage account as deposits even
# though the transaction history shows $0 for them; its deposits total exceeds the ledger's by exactly the amount
# below, so that is the value those six funds carried on arrival (spread across them in proportion to proceeds).
BRK_INKIND_VALUE = 19695.49
brk_inkind_syms = ('MANKX', 'DTMMX', 'VTMFX', 'MAMTX', 'DTMIX', 'SPDW')

unmatched = []
inkind_proceeds = sum(l['proceeds'] for l in vg_lots if l['acct'] == 'BRK' and l['sym'] in brk_inkind_syms)
for l in vg_lots:
    if l['event'] == 'Cash-In-Lieu' or l['qty'] <= 0:
        l['econ_cost'] = l['cost']; l['econ_gain'] = l['gain']; l['wash_adj'] = 0.0; continue
    key = (l['acct'], l['sym'], l['acq'])
    vg_ps = l['cost'] / l['qty']
    subs = buys.get(key)
    if subs:
        rng = (min(s[1] for s in subs), max(s[1] for s in subs))
        if rng[0] - 0.011 <= vg_ps <= rng[1] + 0.011:
            c, got = take_from_day(key, l['qty'], vg_ps)
            l['econ_cost'] = c if got + 1e-6 >= l['qty'] else l['cost']
        else:
            c, got = take_from_day(key, l['qty'])
            if got + 1e-6 < l['qty']:
                vwap = sum(s[2] * s[1] for s in subs) / sum(s[2] for s in subs)
                c += (l['qty'] - got) * vwap
            l['econ_cost'] = c
    else:
        unmatched.append(l)
        if l['acct'] == 'BRK' and l['sym'] in brk_inkind_syms:
            l['econ_cost'] = BRK_INKIND_VALUE * l['proceeds'] / inkind_proceeds
        else:
            # SEP-IRA funds transferred in 03/31/2020: basis = value recorded on arrival (ledger transfer amount)
            tv = df[(df.acct == l['acct']) & (df.symbol == l['sym']) & (df.type == 'Transfer (incoming)') & df.amount.notna()]
            tq = float(tv.quantity.sum()); ta = float(tv.amount.sum())
            l['econ_cost'] = l['qty'] * ta / tq if tq else l['cost']
    l['econ_gain'] = l['proceeds'] - l['econ_cost']
    l['wash_adj'] = l['cost'] - l['econ_cost']
print('lots without a same-day ledger purchase:', len(unmatched), sorted({(u['acct'], u['sym']) for u in unmatched})[:20])

# ---------------------------------------------------------------- 2019 sales (FIFO on what Vanguard did not later consume)
sells19 = df[(df.type == 'Sell') & (df.d < pd.Timestamp('2020-01-01')) & df.symbol.notna()]
lots19 = defaultdict(deque)
for key, subs in buys.items():
    if pd.Timestamp(key[2]) < pd.Timestamp('2020-01-01'):
        for s in subs:
            if s[0] > 1e-9: lots19[(key[0], key[1])].append((s, key[2]))     # shared sub-lot objects
for k in lots19: lots19[k] = deque(sorted(lots19[k], key=lambda x: pd.Timestamp(x[1])))
econ_2019 = []
for r in sells19.itertuples():
    k = (r.acct, r.symbol); take = -float(r.quantity); cost = 0.0
    while take > 1e-9 and lots19[k]:
        l = lots19[k][0][0]; use = min(take, l[0]); cost += use * l[1]; l[0] -= use; take -= use
        if l[0] <= 1e-9: lots19[k].popleft()
    if take > 1e-9: print('  ! 2019 oversold', r.date, k, take)
    econ_2019.append(dict(acct=r.acct, sym=r.symbol, sold=r.date, qty=-float(r.quantity), proceeds=float(r.amount),
                          econ_cost=cost, econ_gain=float(r.amount) - cost, year='2019', wash_adj=0.0))
# whatever 2019 lots remain after 2019 sells but were NOT consumed by Vanguard later should be ~0
left19 = {k: sum(l[0][0] for l in v) for k, v in lots19.items() if sum(l[0][0] for l in v) > 0.01}
print('2019 lots left over (should be empty):', left19)

# ---------------------------------------------------------------- per-day realized, executions
day_pnl = defaultdict(lambda: dict(gain=0.0, taxgain=0.0, wash=0.0, qty=0.0))
for l in vg_lots:
    if l['event'] == 'Cash-In-Lieu': continue
    k = (l['acct'], l['sym'], l['sold'])
    day_pnl[k]['gain'] += l['econ_gain']; day_pnl[k]['taxgain'] += l['gain']; day_pnl[k]['wash'] += l['wash_adj']; day_pnl[k]['qty'] += l['qty']
for l in econ_2019:
    k = (l['acct'], l['sym'], l['sold']); day_pnl[k]['gain'] += l['econ_gain']; day_pnl[k]['taxgain'] += l['econ_gain']; day_pnl[k]['qty'] += l['qty']

executions = []
sells_by_day = defaultdict(list)
for r in df.itertuples():
    if not r.symbol or pd.isna(r.quantity): continue
    if r.type == 'Buy':
        executions.append(dict(date=r.date, account=r.account, symbol=r.symbol, type='Buy', qty=float(r.quantity),
                               price=float(r.price), fees=0.0 if pd.isna(r.fees) else float(r.fees), amount=float(r.amount)))
    elif r.type == 'Sell':
        e = dict(date=r.date, account=r.account, symbol=r.symbol, type='Sell', qty=float(r.quantity),
                 price=float(r.price), fees=0.0 if pd.isna(r.fees) else float(r.fees), amount=float(r.amount))
        executions.append(e); sells_by_day[(r.acct, r.symbol, r.date)].append(e)
    elif r.type == 'Sell-Cancel':
        e = dict(date=r.date, account=r.account, symbol=r.symbol, type='Sell', qty=float(r.quantity),
                 price=float(r.price), fees=0.0, amount=float(r.amount), note='cancelled sell')
        executions.append(e); sells_by_day[(r.acct, r.symbol, r.date)].append(e)
# split each day's lot P&L across that day's sells in proportion to proceeds
missing_days = []
for k, es in sells_by_day.items():
    dp = day_pnl.get(k)
    tot = sum(e['amount'] for e in es)
    if not dp:
        missing_days.append(k)
        for e in es: e['pnl'] = None
        continue
    for e in es:
        w = (e['amount'] / tot) if tot else 1.0 / len(es)
        e['pnl'] = round(dp['gain'] * w, 2); e['tax_pnl'] = round(dp['taxgain'] * w, 2)
        if dp['wash']: e['wash_adj'] = round(dp['wash'] * w, 2)
print('sell days with no Vanguard lot data:', len(missing_days), missing_days[:10])
# days Vanguard reports but the ledger has no sell (should be none)
extra = [k for k in day_pnl if k not in sells_by_day]
print('Vanguard sell days not in ledger:', len(extra), extra[:10])

# ---------------------------------------------------------------- open lots & prices
PRICES = json.load(open('prices.json'))
ACCOUNT_VALUE = PRICES.pop('_account_value'); CASH = PRICES.pop('_cash'); VG_UNREAL = PRICES.pop('_vanguard_unrealized')
open_lots = defaultdict(list)
for key, subs in buys.items():
    for s in subs:
        if s[0] > 1e-6: open_lots[(key[0], key[1])].append(dict(date=key[2], qty=s[0], price=s[1]))
# reverse splits after the purchase date rescale the remaining lots
_sp = df[df.type == 'Stock split']
for (d, a, s_), g in _sp.groupby(['date', 'acct', 'symbol']):
    old = -g[g.quantity < 0].quantity.sum(); new = g[g.quantity > 0].quantity.sum()
    if old and new:
        for l in open_lots.get((a, s_), []):
            if pd.Timestamp(l['date']) <= pd.Timestamp(d): l['qty'] *= new / old; l['price'] *= old / new
open_qty = {k: sum(l['qty'] for l in v) for k, v in open_lots.items()}
print('open lots by (acct,sym):', {k: round(v, 3) for k, v in open_qty.items() if v > 0.5})

ADVISOR_SYMS_EXEC = {'MANKX', 'SPDW', 'VTMFX', 'MAMTX', 'DTMIX', 'DTMMX', 'PONAX', 'PDGIX', 'IWF', 'WAPAX', 'PISIX', 'PRWCX', 'DFQTX', 'PRJIX', 'IEI', 'FNPFX'}
# ---------------------------------------------------------------- round-trip positions from the ledger
positions = []; open_pos = {}; qty_run = defaultdict(float)
split_ratio = {}
sp = df[df.type == 'Stock split']
for (d, a, s_), g in sp.groupby(['date', 'acct', 'symbol']):
    old = -g[g.quantity < 0].quantity.sum(); new = g[g.quantity > 0].quantity.sum()
    if old and new: split_ratio[(d, a, s_)] = (old, new)
seen_split = set()
dividends = defaultdict(float)
def start_pos(k, r):
    open_pos[k] = dict(account=r.account, symbol=k[1], name=names.get(k[1], k[1]), opened=r.date, closed=None, buys=0, sells=0,
                       qty_bought=0.0, cost=0.0, proceeds=0.0, fees=0.0, realized=0.0, tax_realized=0.0, max_qty=0.0, execs=[], basis_known=True)
for r in df.itertuples():
    if not r.symbol: continue
    k = (r.acct, r.symbol)
    if r.type == 'Dividend': dividends[k] += float(r.amount); continue
    if pd.isna(r.quantity) or r.type in ('Sweep in', 'Sweep out'): continue
    q = float(r.quantity)
    if r.type == 'Stock split':
        sk = (r.date, r.acct, r.symbol)
        if sk in split_ratio and sk not in seen_split:
            seen_split.add(sk); old, new = split_ratio[sk]; qty_run[k] = qty_run[k] * new / old
            if k in open_pos: open_pos[k]['execs'].append(dict(date=r.date, type='Split', qty=new - old, price=None, amount=0.0, note=f'{old:.0f} → {new:.0f}'))
        continue
    if r.type == 'Reinvestment' and r.symbol == 'VMFXX': continue
    if r.type in ('Buy', 'Reinvestment') or (r.type == 'Transfer (incoming)' and q > 0):
        if k not in open_pos: start_pos(k, r)
        p = open_pos[k]; amt = 0.0 if pd.isna(r.amount) else float(r.amount)
        p['qty_bought'] += q; p['cost'] += -amt if r.type != 'Transfer (incoming)' else amt
        if r.type == 'Buy': p['buys'] += 1; p['fees'] += 0.0 if pd.isna(r.fees) else float(r.fees)
        p['execs'].append(dict(date=r.date, type={'Buy': 'Buy', 'Reinvestment': 'Reinvest', 'Transfer (incoming)': 'Transfer in'}[r.type], qty=q,
                               price=None if pd.isna(r.price) else float(r.price), amount=amt if r.type != 'Transfer (incoming)' else -amt))
        qty_run[k] += q; p['max_qty'] = max(p['max_qty'], qty_run[k])
    elif r.type == 'Transfer (Outgoing)':
        qty_run[k] += q
        if k in open_pos: open_pos[k]['execs'].append(dict(date=r.date, type='Transfer out', qty=q, price=None, amount=0.0))
    elif r.type in ('Sell', 'Sell-Cancel'):
        if k not in open_pos: start_pos(k, r); open_pos[k]['basis_known'] = False
        p = open_pos[k]; amt = float(r.amount)
        e = next((x for x in sells_by_day[(r.acct, r.symbol, r.date)] if x['amount'] == amt and 'used' not in x), None)
        pnl = None
        if e: e['used'] = True; pnl = e.get('pnl'); tpnl = e.get('tax_pnl', pnl)
        p['sells'] += 1 if r.type == 'Sell' else -1; p['proceeds'] += amt; p['fees'] += 0.0 if pd.isna(r.fees) else float(r.fees)
        if pnl is not None: p['realized'] += pnl; p['tax_realized'] += (tpnl if tpnl is not None else pnl)
        p['execs'].append(dict(date=r.date, type='Sell' if r.type == 'Sell' else 'Sell cancel', qty=q, price=float(r.price), amount=amt,
                               pnl=None if pnl is None else round(pnl, 2), wash_adj=(e or {}).get('wash_adj')))
        qty_run[k] += q
        if qty_run[k] <= 1e-6:
            qty_run[k] = 0.0; p['closed'] = r.date; positions.append(p); del open_pos[k]
for e in executions:
    e.pop('used', None)
    e['category'] = 'advisor' if e['symbol'] in ADVISOR_SYMS_EXEC else 'trade'
for k, p in list(open_pos.items()):
    p['open_qty'] = round(qty_run[k], 4)
    lots = open_lots.get(k, [])
    p['open_cost'] = round(sum(l['qty'] * l['price'] for l in lots), 2)
    p['open_lots'] = [dict(date=l['date'], qty=round(l['qty'], 4), price=round(l['price'], 4)) for l in lots]
    if k[1] in PRICES:
        p['last_price'] = PRICES[k[1]]; p['market_value'] = round(p['open_qty'] * PRICES[k[1]], 2)
        p['unrealized'] = round(p['market_value'] - p['open_cost'], 2)
    positions.append(p)

# Positions that began with a securities transfer-in (the March 2020 ACAT from the former financial advisor) and were
# then liquidated are the advisor's holdings, not Matt's trades. They stay in the totals but are labelled separately.
ADVISOR_SYMS = {'MANKX', 'SPDW', 'VTMFX', 'MAMTX', 'DTMIX', 'DTMMX', 'PONAX', 'PDGIX', 'IWF', 'WAPAX', 'PISIX', 'PRWCX', 'DFQTX', 'PRJIX', 'IEI', 'FNPFX'}
def finish(p):
    p['category'] = 'advisor' if (p['symbol'] in ADVISOR_SYMS and any(e['type'] == 'Transfer in' for e in p['execs'])) else 'trade'
    if p['category'] == 'advisor' and p['cost'] == 0:      # Brokerage funds arrived with no recorded value; use the inferred value on arrival
        p['cost'] = p['proceeds'] - p['realized']; p['name'] = names.get(p['symbol'], p['symbol'])
    for f in ('cost', 'proceeds', 'fees', 'realized', 'tax_realized'): p[f] = round(p[f], 2)
    p['status'] = 'closed' if p['closed'] else 'open'
    end = pd.Timestamp(p['closed']) if p['closed'] else pd.Timestamp(AS_OF)
    p['days'] = (end - pd.Timestamp(p['opened'])).days
    p['return_pct'] = round(100 * p['realized'] / p['cost'], 2) if (p['closed'] and p['cost'] and p['basis_known']) else None
    p['dividends'] = round(dividends.get((('BRK' if p['account'] == 'Brokerage' else 'SEP'), p['symbol']), 0.0), 2)
    p['id'] = f"{p['account'][:3]}-{p['symbol']}-{p['opened'].replace('/', '')}"
    return p
positions = [finish(p) for p in positions if not (p['closed'] is None and (p.get('open_qty') or 0) < 1)]
positions.sort(key=lambda p: pd.Timestamp(p['opened']))

# ---------------------------------------------------------------- summaries
closed = [p for p in positions if p['status'] == 'closed' and p['basis_known'] and p['category'] == 'trade']
advisor = [p for p in positions if p['category'] == 'advisor']
openp = [p for p in positions if p['status'] == 'open']
realized_all = sum(e['pnl'] for e in executions if e['type'] == 'Sell' and e.get('pnl') is not None)
unrealized = sum(p.get('unrealized', 0.0) for p in openp)
market_value = sum(p.get('market_value', 0.0) for p in openp)
open_cost = sum(p['open_cost'] for p in openp)
income = round(float(df[df.type == 'Dividend'].amount.sum()), 2)

by_year = {}
for y in range(2019, 2027):
    ys = str(y)
    econ = sum(e['pnl'] for e in executions if e['type'] == 'Sell' and e.get('pnl') is not None and e['date'].endswith(ys))
    tax = sum(v['gain'] for k, v in taxable.items() if k[0] == ys)
    dis = sum(v['disallowed'] for k, v in taxable.items() if k[0] == ys)
    if ys == '2019': tax = econ
    cl = [p for p in closed if p['closed'].endswith(ys)]
    by_year[ys] = dict(realized=round(econ, 2), taxable=round(tax, 2), disallowed=round(dis, 2), closed=len(cl), wins=sum(p['realized'] > 0 for p in cl),
                       source='Vanguard cost-basis report' if ys != '2019' else 'ledger FIFO (Vanguard report starts 2020)')

by_symbol = defaultdict(lambda: dict(realized=0.0, unrealized=0.0, total=0.0, trades=0, wins=0, losses=0, open=False, advisor=False))
for e in executions:
    if e['type'] == 'Sell' and e.get('pnl') is not None: by_symbol[e['symbol']]['realized'] += e['pnl']
for p in closed:
    s = by_symbol[p['symbol']]; s['trades'] += 1; s['wins'] += p['realized'] > 0; s['losses'] += p['realized'] <= 0
for p in openp:
    s = by_symbol[p['symbol']]; s['open'] = True; s['unrealized'] += p.get('unrealized', 0.0)
for s in by_symbol.values(): s['total'] = s['realized'] + s['unrealized']
for sym_ in ADVISOR_SYMS_EXEC:
    if sym_ in by_symbol: by_symbol[sym_]['advisor'] = True

# cash flows (for the ledger cross-check)
cashflows = []
for r in df.itertuples():
    if pd.isna(r.amount) or r.amount == 0: continue
    if r.type in ('Funds Received', 'Funds Received (adjustment)', 'Contribution', 'Withdrawal', 'Wire Out', 'Distribution', 'Federal Wire Return', 'Withholding (Federal)'):
        cashflows.append(dict(date=r.date, account=r.account, type=r.type, amount=float(r.amount), name=r.name))
    elif r.type.startswith('Transfer') and pd.isna(r.quantity):
        cashflows.append(dict(date=r.date, account=r.account, type='Cash transfer', amount=float(r.amount), name=r.name))
    elif r.type == 'Transfer (incoming)' and not pd.isna(r.quantity) and r.amount > 0:
        cashflows.append(dict(date=r.date, account=r.account, type='Securities transferred in', amount=float(r.amount), name=f'{r.symbol} {r.quantity:g} sh'))
deposits = sum(c['amount'] for c in cashflows if c['amount'] > 0); withdrawals = -sum(c['amount'] for c in cashflows if c['amount'] < 0)
_c = df[~df.type.isin(['Sweep in', 'Sweep out'])]; _c = _c[~((_c.type == 'Reinvestment') & (_c.symbol == 'VMFXX'))]
_c = _c[~(_c.type.str.startswith('Transfer') & _c.quantity.notna())]
ledger_cash = {a: round(float(v), 2) for a, v in _c.groupby('account').amount.sum().items()}

# Vanguard monthly performance
perf = []
cum_dep = 0.0
rows = [l.rstrip('\n').split('|') for l in open('vg_performance_monthly.txt')][1:]
rows = [r for r in rows if re.match(r'\d\d/\d{4}', r[0])]
for r in sorted(rows, key=lambda r: (r[0][-4:], r[0][:2])):
    m, y = r[0].split('/'); end = (pd.Timestamp(int(y), int(m), 1) + pd.offsets.MonthEnd(0))
    cum_dep += num(r[2])
    perf.append(dict(date=end.strftime('%Y-%m-%d'), month=r[0], begin=num(r[1]), flows=num(r[2]), market=num(r[3]), income=num(r[4]),
                     ret=num(r[5]), gain=num(r[6]), value=num(r[7]), net_deposits=round(cum_dep, 2)))
vg_total = dict(investment_returns=perf[-1]['gain'], market=sum(p['market'] for p in perf), income=sum(p['income'] for p in perf),
                flows=round(cum_dep, 2), ending=perf[-1]['value'], since='05/01/2019')

# ---- yearly totals from Vanguard's monthly performance (market + income = investment returns per year)
year_total_gain = defaultdict(float)
for pr in perf:
    year_total_gain[pr['date'][:4]] += pr['market'] + pr['income']

# ---- rough tax estimate (Brokerage only; SEP-IRA is tax-deferred)
# Assumptions agreed with Matt: NY state resident (outside NYC) 2019 -> 06/30/2026, Florida after;
# each year stands alone (2022 loss assumed absorbed at other brokerages); gains treated as short-term
# ordinary income at the top federal bracket (37%) + 3.8% NIIT; NY marginal 9.65% when the year's gain
# alone exceeds ~$1M, else 6.85%.
FED_ST = 0.37 + 0.038      # top ordinary bracket + NIIT
FED_LT = 0.20 + 0.038      # top long-term capital gains rate + NIIT
def ny_rate(base): return 0.0965 if base > 1_000_000 else 0.0685

# BRK-only short/long split per year from the lot dates (held > 1 year = long-term).
# Wash-sale disallowed amounts are all short-holding-period sales, so they adjust the ST bucket;
# this reproduces Vanguard's own ST/LT year totals (e.g. 2025 BRK: ST +585,388 / LT −31,894).
st_by_year = defaultdict(float); lt_by_year = defaultdict(float)
for l in vg_lots:
    if l['acct'] != 'BRK' or l['event'] == 'Cash-In-Lieu': continue
    try:
        held_days = (pd.Timestamp(l['sold']) - pd.Timestamp(l['acq'])).days
    except Exception:
        held_days = 0
    (lt_by_year if held_days > 365 else st_by_year)[l['year']] += l['gain']
for (y, a, sym_), v in taxable.items():
    if a == 'BRK': st_by_year[y] += v['disallowed']
st_by_year['2019'] = sum(e['pnl'] for e in executions
                         if e['type'] == 'Sell' and e.get('pnl') is not None and e['date'].endswith('2019') and e['account'] == 'Brokerage')

h1_2026 = sum(l['gain'] for l in vg_lots if l['acct'] == 'BRK' and l['year'] == '2026'
              and pd.Timestamp(l['sold']) <= pd.Timestamp('2026-06-30'))
tax_years = []
for y in [str(x) for x in range(2019, 2027)]:
    st = round(st_by_year.get(y, 0.0), 2); lt = round(lt_by_year.get(y, 0.0), 2)
    g = round(st + lt, 2)
    # net a loss in one bucket against a gain in the other (the IRS ordering nets across buckets)
    st_t, lt_t = st, lt
    if st_t < 0 and lt_t > 0: lt_t = max(0.0, lt_t + st_t); st_t = min(0.0, st + lt)
    if lt_t < 0 and st_t > 0: st_t = max(0.0, st_t + lt_t); lt_t = min(0.0, st + lt)
    fed = round(max(0.0, st_t) * FED_ST + max(0.0, lt_t) * FED_LT, 2)
    if y == '2026':
        ny_base = max(0.0, round(h1_2026, 2))
        note = f'NY on Jan–Jun sales only (~{ny_base:,.0f}); Florida after the move'
    else:
        ny_base = max(0.0, g); note = ''
    ny = round(ny_base * ny_rate(ny_base), 2)
    if g < 0: note = 'loss year — $3,000/yr deductible, remainder carries forward'
    tax_years.append(dict(year=y, brk_taxable=g, st=st, lt=lt, ny_base=round(ny_base, 2), est_federal=fed, est_ny=ny,
                          est_total=round(fed + ny, 2), ny_rate=ny_rate(ny_base) if ny_base else 0.0, note=note))

for ys, v in by_year.items():
    v['total_gain'] = round(year_total_gain.get(ys, 0.0), 2)

tax_estimate = dict(
    years=tax_years,
    total=round(sum(t['est_total'] for t in tax_years), 2),
    fed_st=FED_ST, fed_lt=FED_LT,
    assumptions=[
        'Brokerage account only — SEP-IRA gains are tax-deferred and excluded',
        'Short-term gains (held ≤ 1 year, from each lot\'s actual dates) at the 37% top federal bracket + 3.8% NIIT; long-term at 20% + 3.8%, with losses in one bucket netted against the other',
        'NY State resident (outside NYC) through 06/30/2026, Florida (no state income tax) after; NY marginal 6.85% or 9.65% depending on the size of the year',
        'Each year stands alone — the 2022 loss is assumed absorbed by gains at other brokerages, no carryforwards applied',
        'ST/LT is split by each lot\'s actual holding period; wash-sale holding-period tacking can shift a small amount between buckets (net effect on the estimate is minimal)',
        'Ignores other income, deductions and estimated-payment timing — a rough planning number, not tax advice',
    ],
)

summary = dict(
    realized=round(realized_all, 2), realized_closed=round(sum(p['realized'] for p in closed), 2), realized_open=round(sum(p['realized'] for p in openp), 2),
    taxable_realized=round(sum(v['gain'] for v in taxable.values()) + by_year['2019']['realized'], 2),
    unrealized=round(unrealized, 2), vanguard_unrealized=VG_UNREAL, wash_deferred=round(VG_UNREAL - unrealized, 2) if VG_UNREAL else None,
    market_value=round(market_value, 2), open_cost=round(open_cost, 2), income=income, fees=round(sum(p['fees'] for p in positions), 2),
    other=round(float(df[df.type.isin(['Interest charge', 'Fee', 'Corp Action (Cash in Lieu)'])].amount.sum()), 2),
    deposits=round(deposits, 2), withdrawals=round(withdrawals, 2), net_deposits=round(deposits - withdrawals, 2),
    account_value=ACCOUNT_VALUE, cash=CASH, ledger_cash=round(sum(ledger_cash.values()), 2), ledger_cash_by_account=ledger_cash,
    prices_as_of=AS_OF, vanguard=vg_total,
)
summary['components_total'] = round(summary['realized'] + summary['unrealized'] + summary['income'], 2)
summary['advisor'] = dict(positions=len(advisor), value_in=round(sum(p['cost'] for p in advisor), 2), proceeds=round(sum(p['proceeds'] for p in advisor), 2),
                          realized=round(sum(p['realized'] for p in advisor), 2), transferred='03/31/2020',
                          liquidated=f"{min(p['closed'] for p in advisor if p['closed'])} – {max(p['closed'] for p in advisor if p['closed'])}")
summary['realized_trades'] = round(summary['realized'] - summary['advisor']['realized'], 2)

out = dict(generated=GENERATED, as_of=AS_OF, first_date=df.date.iloc[0], accounts=['Brokerage', 'SEP-IRA'], summary=summary, tax_estimate=tax_estimate,
           positions=positions, executions=executions, cashflows=cashflows, by_year=by_year, by_symbol={k: {kk: (round(vv, 2) if isinstance(vv, float) else vv) for kk, vv in v.items()} for k, v in by_symbol.items()},
           names=names, balance_history=[dict(date=p['date'], value=p['value'], net_deposits=p['net_deposits'], gain=p['gain'], month=p['month'], market=p['market'], income=p['income']) for p in perf],
           warnings=[f'{len(missing_days)} sell-days without Vanguard lot data'] if missing_days else [])
json.dump(out, open('trades.json', 'w'), indent=0)

print(f"positions {len(positions)}  closed {len(closed)}  open {len(openp)}")
print(f"economic realized {realized_all:,.2f}  unrealized {unrealized:,.2f}  income {income:,.2f}  = {summary['components_total']:,.2f}  vs Vanguard investment returns {vg_total['investment_returns']:,.2f}")
print(f"taxable realized (VG 2020-26 + 2019) {summary['taxable_realized']:,.2f}   VG unrealized {VG_UNREAL:,.2f}  wash deferred in open lots {summary['wash_deferred']:,.2f}")
print({y: (v['realized'], v['taxable']) for y, v in by_year.items()})
print('open:', [(p['account'], p['symbol'], p['open_qty'], p['open_cost'], p.get('unrealized')) for p in openp])
