import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SourceValueCodecError,
  canonicalizeGoogleNumberValue,
  encodeGoogleExtendedValue,
} from '../../dist/integration/google/sourceValueCodec.js';

test('canonicalizes Google numberValue without locale formatting or arithmetic rounding', () => {
  assert.equal(canonicalizeGoogleNumberValue(123.5), '123.5');
  assert.equal(canonicalizeGoogleNumberValue(-0), '0');
  assert.equal(canonicalizeGoogleNumberValue(1e-7), '0.0000001');
  assert.equal(canonicalizeGoogleNumberValue(1e21), '1000000000000000000000');
});

test('encodes source cell type explicitly and normalizes only safe text representation', () => {
  assert.deepEqual(encodeGoogleExtendedValue(undefined), null);
  assert.deepEqual(encodeGoogleExtendedValue({}), null);
  assert.deepEqual(encodeGoogleExtendedValue({ numberValue: 12.5 }), { kind: 'NUMBER', value: '12.5' });
  assert.deepEqual(
    encodeGoogleExtendedValue({ stringValue: 'synthetic\r\ntext' }),
    { kind: 'STRING', value: 'synthetic\ntext' },
  );
});

test('formula, boolean, malformed union and non-finite number fail closed', () => {
  for (const [input, code] of [
    [{ formulaValue: '=1+1' }, 'FORMULA_SOURCE_CELL_NOT_ALLOWED'],
    [{ boolValue: true }, 'UNSUPPORTED_SOURCE_CELL_VALUE'],
    [{ stringValue: 'x', numberValue: 1 }, 'MULTIPLE_SOURCE_CELL_VALUES'],
    [{ numberValue: Number.POSITIVE_INFINITY }, 'NON_FINITE_SOURCE_NUMBER'],
  ]) {
    assert.throws(
      () => encodeGoogleExtendedValue(input),
      (error) => error instanceof SourceValueCodecError && error.code === code,
    );
  }
});
