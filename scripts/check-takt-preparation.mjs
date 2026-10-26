import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { verifyPatchedRuntime } from './takt-local-patch.mjs';
const pkg=verifyPatchedRuntime(process.argv[2]);
const {executeTaskWorkflow}=await import(pathToFileURL(join(pkg,'dist/features/tasks/execute/taskWorkflowExecution.js')));
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
 console.log('Real task workflow: worker cwd prepared before executor, resume prepares again, failed preparation prevents model execution; no network or model used.');
} finally {rmSync(root,{recursive:true,force:true});}
