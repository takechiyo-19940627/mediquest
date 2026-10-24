import { createHash } from 'node:crypto';
import { cpSync, existsSync, readFileSync, writeFileSync, realpathSync, constants } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
export const target = 'dist/core/workflow/engine/WorkflowRunLoop.js';
export const originalHash = 'a89e953086592af47b277e52e320df5709f8e373d26c7a4394333e877c78e006';
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
  return source;
}
export function verifyPatchedRuntime(dir) {
  dir = realpathSync(dir);
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json')));
  const marker = JSON.parse(readFileSync(join(dir, '.mediquest-patch.json')));
  if (pkg.name !== 'takt' || pkg.version !== '0.49.0' || marker.originalHash !== originalHash || marker.patch !== 'readonly-quality-abort-v1' || marker.patchedHash !== sha(patchedSource(readFileSync(join(dir, '.mediquest-original-runloop.js'), 'utf8'))) || sha(readFileSync(join(dir, target))) !== marker.patchedHash) throw new Error('Unreviewed local TAKT patch');
  return dir;
}
export function prepareRuntime(sourceDir, destination) {
  sourceDir = realpathSync(sourceDir); destination = resolve(destination);
  if (existsSync(destination) || destination.startsWith(sourceDir + '/')) throw new Error('Destination must be new and outside source');
  const pkg = JSON.parse(readFileSync(join(sourceDir, 'package.json')));
  if (pkg.name !== 'takt' || pkg.version !== '0.49.0') throw new Error('TAKT 0.49.0 required');
  const source = readFileSync(join(sourceDir, target), 'utf8');
  const patched = patchedSource(source);
  cpSync(sourceDir, destination, { recursive: true, dereference: true, mode: constants.COPYFILE_FICLONE });
  writeFileSync(join(destination, target), patched);
  writeFileSync(join(destination, '.mediquest-original-runloop.js'), source);
  writeFileSync(join(destination, '.mediquest-patch.json'), JSON.stringify({ patch: 'readonly-quality-abort-v1', originalHash, patchedHash: sha(patched) }, null, 2));
  return verifyPatchedRuntime(destination);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv[2] === 'verify' && process.argv.length === 4) verifyPatchedRuntime(process.argv[3]);
    else if (process.argv[2] === 'prepare' && process.argv.length === 5) console.log(prepareRuntime(process.argv[3], process.argv[4]));
    else throw new Error('Usage: takt-local-patch.mjs prepare source new-destination | verify installation');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
