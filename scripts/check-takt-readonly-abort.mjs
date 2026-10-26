import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { verifyPatchedRuntime } from './takt-local-patch.mjs';
const pkg = verifyPatchedRuntime(process.argv[2]);
const { runWorkflowToCompletion, runSingleWorkflowIteration } = await import(pathToFileURL(join(pkg, 'dist/core/workflow/engine/WorkflowRunLoop.js')));
function scenario(edit, failure, embedded) {
  let runs = 0, gates = 0, snapshots = 0;
  const step = { name: 'fixture', edit, persona: 'fixture', rules: [], qualityGates: [] };
  const state = { status: 'running', iteration: 0, currentStep: step.name, stepIterations: new Map(), stepOutputs: new Map() };
  const response = { status: 'done', matchedRuleIndex: 0, content: 'fixture', persona: 'fixture', timestamp: new Date() };
  const fail = { ...response, content: 'fixture failure evidence' };
  const deps = {
    state, options: {}, getWorkflowName: () => 'fixture', getCurrentWorkflowStack: () => [], getCwd: () => process.cwd(), getMaxSteps: () => 4, getReportDir: () => '', abortRequested: () => false, getStep: () => step,
    applyRuntimeEnvironment() {}, loopDetectorCheck: () => ({ count: 0, isLoop: false }), cycleDetectorRecordAndCheck: () => ({ triggered: false }),
    resolveDoneTransition: () => ({ nextStep: 'COMPLETE' }), runLoopMonitorJudge: async () => 'ABORT',
    runStep: async () => { runs++; return { response, instruction: '', ...(embedded && failure && runs === 1 ? { qualityGateFailure: { response: fail, stepIteration: 1 } } : {}) }; },
    runQualityGates: async () => { gates++; return failure && !embedded && gates === 1 ? { ok: false, response: fail } : { ok: true }; },
    persistPreviousResponseSnapshot(_state, _step, _iteration, content) { snapshots++; assert.equal(content, fail.content); },
    buildInstruction: () => '', buildPhase1Instruction: () => '', resolveStepProviderModel: () => ({ provider: 'claude' }), resolveRuntimeForStep: () => undefined, setActiveStep() {}, addUserInput() {}, emit() {}, updateMaxSteps() {},
  };
  return { deps, counts: () => ({ runs, gates, snapshots }) };
}
for (const embedded of [false, true]) {
  for (const edit of [false, true, undefined]) {
    for (const single of [false, true]) {
      const { deps, counts } = scenario(edit, true, embedded);
      const result = await (single ? runSingleWorkflowIteration(deps) : runWorkflowToCompletion(deps));
      assert.equal(counts().snapshots, 1, 'failure evidence must survive');
      if (edit === false) {
        assert.equal(deps.state.status, 'aborted');
        assert.match(result.abort.reason, /readonly_quality_gate_failed/);
        assert.equal(counts().runs, 1);
        assert.equal(deps.state.lastOutput.content, 'fixture failure evidence');
      } else if (single) {
        assert.equal(result.isComplete, false);
        assert.equal(result.nextStep, 'fixture');
        const retry = await runSingleWorkflowIteration(deps);
        assert.equal(retry.isComplete, true);
        assert.equal(deps.state.status, 'completed');
      } else {
        assert.equal(deps.state.status, 'completed');
        assert.equal(counts().runs, 2);
      }
    }
  }
}
for (const single of [false, true]) {
  const { deps } = scenario(false, false, false);
  await (single ? runSingleWorkflowIteration(deps) : runWorkflowToCompletion(deps));
  assert.equal(deps.state.status, 'completed');
}
console.log('Patched real TAKT runloop: readonly abort preserves evidence; editable/undefined retry; success completes; continuous and single iteration, direct and nested failure paths passed.');

// Phase3's choice precedes the host gate: preserve a genuine abort even if the gate passes.
for (const nextStep of ['review', 'ABORT']) {
  const { deps, counts } = scenario(true, false, false);
  deps.resolveDoneTransition = () => ({ nextStep });
  const result = await runSingleWorkflowIteration(deps);
  assert.equal(counts().gates, 1);
  assert.equal(result.nextStep, nextStep);
  assert.equal(result.isComplete, nextStep === 'ABORT');
}
{
  const { deps, counts } = scenario(true, true, false);
  deps.resolveDoneTransition = () => ({ nextStep: 'review' });
  const first = await runSingleWorkflowIteration(deps);
  assert.equal(first.nextStep, 'fixture', 'failed host gate must retain implement/fix');
  assert.equal(first.isComplete, false);
  const second = await runSingleWorkflowIteration(deps);
  assert.equal(second.nextStep, 'review', 'only successful host gate releases host-ready work');
  assert.equal(counts().gates, 2);
}
console.log('Preselected ABORT remains ABORT after host success; host-ready proceeds to review only after gate success. Judge semantics remain model-dependent.');

for (const single of [false, true]) {
  const { deps, counts } = scenario(true, true, false);
  let decisions = 0;
  const { WorkflowEngineStepCoordinator } = await import(pathToFileURL(join(pkg, 'dist/core/workflow/engine/WorkflowEngineStepCoordinator.js')));
  deps.getStep().rules = [{ condition: 'cannot implement', next: 'ABORT' }];
  deps.resolveDoneTransition = (step, response) => { decisions++; return WorkflowEngineStepCoordinator.prototype.resolveTransitionFromDone.call({}, step, response); };
  const result = await (single ? runSingleWorkflowIteration(deps) : runWorkflowToCompletion(deps));
  assert.equal(counts().runs, 1);
  assert.equal(counts().snapshots, 1);
  assert.equal(decisions, 1);
  assert.equal(deps.state.status, 'aborted');
  assert.match(result.abort.reason, /explicit_abort_quality_failure/);
}
console.log('Direct gate failure preserves explicit ABORT once, including failure evidence, in both runloop modes.');
