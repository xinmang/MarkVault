import { Link } from 'react-router-dom'
import { usePlugins } from './context'
import { SandboxPanel } from './SandboxPanel'

export function PluginSlot({ name, actions = false }: { name: string; actions?: boolean }) {
  const { directory, safe } = usePlugins()
  if (safe || !directory) return null
  const contributions = directory.plugins
    .filter((p) => p.status === 'running' && p.origin !== 'builtin')
    .flatMap((plugin) =>
      plugin.manifest.contributes
        .filter((c) => c.slot === name && c.entry)
        .map((contribution) => ({ plugin, contribution }))
    )
  if (!contributions.length) return null
  return (
    <div className={actions ? 'flex flex-wrap gap-2' : 'space-y-4'}>
      {contributions.map(({ plugin, contribution }) =>
        actions ? (
          <Link
            key={plugin.manifest.id + contribution.id}
            to={'/p/' + plugin.manifest.id + '/' + contribution.id}
            className="btn btn-sm btn-secondary"
          >
            {contribution.title}
          </Link>
        ) : (
          <section key={plugin.manifest.id + contribution.id}>
            <h2 className="font-semibold mb-2">{contribution.title}</h2>
            <SandboxPanel plugin={plugin} entry={contribution.entry!} />
          </section>
        )
      )}
    </div>
  )
}
