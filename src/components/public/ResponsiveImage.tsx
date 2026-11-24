import type { ImgHTMLAttributes } from "react";
import type { SignedImage } from "@/lib/image-variants";

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "srcSet" | "sizes"> & {
  image: SignedImage;
  /** How wide the image is drawn, for choosing between the copies (the `sizes` attribute). */
  sizes: string;
};

/**
 * An event image with its resized copies: the browser picks the 640 or 1280 px WebP copy (or the original on wide,
 * dense screens) from `srcSet` and `sizes`. Without copies it is a plain image of the original. `width`/`height`
 * default to the original's size so the layout is reserved before the image loads.
 */
export function ResponsiveImage({ image, sizes, width, height, alt = "", ...rest }: Props) {
  return (
    <img
      // srcSet and sizes before src, so no browser starts fetching src before it knows the alternatives.
      {...(image.srcSet ? { srcSet: image.srcSet, sizes } : {})}
      src={image.src}
      alt={alt}
      width={width ?? image.width ?? undefined}
      height={height ?? image.height ?? undefined}
      {...rest}
    />
  );
}
