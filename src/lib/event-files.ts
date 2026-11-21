import { supabase } from '@/integrations/supabase/client';
import { imageDimensions, validateEventFile } from './event-rules';

/** Canvas encoding creates new pixels-only images: metadata, including EXIF/GPS, is not copied. */
export async function prepareEventFile(file: File, count: number): Promise<File> {
  validateEventFile(file, count);
  if (file.type === 'application/pdf') return file;
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const dimensions = imageDimensions(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = dimensions.width; canvas.height = dimensions.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Invalid event file');
    context.drawImage(bitmap, 0, 0, dimensions.width, dimensions.height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('Invalid event file')), file.type, 0.88));
    const extension = file.type === 'image/jpeg' ? 'jpg' : file.type.split('/')[1];
    const prepared = new File([blob], `${file.name.replace(/\.[^.]+$/, '')}.${extension}`, { type: blob.type });
    validateEventFile(prepared, count);
    return prepared;
  } finally { bitmap.close(); }
}
export async function uploadEventFile(path: string, file: File) {
  const { error } = await supabase.storage.from('event-media').upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw error;
}
export async function removeStoredEventFile(path: string) {
  const { error } = await supabase.storage.from('event-media').remove([path]);
  if (error) throw error;
}
