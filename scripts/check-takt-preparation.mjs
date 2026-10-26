import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { verifyPatchedRuntime } from './takt-local-patch.mjs';
const pkg=verifyPatchedRuntime(process.argv[2]);
const {executeTaskWorkflow}=await import(pathToFileURL(join(pkg,'dist/features/tasks/execute/taskWorkflowExecution.js')));
const {resolveTaskExecution}=await import(pathToFileURL(join(pkg,'dist/features/tasks/execute/resolveTask.js')));
const {buildTraceTaskMetadata}=await import(pathToFileURL(join(pkg,'dist/features/tasks/execute/traceTaskMetadata.js')));
const root=mkdtempSync(join(tmpdir(),'real-takt-prepare-'));
try {
 const main=join(root,'main'),worker=join(root,'worker');mkdirSync(main);
 const git=args=>execFileSync('git',args,{cwd:main,stdio:'pipe'});
 git(['init']);git(['config','user.email','fixture@example.invalid']);git(['config','user.name','Fixture']);
 mkdirSync(join(main,'scripts'));mkdirSync(join(main,'app'));mkdirSync(join(main,'.takt/workflows'),{recursive:true});
 writeFileSync(join(main,'scripts/app-command.sh'),'#!/bin/bash\nset -eu\necho "$1" >> prepared-operations\n[[ ! -f fail-prepare ]]\n');
 for(const file of ['package.json','package-lock.json'])writeFileSync(join(main,'app',file),'{}');
 writeFileSync(join(main,'.takt/workflows/mediquest-app.yaml'),'name: mediquest-app\nmax_steps: 12\ninitial_step: implement\nsteps:\n  - name: implement\n    instruction: fixture\n    rules:\n      - condition: done\n        next: COMPLETE\n');
 git(['add','.']);git(['commit','-m','fixture']);git(['worktree','add',worker,'-b','worker']);
 let invoked=0;
 const options={task:'fixture',cwd:worker,projectCwd:main,workflowIdentifier:'mediquest-app'};
 for(const resume of [{},{startStep:'implement',directResume:true}]) {
  await executeTaskWorkflow({...options,...resume},async()=>{invoked++;assert.equal(readFileSync(join(worker,'prepared-operations'),'utf8').trim().split('\n').length,invoked*2);return {success:true};});
 }
 assert.equal(invoked,2);
 writeFileSync(join(worker,'fail-prepare'),'');
 await assert.rejects(executeTaskWorkflow({...options,startStep:'implement'},async()=>assert.fail('model called after failed preparation')),/host_preparation_failed/);
 // Exercise TAKT's actual resolver, not a hand-created linked worktree.
 git(['branch','codex/clone-fixture']);
 const task={name:'clone-fixture',slug:'clone-fixture',content:'fixture',status:'pending',data:{workflow:'mediquest-app',worktree:true,branch:'codex/clone-fixture',base_branch:'main'}};
 const resolved=await resolveTaskExecution(task,main);
 const clone=realpathSync(resolved.execCwd);
 assert.notEqual(realpathSync(execFileSync('git',['rev-parse','--path-format=absolute','--git-common-dir'],{cwd:clone,encoding:'utf8'}).trim()),realpathSync(join(main,'.git')));
 assert.equal(existsSync(join(clone,'.git/objects/info/alternates')),false);
 assert.equal(execFileSync('git',['remote'],{cwd:clone,encoding:'utf8'}).trim(),'');
 const optionsFor=(r)=>({task:'fixture',cwd:r.execCwd,projectCwd:main,workflowIdentifier:r.workflowIdentifier,startStep:r.startStep,traceTaskMetadata:buildTraceTaskMetadata({task,branch:r.branch,worktreePath:r.worktreePath})});
 let cloneCalls=0;
 const executor=async()=>{cloneCalls++;assert.equal(readFileSync(join(clone,'prepared-operations'),'utf8').trim().split('\n').length,cloneCalls*2);return {success:true};};
 await executeTaskWorkflow(optionsFor(resolved),executor);
 const resumed=await resolveTaskExecution({...task,status:'failed',worktreePath:clone,data:{...task.data,start_step:'implement',retry_note:'fixture retry'}},main);
 assert.equal(realpathSync(resumed.execCwd),clone);
 await executeTaskWorkflow(optionsFor(resumed),executor);
 assert.equal(cloneCalls,2);
 const expectReject=async overrides=>assert.rejects(executeTaskWorkflow({...optionsFor(resumed),...overrides},async()=>assert.fail('untrusted clone reached executor')),/host_preparation_failed/);
 await expectReject({traceTaskMetadata:undefined});
 await expectReject({traceTaskMetadata:{gitBranch:'codex/wrong',worktreePath:clone}});
 await expectReject({traceTaskMetadata:{gitBranch:'codex/clone-fixture',worktreePath:worker}});
 const metadata=join(main,'.takt/clone-meta/codex--clone-fixture.json');
 const originalMeta=readFileSync(metadata,'utf8');
 writeFileSync(metadata,JSON.stringify({branch:'codex/clone-fixture',clonePath:worker}));await expectReject({});
 writeFileSync(metadata,originalMeta);
 // Same repository content / branch is insufficient without a manager registration.
 const unrelated=join(root,'unregistered');execFileSync('git',['clone','--no-hardlinks',main,unrelated],{stdio:'pipe'});
 execFileSync('git',['checkout','codex/clone-fixture'],{cwd:unrelated,stdio:'pipe'});
 await expectReject({cwd:unrelated,traceTaskMetadata:{gitBranch:'codex/clone-fixture',worktreePath:unrelated}});
 assert.equal(existsSync(join(unrelated,'prepared-operations')),false);
 // Even a registration cannot authorize a location outside the configured clone base.
 writeFileSync(metadata,JSON.stringify({branch:'codex/clone-fixture',clonePath:unrelated}));
 await expectReject({cwd:unrelated,traceTaskMetadata:{gitBranch:'codex/clone-fixture',worktreePath:unrelated}});
 writeFileSync(metadata,originalMeta);
 writeFileSync(join(clone,'fail-prepare'),'');await expectReject({});
 console.log('Actual resolveTaskExecution isolated clone + retry accepted; missing/mismatched task metadata, manager registration, unrelated clone and outside base rejected before executor.');
 console.log('Real task workflow: worker cwd prepared before executor, resume prepares again, failed preparation prevents model execution; no network or model used.');
} finally {rmSync(root,{recursive:true,force:true});}
