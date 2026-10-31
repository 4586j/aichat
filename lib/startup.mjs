import { loadEnvFile } from 'node:process';
import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

export function loadLocalEnvironment(path) {
  try { loadEnvFile(path); return true; }
  catch (error) {
    if (error.code === 'ENOENT') return false;
    throw new Error('无法读取本机 .env，请检查文件权限和配置格式。');
  }
}

export function readTunnelConfig(env = process.env) {
  const enabled = env.MEDIA_SSH_ENABLED || 'false';
  if (!['true','false'].includes(enabled)) throw new Error('MEDIA_SSH_ENABLED 必须为 true 或 false。');
  if (enabled === 'false') return null;
  const host = env.MEDIA_SSH_HOST?.trim();
  if (!host || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/u.test(host)) throw new Error('MEDIA_SSH_HOST 应为已配置的 SSH 主机别名。');
  const forwards = (env.MEDIA_SSH_FORWARDS || '').split(',').map(value => value.trim());
  if (!forwards.length || forwards.length > 8 || forwards.some(value => !/^\d{1,5}:\d{1,5}$/u.test(value))) throw new Error('MEDIA_SSH_FORWARDS 应为本地端口:远端端口，以英文逗号分隔，最多 8 项。');
  const pairs = forwards.map(value => { const [local,remote] = value.split(':').map(Number); return {local,remote}; });
  if (pairs.some(pair => [pair.local,pair.remote].some(port => port < 1 || port > 65535)) || new Set(pairs.map(pair => pair.local)).size !== pairs.length) throw new Error('SSH 转发端口必须在 1～65535 之间，本地端口不能重复。');
  return {host,forwards:pairs};
}

export function tunnelArguments(config) {
  return ['-N','-T','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ExitOnForwardFailure=yes',
    '-o','ConnectTimeout=10','-o','ServerAliveInterval=30','-o','ServerAliveCountMax=3',
    '-o','ControlMaster=no','-o','ControlPath=none',
    ...config.forwards.flatMap(({local,remote}) => ['-L',`127.0.0.1:${local}:127.0.0.1:${remote}`]),config.host];
}

function portOpen(port) {
  return new Promise(resolve => {
    const socket = createConnection({host:'127.0.0.1',port});
    const finish = value => { socket.destroy(); resolve(value); };
    socket.setTimeout(250,() => finish(false));
    socket.once('connect',() => finish(true));
    socket.once('error',() => finish(false));
  });
}

// The application owns this child only; it never kills an existing listener or SSH master.
export function createTunnelManager(config, {spawnImpl=spawn, probe=portOpen, env=process.env,
  startupTimeoutMs=15000, retryDelayMs=5000, pollIntervalMs=100, log=console.log, warn=console.warn} = {}) {
  let active = null, retry = null, attempt = null, closed = false, connected = false, failures = 0, warned = false;
  const childEnv = Object.fromEntries(Object.entries(env).filter(([name]) => !/(?:KEY|TOKEN|SECRET|PASSWORD)/iu.test(name)));
  const onExit = () => { active?.process.kill(); };
  if (config) process.once('exit',onExit);
  const isOpen = async () => (await Promise.all(config.forwards.map(pair => probe(pair.local)))).every(Boolean);

  async function stopChild(record) {
    if (!record || record.ended) return;
    record.process.kill();
    let timer;
    await Promise.race([record.done,new Promise(resolve => { timer=setTimeout(resolve,1500); })]);
    clearTimeout(timer);
    if (!record.ended) { record.process.kill('SIGKILL'); await record.done; }
  }
  function schedule() {
    if (closed || retry || !config) return;
    const timeout = Math.min(retryDelayMs * 2 ** Math.min(failures++,3),30000);
    retry = setTimeout(() => { retry=null; void start(); },timeout);
    retry.unref();
  }
  async function connect() {
    if (closed) return false;
    const occupied = await Promise.all(config.forwards.map(pair => probe(pair.local)));
    if (closed) return false;
    if (occupied.some(Boolean)) throw new Error('SSH 转发端口已被占用；请关闭原手动隧道或调整本地端口。');
    const child = spawnImpl('ssh',tunnelArguments(config),{shell:false,windowsHide:true,stdio:['ignore','ignore','pipe'],env:childEnv});
    const record = {process:child,ended:false,failed:false,done:null};
    active = record;
    record.done = new Promise(resolve => {
      const end = failed => {
        if (record.ended) return;
        record.ended=true;record.failed=failed;
        if (active === record) {
          active=null;
          const wasConnected=connected;connected=false;
          if (!closed && wasConnected) { warn('媒体 SSH 隧道已断开，正在自动重连。'); warned=true; }
          if (!closed) schedule();
        }
        resolve();
      };
      child.once('error',() => end(true));
      child.once('close',() => end(true));
    });
    // SSH diagnostics may contain local account/config details. Do not echo them or credentials.
    child.stderr?.resume();
    const deadline = Date.now()+startupTimeoutMs;
    try {
      while (!closed && !record.ended && Date.now()<deadline) {
        if (await isOpen()) {
          if (closed || record.ended) break;
          connected=true;failures=0;warned=false;
          log('媒体 SSH 隧道已连接（仅本机回环地址）。');
          return true;
        }
        await delay(pollIntervalMs);
      }
      if (!closed) throw new Error('媒体 SSH 隧道连接失败；请检查 SSH 主机别名、免交互认证和已确认的主机指纹。');
      return false;
    } finally { if (!connected) await stopChild(record); }
  }
  async function start() {
    if (!config || closed) return false;
    if (connected) return true;
    if (attempt) return attempt;
    if (retry) { clearTimeout(retry);retry=null; }
    attempt = (async () => {
      try { return await connect(); }
      catch (error) {
        if (!closed) {
          if (!warned) { warn(error.message); warned=true; }
          schedule();
        }
        return false;
      } finally { attempt=null; }
    })();
    return attempt;
  }
  return {
    start,
    status:() => ({enabled:Boolean(config),connected}),
    async close() {
      closed=true;connected=false;
      if (retry) clearTimeout(retry);
      retry=null;
      process.removeListener('exit',onExit);
      await stopChild(active);
      await attempt;
    },
  };
}
