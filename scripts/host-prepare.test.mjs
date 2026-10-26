import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { prepareTaskWorkspace } from './host-prepare.mjs';
export function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'host-prepare-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const main = join(root, 'main'), worker = join(root, 'worker'); mkdirSync(main);
  const git = args => execFileSync('git', args, { cwd: main, stdio: 'pipe' });
  git(['init']); git(['config', 'user.email', 'fixture@example.invalid']); git(['config', 'user.name', 'Fixture']);
  mkdirSync(join(main, 'scripts')); mkdirSync(join(main, 'app'));
  writeFileSync(join(main, 'scripts/app-command.sh'), '#!/bin/bash\nset -eu\nprintf "%s\\n" "$1" >> prepared-operations\n[[ ! -f fail-prepare ]]\n');
  writeFileSync(join(main, 'app/package.json'), '{}'); writeFileSync(join(main, 'app/package-lock.json'), '{}');
  mkdirSync(join(main, '.takt/workflows'), {recursive:true});
  writeFileSync(join(main, '.takt/workflows/mediquest-app.yaml'), 'name: mediquest-app\nmax_steps: 12\ninitial_step: implement\nsteps:\n  - name: implement\n    instruction: fixture\n    rules:\n      - condition: done\n        next: COMPLETE\n');
  git(['add', '.']); git(['commit', '-m', 'fixture']); git(['worktree', 'add', worker, '-b', 'worker']);
  return { main: realpathSync(main), worker: realpathSync(worker) };
}
test('prepares real worker in order on every invocation including changed manifest', async t => {
  const {main, worker} = fixture(t); const calls=[];
  const run=async(root,name) => calls.push([root,name]);
  await prepareTaskWorkspace(main,worker,'mediquest-app',undefined,run);
  writeFileSync(join(worker,'app/package-lock.json'), '{"changed":true}');
  await prepareTaskWorkspace(main,worker,'mediquest-app',undefined,run);
  assert.deepEqual(calls, [[worker,'ci'],[worker,'browser:install'],[worker,'ci'],[worker,'browser:install']]);
});
test('failed preparation, cancellation and changed source never approve', async t => {
  const {main,worker}=fixture(t);let calls=0;
  await assert.rejects(prepareTaskWorkspace(main,worker,'mediquest-app',undefined,async()=>{calls++;throw Error('secret');}), /host_preparation_failed/);
  assert.equal(calls,1);
  await assert.rejects(prepareTaskWorkspace(main,worker,'mediquest-app',AbortSignal.abort(),async()=>{calls++;}), /host_preparation_failed/);
  assert.equal(calls,1);
  await assert.rejects(prepareTaskWorkspace(main,worker,'mediquest-app',undefined,async()=>writeFileSync(join(worker,'app/package.json'),'changed')), /host_preparation_failed/);
});
test('rejects altered launcher, unrelated root, subdirectory and unknown workflow before operations', async t => {
  const {main,worker}=fixture(t);const run=()=>assert.fail('unexpected execution');
  const unrelated=fixture(t);
  await assert.rejects(prepareTaskWorkspace(unrelated.main,worker,'mediquest-app',undefined,run));
  await assert.rejects(prepareTaskWorkspace(main,join(worker,'app'),'mediquest-app',undefined,run));
  await assert.rejects(prepareTaskWorkspace(main,worker,'other',undefined,run));
  writeFileSync(join(worker,'scripts/app-command.sh'),'different');
  await assert.rejects(prepareTaskWorkspace(main,worker,'mediquest-app',undefined,run));
});

test('parallel distinct workspaces prepare independently; browser failure stops', async t => {
 const first=fixture(t), second=fixture(t), calls=[];
 await Promise.all([first,second].map(({main,worker})=>prepareTaskWorkspace(main,worker,'mediquest-app',undefined,async(root,name)=>{calls.push([root,name]);await Promise.resolve();})));
 for(const {worker} of [first,second])assert.deepEqual(calls.filter(([root])=>root===worker).map(([,name])=>name),['ci','browser:install']);
 const failed=[];
 await assert.rejects(prepareTaskWorkspace(first.main,first.worker,'mediquest-app',undefined,async(_,name)=>{failed.push(name);if(name==='browser:install')throw Error('failed');}));
 assert.deepEqual(failed,['ci','browser:install']);
});
