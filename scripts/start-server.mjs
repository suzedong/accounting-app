import { spawn } from 'node:child_process';
import { platform } from 'node:os';

const pythonCmd = platform() === 'win32' ? 'python' : 'python3';
spawn(pythonCmd, ['server.py', '18080'], { cwd: 'server', stdio: 'inherit' });
