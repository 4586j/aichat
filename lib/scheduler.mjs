import { id, now } from './store.mjs';
import { AppError } from './model.mjs';

export function createScheduler(store, { memory, answer }) {
  let timer = null;
  let automaticWork = null;
  let activeModelTasks = 0;
  let lastMaintenance = 0;
  const inFlight = new Set();
  async function execute(taskId, { scheduled = false, time = Date.now() } = {}) {
    const task = store.get('SELECT * FROM tasks WHERE id=?', taskId);
    if (!task) throw new AppError('任务不存在。', 404);
    const runId = id();
    store.transaction(() => {
      const claimed = store.run('UPDATE tasks SET running=1 WHERE id=? AND running=0', taskId);
      if (!claimed.changes) throw new AppError('任务正在执行，请勿重复运行。', 409);
      if (scheduled) {
        if (task.scheduleType === 'once') store.run('UPDATE tasks SET enabled=0 WHERE id=?', taskId);
        else store.run('UPDATE tasks SET nextRunAt=? WHERE id=?', new Date(time + task.intervalMinutes * 60000).toISOString(), taskId);
      }
      store.run('INSERT INTO task_runs VALUES (?,?,?,?,?,?,?)', runId, taskId, task.name, 'running', '', now(), null);
    });
    if (task.type !== 'reminder') activeModelTasks++;
    let status = 'success';
    let result;
    try {
      if (task.type === 'reminder') result = task.prompt || task.name;
      else if (task.type === 'summarize') {
        const summary = await memory.summarizePersona(task.personaId);
        result = `已处理 ${summary.processed} 条消息，新增 ${summary.created} 条记忆。`;
      } else result = (await answer(task.personaId, task.prompt)).content;
    } catch (error) {
      status = 'failed';
      result = error instanceof AppError ? error.message : '任务执行失败，请检查输入与服务状态。';
    } finally {
      if (task.type !== 'reminder') activeModelTasks--;
      store.transaction(() => {
        store.run('UPDATE tasks SET running=0 WHERE id=?', taskId);
        store.run('UPDATE task_runs SET status=?,result=?,finishedAt=? WHERE id=?', status, result || '', now(), runId);
      });
    }
    return store.get('SELECT * FROM task_runs WHERE id=?', runId);
  }
  const scheduler = {
    recover() {
      store.transaction(() => {
        store.run("UPDATE task_runs SET status='failed',result=?,finishedAt=? WHERE status='running'", '服务在执行期间退出，本次未完成；任务已恢复可运行。', now());
        store.run('UPDATE tasks SET running=0 WHERE running=1');
      });
    },
    run(taskId, options) {
      const work = execute(taskId, options);
      inFlight.add(work);
      void work.then(() => inFlight.delete(work), () => inFlight.delete(work));
      return work;
    },
    tick(time = Date.now(), { wait = true } = {}) {
      if (time - lastMaintenance >= 3600000) { memory.maintain(time); lastMaintenance = time; }
      const due = store.all('SELECT id,type FROM tasks WHERE enabled=1 AND running=0 AND nextRunAt<=? ORDER BY nextRunAt', new Date(time).toISOString());
      for (const task of due) {
        if (task.type !== 'reminder' && activeModelTasks >= 3) continue;
        void scheduler.run(task.id, { scheduled: true, time }).catch(error => {
          if (error.status !== 409 && error.status !== 404) console.error('定时任务启动失败，请检查数据库状态。');
        });
      }
      if (!automaticWork) {
        automaticWork = memory.automatic().catch(() => console.error('自动记忆总结失败，请检查数据库状态。'))
          .finally(() => { automaticWork = null; });
      }
      return wait ? Promise.all([...inFlight, automaticWork]) : Promise.resolve();
    },
    start() {
      if (timer) return;
      scheduler.recover();
      const dispatch = () => {
        try { void scheduler.tick(Date.now(), { wait: false }); }
        catch { console.error('定时任务维护失败，请检查数据库状态。'); }
      };
      timer = setInterval(dispatch, 15000);
      timer.unref();
      dispatch();
    },
    async stop() {
      clearInterval(timer); timer = null;
      await Promise.allSettled([...inFlight, ...(automaticWork ? [automaticWork] : [])]);
    },
  };
  return scheduler;
}
