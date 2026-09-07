import { createHash } from 'node:crypto';
import type { FullSourceSnapshotDigest } from './fullSourceSnapshot.js';
import type { CanonicalSourceRowDigest } from '../../migration/googleSnapshotProjection.js';

function sha256Utf8(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export interface CanonicalSourceDigest
  extends FullSourceSnapshotDigest, CanonicalSourceRowDigest {}

export function createCanonicalSourceDigest(): Readonly<CanonicalSourceDigest> {
  return Object.freeze({
    digestCanonicalSnapshot(canonicalSnapshot: string): string {
      return sha256Utf8(canonicalSnapshot);
    },
    digestCanonicalRow(canonicalRow: string): string {
      return sha256Utf8(canonicalRow);
    },
  });
}
