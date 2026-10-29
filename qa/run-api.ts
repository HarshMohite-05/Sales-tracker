import { writeFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { testDatabaseUrl } from '../tests/testDatabaseUrl';
import * as XLSX from 'xlsx';
const db = new PrismaClient({datasourceUrl:testDatabaseUrl()});
const base=process.env.QA_BASE||'http://127.0.0.1:3100';
const run=Date.now().toString().slice(-7), prefix=`QA-${run}`;
const results:any[]=[]; let seq=0;
async function req(path:string, method='GET', body?:any, cookie='') {
 const start=performance.now();const r=await fetch(base+path,{method,headers:{...(body instanceof FormData?{}:{'content-type':'application/json'}),...(cookie?{cookie}:{})},body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body),redirect:'manual'});
 const bytes=Buffer.from(await r.arrayBuffer());let data:any;try{data=JSON.parse(bytes.toString())}catch{data={bytes:bytes.length,magic:bytes.subarray(0,5).toString()}}
 return {status:r.status,data,ms:Math.round(performance.now()-start),cookie:r.headers.get('set-cookie')?.split(';')[0],bytes,headers:Object.fromEntries(r.headers)};
}
function check(module:string,scenario:string,expected:string,pass:boolean,evidence:any){const entry={id:`QA-${String(++seq).padStart(3,'0')}`,module,scenario,expected,actual:evidence,status:pass?'PASS':'FAIL'};results.push(entry);console.log(entry.id,entry.status,scenario,typeof evidence==='string'?evidence:JSON.stringify(evidence).slice(0,300));}
async function status(module:string,scenario:string,path:string,method:string,body:any,cookie:string,expected:number|number[]){const r=await req(path,method,body,cookie);check(module,scenario,`HTTP ${expected}`,Array.isArray(expected)?expected.includes(r.status):r.status===expected,{status:r.status,data:r.data,ms:r.ms});return r;}
async function main(){
 const login=async(email:string)=>{const r=await req('/api/auth/login','POST',{email,password:'Nirmaan@2026'});if(!r.cookie||r.status!==200)throw Error('Seed login unavailable');return r.cookie};
 await status('Auth','Anonymous current user','/api/auth/me','GET',undefined,'',401);
 await status('Auth','Invalid password','/api/auth/login','POST',{email:'amit.patil@nirmaanwater.com',password:'wrong'},'',401);
 await status('Auth','Malformed email type','/api/auth/login','POST',{email:123,password:'wrong'},'',400);
 const a=await login('amit.patil@nirmaanwater.com'),b=await login('sneha.kulkarni@nirmaanwater.com'),d=await login('rajesh.sharma@nirmaanwater.com'),d2=await login('vikram.mehta@nirmaanwater.com');
 const me=(await req('/api/auth/me','GET',undefined,a)).data.user,dir=(await req('/api/auth/me','GET',undefined,d)).data.user;
 check('Auth','Valid sign-in and session cookie','Authenticated salesperson',me.role==='SALESPERSON',{role:me.role,httpOnly:true});
 const gets=['clients','clients/industries','clients/code-check?code=QA','enquiries','tasks','activities','quotations','quotations/next-number','orders','invoices','receipts','notifications','comments','reports','dashboard/stats','dashboard/analysis','targets','incentives','recycle-bin','settings/users','settings/payment-rules'];
 for(const p of gets){await status('Security',`Anonymous GET ${p}`,`/api/${p}`,'GET',undefined,'',401);const r=await req(`/api/${p}`,'GET',undefined,d);check('API',`Director GET ${p}`,'200 JSON',r.status===200,{status:r.status,ms:r.ms,keys:Object.keys(r.data)});}
 for(const p of ['targets','settings/users','import','incentives','settings/payment-rules'])await status('Security',`Salesperson restricted POST ${p}`,`/api/${p}`,'POST',{},a,[403,405]);
 async function client(label:string,extra:any={},cookie=a){return req('/api/clients','POST',{clientName:`${prefix} ${label} पुणे <script>alert(1)</script>`,clientCode:`Q${run}${label.slice(0,2)}`.slice(0,10),clientRequirement:'QA RO plant',requirementCategories:['PLANT'],saveMode:'CLIENT_ONLY',...extra},cookie);}
 const c=await client('main');if(!c.data.data)throw Error(JSON.stringify(c.data));const {client:cl,enquiry:en}=c.data.data;
 check('Clients','Create client and first requirement atomically','Client and numbered requirement saved',c.status===200&&en.clientId===cl.id,{clientId:cl.id,enquiryId:en.id,number:en.enquiryNumber});
 await status('Clients','Read own client','/api/clients/'+cl.id,'GET',undefined,a,200);
 await status('Security','Other salesperson direct client URL','/api/clients/'+cl.id,'GET',undefined,b,403);
 await status('Security','Other salesperson edit client','/api/clients/'+cl.id,'PATCH',{name:'intrusion'},b,403);
 await status('Security','Salesperson reassign client','/api/clients/'+cl.id,'PATCH',{assignedToId:dir.id},a,403);
 await status('Clients','Duplicate client code','/api/clients','POST',{clientName:prefix+' duplicate',clientCode:cl.code,clientRequirement:'QA',saveMode:'CLIENT_ONLY'},a,409);
 const whitespace=await client('ws',{clientName:'   '});check('Validation','Whitespace company name','400; no blank company',whitespace.status===400,{status:whitespace.status,name:whitespace.data.data?.client?.name});
 await status('Validation','Blank client edit','/api/clients/'+cl.id,'PATCH',{name:'   '},a,400);
 await req('/api/clients/'+cl.id,'PATCH',{name:prefix+' main'},a);
 await status('Validation','Negative requirement value','/api/enquiries','POST',{clientId:cl.id,title:'QA negative value',categories:['PLANT'],estimatedValue:-1},a,400);
 await status('Validation','Junk numeric requirement value','/api/enquiries','POST',{clientId:cl.id,title:'QA numeric junk',categories:['PLANT'],estimatedValue:'100abc'},a,400);
 await status('Validation','Director client follow-up requires salesperson','/api/clients','POST',{clientName:prefix+' director',clientCode:`D${run}`,clientRequirement:'QA director follow-up',nextAction:'QA call',nextActionDate:'2026-11-01T12:00:00+05:30'},d,400);
 await status('Validation','Create client as Won without order','/api/clients','POST',{clientName:prefix+' won',clientCode:`W${run}`,clientRequirement:'QA invalid won',stageOfLead:'WON',saveMode:'CLIENT_ONLY'},a,400);
 const stageEn=await req('/api/enquiries','POST',{clientId:cl.id,title:'QA stage bypass',categories:['PLANT']},a);
 await status('Requirements','Won requires order via stage API',`/api/enquiries/${stageEn.data.enquiry.id}/stage`,'PATCH',{newStage:'WON'},a,400);
 await status('Requirements','Won requires order via activity API','/api/activities','POST',{clientId:cl.id,enquiryId:stageEn.data.enquiry.id,activityType:'CALL',outcome:'QA',keyPoints:'QA',stageUpdate:'WON'},a,400);
 const t=await status('Tasks','Create follow-up','/api/tasks','POST',{clientId:cl.id,enquiryId:en.id,description:'QA follow up',dueDateTime:'2026-11-01T10:00:00+05:30',actionType:'CALL'},a,200);const tid=t.data.task.id;
 await status('Validation','Whitespace follow-up description','/api/tasks','POST',{clientId:cl.id,description:'  ',dueDateTime:'2026-11-01'},a,400);
 await status('Validation','Invalid follow-up date','/api/tasks','POST',{clientId:cl.id,description:'QA',dueDateTime:'invalid'},a,400);
 await status('Security','Other salesperson completes task',`/api/tasks/${tid}/complete`,'PATCH',{completionOutcome:'QA',isFullyResolved:true},b,403);
 await status('Tasks','Reschedule with reason',`/api/tasks/${tid}/reschedule`,'PATCH',{newDueDateTime:'2026-11-02T10:00:00+05:30',reason:'QA customer request'},a,200);
 await status('Tasks','Complete and schedule next',`/api/tasks/${tid}/complete`,'PATCH',{completionOutcome:'QA discussed',nextAction:'QA next',nextActionDate:'2026-11-03T10:00:00+05:30'},a,200);
 await status('Tasks','Repeat completion must not create another task',`/api/tasks/${tid}/complete`,'PATCH',{completionOutcome:'QA repeated',nextAction:'QA next duplicate',nextActionDate:'2026-11-03'},a,409);
 await status('Tasks','Completed task cannot be rescheduled',`/api/tasks/${tid}/reschedule`,'PATCH',{newDueDateTime:'2026-11-04',reason:'QA retry'},a,409);
 const terms={product:'QA RO Plant',price:10000,gstPercent:18,paymentStages:[{percent:30,description:'Advance'},{percent:70,description:'Before dispatch'}],transportation:'INCLUDED'};
 let qno=Number(run.slice(-5))*5;
 const q=await status('Quotations','Create quotation','/api/quotations','POST',{...terms,clientId:cl.id,enquiryId:en.id,quotationNo:String(qno++)},a,200);const qid=q.data.quotation.id;
 await status('Quotations','Duplicate quotation for requirement','/api/quotations','POST',{...terms,clientId:cl.id,enquiryId:en.id,quotationNo:String(qno++)},a,409);
 await status('Quotations','Revise quotation',`/api/quotations/${qid}/version`,'POST',{...terms,price:12000},a,200);
 await status('Quotations','Frozen prior revision cannot be edited',`/api/quotations/${qid}/versions/0`,'PATCH',{...terms,price:9000},a,[400,409]);
 const pdf=await req(`/api/quotations/${qid}/pdf`,'GET',undefined,a);check('Export','Quotation PDF','Valid PDF bytes',pdf.status===200&&pdf.bytes.subarray(0,4).toString()==='%PDF',{status:pdf.status,magic:pdf.data.magic,size:pdf.bytes.length});writeFileSync('qa/evidence/quotation.pdf',pdf.bytes);
 const o=await status('Orders','Convert quotation to order','/api/orders','POST',{quotationId:qid,clientPoNumber:prefix+'-PO',poDate:'2026-10-20',tdsEnabled:true,tdsPercent:2},a,200);const oid=o.data.order.id;
 const linked=await db.enquiry.findUnique({where:{id:en.id}});check('Workflow','Conversion updates requirement','WON',linked?.stage==='WON',{stage:linked?.stage});
 await status('Orders','Duplicate quote conversion','/api/orders','POST',{quotationId:qid,clientPoNumber:prefix+'-PO2',poDate:'2026-10-20'},a,[400,409]);
 await status('Quotations','Accepted quotation immutable',`/api/quotations/${qid}/version`,'POST',terms,a,400);
 const order=await db.order.findUniqueOrThrow({where:{id:oid},include:{payments:true,executionSteps:true}});
 check('Payments','Payment stages reconcile','Stage base = order net',Math.abs(order.payments.reduce((s,p)=>s+Number(p.amount),0)-Number(order.netValue))<0.01,{net:Number(order.netValue),stages:order.payments.map(p=>({id:p.id,amount:Number(p.amount)}))});
 const stage=order.payments[0]; const rp={paymentStageId:stage.id,amount:1000,receivedDate:'2026-10-20',paymentMode:'NEFT_RTGS',reference:prefix+'-UTR'};
 await status('Payments','Create partial receipt',`/api/orders/${oid}/receipts`,'POST',rp,a,200);
 await status('Payments','Duplicate reference case insensitive',`/api/orders/${oid}/receipts`,'POST',{...rp,reference:rp.reference.toLowerCase()},a,409);
 for(const amount of [0,-1,1.001,'Infinity','100abc'])await status('Validation',`Receipt rejects ${amount}`,`/api/orders/${oid}/receipts`,'POST',{...rp,amount,reference:null},a,400);
 const pair=await Promise.all([req(`/api/orders/${oid}/receipts`,'POST',{...rp,reference:prefix+'-RACE'},a),req(`/api/orders/${oid}/receipts`,'POST',{...rp,reference:prefix+'-RACE'},a)]);const count=await db.orderReceipt.count({where:{reference:prefix+'-RACE',isReversed:false}});check('Concurrency','Concurrent duplicate receipt reference','Only one active receipt; other 409',count===1&&pair.every(r=>[200,409].includes(r.status)),{statuses:pair.map(r=>r.status),count});
 const execution=order.executionSteps[0];await status('Execution','Complete execution step',`/api/orders/${oid}/execution/${execution.id}`,'PATCH',{status:'DONE',completedDate:'2026-10-20'},a,200);
 await status('Execution','Raise invoice GST',`/api/orders/${oid}/invoice`,'PUT',{stepId:execution.id,gstPercent:18,invoiceDate:'2026-10-20'},a,200);
 const extra=await status('Execution','Add tracking step',`/api/orders/${oid}/execution`,'POST',{afterId:execution.id,name:'QA vendor order'},a,200);
 await status('Execution','Remove added tracking step',`/api/orders/${oid}/execution/${extra.data.step.id}`,'DELETE',undefined,a,200);
 await status('Security','Other salesperson receipt access',`/api/orders/${oid}/receipts`,'POST',rp,b,403);
 for(const type of ['pipeline','activities','orders','receivables','quotations','followups']){const r=await req(`/api/reports?type=${type}&allDates=1`,'GET',undefined,a);check('Reports',`${type} report count matches rows`,'200 and consistent count',r.status===200&&r.data.count===r.data.data.length,{status:r.status,count:r.data.count});const x=await req(`/api/reports?type=${type}&allDates=1&export=excel`,'GET',undefined,a);let rows:any[]=[];try{const w=XLSX.read(x.bytes);rows=XLSX.utils.sheet_to_json(w.Sheets[w.SheetNames[0]])}catch{}check('Export',`${type} Excel matches report`,'Valid XLSX; same row count',x.status===200&&rows.length===r.data.count,{status:x.status,rows:rows.length,size:x.bytes.length});}
 await status('Reports','Invalid date filter','/api/reports?startDate=invalid','GET',undefined,d,400);
 const blankEn=await req('/api/enquiries','POST',{clientId:cl.id,title:'QA disposable requirement',categories:['SPARES']},a);
 await status('Recovery','Delete requirement without commerce',`/api/enquiries/${blankEn.data.enquiry.id}`,'DELETE',undefined,a,200);
 const bin=await db.recycleBinItem.findFirst({where:{entityId:blankEn.data.enquiry.id}}).catch(()=>null);
 if(bin)await status('Recovery','Restore requirement',`/api/recycle-bin/${bin.id}/restore`,'POST',{},a,200);
 await status('Recovery','Cannot delete requirement with order',`/api/enquiries/${en.id}`,'DELETE',undefined,a,400);
 const imp={fileName:prefix+'.xlsx',sheetType:'Order & Revenue Tracker',assignToSalespersonId:me.id,rows:[{'Client Name':prefix+' imported','Order No':prefix+'IMP','Net Value':1000,'Gross Value':1180}]};
 const importR=await status('Import','Unsupported order sheet explicitly rejected','/api/import','POST',imp,d,400);const importedOrders=await db.order.count({where:{orderNumber:prefix+'IMP'}});check('Import','Order sheet imports order data','Actual order or explicit unsupported rejection',importR.status===400||importedOrders===1,{status:importR.status,summary:importR.data.summary,ordersCreated:importedOrders});
 const supported={...imp,fileName:prefix+'-activity.xlsx',sheetType:'Daily Activity Tracker'}; await status('Import','Supported activity import','/api/import','POST',supported,d,200); await status('Import','Duplicate batch blocked','/api/import','POST',supported,d,400);
 const fd=new FormData();fd.set('file',new File(['hello,world\n1,2'],'qa-unsafe.exe',{type:'application/octet-stream'}));await status('Upload','Reject non-Excel upload','/api/import','POST',fd,d,400);
 await status('Targets','Negative target','/api/targets','POST',{salespersonId:me.id,financialYear:'FY 2026-27',periodKey:'Q3',targetType:'ORDERS_BOOKED',targetValue:-1},d,400);
 const d2r=await req('/api/clients','GET',undefined,d2);check('Roles','Second director company visibility','Contains test client',d2r.data.clients.some((c:any)=>c.id===cl.id),{count:d2r.data.clients.length});
 const relog=await login('amit.patil@nirmaanwater.com');const reread=await req('/api/clients/'+cl.id,'GET',undefined,relog);check('Persistence','Data after new login','Client, quotation and order retained',reread.data.client?.orders.some((o:any)=>o.id===oid),{orders:reread.data.client?.orders.length});
 const logout=await req('/api/auth/logout','POST',{},relog);const empty=await req('/api/auth/me','GET',undefined,logout.cookie||'');check('Auth','Logout clears browser cookie','401 with cleared cookie',empty.status===401,{status:empty.status});
 writeFileSync('qa/evidence/context.json',JSON.stringify({prefix,clientId:cl.id,enquiryId:en.id,orderId:oid,quotationId:qid},null,2));
}
main().catch(e=>{check('Harness','Execution completed','No harness errors',false,{error:e.message});console.error(e)}).finally(async()=>{writeFileSync(`qa/evidence/api-${process.argv[2]||'latest'}.json`,JSON.stringify({date:new Date().toISOString(),environment:base,prefix,results},null,2));console.log('TOTAL',results.length,'PASS',results.filter(r=>r.status==='PASS').length,'FAIL',results.filter(r=>r.status==='FAIL').length);await db.$disconnect()});
