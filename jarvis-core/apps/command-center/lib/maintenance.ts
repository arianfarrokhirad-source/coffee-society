// Maintenance constants.
//
// Not in app/actions/maintenance.ts: a 'use server' module may only
// export async functions, so a constant exported from there breaks the
// production build while Vitest happily passes.

/** The schema's own check constraint, mirrored so the UI cannot drift. */
export const MAINTENANCE_STATUSES = ['active', 'paused', 'cancelled'] as const

export type MaintenanceStatus = (typeof MAINTENANCE_STATUSES)[number]

/**
 * Stages at which a website project is finished enough to maintain.
 *
 * `deployed` is the honest trigger — you cannot maintain a site that is
 * not live. `closed` is included because a project archived after launch
 * is still a live site with an ongoing relationship.
 */
export const MAINTAINABLE_PROJECT_STAGES = ['deployed', 'closed'] as const
