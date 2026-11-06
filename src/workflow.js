// Minimal workflow engine for service catalog fulfilment: approvals, tasks and
// notifications with dependencies (parallel branches) and conditional steps.

function test(cond, values) {
  if (!cond) return true;
  const v = values[cond.field];
  switch (cond.op) {
    case 'eq': return v === cond.value;
    case 'neq': return v !== cond.value;
    case 'gt': return Number(v) > Number(cond.value);
    case 'lt': return Number(v) < Number(cond.value);
    default: return true;
  }
}

/** Create a workflow instance from a definition and form values. */
export function instantiate(definition, values) {
  const wf = {
    status: 'running',
    steps: definition.map((s) => ({ ...s, dependsOn: s.dependsOn || [], status: 'waiting', completedAt: null, completedBy: null })),
  };
  return advance(wf, values);
}

/**
 * Move the workflow forward: skip steps whose condition is false, activate
 * steps whose dependencies are all finished, auto-complete notifications.
 */
export function advance(wf, values, now = new Date().toISOString()) {
  let changed = true;
  while (changed) {
    changed = false;
    for (const s of wf.steps) {
      if (s.status !== 'waiting') continue;
      const deps = s.dependsOn.map((id) => wf.steps.find((x) => x.id === id));
      if (deps.some((d) => d.status === 'rejected')) { s.status = 'cancelled'; changed = true; continue; }
      if (!deps.every((d) => ['done', 'skipped', 'approved'].includes(d.status))) continue;
      if (!test(s.condition, values)) { s.status = 'skipped'; changed = true; continue; }
      if (s.type === 'notify') { s.status = 'done'; s.completedAt = now; s.completedBy = 'workflow'; changed = true; continue; }
      s.status = 'active';
      changed = true;
    }
  }
  if (wf.steps.some((s) => s.status === 'rejected')) wf.status = 'rejected';
  else if (wf.steps.every((s) => ['done', 'skipped', 'approved', 'cancelled'].includes(s.status))) wf.status = 'completed';
  else wf.status = 'running';
  return wf;
}

/** Complete an active step. decision: 'approve' | 'reject' | 'done'. */
export function completeStep(wf, stepId, decision, actor, values) {
  const s = wf.steps.find((x) => x.id === stepId);
  if (!s) throw Object.assign(new Error(`Unknown step ${stepId}`), { status: 404 });
  if (s.status !== 'active') throw Object.assign(new Error(`Step ${stepId} is ${s.status}, not active`), { status: 409 });
  if (s.type === 'approval') s.status = decision === 'reject' ? 'rejected' : 'approved';
  else s.status = 'done';
  s.completedAt = new Date().toISOString();
  s.completedBy = actor;
  return advance(wf, values);
}
