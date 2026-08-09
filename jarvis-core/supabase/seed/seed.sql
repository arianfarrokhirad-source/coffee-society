-- =====================================================================
-- Seed — organization, roles, permissions, businesses A00–A08, agents.
-- Idempotent: safe to re-run. No personal data, no secrets.
-- PRIME is assigned later via public.claim_prime() by the first
-- authenticated user (see docs/setup/supabase.md).
-- =====================================================================

-- Organization (holding company)
insert into public.organizations (name, slug)
values ('ATLAS Holdings', 'atlas-holdings')
on conflict (slug) do nothing;

-- Roles
insert into public.roles (key, name, description, default_authority_level) values
  ('prime',            'PRIME',            'Founder. Highest authority.',                'L5'),
  ('executive',        'Executive',        'Org-wide executive staff.',                  'L3'),
  ('business_manager', 'Business Manager', 'Manages one or more businesses.',            'L2'),
  ('employee',         'Employee',         'Business-scoped staff.',                     'L1'),
  ('contractor',       'Contractor',       'External contractor, limited scope.',        'L1'),
  ('client',           'Client',           'External client. No internal data access.',  'L0'),
  ('agent',            'Agent',            'AI agent identity. Server-mediated only.',   'L1')
on conflict (key) do nothing;

-- Permissions (action types the permission engine understands)
insert into public.permissions (key, description, min_authority) values
  ('business.read',        'Read business summaries and records',        'L0'),
  ('task.read',            'Read tasks',                                 'L0'),
  ('task.create',          'Create tasks',                               'L1'),
  ('task.update',          'Update tasks',                               'L2'),
  ('project.read',         'Read projects',                              'L0'),
  ('project.create',       'Create projects',                            'L2'),
  ('objective.read',       'Read objectives',                            'L0'),
  ('objective.create',     'Create objectives',                          'L2'),
  ('decision.read',        'Read decisions',                             'L0'),
  ('decision.record',      'Record a decision',                          'L2'),
  ('approval.read',        'Read approvals',                             'L0'),
  ('approval.request',     'Create an approval request',                 'L1'),
  ('approval.resolve',     'Approve or reject approvals',                'L5'),
  ('document.read',        'Read document metadata / search documents',  'L0'),
  ('document.write',       'Create or update document metadata',         'L2'),
  ('brief.generate',       'Generate the daily PRIME brief',             'L2'),
  ('agent.run',            'Execute agent runs',                         'L1'),
  ('external.execute',     'Execute an approved external action',        'L3'),
  ('finance.execute',      'Execute financial actions (always gated)',   'L5')
on conflict (key) do nothing;

-- Role permission grants (users; agents are governed by agents table +
-- agent_permissions and the server-side permission engine).
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on (
  (r.key = 'prime') -- prime: everything
  or (r.key = 'executive' and p.key not in ('approval.resolve', 'finance.execute'))
  or (r.key = 'business_manager' and p.key in
      ('business.read', 'task.read', 'task.create', 'task.update', 'project.read', 'project.create',
       'objective.read', 'objective.create', 'decision.read', 'decision.record', 'approval.read',
       'approval.request', 'document.read', 'document.write', 'brief.generate', 'agent.run'))
  or (r.key = 'employee' and p.key in
      ('business.read', 'task.read', 'task.create', 'project.read', 'objective.read',
       'decision.read', 'approval.read', 'approval.request', 'document.read', 'agent.run'))
  or (r.key = 'contractor' and p.key in ('task.read', 'task.create', 'project.read', 'document.read'))
)
on conflict do nothing;

