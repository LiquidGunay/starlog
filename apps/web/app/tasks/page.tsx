"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";

import { SessionControls } from "../components/session-controls";
import { readEntitySnapshot, writeEntitySnapshot } from "../lib/entity-snapshot";
import { applyOptimisticTasks } from "../lib/optimistic-state";
import { apiRequest } from "../lib/starlog-client";
import { useSessionConfig } from "../session-provider";

type Task = {
  id: string;
  title: string;
  status: string;
  estimate_min?: number | null;
  priority: number;
  due_at?: string | null;
  linked_note_id?: string | null;
  source_artifact_id?: string | null;
  created_at: string;
  updated_at: string;
  pending?: boolean;
  pendingLabel?: string;
};

const TASKS_SNAPSHOT = "tasks.items";
const TASK_SELECTED_SNAPSHOT = "tasks.selected";

function TasksPageContent() {
  const searchParams = useSearchParams();
  const { apiBase, token, outbox, mutateWithQueue } = useSessionConfig();
  const [tasks, setTasks] = useState<Task[]>(() => readEntitySnapshot<Task[]>(TASKS_SNAPSHOT, []));
  const [selectedId, setSelectedId] = useState(() => readEntitySnapshot<string>(TASK_SELECTED_SNAPSHOT, ""));
  const [title, setTitle] = useState("New task");
  const [taskStatus, setTaskStatus] = useState("todo");
  const [estimateMin, setEstimateMin] = useState("30");
  const [priority, setPriority] = useState("3");
  const [dueAt, setDueAt] = useState("");
  const [filter, setFilter] = useState("all");
  const [status, setStatus] = useState("Ready");

  const optimisticTasks = useMemo(() => applyOptimisticTasks(tasks, outbox), [tasks, outbox]);
  const visibleTasks =
    filter === "all" ? optimisticTasks : optimisticTasks.filter((task) => task.status === filter);
  const selectedTask = optimisticTasks.find((task) => task.id === selectedId) ?? null;

  useEffect(() => {
    setTasks((previous) => previous.length > 0 ? previous : readEntitySnapshot<Task[]>(TASKS_SNAPSHOT, []));
    setSelectedId((previous) => previous || readEntitySnapshot<string>(TASK_SELECTED_SNAPSHOT, ""));
  }, []);

  const loadTasks = useCallback(async () => {
    try {
      const path = filter === "all" ? "/v1/tasks" : `/v1/tasks?status=${filter}`;
      const payload = await apiRequest<Task[]>(apiBase, token, path);
      setTasks(payload);
      writeEntitySnapshot(TASKS_SNAPSHOT, payload);
      setStatus(`Loaded ${payload.length} tasks`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Failed to load tasks";
      setStatus(tasks.length > 0 ? `Loaded cached tasks. ${detail}` : detail);
    }
  }, [apiBase, filter, tasks.length, token]);

  function selectTask(task: Task) {
    setSelectedId(task.id);
    setTitle(task.title);
    setTaskStatus(task.status);
    setEstimateMin(task.estimate_min ? String(task.estimate_min) : "");
    setPriority(String(task.priority));
    setDueAt(task.due_at ? task.due_at.slice(0, 16) : "");
  }

  function clearEditor() {
    setSelectedId("");
    setTitle("New task");
    setTaskStatus("todo");
    setEstimateMin("30");
    setPriority("3");
    setDueAt("");
  }

  async function createTask() {
    try {
      const result = await mutateWithQueue<Task>(
        "/v1/tasks",
        {
          method: "POST",
          body: JSON.stringify({
            title: title.trim() || "New task",
            status: taskStatus,
            estimate_min: estimateMin ? Number(estimateMin) : undefined,
            priority: Number(priority || "3"),
            due_at: dueAt ? new Date(dueAt).toISOString() : undefined,
          }),
        },
        {
          label: `Create task: ${title.trim() || "New task"}`,
          entity: "task",
          op: "create",
        },
      );
      if (result.queued || !result.data) {
        clearEditor();
        setStatus("Task creation queued for replay");
        return;
      }

      setStatus(`Created task ${result.data.id}`);
      await loadTasks();
      selectTask(result.data);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to create task");
    }
  }

  async function saveTask() {
    if (!selectedTask) {
      setStatus("Select an existing task or create a new one");
      return;
    }
    if (selectedTask.id.startsWith("pending:")) {
      setStatus("Replay queued task creation before editing it again");
      return;
    }

    try {
      const result = await mutateWithQueue<Task>(
        `/v1/tasks/${selectedTask.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            title: title.trim() || selectedTask.title,
            status: taskStatus,
            estimate_min: estimateMin ? Number(estimateMin) : undefined,
            priority: Number(priority || "3"),
            due_at: dueAt ? new Date(dueAt).toISOString() : null,
          }),
        },
        {
          label: `Update task: ${selectedTask.title}`,
          entity: "task",
          op: "update",
        },
      );
      if (result.queued || !result.data) {
        setStatus("Task update queued for replay");
        return;
      }

      setStatus(`Saved task ${result.data.id}`);
      await loadTasks();
      selectTask(result.data);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to save task");
    }
  }

  async function quickStatus(task: Task, nextStatus: string) {
    if (task.id.startsWith("pending:")) {
      setStatus("Replay queued task creation before changing status");
      return;
    }

    try {
      const result = await mutateWithQueue<Task>(
        `/v1/tasks/${task.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ status: nextStatus }),
        },
        {
          label: `Set task ${task.title} to ${nextStatus}`,
          entity: "task",
          op: "update",
        },
      );
      setStatus(
        result.queued
          ? `Queued status update for ${task.title}`
          : `Updated ${task.title} to ${nextStatus}`,
      );
      if (!result.queued) {
        await loadTasks();
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to update task status");
    }
  }

  useEffect(() => {
    if (!token) {
      return;
    }
    loadTasks().catch(() => undefined);
  }, [loadTasks, token]);

  useEffect(() => {
    const requestedId = searchParams.get("task");
    if (!requestedId) {
      return;
    }
    const requestedTask = optimisticTasks.find((task) => task.id === requestedId);
    if (requestedTask) {
      selectTask(requestedTask);
    }
  }, [optimisticTasks, searchParams]);

  useEffect(() => {
    writeEntitySnapshot(TASK_SELECTED_SNAPSHOT, selectedId);
  }, [selectedId]);

  return (
    <main className="shell">
      <section className="workspace glass">
        <SessionControls />
        <div>
          <p className="eyebrow">Tasks</p>
          <h1>Execution workspace</h1>
          <p className="console-copy">
            Create and update tasks in the PWA, with queued mutations kept visible until replay.
          </p>
          <label className="label" htmlFor="task-title">Title</label>
          <input
            id="task-title"
            className="input"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
          <label className="label" htmlFor="task-status">Status</label>
          <input
            id="task-status"
            className="input"
            value={taskStatus}
            onChange={(event) => setTaskStatus(event.target.value)}
          />
          <label className="label" htmlFor="task-estimate">Estimate minutes</label>
          <input
            id="task-estimate"
            className="input"
            value={estimateMin}
            onChange={(event) => setEstimateMin(event.target.value)}
          />
          <label className="label" htmlFor="task-priority">Priority (1-5)</label>
          <input
            id="task-priority"
            className="input"
            value={priority}
            onChange={(event) => setPriority(event.target.value)}
          />
          <label className="label" htmlFor="task-due">Due at</label>
          <input
            id="task-due"
            className="input"
            type="datetime-local"
            value={dueAt}
            onChange={(event) => setDueAt(event.target.value)}
          />
          <div className="button-row">
            <button className="button" type="button" onClick={() => createTask()}>Create Task</button>
            <button className="button" type="button" onClick={() => saveTask()}>Save Selected</button>
            <button className="button" type="button" onClick={() => clearEditor()}>Clear</button>
          </div>
          <p className="status">{status}</p>
        </div>

        <div className="panel glass">
          <h2>Task list</h2>
          <div className="button-row">
            <button className="button" type="button" onClick={() => setFilter("all")}>All</button>
            <button className="button" type="button" onClick={() => setFilter("todo")}>Todo</button>
            <button className="button" type="button" onClick={() => setFilter("doing")}>Doing</button>
            <button className="button" type="button" onClick={() => setFilter("done")}>Done</button>
            <button className="button" type="button" onClick={() => loadTasks()}>Refresh</button>
          </div>
          {visibleTasks.length === 0 ? (
            <p className="console-copy">No tasks for this filter.</p>
          ) : (
            <ul>
              {visibleTasks.map((task) => (
                <li key={task.id}>
                  <button className="button" type="button" onClick={() => selectTask(task)}>
                    {task.title}
                  </button>
                  <p className="console-copy">
                    {task.status} | priority {task.priority}
                    {task.estimate_min ? ` | ${task.estimate_min} min` : ""}
                  </p>
                  {task.due_at ? (
                    <p className="console-copy">Due: {new Date(task.due_at).toLocaleString()}</p>
                  ) : null}
                  {task.pending ? (
                    <p className="console-copy">Pending: {task.pendingLabel || "queued mutation"}</p>
                  ) : null}
                  <div className="button-row">
                    <button className="button" type="button" onClick={() => quickStatus(task, "todo")}>Todo</button>
                    <button className="button" type="button" onClick={() => quickStatus(task, "doing")}>Doing</button>
                    <button className="button" type="button" onClick={() => quickStatus(task, "done")}>Done</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </main>
  );
}

export default function TasksPage() {
  return (
    <Suspense fallback={<main className="shell"><section className="workspace glass"><p className="status">Loading tasks...</p></section></main>}>
      <TasksPageContent />
    </Suspense>
  );
}
