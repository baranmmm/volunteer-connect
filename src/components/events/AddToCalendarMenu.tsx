import { CalendarPlus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { eventIcs, googleCalendarUrl, isScheduled, outlookCalendarUrl, type HubEvent } from '@/lib/event-rules';
import type { SeriesInfo } from '@/lib/recurrence';

function isAppleMobile() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/** With `series`, Google and .ics add the whole series (RRULE, EXDATE); Outlook links add this occurrence. */
export function AddToCalendarMenu({ event, url, series }: { event: HubEvent; url: string; series?: SeriesInfo | null }) {
  const { t } = useTranslation();
  const [apple, setApple] = useState(false);
  useEffect(() => { setApple(isAppleMobile()); }, []);
  const scheduled = isScheduled(event);
  function downloadIcs() {
    const blob = new Blob([eventIcs(event, url, new Date(), series)], { type: 'text/calendar;charset=utf-8' });
    const object = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = object; a.download = series ? `series-${series.id}.ics` : `event-${event.id}.ics`; a.click();
    setTimeout(() => URL.revokeObjectURL(object), 1000);
  }
  const open = (href: string) => window.open(href, '_blank', 'noopener,noreferrer');
  const ics = <DropdownMenuItem key="ics" data-testid="add-to-calendar-ics" onSelect={downloadIcs}>{t('events.calendarIcs')}</DropdownMenuItem>;
  const others = [
    <DropdownMenuItem key="google" data-testid="add-to-calendar-google" onSelect={() => open(googleCalendarUrl(event, url, series))}>{t('events.calendarGoogle')}</DropdownMenuItem>,
    <DropdownMenuItem key="outlook" data-testid="add-to-calendar-outlook" onSelect={() => open(outlookCalendarUrl(event, url))}>{t('events.calendarOutlook')}</DropdownMenuItem>,
    <DropdownMenuItem key="work" data-testid="add-to-calendar-outlook-work" onSelect={() => open(outlookCalendarUrl(event, url, true))}>{t('events.calendarOutlookWork')}</DropdownMenuItem>,
  ];
  return <div data-testid="event-add-to-calendar">
    <DropdownMenu>
      <DropdownMenuTrigger asChild><Button data-testid="event-add-to-calendar-button" disabled={!scheduled} variant="outline" className="h-11 w-full sm:w-auto"><CalendarPlus />{t('events.addToCalendar')}</Button></DropdownMenuTrigger>
      <DropdownMenuContent align="start">{apple ? [ics, ...others] : [...others, ics]}</DropdownMenuContent>
    </DropdownMenu>
  </div>;
}
