import { Badge, Card } from '@jarvis/ui'
import { listIntegrations } from '@jarvis/integrations'
import { getAuthContext } from '@/lib/auth'
import { providerStatus } from '@/lib/jarvis'

export const dynamic = 'force-dynamic'

export default async function SettingsPage() {
  const auth = await getAuthContext()
  const providers = providerStatus()
  const integrations = listIntegrations()

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-bold text-white">Settings</h1>
      </header>

      <Card title="Account">
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted">Email</dt>
            <dd>{auth?.email ?? '—'}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted">Role</dt>
            <dd>
              {auth?.isPrime
                ? 'PRIME (founder)'
                : (auth?.memberships[0]?.roleKey ?? 'no membership')}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted">Authority</dt>
            <dd>{auth?.authority ?? 'L0'}</dd>
          </div>
        </dl>
      </Card>

      <Card title="AI providers">
        <p className="mb-3 text-xs text-muted">
          Keys are server-side only; this shows configuration status, never values.
        </p>
        <div className="flex gap-3">
          <Badge tone={providers.anthropic ? 'ok' : 'muted'}>
            Anthropic {providers.anthropic ? 'configured' : 'not configured'}
          </Badge>
          <Badge tone={providers.openai ? 'ok' : 'muted'}>
            OpenAI {providers.openai ? 'configured' : 'not configured'}
          </Badge>
        </div>
      </Card>

      <Card title="External integrations">
        <p className="mb-3 text-xs text-muted">
          All adapters ship disabled. Enabling one requires credentials, a passing connection test
          and PRIME approval (integration.connect is an always-approval action).
        </p>
        <table className="data">
          <thead>
            <tr>
              <th>Integration</th>
              <th>Status</th>
              <th>Allowed actions</th>
            </tr>
          </thead>
          <tbody>
            {integrations.map((i) => (
              <tr key={i.name}>
                <td>{i.name}</td>
                <td>
                  <Badge tone={i.status === 'connected' ? 'ok' : 'muted'}>{i.status}</Badge>
                </td>
                <td className="text-muted">{i.allowedActions.join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  )
}
