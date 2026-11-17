// 可信引导程序只转发有界 RPC，Worker 的全部系统权限都被关闭。
const encoder = new TextEncoder();
const write = (message) => Deno.stdout.writeSync(encoder.encode(JSON.stringify(message) + "\n"));
const workerSource = `
// 禁止插件自行创建更多 Worker，进程配额只由 Go 宿主分配。
Object.defineProperty(globalThis,'Worker',{value:undefined,writable:false,configurable:false});
const {AsyncLocalStorage}=await import('node:async_hooks');
const scope=new AsyncLocalStorage();
const pending = new Map(); let sequence = 0;
const request = (method,args={}) => new Promise((resolve,reject) => {
 const id=++sequence; pending.set(id,{resolve,reject}); postMessage({type:'rpc',id,method,args,scope:scope.getStore()??0});
});
const sdk=Object.freeze({
 config:()=>request('config'),
 storage:Object.freeze({get:key=>request('storage.get',{key}),set:(key,value)=>request('storage.set',{key,value})}),
 call:(tool,args)=>request('business.call',{tool,args}),
 fetch:(url,credential,options={})=>request('network.fetch',{...options,url,credential}),
 model:messages=>request('models.call',{messages}),
 onDispose:callback=>{if(typeof callback!=='function')throw new Error('Invalid cleanup');cleanups.push(callback)}
});
let instance;
let stopping=false;
const cleanups=[];
onmessage=async({data})=>{
 if(data.type==='response'){const item=pending.get(data.id);if(item){pending.delete(data.id);data.error?item.reject(new Error(data.error)):item.resolve(data.value)};return}
 if(data.type==='dispose'){if(stopping)return;stopping=true;try{if(instance?.dispose)await instance.dispose();for(const cleanup of cleanups.reverse())await cleanup()}finally{postMessage({type:'disposed'})};return}
 if(data.type==='invoke'){try{const value=await scope.run(data.scope,()=>instance.invoke(data.method,data.args));postMessage({type:'result',value:value??null})}catch{postMessage({type:'error'})};return}
 if(data.type!=='start')return;
 try {
  const module=await import('data:text/javascript;base64,'+data.code);
  if(data.method==='__install'||data.method==='__upgrade'){const hook=module[data.method.slice(2)];if(hook)await hook(sdk,data.args);postMessage({type:'result',value:null});return}
  instance=await module.activate(sdk);
  postMessage({type:'ready'});
  if(data.persistent)return;
  const result=await instance.invoke(data.method,data.args);
  if(instance.dispose)await instance.dispose();
  postMessage({type:'result',value:result??null});
 }catch{postMessage({type:'error'})}
};`;
let persistent=false;
const worker = new Worker(URL.createObjectURL(new Blob([workerSource],{type:'text/javascript'})),{type:'module',deno:{permissions:'none'}});
const startup = setTimeout(()=>{write({type:'error'});worker.terminate();Deno.exit(1)},10000);
worker.onmessage=({data})=>{if(data.type==='ready'){clearTimeout(startup);if(persistent)write(data);return}write(data);if(data.type==='error'||data.type==='disposed'||(data.type==='result'&&!persistent)){worker.terminate();Deno.exit(data.type==='error'?1:0)}};
worker.onerror=()=>{write({type:'error'});Deno.exit(1)};
let buffer='';for await(const chunk of Deno.stdin.readable){buffer+=new TextDecoder().decode(chunk);if(buffer.length>1048576)Deno.exit(1);let newline;while((newline=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,newline);buffer=buffer.slice(newline+1);const message=JSON.parse(line);if(message.type==='start')persistent=message.persistent===true;worker.postMessage(message)}}
