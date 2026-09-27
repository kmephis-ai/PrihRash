import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const agents = await readFile('AGENTS.md', 'utf8');
const sprint = await readFile('docs/R1_COMPLETION_SPRINT.md', 'utf8');

test('standing Owner delegation covers autonomous R1 decisions only until the completion target', () => {
  assert.match(agents, /Standing Owner delegation through R1 completion|Постоянная делегация Owner до завершения R1/);
  assert.match(agents, /Owner делегирует агенту автономно принимать и выполнять все repository\/process\/provider решения/);
  assert.match(agents, /Не запрашивать Owner confirmation для каждого следующего causal гипотезы/);
  assert.match(agents, /Standing delegation.*read-only probes без нового per-probe Owner confirmation/s);
  assert.match(agents, /нового exact SHA и новой repository causal\s+гипотезы\/diagnostic discriminator/);
  assert.match(agents, /Повтор неизменённого query\/кода, same-SHA replay или telemetry-only blind\s+replay запрещены/);
  assert.match(agents, /делегация не включает CUTOVER, timer activation, YDB-authoritative production Writer/);
  assert.match(agents, /retires после доказанного initial/);

  assert.match(sprint, /## Постоянная делегация Owner до завершения R1/);
  assert.match(sprint, /Не запрашивать Owner confirmation/);
  assert.match(sprint, /не обходит `AGENTS\.md`, `MIGRATION_CONTRACT`/);
  assert.match(sprint, /неизвестное состояние остаётся неизвестным/i);
  assert.match(sprint, /timer activation/);
  assert.match(sprint, /Она\s+завершается только после доказательства R1 baseline/);
  assert.match(sprint, /без новых Owner confirmation продолжать bounded read-only diagnostic/);
  assert.match(sprint, /Same-SHA или неизменённый query повторять запрещено/);
  assert.match(sprint, /Read-only probes\s+не увеличивают write-attempt circuit/);
});