-- Businesses A00–A08
with org as (select id from public.organizations where slug = 'atlas-holdings')
insert into public.businesses (organization_id, code, name, description, status, agents_enabled)
select org.id, v.code, v.name, v.description, v.status::public.business_status, v.agents_enabled
from org,
  (values
    ('A00', 'ATLAS',   'Holding company, executive command and shared services.', 'active',  true),
    ('A01', 'FORGE',   'Creates, manages and improves websites for small businesses.', 'active', true),
    ('A02', 'SIGNAL',  'Marketing for internal companies and external clients.',  'active',  true),
    ('A03', 'VECTOR',  'Business development, management consulting, business plans and execution.', 'active', true),
    ('A04', 'ORACLE',  'Accounting, CFO support, treasury, forecasting and controlled investment research.', 'active', true),
    ('A05', 'TEMPO',   'Luxury fashion brand focused on time, experience, love, memory and exclusivity.', 'active', true),
    ('A06', 'ECHO',    'Music and entertainment company managing artists, releases, rights and distribution.', 'active', true),
    ('A07', 'ACADEMY', 'Teaching and education platform.',                        'active',  true),
    ('A08', 'VOID',    'Reserved future business. Dormant by default.',           'dormant', false)
  ) as v(code, name, description, status, agents_enabled)
on conflict (organization_id, code) do nothing;

-- Agents. Default authority is L1 (draft and recommend). Financial
-- authority is zero for every agent in Phase 1.
with org as (select id from public.organizations where slug = 'atlas-holdings'),
     biz as (select id, code from public.businesses where organization_id = (select id from org))
insert into public.agents
  (organization_id, business_id, code, name, description, authority_level,
   allowed_action_types, prohibited_action_types, max_financial_authority, active, status)
select
  (select id from org),
  (select id from biz where biz.code = v.business_code),
  v.code, v.name, v.description, v.authority::public.authority_level,
  v.allowed, v.prohibited, 0, v.active,
  case when v.active then 'active' else 'inactive' end
from (values
  ('JVS-00', null, 'JARVIS Core Orchestrator',
   'Routes requests, classifies intent, selects agents and models, enforces policy.',
   'L1',
   array['classify', 'route', 'summarize', 'read_internal'],
   array['external_side_effect', 'financial_execution', 'permission_change'],
   true),
  ('A00-GM', 'A00', 'ATLAS Executive Agent',
   'Executive analysis and cross-business coordination for the holding company.',
   'L1', array['read_internal', 'draft', 'recommend'],
   array['external_side_effect', 'financial_execution', 'permission_change'], true),
  ('A01-GM', 'A01', 'FORGE General Manager Agent',
   'Website business operations: leads, audits, proposals, delivery.',
   'L1', array['read_internal', 'draft', 'recommend', 'create_task'],
   array['external_side_effect', 'financial_execution', 'client_messaging'], true),
  ('A02-GM', 'A02', 'SIGNAL General Manager Agent',
   'Marketing strategy and campaign planning.',
   'L1', array['read_internal', 'draft', 'recommend', 'create_task'],
   array['external_side_effect', 'financial_execution', 'public_publishing'], true),
  ('A03-GM', 'A03', 'VECTOR General Manager Agent',
   'Consulting, business plans and execution support.',
   'L1', array['read_internal', 'draft', 'recommend', 'create_task'],
   array['external_side_effect', 'financial_execution'], true),
  ('A04-CFO', 'A04', 'ORACLE CFO Agent',
   'Accounting, forecasting and investment research. Research only — never execution.',
   'L1', array['read_internal', 'draft', 'recommend'],
   array['external_side_effect', 'financial_execution', 'trading', 'money_transfer'], true),
  ('A05-CD', 'A05', 'TEMPO Creative Director Agent',
   'Brand, collections and creative direction.',
   'L1', array['read_internal', 'draft', 'recommend', 'create_task'],
   array['external_side_effect', 'financial_execution', 'public_publishing'], true),
  ('A06-LD', 'A06', 'ECHO Label Director Agent',
   'Artists, releases, rights and distribution planning.',
   'L1', array['read_internal', 'draft', 'recommend', 'create_task'],
   array['external_side_effect', 'financial_execution', 'public_publishing'], true),
  ('A07-AD', 'A07', 'ACADEMY Academic Director Agent',
   'Curriculum and education platform planning.',
   'L1', array['read_internal', 'draft', 'recommend', 'create_task'],
   array['external_side_effect', 'financial_execution'], true),
  ('A08-RSV', 'A08', 'VOID Reserved Agent',
   'Reserved. Inactive until VOID is activated.',
   'L0', array[]::text[],
   array['external_side_effect', 'financial_execution'], false)
) as v(code, business_code, name, description, authority, allowed, prohibited, active)
on conflict (organization_id, code) do nothing;
