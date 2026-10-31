import assert from 'node:assert/strict';
import { requestImageQuestion } from '../src/services/api/image';
import { relayChatScript, deepseekAgentChatScript } from '../src/services/api/relay-chat';
import { defaultConfig, encodeChannelModel, type AiConfig } from '../src/stores/use-config-store';
import { centerAssistantNodes } from '../src/lib/canvas/assistant-node-layout';
import { registerBuiltinNodes } from '../src/components/canvas/nodes/builtin-nodes';
import { getNodeSpec } from '../src/lib/canvas/node-registry';
import type { CanvasAgentOp } from '../src/lib/canvas/canvas-agent-ops';
registerBuiltinNodes();
const base=(name:string,script?:string):AiConfig=>({...defaultConfig,proxyEnabled:false,model:encodeChannelModel('official',name),reasoningEffort:'high',channels:[{id:'official',name:'stub official',baseUrl:'https://official.test',apiKey:'stub-only',apiFormat:'openai',models:[{name,capability:'text',...(script?{script}: {})}]}]});
const requests:any[]=[];let streaming=false, fail=false;
const originalFetch=globalThis.fetch;
globalThis.fetch=(async(url,options)=>{
 assert.equal(String(url),'https://official.test/v1/chat/completions');
 requests.push(JSON.parse(String(options?.body)));
 if(fail)return new Response(JSON.stringify({error:{message:'stub failure'}}),{status:400});
 const content=JSON.stringify({tool:'final',args:{message:'done'}});
 if(!streaming)return new Response(JSON.stringify({choices:[{message:{content}}]}),{headers:{'content-type':'application/json'}});
 const stream='data: '+JSON.stringify({choices:[{delta:{reasoning_content:'ignore reasoning'}}]})+'\r\n\r\n'+[...content].map(content=>'data: '+JSON.stringify({choices:[{delta:{content}}]})+'\r\n\r\n').join('')+'data: [DONE]\r\n\r\n';
 return new Response(new ReadableStream({start(c){const bytes=new TextEncoder().encode(stream);for(let i=0;i<bytes.length;i+=7)c.enqueue(bytes.slice(i,i+7));c.close();}}),{headers:{'content-type':'text/event-stream'}});
}) as typeof fetch;
async function main(){
 assert.notEqual(deepseekAgentChatScript,relayChatScript);assert(!deepseekAgentChatScript.includes('reasoning_effort'));
 for(const name of ['deepseek-flash','deepseek-v4-flash','deepseek-v4-flash-vision-exp','deepseek-v4.1-flash-1017']){
  streaming=!streaming;const deltas:string[]=[];
  const result=await requestImageQuestion(base(name),[{role:'user',content:'Return JSON'}],s=>deltas.push(s),{agent:true});
  assert.equal(JSON.parse(result).tool,'final');assert.equal(deltas.at(-1),result);
  assert.deepEqual(requests.at(-1).thinking,{type:'disabled'});assert.deepEqual(requests.at(-1).response_format,{type:'json_object'});assert.equal(requests.at(-1).model,name);assert(!('reasoning_effort'in requests.at(-1)));
 }
 await requestImageQuestion(base('deepseek-flash',relayChatScript),[{role:'user',content:'JSON'}],()=>{}, {agent:true});assert(requests.at(-1).thinking);
 await requestImageQuestion(base('deepseek-flash',relayChatScript),[{role:'user',content:'hello'}],()=>{});assert.equal(requests.at(-1).thinking,undefined);assert.equal(requests.at(-1).reasoning_effort,'high');
 await requestImageQuestion(base('gpt-other',relayChatScript),[{role:'user',content:'JSON'}],()=>{}, {agent:true});assert.equal(requests.at(-1).thinking,undefined);
 const before=requests.length;
 assert.equal(await requestImageQuestion(base('deepseek-flash','return "CUSTOM_UNCHANGED";'),[{role:'user',content:'JSON'}],()=>{}, {agent:true}),'CUSTOM_UNCHANGED');assert.equal(requests.length,before);
 fail=true;await assert.rejects(requestImageQuestion(base('deepseek-flash'),[{role:'user',content:'JSON'}],()=>{}, {agent:true}),/stub failure/);assert.equal(requests.length,before+1,'no hidden retry');
 const aborted=new AbortController();aborted.abort();await assert.rejects(requestImageQuestion(base('deepseek-flash'),[],()=>{},{agent:true,signal:aborted.signal}));assert.equal(requests.length,before+1);
 const center={x:3000,y:-700};
 const types=['text','image','video','audio','dxos:table','dxos:llm','dxos:concurrent'];
 const additions:CanvasAgentOp[]=types.map((nodeType,i)=>({type:'add_node',id:String(i),nodeType,position:{x:0,y:0}}));
 const moved=centerAssistantNodes(additions,center,[]) as Array<Extract<CanvasAgentOp,{type:'add_node'}>>;
 const bounds={left:Math.min(...moved.map(o=>o.position.x)),top:Math.min(...moved.map(o=>o.position.y)),right:Math.max(...moved.map(o=>o.position.x+getNodeSpec(o.nodeType).width)),bottom:Math.max(...moved.map(o=>o.position.y+getNodeSpec(o.nodeType).height))};
 assert.equal((bounds.left+bounds.right)/2,center.x);assert.equal((bounds.top+bounds.bottom)/2,center.y);
 for(let i=0;i<moved.length;i++)for(let j=i+1;j<moved.length;j++){const a=moved[i],b=moved[j],as=getNodeSpec(a.nodeType),bs=getNodeSpec(b.nodeType);assert(a.position.x+as.width<=b.position.x||b.position.x+bs.width<=a.position.x||a.position.y+as.height<=b.position.y||b.position.y+bs.height<=a.position.y);}
 const source={id:'source',type:'text',position:{x:center.x-150,y:center.y-100},width:300,height:200};const original=JSON.stringify(source);
 const next=centerAssistantNodes([additions[1]],center,[source as any])[0] as Extract<CanvasAgentOp,{type:'add_node'}>;const spec=getNodeSpec('image');
 assert(next.position.x+spec.width<=source.position.x||source.position.x+source.width<=next.position.x||next.position.y+spec.height<=source.position.y||source.position.y+source.height<=next.position.y);assert.equal(JSON.stringify(source),original);
 assert.deepEqual(centerAssistantNodes([],center,[]),[]);
 console.log('PASS DeepSeek Agent-only JSON/non-thinking, SSE, channel isolation, custom script, ordinary/GPT unchanged, abort/no retry; live-center grid and overlap avoidance');
}
main().then(()=>{globalThis.fetch=originalFetch;process.exit(0)}).catch(e=>{console.error(e);globalThis.fetch=originalFetch;process.exit(1)});