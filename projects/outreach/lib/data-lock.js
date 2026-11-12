import fs from 'node:fs';
import path from 'node:path';

let lockedPath = '';

/** @param {string} directory */
export function lockDataDirectory(directory) {
  if (lockedPath) return;
  const target = path.join(directory, '.writer.lock');
  try {
    const descriptor = fs.openSync(target, 'wx');
    fs.writeFileSync(descriptor, String(process.pid));
    fs.closeSync(descriptor);
    lockedPath = target;
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const owner = Number(fs.readFileSync(target, 'utf8'));
    let active = false;
    if (Number.isInteger(owner) && owner > 0) {
      try {
        process.kill(owner, 0);
        active = true;
      } catch (probeError) {
        if (probeError.code !== 'ESRCH') active = true;
      }
    }
    if (active) throw new Error('该拓客数据目录已有运行进程，请为各实例使用独立数据目录');
    fs.unlinkSync(target);
    lockDataDirectory(directory);
  }
}

process.once('exit', () => {
  if (!lockedPath) return;
  try {
    if (fs.readFileSync(lockedPath, 'utf8') === String(process.pid)) fs.unlinkSync(lockedPath);
  } catch {
    // A stale PID marker is reclaimed by the next process after exit.
  }
});
