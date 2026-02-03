/**
 * External Chaos Runner
 *
 * Uses Node.js child processes and shell commands to simulate
 * external chaos that affects the environment outside Stark:
 * - Process crashes
 * - Network partitions
 * - Host instability
 * - Resource exhaustion
 *
 * This is for development/test environments only.
 */

import { spawn, exec, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { platform } from 'os';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ExternalChaosConfig {
  enabled: boolean;
  dryRun?: boolean; // Log commands but don't execute
}

export interface ProcessInfo {
  pid: number;
  name: string;
  command: string;
}

export interface ChaosResult {
  success: boolean;
  message: string;
  error?: Error;
}

// ─────────────────────────────────────────────────────────────────────────────
// External Chaos Runner
// ─────────────────────────────────────────────────────────────────────────────

export class ExternalChaosRunner extends EventEmitter {
  private enabled = false;
  private dryRun = false;
  private isWindows = platform() === 'win32';
  private trackedProcesses: Map<string, ChildProcess> = new Map();

  constructor(config: ExternalChaosConfig = { enabled: false }) {
    super();
    this.enabled = config.enabled;
    this.dryRun = config.dryRun ?? false;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────────────────────

  enable(): void {
    if (process.env.NODE_ENV === 'production') {
      console.warn('[ExternalChaos] REFUSING to enable in production');
      return;
    }
    this.enabled = true;
    console.log('[ExternalChaos] ⚡ External chaos runner ENABLED');
  }

  disable(): void {
    this.enabled = false;
    console.log('[ExternalChaos] External chaos runner disabled');
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setDryRun(dryRun: boolean): void {
    this.dryRun = dryRun;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Process Management (Kill pods/nodes)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Kill a process by PID
   */
  async killProcess(pid: number, signal: 'SIGTERM' | 'SIGKILL' = 'SIGTERM'): Promise<ChaosResult> {
    if (!this.enabled) {
      return { success: false, message: 'External chaos not enabled' };
    }

    const logPrefix = '[ExternalChaos]';

    try {
      if (this.isWindows) {
        const forceFlag = signal === 'SIGKILL' ? '/F' : '';
        const cmd = `taskkill ${forceFlag} /PID ${pid}`;
        console.log(`${logPrefix} Executing: ${cmd}`);

        if (this.dryRun) {
          return { success: true, message: `[DRY RUN] Would execute: ${cmd}` };
        }

        await this.execCommand(cmd);
      } else {
        const sig = signal === 'SIGKILL' ? '-9' : '-15';
        const cmd = `kill ${sig} ${pid}`;
        console.log(`${logPrefix} Executing: ${cmd}`);

        if (this.dryRun) {
          return { success: true, message: `[DRY RUN] Would execute: ${cmd}` };
        }

        await this.execCommand(cmd);
      }

      this.emit('process_killed', { pid, signal });
      return { success: true, message: `Process ${pid} killed with ${signal}` };
    } catch (error) {
      return {
        success: false,
        message: `Failed to kill process ${pid}`,
        error: error as Error,
      };
    }
  }

  /**
   * Find and kill processes by name pattern
   */
  async killProcessByName(
    namePattern: string,
    signal: 'SIGTERM' | 'SIGKILL' = 'SIGTERM'
  ): Promise<ChaosResult> {
    if (!this.enabled) {
      return { success: false, message: 'External chaos not enabled' };
    }

    try {
      const processes = await this.findProcesses(namePattern);
      if (processes.length === 0) {
        return { success: false, message: `No processes found matching: ${namePattern}` };
      }

      console.log(`[ExternalChaos] Found ${processes.length} processes matching "${namePattern}"`);

      const results: ChaosResult[] = [];
      for (const proc of processes) {
        results.push(await this.killProcess(proc.pid, signal));
      }

      const successful = results.filter((r) => r.success).length;
      return {
        success: successful > 0,
        message: `Killed ${successful}/${processes.length} processes matching "${namePattern}"`,
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to kill processes matching ${namePattern}`,
        error: error as Error,
      };
    }
  }

  /**
   * Find processes matching a pattern
   */
  async findProcesses(namePattern: string): Promise<ProcessInfo[]> {
    const processes: ProcessInfo[] = [];

    try {
      if (this.isWindows) {
        const output = await this.execCommand(
          `wmic process where "name like '%${namePattern}%'" get processid,name,commandline /format:csv`
        );
        const lines = output.split('\n').filter((l) => l.trim());
        for (const line of lines.slice(1)) {
          // Skip header
          const parts = line.split(',');
          if (parts.length >= 4) {
            processes.push({
              pid: parseInt(parts[3]!, 10),
              name: parts[2]!,
              command: parts[1]!,
            });
          }
        }
      } else {
        const output = await this.execCommand(`pgrep -f "${namePattern}" || true`);
        const pids = output
          .split('\n')
          .map((p) => parseInt(p.trim(), 10))
          .filter((p) => !isNaN(p));
        for (const pid of pids) {
          try {
            const cmdline = await this.execCommand(`ps -p ${pid} -o comm=`);
            processes.push({
              pid,
              name: cmdline.trim(),
              command: '',
            });
          } catch {
            // Process may have exited
          }
        }
      }
    } catch (error) {
      console.error('[ExternalChaos] Failed to find processes:', error);
    }

    return processes;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Spawn Test Processes (Fake Nodes/Pods for Chaos Testing)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Spawn a test process that can be killed for chaos testing
   */
  spawnTestProcess(id: string, command: string, args: string[] = []): ChildProcess | null {
    if (!this.enabled) {
      console.warn('[ExternalChaos] Cannot spawn test process - chaos not enabled');
      return null;
    }

    console.log(`[ExternalChaos] Spawning test process: ${id} (${command} ${args.join(' ')})`);

    if (this.dryRun) {
      console.log(`[DRY RUN] Would spawn: ${command} ${args.join(' ')}`);
      return null;
    }

    const proc = spawn(command, args, {
      stdio: 'pipe',
      detached: false,
      shell: this.isWindows,
    });

    proc.on('exit', (code, signal) => {
      console.log(`[ExternalChaos] Test process ${id} exited: code=${code}, signal=${signal}`);
      this.trackedProcesses.delete(id);
      this.emit('process_exited', { id, code, signal });
    });

    proc.on('error', (error) => {
      console.error(`[ExternalChaos] Test process ${id} error:`, error);
      this.trackedProcesses.delete(id);
    });

    this.trackedProcesses.set(id, proc);
    this.emit('process_spawned', { id, pid: proc.pid });

    return proc;
  }

  /**
   * Kill a tracked test process
   */
  killTestProcess(id: string, signal: 'SIGTERM' | 'SIGKILL' = 'SIGTERM'): ChaosResult {
    const proc = this.trackedProcesses.get(id);
    if (!proc) {
      return { success: false, message: `Test process "${id}" not found` };
    }

    console.log(`[ExternalChaos] ⚡ Killing test process: ${id} (PID ${proc.pid})`);

    if (this.dryRun) {
      return { success: true, message: `[DRY RUN] Would kill process ${id}` };
    }

    const success = proc.kill(signal === 'SIGKILL' ? 'SIGKILL' : 'SIGTERM');
    return {
      success,
      message: success ? `Killed test process ${id}` : `Failed to kill test process ${id}`,
    };
  }

  /**
   * Kill all tracked test processes
   */
  killAllTestProcesses(): void {
    console.log(`[ExternalChaos] Killing all ${this.trackedProcesses.size} test processes`);
    for (const [id] of this.trackedProcesses) {
      this.killTestProcess(id, 'SIGKILL');
    }
  }

  getTrackedProcesses(): Map<string, ChildProcess> {
    return new Map(this.trackedProcesses);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Network Chaos (Simulated via process-level)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Block network to a specific port (Windows/Linux)
   * NOTE: Requires admin/root privileges
   */
  async blockPort(port: number, durationMs: number = 10000): Promise<ChaosResult> {
    if (!this.enabled) {
      return { success: false, message: 'External chaos not enabled' };
    }

    console.log(`[ExternalChaos] ⚡ Blocking port ${port} for ${durationMs}ms`);

    if (this.dryRun) {
      return { success: true, message: `[DRY RUN] Would block port ${port}` };
    }

    try {
      if (this.isWindows) {
        // Windows firewall rule
        const ruleName = `CHAOS_BLOCK_${port}`;
        await this.execCommand(
          `netsh advfirewall firewall add rule name="${ruleName}" dir=in action=block protocol=tcp localport=${port}`
        );

        setTimeout(async () => {
          try {
            await this.execCommand(
              `netsh advfirewall firewall delete rule name="${ruleName}"`
            );
            console.log(`[ExternalChaos] Unblocked port ${port}`);
          } catch (e) {
            console.error(`[ExternalChaos] Failed to unblock port ${port}:`, e);
          }
        }, durationMs);
      } else {
        // Linux iptables
        await this.execCommand(`iptables -A INPUT -p tcp --dport ${port} -j DROP`);

        setTimeout(async () => {
          try {
            await this.execCommand(`iptables -D INPUT -p tcp --dport ${port} -j DROP`);
            console.log(`[ExternalChaos] Unblocked port ${port}`);
          } catch (e) {
            console.error(`[ExternalChaos] Failed to unblock port ${port}:`, e);
          }
        }, durationMs);
      }

      this.emit('port_blocked', { port, durationMs });
      return { success: true, message: `Blocked port ${port} for ${durationMs}ms` };
    } catch (error) {
      return {
        success: false,
        message: `Failed to block port ${port} (may require admin privileges)`,
        error: error as Error,
      };
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Resource Stress
  // ─────────────────────────────────────────────────────────────────────────

  private stressProcess: ChildProcess | null = null;

  /**
   * Start CPU stress (requires stress/stress-ng on Linux, uses PowerShell on Windows)
   */
  async startCpuStress(cores: number = 1, durationMs: number = 10000): Promise<ChaosResult> {
    if (!this.enabled) {
      return { success: false, message: 'External chaos not enabled' };
    }

    console.log(`[ExternalChaos] ⚡ Starting CPU stress: ${cores} cores for ${durationMs}ms`);

    if (this.dryRun) {
      return { success: true, message: `[DRY RUN] Would stress ${cores} cores` };
    }

    try {
      if (this.isWindows) {
        // PowerShell CPU stress
        const script = `
          $duration = [TimeSpan]::FromMilliseconds(${durationMs})
          $end = (Get-Date) + $duration
          1..${cores} | ForEach-Object -Parallel {
            while ((Get-Date) -lt $using:end) {
              [Math]::Sqrt(12345) | Out-Null
            }
          }
        `;
        this.stressProcess = spawn('powershell', ['-Command', script], { stdio: 'ignore' });
      } else {
        // Linux stress-ng
        const seconds = Math.ceil(durationMs / 1000);
        this.stressProcess = spawn('stress-ng', ['--cpu', cores.toString(), '--timeout', `${seconds}s`], {
          stdio: 'ignore',
        });
      }

      this.stressProcess.on('exit', () => {
        this.stressProcess = null;
        console.log('[ExternalChaos] CPU stress ended');
      });

      this.emit('cpu_stress_started', { cores, durationMs });
      return { success: true, message: `Started CPU stress on ${cores} cores` };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to start CPU stress',
        error: error as Error,
      };
    }
  }

  /**
   * Stop ongoing stress test
   */
  stopStress(): void {
    if (this.stressProcess) {
      this.stressProcess.kill('SIGKILL');
      this.stressProcess = null;
      console.log('[ExternalChaos] Stopped stress test');
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Utility
  // ─────────────────────────────────────────────────────────────────────────

  private execCommand(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      exec(command, { timeout: 30000 }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`Command failed: ${error.message}\nStderr: ${stderr}`));
        } else {
          resolve(stdout);
        }
      });
    });
  }

  /**
   * Cleanup all resources
   */
  cleanup(): void {
    this.killAllTestProcesses();
    this.stopStress();
    this.disable();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton
// ─────────────────────────────────────────────────────────────────────────────

let externalChaos: ExternalChaosRunner | null = null;

export function getExternalChaosRunner(config?: ExternalChaosConfig): ExternalChaosRunner {
  if (!externalChaos) {
    externalChaos = new ExternalChaosRunner(config);
  }
  return externalChaos;
}

export function resetExternalChaosRunner(): void {
  if (externalChaos) {
    externalChaos.cleanup();
  }
  externalChaos = null;
}
