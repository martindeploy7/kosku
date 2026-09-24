/* A process-wide data revision. Every write bumps it; browsers poll
 * /api/sync and refetch only when it moved. Single-instance deployment, so
 * in-memory is sufficient — a restart changes the seed, which just triggers
 * one refetch everywhere. */

let rev = Date.now()

export function bumpRev() {
  rev += 1
  return rev
}

export const currentRev = () => rev
