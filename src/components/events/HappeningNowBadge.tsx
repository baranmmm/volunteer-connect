import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { eventTimeState } from '@/lib/event-rules';
import type { HubEvent } from '@/lib/event-rules';

export function HappeningNowBadge({ event, now }: { event: HubEvent; now: Date }) {
  const { t } = useTranslation();
  if (!eventTimeState(event, now).happeningNow) return null;
  return <Badge data-testid="event-badge-happening-now" variant="secondary">{t('events.happeningNow')}</Badge>;
}