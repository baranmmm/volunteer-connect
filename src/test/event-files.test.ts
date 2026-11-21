import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ upload: vi.fn(), remove: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { storage: { from: () => mocks } } }));
import { prepareEventFile, uploadEventFile } from '@/lib/event-files';
beforeEach(() => vi.resetAllMocks());
describe('event file uploads', () => {
  it('passes PDF bytes unchanged', async () => {
    const file = new File(['%PDF-1.4'], 'leaflet.pdf', { type: 'application/pdf' });
    expect(await prepareEventFile(file, 0)).toBe(file);
  });
  it('rejects a text file before reservation or upload', async () => {
    await expect(prepareEventFile(new File(['text'], 'rejected.txt', { type: 'text/plain' }), 0)).rejects.toThrow('Invalid event file');
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it('rejects files over 10 MB before re-encoding', async () => {
    const file = new File([new Uint8Array(10485761)], 'large.png', { type: 'image/png' });
    await expect(prepareEventFile(file, 0)).rejects.toThrow('Event file exceeds 10 MB');
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it('sends an explicit JPEG content type and never overwrites a stored object', async () => {
    mocks.upload.mockResolvedValue({ error: null });
    const file = new File(['pixels'], 'phone.jpg', { type: 'image/jpeg' });
    await uploadEventFile('event/media.jpg', file);
    expect(mocks.upload).toHaveBeenCalledWith('event/media.jpg', file, { contentType: 'image/jpeg', upsert: false });
  });
  it('turns bucket MIME rejection into a specific validation error', async () => {
    mocks.upload.mockResolvedValue({ error: { code: 'InvalidMimeType', message: 'Rejected' } });
    await expect(uploadEventFile('event/media.jpg', new File([], 'phone.jpeg'))).rejects.toThrow('Invalid event file');
  });
  it('turns bucket size rejection into a specific 10 MB error', async () => {
    mocks.upload.mockResolvedValue({ error: { code: 'EntityTooLarge', message: 'Rejected' } });
    await expect(uploadEventFile('event/media.png', new File([], 'large.png'))).rejects.toThrow('Event file exceeds 10 MB');
  });
});