import type { WorkerCommand } from '../shared/workerProtocol';

/**
 * Command ordering / idempotency gate. Every mutating operator command
 * carries a stable commandId and a strictly increasing commandSeq; duplicate
 * or out-of-order deliveries are rejected instead of re-executed.
 * Pure logic (no worker APIs) so it is unit-testable under Node.
 */
export class CommandGate {
  private lastSeq = -1;
  private readonly seenIds = new Set<string>();

  check(command: WorkerCommand): { ok: true } | { ok: false; errorCode: string } {
    if (this.seenIds.has(command.commandId)) {
      return { ok: false, errorCode: 'duplicate-command-id' };
    }
    if (command.commandSeq <= this.lastSeq) {
      return { ok: false, errorCode: 'stale-or-out-of-order-command' };
    }
    this.lastSeq = command.commandSeq;
    this.seenIds.add(command.commandId);
    return { ok: true };
  }
}
