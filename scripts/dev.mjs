import { spawn, execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { platform } from 'node:os';

const scriptsDir = fileURLToPath(new URL('.', import.meta.url));
const projectRoot = dirname(scriptsDir);
const isWin = platform() === 'win32';
const { existsSync } = await import('node:fs');

let pythonCmd = isWin
  ? 'python'
  : join(projectRoot, '.venv', 'bin', 'python3');

if (!isWin && !existsSync(pythonCmd)) {
  console.warn(`[dev] 未找到虚拟环境 Python (${pythonCmd})，使用系统 python3`);
  pythonCmd = 'python3';
}

const server = spawn(pythonCmd, ['server.py', '18080'], {
  cwd: join(projectRoot, 'server'),
  stdio: 'inherit'
});

const vite = spawn(isWin ? 'cmd.exe' : 'npx', isWin ? ['/c', 'npx vite'] : ['vite'], {
  cwd: projectRoot,
  stdio: 'inherit',
  env: { ...process.env, FORCE_COLOR: '1' }
});

const cleanup = () => {
  console.log('\n正在关闭服务...');
  if (isWin) {
    try { execSync(`taskkill /PID ${server.pid} /T /F`, { stdio: 'ignore' }); } catch {}
    try { execSync(`taskkill /PID ${vite.pid} /T /F`, { stdio: 'ignore' }); } catch {}
  } else {
    // SIGKILL 强制终止，包括所有子进程
    try { process.kill(-server.pid, 'SIGKILL'); } catch {}
    try { process.kill(-vite.pid, 'SIGKILL'); } catch {}
    server.kill('SIGKILL');
    vite.kill('SIGKILL');
  }
  setTimeout(() => process.exit(0), 500);
};

process.on('SIGINT', () => cleanup());
if (!isWin) {
  process.on('SIGTERM', () => cleanup());
}

server.on('exit', (code) => code && cleanup());
vite.on('exit', (code) => code && cleanup());
