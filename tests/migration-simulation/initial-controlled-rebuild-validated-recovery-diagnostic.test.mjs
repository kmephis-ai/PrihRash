import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyValidatedControlledRebuildStructure,
} from '../../dist/migration/initialControlledRebuildValidatedRecoveryDiagnostic.js';

test('validated controlled rebuild structural classifier is enum-only and fail-closed', () => {
  assert.equal(classifyValidatedControlledRebuildStructure(true, 'ABSENT'), 'VALIDATED_CURRENT_EMPTY_STAGING_ABSENT');
  assert.equal(classifyValidatedControlledRebuildStructure(true, 'EMPTY'), 'VALIDATED_CURRENT_EMPTY_STAGING_EMPTY');
  assert.equal(classifyValidatedControlledRebuildStructure(true, 'NONEMPTY'), 'VALIDATED_CURRENT_EMPTY_STAGING_NONEMPTY');
  assert.equal(classifyValidatedControlledRebuildStructure(false, 'ABSENT'), 'VALIDATED_CURRENT_NONEMPTY_STAGING_ABSENT');
  assert.equal(classifyValidatedControlledRebuildStructure(false, 'PRESENT'), 'VALIDATED_CURRENT_NONEMPTY_STAGING_PRESENT');
  assert.equal(classifyValidatedControlledRebuildStructure(true, 'AMBIGUOUS'), 'VALIDATED_CONTROLLED_STRUCTURE_AMBIGUOUS');
});
