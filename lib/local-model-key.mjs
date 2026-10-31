import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { AppError } from './model.mjs';

const script = operation => `$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $inputBytes=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $outputBytes=[Security.Cryptography.ProtectedData]::${operation}($inputBytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($outputBytes))`;
function dpapi(operation, bytes) {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script(operation)], {
    input: bytes.toString('base64'), encoding: 'utf8', windowsHide: true, timeout: 15000, maxBuffer: 65536,
  });
  if (result.error || result.status !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(result.stdout)) throw new Error('本地密钥加密或解密失败。');
  return Buffer.from(result.stdout, 'base64');
}

// Windows ties the encrypted key to the current user. On other systems the file is owner-only.
export function createLocalModelKey(path) {
  return {
    read() {
      if (!existsSync(path)) return null;
      try {
        const data = readFileSync(path);
        const value = process.platform === 'win32' ? dpapi('Unprotect', data) : data;
        const parsed = JSON.parse(value.toString('utf8'));
        if (parsed.version !== 1 || typeof parsed.key !== 'string' || parsed.key.length > 2000) throw new Error('invalid');
        return parsed.key;
      } catch { throw new AppError('无法读取本地保存的模型密钥，请检查当前用户和文件权限。', 500); }
    },
    write(key) {
      let temporary;
      try {
        const data = Buffer.from(JSON.stringify({ version: 1, key }), 'utf8');
        const stored = process.platform === 'win32' ? dpapi('Protect', data) : data;
        mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
        temporary = `${path}.${randomUUID()}.tmp`;
        writeFileSync(temporary, stored, { mode: 0o600, flag: 'wx' });
        renameSync(temporary, path);
      } catch {
        if (temporary) try { rmSync(temporary, { force: true }); } catch { /* leave old key intact */ }
        throw new AppError('无法保存本地模型密钥，请检查文件权限后重试。', 500);
      }
    },
  };
}
