import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
test('judge-facing implement/fix rules distinguish host-ready from quality success and genuine blockers', () => {
  const yaml = readFileSync(new URL('../.takt/workflows/mediquest-app.yaml', import.meta.url), 'utf8');
  for (const name of ['implement', 'fix']) {
    const step = yaml.split(`  - name: ${name}\n`)[1].split(/\n  - name: /)[0];
    assert.match(step, /condition: .*host全7.*引継ぎ可能。sandbox制約やhost検証待ちはこの条件に含む（品質成功の宣言ではない）\n        next: review/);
    assert.match(step, /condition: .*自体が進行不能.*仕様判断.*認証対応.*sandbox制約やhost検証待ちだけでは該当しない\n        next: ABORT/);
    assert.match(step, /command: bash scripts\/app-command.sh host-quality\n/);
    assert.match(step, /timeout_ms: 2400000/);
  }
  assert.match(yaml, /max_steps: 12/);
  assert.match(yaml.split('  - name: review\n')[1], /edit: false/);
});
