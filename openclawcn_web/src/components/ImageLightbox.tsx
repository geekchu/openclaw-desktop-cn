'use client'

import { useState } from 'react'
import Image from 'next/image'

interface ImageLightboxProps {
  src: string
  alt: string
  caption: string
  priority?: boolean
}

export default function ImageLightbox({ src, alt, caption, priority = false }: ImageLightboxProps) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <div
        className="bg-white border border-gray-100 rounded-2xl overflow-hidden shadow-sm hover:shadow-lg hover:-translate-y-1 transition-all duration-300 cursor-pointer group"
        onClick={() => setOpen(true)}
      >
        <div className="overflow-hidden">
          <Image
            src={src}
            alt={alt}
            width={400}
            height={267}
            className="w-full group-hover:scale-105 transition-transform duration-500"
            quality={75}
            priority={priority}
            loading={priority ? undefined : 'lazy'}
          />
        </div>
        <p className="text-[#555] text-sm p-3 md:p-4 leading-relaxed">{caption}</p>
      </div>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setOpen(false)}
        >
          <div className="relative max-w-[95vw] md:max-w-[90vw] max-h-[90vh]" onClick={e => e.stopPropagation()}>
            <button
              onClick={() => setOpen(false)}
              className="absolute -top-10 right-0 text-white/70 hover:text-white text-2xl transition-colors w-10 h-10 flex items-center justify-center"
            >
              ✕
            </button>
            <Image
              src={src}
              alt={alt}
              width={1200}
              height={800}
              className="max-w-[95vw] md:max-w-[90vw] max-h-[85vh] rounded-xl object-contain"
              quality={85}
              loading="lazy"
            />
            <p className="text-white/80 text-sm text-center mt-3">{caption}</p>
          </div>
        </div>
      )}
    </>
  )
}
