/**
 * Album art as a texture.
 *
 * Lifted out of Record.tsx when the flat-lay's sleeve needed the same image:
 * two copies of this would mean two downloads, two uploads to the GPU and two
 * lifetimes to get wrong.
 *
 * `crossOrigin` matters: the art comes from i.scdn.co, which the packaged CSP
 * permits under `img-src`. Without CORS the texture would taint and fail.
 */

import { useEffect, useState } from 'react'
import { SRGBColorSpace, type Texture, TextureLoader } from 'three'

export function useAlbumArtTexture(url: string | null): Texture | null {
  const [texture, setTexture] = useState<Texture | null>(null)

  useEffect(() => {
    if (!url) {
      setTexture(null)
      return
    }

    let cancelled = false
    const loader = new TextureLoader()
    loader.setCrossOrigin('anonymous')
    loader.load(
      url,
      (loaded) => {
        if (cancelled) {
          loaded.dispose()
          return
        }
        loaded.colorSpace = SRGBColorSpace
        setTexture(loaded)
      },
      undefined,
      () => {
        // A failed load is not worth an error screen - the red label is a
        // perfectly good fallback and the next track will try again.
        if (!cancelled) setTexture(null)
      },
    )

    return () => {
      cancelled = true
    }
  }, [url])

  useEffect(() => () => texture?.dispose(), [texture])

  return texture
}
