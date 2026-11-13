"""Apply an audited Vanguard update to a dated ledger baseline (no network access).

Usage: python3 apply_snapshot.py BASELINE_JSON UPDATE_JSON OUTPUT_JSON
Finalized tax history is preserved. Unsettled sales use the order's stated lot
method for provisional economic P&L; they never become finalized tax records.

Updates may also carry posted fees, a list of income rows, margin-interest cash
flows and a `tax` block of Vanguard realized-gain totals for one year (which then
replaces that year's taxable figures). Partial sales without a stated method use
the update's `default_methods` for that account, else FIFO.
"""
import copy
import json
import sys
from datetime import datetime

def date(s):
    return datetime.strptime(s, '%m/%d/%Y')

def apply(base, update):
    assert base['as_of'] == update['baseline_as_of'], 'Wrong baseline; refusing duplicate import'
    d = copy.deepcopy(base)
    sm = d['summary']
    for row in update['executions']:
        assert date(row['date']) > date(base['as_of']), 'Overlapping transaction'
        e = {k: row[k] for k in ('date', 'account', 'symbol', 'type', 'qty', 'price', 'amount')}
        e.update(fees=row.get('fees', 0), category='trade')
        if row.get('provisional'):
            e.update(provisional=True, note='Executed; settlement 09/09/2026. Sale fees and lot P&L provisional.')
        matches = [p for p in d['positions'] if p['account'] == e['account'] and p['symbol'] == e['symbol'] and p['status'] == 'open']
        assert len(matches) <= 1
        if matches:
            p = matches[0]
        else:
            assert e['type'] == 'Buy', 'Sale has no open position'
            p = dict(id=f"{e['account'][:3]}-{e['symbol']}-{e['date'].replace('/', '')}", account=e['account'],
                     symbol=e['symbol'], name=row['name'], opened=e['date'], closed=None, status='open', buys=0,
                     sells=0, qty_bought=0, max_qty=0, cost=0, proceeds=0, fees=0, realized=0, tax_realized=0,
                     return_pct=None, days=0, basis_known=True, category='trade', dividends=0, open_qty=0,
                     open_cost=0, open_lots=[], execs=[])
            d['positions'].append(p)
        d['names'][e['symbol']] = row['name']
        sm['ledger_cash_by_account'][e['account']] = round(sm['ledger_cash_by_account'][e['account']] + e['amount'], 2)
        if e['type'] == 'Buy':
            p['buys'] += 1
            p['qty_bought'] += e['qty']
            p['cost'] = round(p['cost'] - e['amount'], 2)
            p['open_cost'] = round(p['open_cost'] - e['amount'], 2)
            p['open_qty'] += e['qty']
            p['max_qty'] = max(p['max_qty'], p['open_qty'])
            p['open_lots'].append(dict(date=e['date'], qty=e['qty'], price=-e['amount']/e['qty']))
        else:
            qty = -e['qty']
            assert qty <= p['open_qty'] + 1e-6, 'Oversold position'
            # A complete exit uses the preserved full economic cost, avoiding
            # cumulative rounding from the display precision of historical lots.
            if abs(qty - p['open_qty']) < 1e-6:
                cost = p['open_cost']
                p['open_lots'] = []
            else:
                method = row.get('method') or update.get('default_methods', {}).get(e['account'], 'FIFO')
                assert method in ('FIFO', 'HIFO')
                lots = sorted(p['open_lots'], key=lambda l: -l['price'] if method == 'HIFO' else date(l['date']))
                remaining, cost = qty, 0
                for lot in lots:
                    take = min(remaining, lot['qty'])
                    cost += take * lot['price']
                    lot['qty'] -= take
                    remaining -= take
                assert remaining < 1e-6, 'Insufficient lot evidence'
                p['open_lots'] = [l for l in lots if l['qty'] > 1e-6]
                cost = round(cost, 2)
            e['pnl'] = round(e['amount'] - cost, 2)
            e['tax_pnl'] = None
            p['sells'] += 1
            p['proceeds'] = round(p['proceeds'] + e['amount'], 2)
            p['realized'] = round(p['realized'] + e['pnl'], 2)
            p['open_qty'] -= qty
            p['open_cost'] = round(p['open_cost'] - cost, 2)
            p['provisional'] = True
            if p['open_qty'] < 1e-6:
                p.update(open_qty=0, open_cost=0, market_value=0, unrealized=0, status='closed', closed=e['date'])
                p['return_pct'] = round(100*p['realized']/p['cost'], 2) if p['cost'] else None
        p['execs'].append({k: v for k, v in e.items() if k not in ('account', 'symbol', 'category', 'fees')})
        d['executions'].append(e)
    incomes = update['income'] if isinstance(update['income'], list) else [update['income']]
    for income in incomes:
        sm['income'] = round(sm['income'] + income['amount'], 2)
        sm['ledger_cash_by_account'][income['account']] = round(sm['ledger_cash_by_account'][income['account']] + income['amount'], 2)
    for flow in update.get('cash_flows', []):
        sm['other'] = round(sm['other'] + flow['amount'], 2)
        sm['ledger_cash_by_account'][flow['account']] = round(sm['ledger_cash_by_account'][flow['account']] + flow['amount'], 2)
        d['cashflows'].append(flow)
    current = {(h['account'], h['symbol']): h for h in update['holdings']}
    openp = [p for p in d['positions'] if p['status'] == 'open']
    assert set(current) == {(p['account'], p['symbol']) for p in openp}, 'Holdings universe mismatch'
    for p in d['positions']:
        p['days'] = (date(p['closed'] or update['as_of']) - date(p['opened'])).days
        if p['status'] != 'open':
            continue
        h = current[(p['account'], p['symbol'])]
        assert abs(p['open_qty'] - h['qty']) < 1e-6, f"Quantity mismatch: {p['symbol']}"
        p.update(last_price=h['price'], market_value=h['value'], unrealized=round(h['value']-p['open_cost'], 2))
    for account, expected in update['accounts'].items():
        market = sum(h['value'] for h in update['holdings'] if h['account'] == account)
        assert abs(market + expected['cash'] - expected['value']) < .02, f'Account reconciliation failed: {account}'
    d['positions'].sort(key=lambda p: date(p['opened']))
    d['executions'].sort(key=lambda e: date(e['date']))
    sales = [e for e in d['executions'] if e['type'] == 'Sell' and e.get('pnl') is not None]
    closed = [p for p in d['positions'] if p['status']=='closed' and p['basis_known'] and p.get('category')!='advisor']
    sm.update(realized=round(sum(e['pnl'] for e in sales),2),
              realized_closed=round(sum(p['realized'] for p in closed),2),
              realized_open=round(sum(p['realized'] for p in openp),2),
              unrealized=round(sum(p['unrealized'] for p in openp),2),
              market_value=round(sum(p['market_value'] for p in openp),2),
              open_cost=round(sum(p['open_cost'] for p in openp),2),
              account_value=round(sum(a['value'] for a in update['accounts'].values()),2),
              cash=round(sum(a['cash'] for a in update['accounts'].values()),2),
              ledger_cash=round(sum(sm['ledger_cash_by_account'].values()),2),
              prices_as_of=update['as_of'], prices_label=update['holdings_at'],
              vanguard_unrealized=None, wash_deferred=None)
    sm['components_total'] = round(sm['realized']+sm['unrealized']+sm['income'],2)
    sm['realized_trades'] = round(sm['realized']-sm['advisor']['realized'],2)
    sm['cash_reconciliation_difference'] = round(sm['cash']-sm['ledger_cash'],2)
    # Replace partial August and add September only through the broker's actual
    # performance cutoff, not the end of a month that has not happened yet.
    updated_months = {r['month'] for r in update['performance_months']}
    d['balance_history'] = sorted([r for r in d['balance_history'] if r['month'] not in updated_months] + update['performance_months'], key=lambda r:r['date'])
    history = d['balance_history']
    sm['vanguard'].update(investment_returns=history[-1]['gain'], ending=history[-1]['value'],
        flows=history[-1]['net_deposits'], market=round(sum(r['market'] for r in history),2),
        income=round(sum(r['income'] for r in history),2), as_of=update['performance_as_of'])
    for year, y in d['by_year'].items():
        yearclosed = [p for p in closed if p['closed'].endswith(year)]
        y.update(realized=round(sum(e['pnl'] for e in sales if e['date'].endswith(year)),2),
                 closed=len(yearclosed), wins=sum(p['realized']>0 for p in yearclosed),
                 total_gain=round(sum(r['market']+r['income'] for r in history if r['date'].startswith(year)),2))
    tax = update.get('tax')
    d['by_year']['2026']['source'] = ('Vanguard cost-basis report through ' + update['tax_as_of'] + ' (taxable); economic P&L from original lot costs'
                                      if tax else 'Finalized Vanguard lots + provisional 09/08 executed sales (economic only)')
    for sym in {p['symbol'] for p in d['positions']} | set(d['by_symbol']):
        old = d['by_symbol'].get(sym, {})
        positions = [p for p in closed if p['symbol']==sym]
        r = round(sum(e['pnl'] for e in sales if e['symbol']==sym),2)
        u = round(sum(p['unrealized'] for p in openp if p['symbol']==sym),2)
        d['by_symbol'][sym] = dict(realized=r,unrealized=u,total=round(r+u,2),trades=len(positions),
            wins=sum(p['realized']>0 for p in positions),losses=sum(p['realized']<=0 for p in positions),
            open=any(p['symbol']==sym for p in openp),advisor=old.get('advisor',False))
    d.update(as_of=update['as_of'],generated=update['as_of'])
    if tax:
        apply_tax(d, base, tax)
        d['refresh_note'] = update['refresh_note']
        d['warnings'] = [update['refresh_note'], f"Broker cash differs from the execution ledger by ${sm['cash_reconciliation_difference']:.2f}."]
        return d
    d['refresh_note'] = ('Includes nine executed orders settling September 9. Today’s sale P&L uses the stated FIFO/HIFO method and is provisional until final lot and fee records post. Tax figures remain finalized through '+update['tax_as_of']+'.')
    d['warnings'] = [d['refresh_note'], f"Intraday broker cash differs from the execution ledger by ${sm['cash_reconciliation_difference']:.2f}; unsettled sale fees are not finalized."]
    assert d['tax_estimate'] == base['tax_estimate'], 'Finalized tax estimates changed'
    assert all(e in d['executions'] for e in base['executions']), 'Historical execution lost'
    return d

