import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
export function inspectInheritedSettings(files) {
  const problems = [];
  for (const file of files) {
    if (!existsSync(file)) continue;
    let settings;
    try { settings = JSON.parse(readFileSync(file, 'utf8')); }
    catch { problems.push({ file, reason: 'unreadable settings' }); continue; }
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      problems.push({ file, reason: 'invalid settings' }); continue;
    }
    if (settings.permissions?.allow?.length) problems.push({ file, reason: 'inherited allow rules require review' });
    if (settings.hooks && Object.keys(settings.hooks).length) problems.push({ file, reason: 'inherited hooks require review' });
    const s = settings.sandbox;
    if (s && (s.enabled === false || s.failIfUnavailable === false || s.autoAllowBashIfSandboxed === true || s.allowUnsandboxedCommands === true || s.excludedCommands?.length)) problems.push({ file, reason: 'inherited sandbox relaxation requires review' });
    if (['bypassPermissions', 'auto'].includes(settings.permissions?.defaultMode)) problems.push({ file, reason: 'inherited permission mode requires review' });
  }
  return problems;
}
export function settingsCandidates(root, env = process.env) {
  const config = env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
  return [join(config, 'settings.json'), join(config, 'settings.local.json'), join(root, '.claude/settings.local.json'), process.platform === 'darwin' ? '/Library/Application Support/ClaudeCode/managed-settings.json' : '/etc/claude-code/managed-settings.json'];
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const problems = inspectInheritedSettings(settingsCandidates(resolve(import.meta.dirname, '..')));
  if (problems.length) {
    for (const { file, reason } of problems) console.error(`${reason}: ${file}`);
    process.exitCode = 1;
  } else console.log('No conflicting inherited settings found in known local files; runtime settings merge is not proven.');
}
