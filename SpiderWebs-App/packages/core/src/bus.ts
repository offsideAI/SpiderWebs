import type { RunEvent, RunEventOf, RunEventType } from '@spiderwebs/schema';
import { RunEventSchema } from '@spiderwebs/schema';

export type Unsubscribe = () => void;
type AnyHandler = (event: RunEvent) => void;

/** Thrown when an emitted event does not conform to `RunEventSchema`. */
export class InvalidEventError extends Error {
  override name = 'InvalidEventError';
}

/**
 * The single typed event bus (PRD §7.2). The TUI and the headless/JSON
 * renderers subscribe to the same stream, keeping all output consistent.
 *
 * Emission is synchronous and validated; a throwing subscriber never
 * prevents delivery to the others.
 */
export class EventBus {
  readonly #byType = new Map<RunEventType, Set<AnyHandler>>();
  readonly #any = new Set<AnyHandler>();

  on<T extends RunEventType>(type: T, handler: (event: RunEventOf<T>) => void): Unsubscribe {
    let handlers = this.#byType.get(type);
    if (!handlers) {
      handlers = new Set();
      this.#byType.set(type, handlers);
    }
    handlers.add(handler as AnyHandler);
    return () => handlers.delete(handler as AnyHandler);
  }

  onAny(handler: AnyHandler): Unsubscribe {
    this.#any.add(handler);
    return () => this.#any.delete(handler);
  }

  emit(event: RunEvent): void {
    const validation = RunEventSchema.safeParse(event);
    if (!validation.success) {
      throw new InvalidEventError(
        `refusing to emit malformed "${String((event as { type?: unknown }).type)}" event: ${validation.error.message}`,
      );
    }

    const errors: unknown[] = [];
    const handlers = [...(this.#byType.get(event.type) ?? []), ...this.#any];
    for (const handler of handlers) {
      try {
        handler(event);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, `${errors.length} event handler(s) failed`);
    }
  }
}
