import * as Primitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';

export function EventDialog({ open, onClose, title, children, testId, fullscreen = false }: { open: boolean; onClose: () => void; title: string; children: ReactNode; testId?: string; fullscreen?: boolean }) {
  const { t } = useTranslation();
  return <Primitive.Root open={open} onOpenChange={v => { if (!v) onClose(); }}><Primitive.Portal>
    <Primitive.Overlay className="fixed inset-0 z-50 bg-foreground/70" />
    <Primitive.Content data-testid={testId} aria-describedby={undefined} className={fullscreen ? 'fixed inset-0 z-50 flex flex-col bg-background p-4 sm:p-6' : 'fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-2xl max-h-[90dvh] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border bg-background p-5 shadow-soft sm:p-6'}>
      <div className="mb-5 flex items-center justify-between gap-4"><Primitive.Title className="text-xl font-semibold">{title}</Primitive.Title><Button type="button" size="icon" variant="ghost" aria-label={t('events.close')} onClick={onClose}><X /></Button></div>
      {children}
    </Primitive.Content>
  </Primitive.Portal></Primitive.Root>;
}
