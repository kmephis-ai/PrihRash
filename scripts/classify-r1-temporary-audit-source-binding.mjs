import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export function classifyExactReadBinding(response, roleId, serviceAccountId) {
  if (!Array.isArray(response)
    || typeof roleId !== 'string' || roleId.length === 0
    || typeof serviceAccountId !== 'string' || serviceAccountId.length === 0) {
    return 'READ_BINDING_RESPONSE_INVALID';
  }

  let exactMatches = 0;
  for (const binding of response) {
    if (!binding || typeof binding !== 'object' || Array.isArray(binding)) {
      return 'READ_BINDING_RESPONSE_INVALID';
    }
    const bindingRole = binding.role_id ?? binding.roleId;
    const subject = binding.subject;
    if (typeof bindingRole !== 'string' || !subject || typeof subject !== 'object' || Array.isArray(subject)
      || typeof subject.type !== 'string' || typeof subject.id !== 'string') {
      return 'READ_BINDING_RESPONSE_INVALID';
    }
    if (bindingRole === roleId && subject.type === 'serviceAccount' && subject.id === serviceAccountId) {
      exactMatches += 1;
    }
  }

  if (exactMatches > 1) return 'READ_BINDING_AMBIGUOUS';
  return exactMatches === 1 ? 'EXACT_READ_BINDING_PRESENT' : 'EXACT_READ_BINDING_ABSENT';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , bindingsPath, roleId, serviceAccountId] = process.argv;
  if (!bindingsPath || !roleId || !serviceAccountId) {
    process.stdout.write('READ_BINDING_INPUT_INVALID\n');
    process.exitCode = 2;
  } else {
    try {
      const response = JSON.parse(await readFile(bindingsPath, 'utf8'));
      process.stdout.write(`${classifyExactReadBinding(response, roleId, serviceAccountId)}\n`);
    } catch {
      process.stdout.write('READ_BINDING_RESPONSE_INVALID\n');
    }
  }
}
