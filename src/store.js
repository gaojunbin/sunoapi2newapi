import fs from 'node:fs/promises';
import path from 'node:path';

export class TaskStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.tasks = {};
    this.loaded = false;
    this.writeQueue = Promise.resolve();
  }

  async load() {
    if (this.loaded) return;
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      this.tasks = parsed && typeof parsed === 'object' ? parsed : {};
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      this.tasks = {};
    }
    this.loaded = true;
  }

  async get(taskId) {
    await this.load();
    return this.tasks[taskId] || null;
  }

  async upsert(taskId, patch) {
    await this.load();
    const now = Math.floor(Date.now() / 1000);
    const current = this.tasks[taskId] || {
      task_id: taskId,
      created_at: now,
      submit_time: now
    };
    this.tasks[taskId] = {
      ...current,
      ...patch,
      task_id: taskId,
      updated_at: now
    };
    await this.flush();
    return this.tasks[taskId];
  }

  async addCallback(taskId, callbackBody) {
    const current = (await this.get(taskId)) || {};
    const callbacks = Array.isArray(current.callbacks) ? current.callbacks.slice(-9) : [];
    callbacks.push({
      received_at: Math.floor(Date.now() / 1000),
      body: callbackBody
    });
    return this.upsert(taskId, { callbacks, last_callback: callbackBody });
  }

  async flush() {
    const write = async () => {
      const tmpPath = `${this.filePath}.tmp`;
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      await fs.writeFile(tmpPath, `${JSON.stringify(this.tasks, null, 2)}\n`);
      await fs.rename(tmpPath, this.filePath);
    };
    this.writeQueue = this.writeQueue.then(write, write);
    return this.writeQueue;
  }
}
