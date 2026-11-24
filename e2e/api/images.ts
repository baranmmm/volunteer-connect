// Test images and the event-media objects of an event (service role, read only): resized copies of event images are
// stored next to the original as <name>.w640.webp and <name>.w1280.webp.
import { crc32, deflateSync } from "node:zlib";
import { adminClient } from "./SupabaseClient";

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([length, body, crc]);
}

/** A solid-colour RGB PNG of the given size (large enough for both resized copies, small in bytes). */
export function solidPng(width: number, height: number, rgb: [number, number, number] = [0, 109, 156]): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.writeUInt8(8, 8); // bit depth
  header.writeUInt8(2, 9); // colour type: RGB
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x++) row.set(rgb, 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** The copy names of a stored image name (same rule as event_media_variant_paths). */
export function copyNames(name: string): [string, string] {
  const base = name.replace(/\.[A-Za-z0-9]+$/, "");
  return [`${base}.w640.webp`, `${base}.w1280.webp`];
}

/** Object names in an event's folder of the event-media bucket. */
export async function storedEventObjects(eventId: string): Promise<string[]> {
  const { data, error } = await adminClient().storage.from("event-media").list(eventId, { limit: 100 });
  if (error) throw new Error(`list ${eventId}: ${error.message}`);
  return data.map((o) => o.name).sort();
}
