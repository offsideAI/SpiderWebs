import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger, resolveLogLevel } from '../src/index.js';

class MemorySink extends Writable {
  data = '';

  override _write(chunk: Buffer, _enc: string, cb: () => void): void {
    this.data += chunk.toString();
    cb();
  }

  lines(): Record<string, unknown>[] {
    return this.data
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  }
}

describe('resolveLogLevel', () => {
  it('maps flags to levels', () => {
    expect(resolveLogLevel({})).toBe('info');
    expect(resolveLogLevel({ verbose: true })).toBe('debug');
    expect(resolveLogLevel({ quiet: true })).toBe('error');
    expect(resolveLogLevel({ quiet: true, verbose: true })).toBe('error'); // quiet wins
  });
});

describe('createLogger', () => {
  it('writes structured JSON to the given destination', () => {
    const sink = new MemorySink();
    const logger = createLogger({ destination: sink, pretty: false });
    logger.info({ stage: 'deps' }, 'stage complete');
    const [line] = sink.lines();
    expect(line).toMatchObject({ msg: 'stage complete', stage: 'deps' });
  });

  it('redacts token-shaped properties (defense in depth)', () => {
    const sink = new MemorySink();
    const logger = createLogger({ destination: sink, pretty: false });
    logger.info(
      { token: 'ghp_secret123', request: { apiKey: 'sk-ant-xyz', authorization: 'Bearer abc' } },
      'request',
    );
    expect(sink.data).not.toContain('ghp_secret123');
    expect(sink.data).not.toContain('sk-ant-xyz');
    expect(sink.data).not.toContain('Bearer abc');
    expect(sink.data).toContain('[REDACTED]');
  });

  it('suppresses info logs in quiet mode', () => {
    const sink = new MemorySink();
    const logger = createLogger({ destination: sink, pretty: false, quiet: true });
    logger.info('not shown');
    logger.error('shown');
    const lines = sink.lines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ msg: 'shown' });
  });
});
