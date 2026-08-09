// Delivery constants.
//
// Deliberately NOT in app/actions/delivery.ts: a 'use server' module may
// only export async functions, so exporting a constant from there breaks
// the production build. Vitest does not enforce the directive, so this
// only ever surfaces at build time — which is exactly why it lives here.

/** Stages a team can move through on its own. `deployed` is not one. */
export const INTERNAL_STAGES = ['planning', 'design', 'build', 'review', 'closed'] as const

/** Existing action policy: L4, external, risk high, alwaysApproval. */
export const PUBLISH_ACTION = 'public.publish'
