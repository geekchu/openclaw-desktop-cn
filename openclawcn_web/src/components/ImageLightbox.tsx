import Image from "next/image";

interface ImageLightboxProps {
  src: string;
  alt: string;
  caption: string;
  priority?: boolean;
}

let _id = 0;
function nextId() {
  return `lightbox-${++_id}`;
}

export default function ImageLightbox({ src, alt, caption, priority = false }: ImageLightboxProps) {
  const id = nextId();

  return (
    <div className="lightbox-wrapper">
      <label
        htmlFor={id}
        className="bg-white border border-gray-100 rounded-2xl overflow-hidden shadow-sm hover:shadow-lg hover:-translate-y-1 transition-all duration-300 cursor-pointer group block"
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
            loading={priority ? undefined : "lazy"}
          />
        </div>
        <p className="text-[#555] text-sm p-3 md:p-4 leading-relaxed">{caption}</p>
      </label>

      {/* Pure CSS lightbox: hidden checkbox toggles overlay visibility */}
      <input type="checkbox" id={id} className="lightbox-toggle" aria-hidden="true" />
      <label htmlFor={id} className="lightbox-overlay" aria-label="关闭预览">
        <span className="lightbox-content">
          <Image
            src={src}
            alt={alt}
            width={1200}
            height={800}
            className="max-w-[95vw] md:max-w-[90vw] max-h-[85vh] rounded-xl object-contain"
            quality={85}
            loading="lazy"
          />
          <span className="text-white/80 text-sm text-center mt-3 block">{caption}</span>
        </span>
      </label>
    </div>
  );
}
