import { beforeAll, describe, expect, it, vi } from 'vitest';
const { session } = vi.hoisted(() => ({ session: { user: null as any } }));
vi.mock('@/lib/auth', () => ({ requireAuth: async () => session.user, requireDirector: async () => session.user }));
import { nextFollowUpDates } from '@/lib/followUpDates';
import prisma from '@/lib/prisma';
import { moneyInput, validDateInput } from '@/lib/inputValidation';
import { parseReceiptInput } from '@/lib/receiptInput';
import { parseQuotationInput } from '@/lib/quotationInput';
import { errorResponse } from '@/lib/apiErrors';
import { getIndianFYQuarter } from '@/lib/utils';
import { POST as createQuote } from '@/app/api/quotations/route';
import { POST as convert } from '@/app/api/orders/route';
import { POST as revision } from '@/app/api/quotations/[id]/version/route';
import { PATCH as editVersion } from '@/app/api/quotations/[id]/versions/[versionNumber]/route';
import { POST as receipt } from '@/app/api/orders/[id]/receipts/route';
import { POST as createTask } from '@/app/api/tasks/route';
import { PATCH as complete } from '@/app/api/tasks/[id]/complete/route';

const body = (data: any) => new Request('http://localhost/api/qa', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify(data) });
const terms = {product:'QA regression RO',price:10000,gstPercent:18,paymentStages:[],transportation:'INCLUDED'};
let clientId: string, enquiryId: string;
beforeAll(async () => {
  session.user = await prisma.user.findUniqueOrThrow({where:{email:'amit.patil@nirmaanwater.com'}});
  const client = await prisma.client.create({data:{name:'QA regression isolated client',code:`QA${Date.now().toString().slice(-7)}`,industrySegment:'Other',assignedToId:session.user.id,createdById:session.user.id}});
  clientId=client.id;
  const e=await prisma.enquiry.create({data:{clientId,title:'QA regression requirement',requirementSummary:'QA regression requirement',enquiryNumber:`${client.code}/001`,category:'PLANT',categories:['PLANT'],assignedToId:session.user.id,createdById:session.user.id}});
  enquiryId=e.id;
});

describe('Strict input and safe errors', () => {
  it.each([-1,NaN,Infinity,'100abc','',null,{},1.001,1e15])('rejects invalid money %s', value => expect(()=>moneyInput(value,'Amount')).toThrow());
  it.each([0,0.01,100,'100.50'])('accepts exact currency %s', value => expect(moneyInput(value,'Amount')).toBe(Number(value)));
  it.each(['2026-02-29','2026-02-30','2026-04-31','invalid','2026-13-01'])('rejects impossible date %s',value=>expect(validDateInput(value)).toBe(false));
  it.each(['2028-02-29','2026-10-27','2026-03-31T23:59:59+05:30'])('accepts calendar date %s',value=>expect(validDateInput(value)).toBe(true));
  it('rejects non-finite receipt and malformed quotation price',()=>{
    expect(parseReceiptInput({amount:'Infinity',paymentStageId:'x',receivedDate:'2026-10-20'})).toHaveProperty('error');
    expect(parseQuotationInput({...terms,price:'100abc'})).toHaveProperty('error');
  });
  it('answers expired authentication as 401 and hides internal failures',async()=>{
    expect(errorResponse(new Error('UNAUTHORIZED')).status).toBe(401);
    const spy=vi.spyOn(console,'error').mockImplementation(()=>{});
    const r=errorResponse(new Error('database password and SQL internals'));
    expect(r.status).toBe(500);expect(JSON.stringify(await r.json())).not.toContain('password');spy.mockRestore();
  });
});

