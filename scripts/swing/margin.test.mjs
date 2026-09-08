import {test} from 'node:test';
import assert from 'node:assert/strict';
import {marginScenario,marginCrossing} from '../../app/swing/_lib/margin.ts';
const near=(a,b)=>assert.ok(Math.abs(a-b)<.001,`${a} != ${b}`);
test('diversified margin, debt and equity identity',()=>{
 const h=['A','B','C','D'].map(symbol=>({symbol,qty:100,value:10000}));
 const r=marginScenario(h,10000);near(r.requirement,14000);near(r.buffer,16000);
 near(marginCrossing(h,10000),100*(1-10000/26000));
});
test('low-priced shares use dollar floor and cannot lend below $3',()=>{
 const h=[{symbol:'A',qty:1000,value:4000}];
 near(marginScenario(h,1000).requirement,3000);
 near(marginScenario(h,1000,50).buffer,-1000);
});
test('concentration and higher security requirements',()=>{
 const h=[{symbol:'A',qty:100,value:60000},{symbol:'B',qty:100,value:20000},{symbol:'C',qty:100,value:20000}];
 near(marginScenario(h,20000).requirement,44000);
 near(marginScenario(h,20000,0,'',0,75).requirement,59000);
 near(marginScenario(h,20000,0,'',0,50,{A:100}).requirement,74000);
});
test('combined shocks, repayment and minimum equity',()=>{
 const h=[{symbol:'A',qty:100,value:10000}];
 near(marginScenario(h,2000,20,'A',25).market,6000);
 near(marginScenario(h,1000).buffer-marginScenario(h,2000).buffer,1000);
 near(marginScenario([{symbol:'A',qty:1,value:1000}],0).buffer,-1000);
 assert.equal(marginCrossing(h,9000),0);
});
