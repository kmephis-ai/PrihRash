import {
  assessAtomicPromotionWrites,
  type AtomicPromotionPreflightAssessment,
  type PromotionWrite,
} from './atomicPromotion.js';

export type InitialBootstrapPromotionRoute =
  | 'ORDINARY_ATOMIC'
  | 'CONTROLLED_REBUILD_REQUIRED';

export interface InitialBootstrapPromotionPlan {
  readonly route: InitialBootstrapPromotionRoute;
  readonly currentWrites: readonly PromotionWrite[];
  readonly preflight: Readonly<AtomicPromotionPreflightAssessment>;
}

export function planInitialBootstrapPromotion(
  currentWrites: readonly PromotionWrite[],
): Readonly<InitialBootstrapPromotionPlan> {
  const writes = Object.freeze([...currentWrites]);
  const preflight = assessAtomicPromotionWrites(writes);
  return Object.freeze({
    route: preflight.eligible ? 'ORDINARY_ATOMIC' : 'CONTROLLED_REBUILD_REQUIRED',
    currentWrites: writes,
    preflight,
  });
}
