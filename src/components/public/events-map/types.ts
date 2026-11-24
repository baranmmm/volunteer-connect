import type { SignedImage } from "@/lib/image-variants";
import type { MapEvent, MapPlace } from "@/lib/events-map";

/** An event on the public map; landing rows carry their signed cover, others load it when their card opens. */
export type MapCardEvent = MapEvent & { image?: SignedImage | null };

/** A place with its accessible marker name ("<title>, <date>, <place>"). */
export type LabelledPlace = MapPlace<MapCardEvent> & { label: string };
