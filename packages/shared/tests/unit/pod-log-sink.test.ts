/**
 * Tests for PodLogSink
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PodLogSink, createPodLogSink, createPodConsole, type PodLogSinkMeta } from '../../src/logging/pod-log-sink.js';

describe('PodLogSink', () => {
  const testMeta: PodLogSinkMeta = {
    podId: 'pod-123',
    packId: 'pack-abc',
    packVersion: '1.0.0',
    executionId: 'exec-xyz',
  };

  let consoleSpy: {
    log: ReturnType<typeof vi.spyOn>;
    error: ReturnType<typeof vi.spyOn>;
  };

  beforeEach(() => {
    consoleSpy = {
      log: vi.spyOn(console, 'log').mockImplementation(() => {}),
      error: vi.spyOn(console, 'error').mockImplementation(() => {}),
    };
  });

  afterEach(() => {
    consoleSpy.log.mockRestore();
    consoleSpy.error.mockRestore();
  });

  describe('constructor', () => {
    it('creates a sink with metadata', () => {
      const sink = new PodLogSink(testMeta);
      expect(sink.podId).toBe('pod-123');
      expect(sink.isClosed).toBe(false);
    });
  });

  describe('stdout', () => {
    it('writes to console.log with timestamp and pod prefix', () => {
      const sink = new PodLogSink(testMeta);
      sink.stdout('hello world');

      expect(consoleSpy.log).toHaveBeenCalledTimes(1);
      const [prefix, message] = consoleSpy.log.mock.calls[0];
      expect(prefix).toMatch(/^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\]\[pod-123:out\]$/);
      expect(message).toBe('hello world');
    });
  });

  describe('stderr', () => {
    it('writes to console.error with timestamp and pod prefix', () => {
      const sink = new PodLogSink(testMeta);
      sink.stderr('error message');

      expect(consoleSpy.error).toHaveBeenCalledTimes(1);
      const [prefix, message] = consoleSpy.error.mock.calls[0];
      expect(prefix).toMatch(/^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\]\[pod-123:err\]$/);
      expect(message).toBe('error message');
    });
  });

  describe('close', () => {
    it('closes the sink', () => {
      const sink = new PodLogSink(testMeta);
      expect(sink.isClosed).toBe(false);
      
      sink.close();
      expect(sink.isClosed).toBe(true);
    });

    it('drops messages after close', () => {
      const sink = new PodLogSink(testMeta);
      sink.close();

      sink.stdout('should be dropped');
      sink.stderr('should also be dropped');

      expect(consoleSpy.log).not.toHaveBeenCalled();
      expect(consoleSpy.error).not.toHaveBeenCalled();
    });

    it('is idempotent', () => {
      const sink = new PodLogSink(testMeta);
      sink.close();
      sink.close();
      sink.close();

      expect(sink.isClosed).toBe(true);
    });
  });

  describe('createPodLogSink', () => {
    it('creates a new PodLogSink', () => {
      const sink = createPodLogSink(testMeta);
      expect(sink).toBeInstanceOf(PodLogSink);
      expect(sink.podId).toBe('pod-123');
    });
  });
});

describe('createPodConsole', () => {
  const testMeta: PodLogSinkMeta = {
    podId: 'pod-456',
    packId: 'pack-def',
    packVersion: '2.0.0',
    executionId: 'exec-uvw',
  };

  let consoleSpy: {
    log: ReturnType<typeof vi.spyOn>;
    error: ReturnType<typeof vi.spyOn>;
  };

  beforeEach(() => {
    consoleSpy = {
      log: vi.spyOn(console, 'log').mockImplementation(() => {}),
      error: vi.spyOn(console, 'error').mockImplementation(() => {}),
    };
  });

  afterEach(() => {
    consoleSpy.log.mockRestore();
    consoleSpy.error.mockRestore();
  });

  it('routes log to stdout with timestamp', () => {
    const sink = createPodLogSink(testMeta);
    const podConsole = createPodConsole(sink);

    podConsole.log('test message');
    expect(consoleSpy.log).toHaveBeenCalledTimes(1);
    const [prefix, message] = consoleSpy.log.mock.calls[0];
    expect(prefix).toMatch(/^\[\d{4}-\d{2}-\d{2}T.*\]\[pod-456:out\]$/);
    expect(message).toBe('test message');
  });

  it('routes info to stdout with timestamp', () => {
    const sink = createPodLogSink(testMeta);
    const podConsole = createPodConsole(sink);

    podConsole.info('info message');
    expect(consoleSpy.log).toHaveBeenCalledTimes(1);
    const [prefix, message] = consoleSpy.log.mock.calls[0];
    expect(prefix).toMatch(/^\[\d{4}-\d{2}-\d{2}T.*\]\[pod-456:out\]$/);
    expect(message).toBe('info message');
  });

  it('routes debug to stdout with timestamp', () => {
    const sink = createPodLogSink(testMeta);
    const podConsole = createPodConsole(sink);

    podConsole.debug('debug message');
    expect(consoleSpy.log).toHaveBeenCalledTimes(1);
    const [prefix, message] = consoleSpy.log.mock.calls[0];
    expect(prefix).toMatch(/^\[\d{4}-\d{2}-\d{2}T.*\]\[pod-456:out\]$/);
    expect(message).toBe('debug message');
  });

  it('routes warn to stderr with timestamp', () => {
    const sink = createPodLogSink(testMeta);
    const podConsole = createPodConsole(sink);

    podConsole.warn('warning');
    expect(consoleSpy.error).toHaveBeenCalledTimes(1);
    const [prefix, message] = consoleSpy.error.mock.calls[0];
    expect(prefix).toMatch(/^\[\d{4}-\d{2}-\d{2}T.*\]\[pod-456:err\]$/);
    expect(message).toBe('warning');
  });

  it('routes error to stderr with timestamp', () => {
    const sink = createPodLogSink(testMeta);
    const podConsole = createPodConsole(sink);

    podConsole.error('error');
    expect(consoleSpy.error).toHaveBeenCalledTimes(1);
    const [prefix, message] = consoleSpy.error.mock.calls[0];
    expect(prefix).toMatch(/^\[\d{4}-\d{2}-\d{2}T.*\]\[pod-456:err\]$/);
    expect(message).toBe('error');
  });

  it('formats multiple arguments', () => {
    const sink = createPodLogSink(testMeta);
    const podConsole = createPodConsole(sink);

    podConsole.log('hello', 'world', 123);
    expect(consoleSpy.log).toHaveBeenCalledWith(
      expect.stringMatching(/^\[.*\]\[pod-456:out\]$/),
      'hello world 123',
    );
  });

  it('formats objects as JSON', () => {
    const sink = createPodLogSink(testMeta);
    const podConsole = createPodConsole(sink);

    podConsole.log({ key: 'value' });
    expect(consoleSpy.log).toHaveBeenCalledWith(
      expect.stringMatching(/^\[.*\]\[pod-456:out\]$/),
      '{"key":"value"}',
    );
  });

  it('formats errors with name and message', () => {
    const sink = createPodLogSink(testMeta);
    const podConsole = createPodConsole(sink);

    podConsole.error(new Error('test error'));
    expect(consoleSpy.error).toHaveBeenCalledWith(
      expect.stringMatching(/^\[.*\]\[pod-456:err\]$/),
      'Error: test error',
    );
  });

  it('handles circular references gracefully', () => {
    const sink = createPodLogSink(testMeta);
    const podConsole = createPodConsole(sink);

    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;

    // Should not throw, falls back to String()
    expect(() => podConsole.log(circular)).not.toThrow();
    expect(consoleSpy.log).toHaveBeenCalled();
  });
});
