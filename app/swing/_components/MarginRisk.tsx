"use client";
import {useState} from "react";
import {marginScenario,marginCrossing,type MarginHolding} from "../_lib/margin";
import {money,pnl} from "../_lib/format";
import broker from "../_data/margin.json";

export function MarginRisk({holdings,asOf}:{holdings:MarginHolding[];asOf:string}) {
 const [drop,setDrop]=useState(0),[focusDrop,setFocusDrop]=useState(0),[rate,setRate]=useState(50),[repay,setRepay]=useState(0);
 const [overrides,setOverrides]=useState<Record<string,number>>({});
 const largest=[...holdings].sort((a,b)=>b.value-a.value)[0];
 const debt=Math.max(0,broker.debit-repay);
 const base=marginScenario(holdings,broker.debit);
 const scenario=marginScenario(holdings,debt,drop,largest?.symbol,focusDrop,rate,overrides);
 const crossing=marginCrossing(holdings,debt,'',rate,overrides);
 const focusCrossing=marginCrossing(holdings,debt,largest?.symbol,rate,overrides);
 const num=(s:string,max:number)=>Math.min(max,Math.max(0,Number(s)||0));
 return <section className="card p-4 space-y-4" aria-label="Margin risk">
  <div><h2 className="font-medium">Margin risk & scenarios</h2><p className="text-xs text-muted mt-1">Brokerage only · SEP-IRA excluded · holdings {asOf}</p></div>
  <p className="text-sm">Vanguard reported house call <strong>{money(broker.houseCall)}</strong> and federal call <strong>{money(broker.federalCall)}</strong> at the last check. <span className="text-ink-2">{broker.observedAt}. This is a saved snapshot, not live monitoring or an alert service.</span></p>
  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
   {[["Debit including pending trades",money(broker.debit)],["Brokerage equity",money(base.equity)],["Estimated maintenance buffer",money(base.buffer)],[`${largest?.symbol} concentration`,`${(largest.value/base.market*100).toFixed(1)}%`]].map(([label,value])=><div className="rounded-lg bg-surface-2 p-3" key={label}><div className="text-xs text-muted">{label}</div><div className="text-lg font-semibold tnum">{value}</div></div>)}
  </div>
  <p className="text-xs text-ink-2">Buffer = equity minus estimated required equity. It is not buying power or cash available to withdraw. Actual per-stock maintenance rates were not provided in the account view; estimates below use published rules and can overstate your real buffer.</p>
  <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
   <label>All holdings fall: {drop}%<input className="block w-full mt-2" aria-label="All holdings decline" type="range" min="0" max="90" value={drop} onChange={e=>setDrop(Number(e.target.value))}/></label>
   <label>{largest?.symbol} falls an additional: {focusDrop}%<input className="block w-full mt-2" aria-label="Largest holding additional decline" type="range" min="0" max="90" value={focusDrop} onChange={e=>setFocusDrop(Number(e.target.value))}/></label>
   <label>Concentrated holding requirement<select className="block w-full mt-2" aria-label="Concentration requirement" value={rate} onChange={e=>setRate(Number(e.target.value))}>{[50,60,75,100].map(r=><option key={r} value={r}>{r}%</option>)}</select></label>
   <label>Hypothetical cash repayment ($)<input className="block w-full mt-2" aria-label="Cash repayment" type="number" min="0" max={broker.debit} value={repay} onChange={e=>setRepay(num(e.target.value,broker.debit))}/></label>
  </div>
  <div aria-live="polite" className="rounded-lg bg-surface-2 p-3 text-sm space-y-1">
   <p className={scenario.buffer>=0?'text-gain':'text-loss'}><strong>{scenario.buffer>=0?'Estimated remaining buffer':'Estimated maintenance shortfall'}: {money(Math.abs(scenario.buffer))}</strong></p>
   <p>Scenario equity {money(scenario.equity)} · required equity {money(scenario.requirement)}</p>
   <p>Uniform decline to estimated threshold: {crossing===null?'not reached within a 100% decline':`${crossing.toFixed(1)}%`} · {largest?.symbol}-only decline: {focusCrossing===null?'not reached within a 100% decline':`${focusCrossing.toFixed(1)}%`}</p>
   <p className="text-xs text-muted">Thresholds start at saved prices using the selected requirements and repayment. Other holdings stay fixed in the single-stock case. Sliders combine multiplicatively. Debt stays fixed; future interest, fees, trades and rule changes can reduce the buffer.</p>
  </div>
  <div className="overflow-x-auto"><table className="data"><thead><tr><th>Example scenario</th><th>Estimated buffer / shortfall</th></tr></thead><tbody>
   {[{label:'All holdings −20%',b:20,f:0,r:50},{label:`${largest?.symbol} −40%`,b:0,f:40,r:50},{label:'Concentration requirement raised to 75%',b:0,f:0,r:75},{label:'All holdings −30% + 75% concentration requirement',b:30,f:0,r:75}].map(s=>{const v=marginScenario(holdings,broker.debit,s.b,largest?.symbol,s.f,s.r);return <tr key={s.label}><td>{s.label}</td><td className={v.buffer>=0?'text-gain':'text-loss'}>{pnl(v.buffer)}</td></tr>})}
  </tbody></table></div>
  <details><summary className="cursor-pointer text-sm">Per-stock assumptions & Vanguard rules</summary>
   <p className="text-xs text-muted mt-3">Presets above use the saved debit and published defaults. Controls below affect the interactive scenario only. Enter a higher confirmed broker rate or 100% for non-marginable shares.</p>
   <div className="overflow-x-auto"><table className="data"><thead><tr><th>Stock</th><th>Scenario value</th><th>Effective requirement</th><th>Override minimum (%)</th></tr></thead><tbody>{scenario.lines.map(h=><tr key={h.symbol}><td>{h.symbol}</td><td>{money(h.value)}</td><td>{(h.rate*100).toFixed(1)}%</td><td><input className="w-24" aria-label={`${h.symbol} maintenance override`} type="number" min="0" max="100" placeholder="Auto" value={overrides[h.symbol]??''} onChange={e=>setOverrides(o=>{const next={...o};if(e.target.value==='')delete next[h.symbol];else next[h.symbol]=num(e.target.value,100);return next;})}/></td></tr>)}</tbody></table></div>
   <p className="text-xs text-ink-2 mt-3">Model: 35% standard maintenance, a $3-per-share floor capped at full value, and at least 50% for a position representing 40% or more of the account. A $2,000 equity floor also applies. Vanguard can impose higher security or sector requirements and liquidate without prior notice. Initial purchase requirements differ from maintenance.</p>
   <p className="text-xs mt-2"><a className="underline" href="https://www.vanguard.com/pdf/margin.pdf" target="_blank" rel="noreferrer">Vanguard margin guide</a> · <a className="underline" href="https://investor.vanguard.com/client-benefits/margin-disclosure-statement" target="_blank" rel="noreferrer">Margin disclosure</a> · rules checked {broker.rulesVerified}</p>
   <p className="text-xs text-muted mt-2">Broker-reported buying power {money(broker.buyingPower)}; month-to-date interest {money(broker.monthToDateInterest)}. Interest is not added again to the saved debit because its posting status is unknown. Saved holdings include unsettled executions.</p>
  </details>
  <button className="chip" onClick={()=>{setDrop(0);setFocusDrop(0);setRate(50);setRepay(0);setOverrides({});}}>Reset scenarios</button>
 </section>;
}
