import { id, now } from './store.mjs';
import { AppError, isQuotaLimitError } from './model.mjs';
import { listDueResumableRuns, recoverRunningResumableRuns } from './resumable-runs.mjs';

export const MISSED_ONCE_GRACE_MS = 6 * 3600000;
export const RUN_RETENTION = 200;
export const AUTO_DISABLE_FAILURES = 3;

export function createScheduler(store, { memory, answer, autonomy = null, resumeRun = null, onTaskQuotaPause = null }) {
  let timer = null;
  let automaticWork = null;
  let autonomousWork = null;
  let activeModelTasks = 0;
  let lastMaintenance = 0;
  const inFlight = new Set();
  function deliverResult(task, status, result) {
    if (!autonomy || task.type === 'summarize') return;
    try {
      if (status === 'success') autonomy.deliverTaskResult(task, result);
      else if (justAutoDisabled(task)) autonomy.deliverTaskResult(task, '执行失败：' + result + "（已连续失败 " + AUTO_DISABLE_FAILURES + " 次，任务已自动停用）");
    } catch { console.error('任务结果投递失败。'); }
  }
  const justAutoDisabled = task => task.scheduleType === 'interval' && (task.failCount || 0) + 1 >= AUTO_DISABLE_FAILURES;
  async function execute(taskId, { scheduled = false, time = Date.now() } = {}) {
    const task = store.get('SELECT * FROM tasks WHERE id=?', taskId);
    if (!task) throw new AppError('任务不存在。', 404);
    const runId = id();
    if (scheduled && task.scheduleType === 'once' && time - Date.parse(task.nextRunAt) > MISSED_ONCE_GRACE_MS) {
      store.transaction(() => {
        store.run('UPDATE tasks SET enabled=0 WHERE id=?', taskId);
        store.run('INSERT INTO task_runs VALUES (?,?,?,?,?,?,?)', runId, taskId, task.name, 'missed', '服务未运行，提醒已过期（原定 ' + task.nextRunAt + '），已跳过。', now(), now());
      });
      return store.get('SELECT * FROM task_runs WHERE id=?', runId);
    }
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
      if (isQuotaLimitError(error) && typeof onTaskQuotaPause === 'function') {
        const paused = onTaskQuotaPause({ task, runId, error, time });
        status = 'paused_quota';
        result = `因模型限流已暂停，已保存至第 ${paused?.step || 0} 步，预计 ${paused?.resumeAt || '稍后'} 自动继续。`;
      } else {
        status = 'failed';
        result = error instanceof AppError ? error.message : '任务执行失败，请检查输入与服务状态。';
      }
    } finally {
      if (task.type !== 'reminder') activeModelTasks--;
      store.transaction(() => {
        store.run('UPDATE tasks SET running=0 WHERE id=?', taskId);
        store.run('UPDATE task_runs SET status=?,result=?,finishedAt=? WHERE id=?', status, result || '', status === 'paused_quota' ? null : now(), runId);
        store.run('DELETE FROM task_runs WHERE taskId=? AND id NOT IN (SELECT id FROM task_runs WHERE taskId=? ORDER BY startedAt DESC LIMIT ?)', taskId, taskId, RUN_RETENTION);
        if (status === 'failed') {
          store.run('UPDATE tasks SET failCount=failCount+1 WHERE id=?', taskId);
          if (scheduled && task.scheduleType === 'interval' && (task.failCount || 0) + 1 >= AUTO_DISABLE_FAILURES) store.run('UPDATE tasks SET enabled=0 WHERE id=?', taskId);
        } else if (status === 'success') store.run('UPDATE tasks SET failCount=0 WHERE id=?', taskId);
      });
      if (status !== 'paused_quota') deliverResult(task, status, result);
    }
    return store.get('SELECT * FROM task_runs WHERE id=?', runId);
  }
  const scheduler = {
    recover() {
      store.transaction(() => {
        store.run("UPDATE task_runs SET status='failed',result=?,finishedAt=? WHERE status='running'", '服务在执行期间退出，本次未完成；任务已恢复可运行。', now());
        store.run('UPDATE tasks SET running=0 WHERE running=1');
      });
      recoverRunningResumableRuns(store);
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
      if (typeof resumeRun === 'function') {
        const dueResumes = listDueResumableRuns(store, time);
        for (const item of dueResumes) {
          if (activeModelTasks >= 3) break;
          const work = (async () => {
            activeModelTasks++;
            try { await resumeRun(item.id, { scheduled: true, time }); }
            catch (error) {
              if (error?.status !== 409 && error?.status !== 404) console.error('断点任务自动恢复失败。');
            } finally { activeModelTasks--; }
          })();
          inFlight.add(work);
          void work.then(() => inFlight.delete(work), () => inFlight.delete(work));
        }
      }
      if (!automaticWork) {
        automaticWork = memory.automatic().catch(() => console.error('自动记忆总结失败，请检查数据库状态。'))
          .finally(() => { automaticWork = null; });
      }
      if (autonomy && !autonomousWork) {
        autonomousWork = autonomy.evaluate(time).catch(() => console.error('自主行为评估失败，请检查数据库状态。'))
          .finally(() => { autonomousWork = null; });
      }
      return wait ? Promise.all([...inFlight, automaticWork, autonomousWork]) : Promise.resolve();
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
      await Promise.allSettled([...inFlight, ...(automaticWork ? [automaticWork] : []), ...(autonomousWork ? [autonomousWork] : [])]);
    },
  };
  return scheduler;
}



