import { errMeta, log } from './log'

/**
 * Side effects that must only happen once the database transaction has
 * committed — web push, waking the WhatsApp sender. Services push closures in;
 * the caller runs them after `db.transaction()` resolves. If the transaction
 * rolls back, nothing fires and no one is told about a change that didn't happen.
 */
export class Effects {
  private tasks: Array<() => unknown | Promise<unknown>> = []

  push(task: () => unknown | Promise<unknown>) {
    this.tasks.push(task)
  }

  async run() {
    const tasks = this.tasks
    this.tasks = []
    for (const t of tasks) {
      try {
        await t()
      } catch (e) {
        log.error('Efek pasca-transaksi gagal', errMeta(e))
      }
    }
  }
}
