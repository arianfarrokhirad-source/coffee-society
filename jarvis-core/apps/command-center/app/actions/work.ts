'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { PRIORITY_LEVELS } from '@jarvis/shared'
import { buildAuditEvent } from '@jarvis/security'
import { getAuthContext } from '@/lib/auth'
import { getStore } from '@/lib/jarvis'
import { createUserClient } from '@/lib/supabase/server'

// Work-item mutations run through the USER's RLS-scoped client — the
// database enforces business scope and role access; these actions add
// input validation and audit logging on top.

export interface ActionState {
  error: string | null
  ok?: boolean
}

const priority = z.enum(PRIORITY_LEVELS)
const uuid = z.string().uuid()
const dateStr = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional()
  .or(z.literal('').transform(() => undefined))

async function audit(
  action: string,
  resourceType: string,
  resourceId: string | null,
  businessId: string | null
) {
  const auth = await getAuthContext()
  await getStore().writeAudit(
    buildAuditEvent({
      organizationId: auth?.organizationId ?? null,
      businessId,
      actorType: 'user',
      actorId: auth?.userId ?? null,
      action,
      resourceType,
      resourceId,
    })
  )
}

export async function createObjective(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const auth = await getAuthContext()
  if (!auth?.hasMembership || !auth.organizationId) return { error: 'No active membership.' }
  const parsed = z
    .object({
      title: z.string().min(1).max(300),
      businessId: uuid.optional().or(z.literal('').transform(() => undefined)),
      priority: priority.default('P2'),
      targetDate: dateStr,
      description: z.string().max(5000).optional(),
    })
    .safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: 'Invalid objective input.' }

  const supabase = await createUserClient()
  const { data, error } = await supabase
    .from('objectives')
    .insert({
      organization_id: auth.organizationId,
      business_id: parsed.data.businessId ?? null,
      title: parsed.data.title,
      description: parsed.data.description || null,
      priority: parsed.data.priority,
      target_date: parsed.data.targetDate ?? null,
      status: 'active',
      created_by: auth.userId,
    })
    .select('id')
    .single()
  if (error) return { error: 'Could not create objective (check your access).' }
  await audit('objective.created', 'objective', data.id, parsed.data.businessId ?? null)
  revalidatePath('/objectives')
  return { error: null, ok: true }
}

export async function createProject(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const auth = await getAuthContext()
  if (!auth?.hasMembership || !auth.organizationId) return { error: 'No active membership.' }
  const parsed = z
    .object({
      name: z.string().min(1).max(300),
      businessId: uuid,
      priority: priority.default('P2'),
      dueDate: dateStr,
      description: z.string().max(5000).optional(),
    })
    .safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: 'Invalid project input (business is required).' }

  const supabase = await createUserClient()
  const { data, error } = await supabase
    .from('projects')
    .insert({
      organization_id: auth.organizationId,
      business_id: parsed.data.businessId,
      name: parsed.data.name,
      description: parsed.data.description || null,
      priority: parsed.data.priority,
      due_date: parsed.data.dueDate ?? null,
      created_by: auth.userId,
    })
    .select('id')
    .single()
  if (error) return { error: 'Could not create project (check your access).' }
  await audit('project.created', 'project', data.id, parsed.data.businessId)
  revalidatePath('/projects')
  return { error: null, ok: true }
}

export async function createTaskAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const auth = await getAuthContext()
  if (!auth?.hasMembership || !auth.organizationId) return { error: 'No active membership.' }
  const parsed = z
    .object({
      title: z.string().min(1).max(300),
      businessId: uuid,
      priority: priority.default('P2'),
      dueDate: dateStr,
      description: z.string().max(5000).optional(),
    })
    .safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: 'Invalid task input (business is required).' }

  const supabase = await createUserClient()
  const { data, error } = await supabase
    .from('tasks')
    .insert({
      organization_id: auth.organizationId,
      business_id: parsed.data.businessId,
      title: parsed.data.title,
      description: parsed.data.description || null,
      priority: parsed.data.priority,
      due_date: parsed.data.dueDate ?? null,
      created_by: auth.userId,
    })
    .select('id')
    .single()
  if (error) return { error: 'Could not create task (check your access).' }
  await audit('task.created', 'task', data.id, parsed.data.businessId)
  await getStore().createSystemEvent({
    organizationId: auth.organizationId,
    businessId: parsed.data.businessId,
    eventType: 'task.created',
    payload: { taskId: data.id },
    dedupeKey: data.id,
  })
  revalidatePath('/tasks')
  return { error: null, ok: true }
}

export async function updateTaskStatus(taskId: string, status: string): Promise<ActionState> {
  const auth = await getAuthContext()
  if (!auth?.hasMembership) return { error: 'No active membership.' }
  const parsed = z
    .object({
      taskId: uuid,
      status: z.enum(['todo', 'in_progress', 'blocked', 'review', 'done', 'cancelled']),
    })
    .safeParse({ taskId, status })
  if (!parsed.success) return { error: 'Invalid status change.' }

  const supabase = await createUserClient()
  const { error } = await supabase
    .from('tasks')
    .update({
      status: parsed.data.status,
      ...(parsed.data.status === 'done' ? { completed_at: new Date().toISOString() } : {}),
    })
    .eq('id', parsed.data.taskId)
  if (error) return { error: 'Could not update task.' }
  await audit('task.status_changed', 'task', parsed.data.taskId, null)
  revalidatePath('/tasks')
  return { error: null, ok: true }
}

export async function recordDecisionAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const auth = await getAuthContext()
  if (!auth?.hasMembership || !auth.organizationId) return { error: 'No active membership.' }
  const parsed = z
    .object({
      title: z.string().min(1).max(300),
      decision: z.string().min(1).max(5000),
      businessId: uuid.optional().or(z.literal('').transform(() => undefined)),
      context: z.string().max(5000).optional(),
      rationale: z.string().max(5000).optional(),
    })
    .safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: 'Invalid decision input.' }

  const supabase = await createUserClient()
  const { data, error } = await supabase
    .from('decisions')
    .insert({
      organization_id: auth.organizationId,
      business_id: parsed.data.businessId ?? null,
      title: parsed.data.title,
      decision: parsed.data.decision,
      context: parsed.data.context || null,
      rationale: parsed.data.rationale || null,
      decided_by: auth.userId,
    })
    .select('id')
    .single()
  if (error) return { error: 'Could not record decision (check your access).' }
  await audit('decision.recorded', 'decision', data.id, parsed.data.businessId ?? null)
  await getStore().createSystemEvent({
    organizationId: auth.organizationId,
    eventType: 'decision.recorded',
    payload: { decisionId: data.id },
    dedupeKey: data.id,
  })
  revalidatePath('/decisions')
  return { error: null, ok: true }
}