describe('Real database concurrency regressions',()=>{
 it('creates one quotation and one order under simultaneous requests, then blocks accepted edits',async()=>{
   const no=Date.now().toString().slice(-5);
   const quotes=await Promise.all([createQuote(body({...terms,clientId,enquiryId,quotationNo:no})),createQuote(body({...terms,clientId,enquiryId,quotationNo:String(Number(no)+1)}))]);
   expect(quotes.map(r=>r.status).sort()).toEqual([200,409]);
   const quote=(await (await Promise.resolve(quotes.find(r=>r.status===200)!)).json()).quotation;
   const revisions=await revision(body({...terms,price:12000}),{params:Promise.resolve({id:quote.id})});expect(revisions.status).toBe(200);
   const edit=await editVersion(body({...terms,price:1}),{params:Promise.resolve({id:quote.id,versionNumber:'0'})});expect(edit.status).toBe(409);
   expect(Number((await prisma.quotationVersion.findUniqueOrThrow({where:{quotationId_versionNumber:{quotationId:quote.id,versionNumber:0}}})).originalValue)).toBe(10000);
   const orders=await Promise.all([1,2].map(i=>convert(body({quotationId:quote.id,clientPoNumber:`QA-REG-${no}-${i}`,poDate:'2026-10-20'}))));expect(orders.map(r=>r.status).sort()).toEqual([200,409]);
   expect(await prisma.order.count({where:{quotationId:quote.id}})).toBe(1);
   const order=(await orders.find(r=>r.status===200)!.json()).order;
   const stage=await prisma.orderPaymentStage.findFirstOrThrow({where:{orderId:order.id}});
   const reference=`QA-REG-${no}`;const input={paymentStageId:stage.id,amount:100,receivedDate:'2026-10-20',reference};
   const receipts=await Promise.all([receipt(body(input),{params:Promise.resolve({id:order.id})}),receipt(body({...input,reference:reference.toLowerCase()}),{params:Promise.resolve({id:order.id})})]);expect(receipts.map(r=>r.status).sort()).toEqual([200,409]);
   expect(await prisma.orderReceipt.count({where:{reference:{equals:reference,mode:'insensitive'},isReversed:false}})).toBe(1);
 });
 it('completes a follow-up once and creates one successor under simultaneous submissions',async()=>{
   const t=await createTask(body({clientId,description:'QA concurrency task',dueDateTime:'2026-11-01'}));expect(t.status).toBe(200);const task=(await t.json()).task;
   const before=await prisma.task.count({where:{clientId}});
   const results=await Promise.all([1,2].map(()=>complete(body({completionOutcome:'QA discussed',nextAction:'QA next call',nextActionDate:'2026-11-02'}),{params:Promise.resolve({id:task.id})})));
   expect(results.map(r=>r.status).sort()).toEqual([200,409]);expect(await prisma.task.count({where:{clientId}})).toBe(before+1);
 });
});

describe('Indian quarter boundaries',()=>{
 it('includes the first and final millisecond of the quarter in India',()=>{
   const start=new Date('2026-03-31T18:30:00Z');const q=getIndianFYQuarter(start);
   expect(q.quarter).toBe('Q1');expect(q.startDate.toISOString()).toBe(start.toISOString());
   expect(q.endDate.toISOString()).toBe('2026-06-30T18:29:59.999Z');
 });
});


describe('Follow-up ordering',()=>{
 it('finds the next strictly later task without mixing requirements and client tasks',()=>{
   const tasks=[
    {id:'a',clientId:'client',enquiryId:'req',dueDateTime:new Date('2026-10-01')},
    {id:'same',clientId:'client',enquiryId:'req',dueDateTime:new Date('2026-10-01')},
    {id:'later',clientId:'client',enquiryId:'req',dueDateTime:new Date('2026-10-03')},
    {id:'other',clientId:'client',enquiryId:'other-req',dueDateTime:new Date('2026-10-02')},
    {id:'client',clientId:'client',enquiryId:null,dueDateTime:new Date('2026-10-02')},
   ];
   const next=nextFollowUpDates(tasks);
   expect(next.get('a')).toEqual(new Date('2026-10-03'));expect(next.get('same')).toEqual(new Date('2026-10-03'));
   expect(next.get('later')).toBeNull();expect(next.get('other')).toBeNull();expect(next.get('client')).toBeNull();
 });
});
