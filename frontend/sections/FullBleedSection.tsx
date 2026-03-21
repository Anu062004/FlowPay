import { useRef, useLayoutEffect } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { ArrowRight } from 'lucide-react';
import { motion } from 'framer-motion';

gsap.registerPlugin(ScrollTrigger);

interface FullBleedSectionProps {
  headline: string;
  body: string;
  cta?: string;
  image: string;
  zIndex: number;
  id?: string;
}

export function FullBleedSection({ headline, body, cta, image, zIndex, id }: FullBleedSectionProps) {
  const sectionRef = useRef<HTMLElement>(null);
  const imageRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const section = sectionRef.current;
    const imageEl = imageRef.current;
    const text = textRef.current;
    if (!section || !imageEl || !text) return;

    const ctx = gsap.context(() => {
      const scrollTl = gsap.timeline({
        scrollTrigger: {
          trigger: section,
          start: 'top top',
          end: '+=130%',
          pin: true,
          scrub: 0.6,
        },
      });

      // ENTRANCE (0-30%)
      scrollTl.fromTo(imageEl,
        { scale: 1.08, opacity: 0.6 },
        { scale: 1.00, opacity: 1, ease: 'power2.out' },
        0
      );

      scrollTl.fromTo(text,
        { x: '-18vw', opacity: 0 },
        { x: 0, opacity: 1, ease: 'power2.out' },
        0
      );

      // SETTLE (30-70%): Hold

      // EXIT (70-100%)
      scrollTl.fromTo(imageEl,
        { scale: 1.00, opacity: 1 },
        { scale: 1.05, opacity: 0, ease: 'power2.in' },
        0.70
      );

      scrollTl.fromTo(text,
        { y: 0, opacity: 1 },
        { y: '-10vh', opacity: 0, ease: 'power2.in' },
        0.70
      );
    }, section);

    return () => ctx.revert();
  }, []);

  const headlineWords = headline.split(' ');
  const firstLine = headlineWords.slice(0, 2).join(' ');
  const secondLine = headlineWords.slice(2).join(' ');

  return (
    <section
      ref={sectionRef}
      id={id}
      className="relative w-full h-screen overflow-hidden z-[${zIndex}]"
      style={{ zIndex }}
    >
      {/* Full-bleed Image */}
      <div
        ref={imageRef}
        className="absolute inset-0 w-full h-full"
      >
        <img
          src={image}
          alt=""
          className="w-full h-full object-cover"
        />
        {/* Dark Overlay Gradient */}
        <div 
          className="absolute inset-0"
          style={{
            background: 'linear-gradient(90deg, rgba(7,10,18,.78) 0%, rgba(7,10,18,.35) 60%, rgba(7,10,18,.55) 100%)'
          }}
        />
      </div>

      {/* Text Block */}
      <div
        ref={textRef}
        className="relative z-10 flex items-center h-full px-6 lg:px-12"
      >
        <div className="max-w-[600px] lg:ml-[8vw]">
          <h2 className="font-display text-4xl sm:text-5xl lg:text-6xl xl:text-7xl font-bold text-[#FFFFFF] leading-[0.95] tracking-tight mb-6">
            <span className="block">{firstLine}</span>
            <span className="block accent-gradient-text">{secondLine}</span>
          </h2>
          <p className="text-base lg:text-lg text-[#FFFFFF]/80 leading-relaxed mb-8 max-w-md">
            {body}
          </p>
          {cta && (
            <motion.button
              whileHover={{ scale: 1.02, y: -2 }}
              whileTap={{ scale: 0.98 }}
              className="group flex items-center gap-2 text-[#FFFFFF] font-medium hover:text-[#FFFFFF]/80 transition-colors"
            >
              <span>{cta}</span>
              <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
            </motion.button>
          )}
        </div>
      </div>
    </section>
  );
}
