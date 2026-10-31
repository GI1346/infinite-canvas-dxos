import assert from 'node:assert/strict';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {App,ConfigProvider} from 'antd';
import {CanvasLogsModal} from '../src/components/canvas/canvas-logs-modal';
import {CanvasCleanupModal} from '../src/components/canvas/canvas-cleanup-modal';
import {CanvasTopBar} from '../src/components/canvas/canvas-top-bar';
import {recordDiagnostic,flushDiagnosticLogs} from '../src/services/diagnostics';
const tick=()=>new Promise(r=>setTimeout(r,30));let passed=0;
const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
async function render(child:React.ReactNode){await act(async()=>{root.render(<ConfigProvider virtual={false} theme={{token:{motion:false}}}><App>{child}</App></ConfigProvider>);await tick();});await act(tick);}
async function click(el:Element){await act(async()=>{for(const type of ['pointerdown','mousedown','mouseup','click'])el.dispatchEvent(type==='pointerdown'?new PointerEvent(type,{bubbles:true,button:0}):new MouseEvent(type,{bubbles:true,button:0}));await tick();});}
function check(name:string,fn:()=>unknown){fn();passed++;console.log('PASS '+name);}
async function main(){
 await render(<CanvasLogsModal open onClose={()=>{}}/>);
 check('日志空状态',()=>assert.ok(document.body.textContent?.includes('暂无错误日志')));
 await act(async()=>{recordDiagnostic('画布任务',new Error('离线测试HTTP 413'),{status:413,url:'https://relay.invalid/tasks?token=private'});await flushDiagnosticLogs();await tick();});await act(tick);
 check('弹窗打开后新错误实时可见',()=>assert.ok(document.body.textContent?.includes('离线测试HTTP 413')));
 const header=document.querySelector('.ant-collapse-header')!;assert.ok(header);await click(header);
 check('展开详情、复制按钮与浮层标记',()=>{assert.ok(document.body.querySelector('pre')?.textContent?.includes('relay.invalid/tasks'));assert.ok(!document.body.querySelector('pre')?.textContent?.includes('token=private'));assert.ok([...document.querySelectorAll('button')].some(x=>x.textContent?.includes('复制此条')));assert.ok(document.querySelector('[data-canvas-overlay][data-canvas-no-zoom]'));});
 await render(<CanvasCleanupModal open projectId='fixture' onClose={()=>{}} beforeOperation={()=>()=>{}}/>);
 const labels=[...document.querySelectorAll('label.ant-checkbox-wrapper')];const diagnostic=labels.find(x=>x.textContent?.includes('清理错误日志'))!;assert.ok(diagnostic);
 check('日志为独立且默认未选的清理选项',()=>assert.equal(diagnostic.querySelector<HTMLInputElement>('input')!.checked,false));
 for(const label of labels.filter(x=>x.querySelector<HTMLInputElement>('input')?.checked))await click(label);
 let action=[...document.querySelectorAll('button')].find(x=>x.textContent?.includes('直接清理并刷新'))!;
 check('未选任何项禁用清理',()=>assert.ok(action.disabled));
 await click(diagnostic);action=[...document.querySelectorAll('button')].find(x=>x.textContent?.includes('直接清理并刷新'))!;
 check('仅勾错误日志允许执行',()=>{assert.equal(action.disabled,false);assert.equal(labels.filter(x=>x.querySelector<HTMLInputElement>('input')?.checked).length,1);});
 const no=()=>{};
 const props={title:'test',titleDraft:'test',isTitleEditing:false,onTitleDraftChange:no,onStartTitleEditing:no,onFinishTitleEditing:no,onCancelTitleEditing:no,canUndo:false,canRedo:false,onHome:no,onProjects:no,onCreateProject:no,onDeleteProject:no,onExportProject:no,onImportImage:no,onOpenPlugins:no,onOpenCleanup:no,onOpenGrid:no,onOpenTasks:no,onUndo:no,onRedo:no};
 await render(<CanvasTopBar {...props}/>);await click([...document.querySelectorAll('button')].find(x=>x.textContent==='日志')!);
 check('顶部日志按钮可打开查看窗口',()=>assert.ok(document.querySelector('.ant-modal-title')?.textContent?.includes('错误日志')));
 await act(async()=>root.unmount());console.log('diagnostics-ui: '+passed+' passed');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
