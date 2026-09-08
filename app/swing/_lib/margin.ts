export type MarginHolding = {symbol:string; qty:number; value:number};
// Long-stock scenario only. Account-specific broker requirements may be higher.
export function marginScenario(holdings:MarginHolding[], debt:number, broadDrop=0, focus='', focusDrop=0, concentratedRate=50, overrides:Record<string,number>={}) {
  const shocked = holdings.map(h=>({...h,value:h.value*(1-broadDrop/100)*(h.symbol===focus ? 1-focusDrop/100 : 1)}));
  const market=shocked.reduce((s,h)=>s+h.value,0);
  const lines=shocked.map(h=>{
    const concentration=market>0 && h.value/market>=.4;
    const rate=Math.max(.35, concentration ? concentratedRate/100 : 0, (overrides[h.symbol]??0)/100);
    const requirement=Math.min(h.value,Math.max(3*h.qty,h.value*rate));
    return {...h,requirement,rate:h.value>0?requirement/h.value:1,concentration};
  });
  const requirement=Math.max(2000,lines.reduce((s,h)=>s+h.requirement,0));
  const equity=market-debt;
  return {market,equity,requirement,buffer:equity-requirement,lines};
}
// First crossing, including changes in concentration and low-price floors.
export function marginCrossing(holdings:MarginHolding[],debt:number,focus='',rate=50,overrides:Record<string,number>={}) {
 const buffer=(drop:number)=>marginScenario(holdings,debt,focus?0:drop,focus,focus?drop:0,rate,overrides).buffer;
 if(buffer(0)<=0)return 0;
 for(let step=1;step<=1000;step++) {
  const hi=step/10;
  if(buffer(hi)<=0) {let lo=hi-.1, upper=hi;for(let i=0;i<40;i++){const mid=(lo+upper)/2;if(buffer(mid)<=0)upper=mid;else lo=mid;}return upper;}
 }
 return null;
}
