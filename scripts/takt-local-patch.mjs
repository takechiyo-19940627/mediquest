import { createHash } from 'node:crypto';
import { cpSync, existsSync, readFileSync, writeFileSync, realpathSync, constants } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
export const target = 'dist/core/workflow/engine/WorkflowRunLoop.js';
export const originalHash = 'a89e953086592af47b277e52e320df5709f8e373d26c7a4394333e877c78e006';
export const taskTarget = 'dist/features/tasks/execute/taskWorkflowExecution.js';
export const taskOriginalHash = 'c708bf9842f99e680d37bcd3fd30724b2f8e231ebe69553619972b948e9cab09';
const helperSource = () => readFileSync(new URL('./host-prepare.mjs', import.meta.url), 'utf8');
const sha = value => createHash('sha256').update(value).digest('hex');
export function patchedSource(source) {
  if (sha(source) !== originalHash) throw new Error('Unreviewed TAKT runloop hash');
  for (const [indent, single] of [['                ', false], ['        ', true]]) {
    for (const response of ['result.qualityGateFailure.response', 'qualityGateResult.response']) {
      const pattern = `${indent}applyQualityGateFailure(deps, step, `;
      const lines = source.split('\n');
      const matches = lines.flatMap((line, i) => line.startsWith(pattern) && line.endsWith(`${response});`) ? [i] : []);
      if (matches.length !== 1) throw new Error('Patch context mismatch');
      const guard = `${indent}if (step.edit === false) {\n${indent}    const gateAbort = abortWorkflow(deps, 'step_error', '[readonly_quality_gate_failed] Read-only quality gate failed; supervisor repair required');\n${indent}    ${single ? `return { response: ${response}, nextStep: ABORT_STEP, isComplete: true, loopDetected: loopCheck.isLoop, abort: gateAbort };` : 'abort = gateAbort; break;'}\n${indent}}`;
      lines.splice(matches[0] + 1, 0, guard);
      source = lines.join('\n');
    }
  }
  for (const [indent, single] of [['                ', false], ['        ', true]]) {
    const anchor = `\n${indent}applyQualityGateFailure(deps, step, resolveQualityGateSnapshotIteration(deps.state, step, stepIteration), qualityGateResult.response);`;
    const guard = `${indent}if (step.edit !== false && response.status === 'done' && response.matchedRuleIndex != null && deps.resolveDoneTransition(step, response).nextStep === ABORT_STEP) {\n${indent}    const explicitAbort = abortWorkflow(deps, 'step_error', '[explicit_abort_quality_failure] Explicit ABORT preserved after quality failure');\n${indent}    ${single ? 'return { response: qualityGateResult.response, nextStep: ABORT_STEP, isComplete: true, loopDetected: loopCheck.isLoop, abort: explicitAbort };' : 'abort = explicitAbort; break;'}\n${indent}}`;
    if (source.split(anchor).length !== 2) throw new Error('Abort patch context mismatch');
    source = source.replace(anchor, `${anchor}\n${guard}`);
  }
  return source;
}
export function patchedTaskSource(source) {
  if (sha(source) !== taskOriginalHash) throw new Error('Unreviewed TAKT task workflow hash');
  const anchor = "    log.debug('Running workflow', {";
  if (source.split(anchor).length !== 2) throw new Error('Task preparation context mismatch');
  return "import { resolveCloneBaseDir } from '../../../infra/task/index.js';\nimport { prepareTaskWorkspace } from '../../../mediquest-host-prepare.mjs';\n" + source.replace(anchor, "    await prepareTaskWorkspace(projectCwd, cwd, workflowConfig.name, abortSignal, undefined, { ...traceTaskMetadata, cloneBaseDir: resolveCloneBaseDir(projectCwd) });\n" + anchor);
}
export function verifyPatchedRuntime(dir) {
  dir = realpathSync(dir);
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json')));
  const marker = JSON.parse(readFileSync(join(dir, '.mediquest-patch.json')));
  if (pkg.name !== 'takt' || pkg.version !== '0.49.0' || marker.originalHash !== originalHash || marker.patch !== 'host-prepare-clone-provenance-v3' || marker.patchedHash !== sha(patchedSource(readFileSync(join(dir, '.mediquest-original-runloop.js'), 'utf8'))) || sha(readFileSync(join(dir, target))) !== marker.patchedHash) throw new Error('Unreviewed local TAKT patch');
  if (sha(readFileSync(join(dir, taskTarget))) !== sha(patchedTaskSource(readFileSync(join(dir, '.mediquest-original-task-workflow.js'), 'utf8'))) || readFileSync(join(dir, 'dist/mediquest-host-prepare.mjs'), 'utf8') !== helperSource()) throw new Error('Unreviewed task preparation patch');
  return dir;
}
export function prepareRuntime(sourceDir, destination) {
  sourceDir = realpathSync(sourceDir); destination = resolve(destination);
  if (existsSync(destination) || destination.startsWith(sourceDir + '/')) throw new Error('Destination must be new and outside source');
  const pkg = JSON.parse(readFileSync(join(sourceDir, 'package.json')));
  if (pkg.name !== 'takt' || pkg.version !== '0.49.0') throw new Error('TAKT 0.49.0 required');
  const source = readFileSync(join(sourceDir, target), 'utf8');
  const patched = patchedSource(source);
  const taskSource = readFileSync(join(sourceDir, taskTarget), 'utf8');
  const patchedTask = patchedTaskSource(taskSource);
  cpSync(sourceDir, destination, { recursive: true, dereference: true, mode: constants.COPYFILE_FICLONE });
  writeFileSync(join(destination, target), patched);
  writeFileSync(join(destination, taskTarget), patchedTask);
  writeFileSync(join(destination, '.mediquest-original-task-workflow.js'), taskSource);
  writeFileSync(join(destination, 'dist/mediquest-host-prepare.mjs'), helperSource());
  writeFileSync(join(destination, '.mediquest-original-runloop.js'), source);
  writeFileSync(join(destination, '.mediquest-patch.json'), JSON.stringify({ patch: 'host-prepare-clone-provenance-v3', originalHash, patchedHash: sha(patched) }, null, 2));
  return verifyPatchedRuntime(destination);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv[2] === 'verify' && process.argv.length === 4) verifyPatchedRuntime(process.argv[3]);
    else if (process.argv[2] === 'prepare' && process.argv.length === 5) console.log(prepareRuntime(process.argv[3], process.argv[4]));
    else throw new Error('Usage: takt-local-patch.mjs prepare source new-destination | verify installation');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
