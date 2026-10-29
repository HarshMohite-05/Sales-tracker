import http from 'node:http';
import {readFileSync} from 'node:fs';
// Local-only test proxy. Failure injection never reaches the real CRM.
http.createServer(async(req,res)=>{
 let config:any={};try{config=JSON.parse(readFileSync('qa/evidence/proxy-config.json','utf8'))}catch{}
 const path=req.url||'/';
 if(path.startsWith('/api/')&&config.path&&path.startsWith(config.path)){
  if(config.delay) await new Promise(r=>setTimeout(r,config.delay));
  if(config.disconnect){req.socket.destroy();return;}
  if(config.status){res.writeHead(config.status,{'content-type':'application/json'});res.end(JSON.stringify({error:'QA simulated unavailable service'}));return;}
 }
 const upstream=http.request({hostname:'127.0.0.1',port:3100,path,method:req.method,headers:{...req.headers,host:'127.0.0.1:3100'}},r=>{res.writeHead(r.statusCode||502,r.headers);r.pipe(res)});
 upstream.on('error',()=>{res.writeHead(503,{'content-type':'application/json'});res.end(JSON.stringify({error:'QA upstream unavailable'}))});req.pipe(upstream);
}).listen(3101,'127.0.0.1',()=>console.log('QA proxy http://127.0.0.1:3101'));