def apply_tax(d, base, tax):
    """Replace one year's taxable figures with Vanguard's realized-gain report totals."""
    year = tax['year']
    y = d['by_year'][year]
    old_taxable = y['taxable']
    y['taxable'] = round(tax['brokerage_taxable'] + tax['sep_taxable'], 2)
    y['disallowed'] = round(sum(r['disallowed'] for r in tax['rows']), 2)
    d['summary']['taxable_realized'] = round(d['summary']['taxable_realized'] - old_taxable + y['taxable'], 2)
    te = d['tax_estimate']
    t = next(t for t in te['years'] if t['year'] == year)
    brk = tax['brokerage_taxable']
    # Same method as the original estimate: all 2026 lots are short-term; NY applies only to the Jan–Jun (pre-move)
    # sales, which are unchanged; Florida has no income tax.
    t.update(brk_taxable=brk, st=brk, lt=0.0, est_federal=round(brk * te['fed_st'], 2))
    t['est_total'] = round(t['est_federal'] + t['est_ny'], 2)
    te['total'] = round(sum(x['est_total'] for x in te['years']), 2)
    te['as_of'] = tax.get('as_of', d['as_of'])
    te['realized_rows'] = tax['rows']
    for note in tax.get('extra_assumptions', []):
        if note not in te['assumptions']:
            te['assumptions'].append(note)
    scen = []
    for sym, b in tax.get('open_brokerage_tax_basis', {}).items():
        new = round(brk + b['unrealized'], 2)
        fed = round(new * te['fed_st'], 2)
        scen.append(dict(symbol=sym, qty=b['qty'], basis=b['basis'], value=b['value'], unrealized=b['unrealized'],
                         brk_taxable_after=new, est_federal_after=fed, est_total_after=round(fed + t['est_ny'], 2),
                         saving=round(t['est_total'] - fed - t['est_ny'], 2)))
    te['scenarios'] = scen
    for e in base['executions']:
        assert e in d['executions'], 'Historical execution lost'

if __name__ == '__main__':
    base, update, output = sys.argv[1:]
    result = apply(json.load(open(base)), json.load(open(update)))
    with open(output, 'w') as f:
        json.dump(result, f, indent=0)
    print(json.dumps({'holdings':sum(p['status']=='open' for p in result['positions']), 'executions':len(result['executions']), 'account_value':result['summary']['account_value'], 'cash_difference':result['summary']['cash_reconciliation_difference']}))
