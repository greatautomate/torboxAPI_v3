import { PageHeader } from '../../components/admin/PageHeader';
import { LogsView } from '../../components/admin/LogsView';

export function LogsPage() {
  return (
    <div>
      <PageHeader title="Request logs" description="Every request that hit the gateway: route, status, latency, cache and upstream outcome." />
      <LogsView />
    </div>
  );
}
