import { spawn } from 'node:child_process';
import { AppError } from './model.mjs';

export function createStdioMcpClient({ name, command, args = [], env = {}, cwd = process.cwd(), timeoutMs = 15000 } = {}) {
  let child = null;
  let nextId = 1;
  const pendingRequests = new Map();
  let buffer = '';
  let initialized = false;

  function ensureProcess() {
    if (child && !child.killed) return child;
    child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep last incomplete chunk
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const msg = JSON.parse(trimmed);
          if (msg.id != null && pendingRequests.has(msg.id)) {
            const { resolve, reject, timer } = pendingRequests.get(msg.id);
            clearTimeout(timer);
            pendingRequests.delete(msg.id);
            if (msg.error) {
              reject(new AppError(`MCP [${name}] 服务报错: ${msg.error.message || JSON.stringify(msg.error)}`));
            } else {
              resolve(msg.result);
            }
          }
        } catch {
          // Ignore non-json logging lines from stderr/stdout
        }
      }
    });

    child.on('error', err => {
      for (const { reject, timer } of pendingRequests.values()) {
        clearTimeout(timer);
        reject(new AppError(`MCP [${name}] 进程错误: ${err.message}`));
      }
      pendingRequests.clear();
    });

    child.on('exit', () => {
      for (const { reject, timer } of pendingRequests.values()) {
        clearTimeout(timer);
        reject(new AppError(`MCP [${name}] 进程已退出。`));
      }
      pendingRequests.clear();
      child = null;
      initialized = false;
    });

    return child;
  }

  function sendRpc(method, params = {}) {
    return new Promise((resolve, reject) => {
      const proc = ensureProcess();
      const id = nextId++;
      const timer = setTimeout(() => {
        pendingRequests.delete(id);
        reject(new AppError(`MCP [${name}] 请求 [${method}] 超时 (${timeoutMs}ms)。`, 504));
      }, timeoutMs);

      pendingRequests.set(id, { resolve, reject, timer });
      const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
      try {
        proc.stdin.write(payload);
      } catch (err) {
        clearTimeout(timer);
        pendingRequests.delete(id);
        reject(new AppError(`向 MCP [${name}] 发送指令失败: ${err.message}`));
      }
    });
  }

  return {
    name,
    async initialize() {
      if (initialized) return;
      const result = await sendRpc('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'ai-companion', version: '1.0.0' }
      });
      // Send initialized notification
      try {
        ensureProcess().stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
      } catch {}
      initialized = true;
      return result;
    },

    async listTools() {
      await this.initialize();
      const result = await sendRpc('tools/list', {});
      return Array.isArray(result?.tools) ? result.tools : [];
    },

    async callTool(toolName, toolArgs = {}, { signal } = {}) {
      await this.initialize();
      if (signal?.aborted) throw new AppError('本次回复已取消。', 499);
      const result = await sendRpc('tools/call', {
        name: toolName,
        arguments: toolArgs
      });
      return result;
    },

    close() {
      if (child) {
        try { child.kill(); } catch {}
        child = null;
      }
      initialized = false;
      for (const { timer } of pendingRequests.values()) clearTimeout(timer);
      pendingRequests.clear();
    }
  };
}

export function createMcpManager({ toolRegistry = null, store = null } = {}) {
  const clients = new Map();

  return {
    registerServer(name, client) {
      clients.set(name, client);
    },

    getClient(name) {
      return clients.get(name);
    },

    async syncAllTools() {
      if (!toolRegistry) return;
      for (const [serverName, client] of clients.entries()) {
        try {
          const tools = await client.listTools();
          for (const t of tools) {
            toolRegistry.registerMcpTool(t, client, { safe: Boolean(t.readOnly) });
          }
        } catch (err) {
          // Log or record warning without crashing whole system
        }
      }
    },

    closeAll() {
      for (const client of clients.values()) {
        client.close?.();
      }
      clients.clear();
    }
  };
}
