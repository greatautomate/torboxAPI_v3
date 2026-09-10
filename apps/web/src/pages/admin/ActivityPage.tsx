import { PageHeader } from '../../components/admin/PageHeader';
import { ActivityView } from '../../components/admin/ActivityView';

export function ActivityPage() {
  return (
    <div>
      <PageHeader title="Activity" description="What consumers submitted (magnets, URLs, NZBs), what TorBox generated (CDN links, streams) and control actions." />
      <ActivityView />
    </div>
  );
}
