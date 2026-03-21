import { useRef, useLayoutEffect } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { ArrowRight } from 'lucide-react';
import { motion } from 'framer-motion';

gsap.registerPlugin(ScrollTrigger);

interface TwoUpSectionProps {
  headline: string;
  body: string;
  microLabel?: string;
  cta?: string;
  image: string;
  reversed: boolean;
  zIndex: number;
  id?: string;
}

export function TwoUpSection({ headline, body, microLabel, cta, image, reversed, zIndex, id }: TwoUpSectionProps) {
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
      const imageStartX = reversed ? '55vw' : '-55vw';
      const textStartX = reversed ? '-18vw' : '18vw';

      scrollTl.fromTo(imageEl,
        { x: imageStartX, opacity: 0, scale: 0.98 },
        { x: 0, opacity: 1, scale: 1, ease: 'power2.out' },
        0
      );

      scrollTl.fromTo(text,
        { x: textStartX, opacity: 0 },
        { x: 0, opacity: 1, ease: 'power2.out' },
        0
      );

      // SETTLE (30-70%): Hold

      // EXIT (70-100%)
      const imageExitX = reversed ? '-28vw' : '18vw';
      const textExitX = reversed ? '10vw' : '-10vw';

      scrollTl.fromTo(imageEl,
        { x: 0, opacity: 1, scale: 1 },
        { x: imageExitX, opacity: 0, ease: 'power2.in' },
        0.70
      );

      scrollTl.fromTo(text,
        { x: 0, opacity: 1 },
        { x: textExitX, opacity: 0, ease: 'power2.in' },
        0.70
      );
    }, section);

    return () => ctx.revert();
  }, [reversed]);

  const headlineWords = headline.split(' ');
  const firstLine = headlineWords.slice(0, 2).join(' ');
  const secondLine = headlineWords.slice(2).join(' ');

  return (
    <section
      ref={sectionRef}
      id={id}
      className="relative w-full h-screen overflow-hidden bg-[#FFFFFF]"
      style={{ zIndex }}
    >
      {/* Main Content */}
      <div className="relative z-10 flex items-center h-full px-6 lg:px-12">
        <div className={`w-full max-w-[1800px] mx-auto grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-16 items-center ${reversed ? '' : ''}`}>
          {/* Image Card */}
          <div
            ref={imageRef}
            className={`image-card relative w-full aspect-[4/5] lg:aspect-[4/5] max-w-lg mx-auto lg:mx-0 ${
              reversed ? 'lg:ml-auto lg:order-2' : 'lg:ml-[4vw] lg:order-1'
            }`}
          >
            <img
              src={image}
              alt={headline}
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[#FFFFFF]/30 to-transparent" />
          </div>

          {/* Text Block */}
          <div
            ref={textRef}
            className={`flex flex-col items-start text-left ${
              reversed ? 'lg:pl-[4vw] lg:order-1' : 'lg:pl-8 lg:order-2'
            }`}
          >
            {microLabel && (
              <span className="font-mono text-xs tracking-[0.18em] text-[#476640] mb-4">
                {microLabel}
              </span>
            )}
            <h2 className="font-display text-4xl sm:text-5xl lg:text-6xl font-bold text-[#111A12] leading-[1.0] tracking-tight mb-6">
              <span className="block">{firstLine}</span>
              <span className="block accent-gradient-text">{secondLine}</span>
            </h2>
            <p className="text-base lg:text-lg text-[#344535] max-w-md leading-relaxed mb-8">
              {body}
            </p>
            {cta && (
              <motion.button
                whileHover={{ scale: 1.02, y: -2 }}
                whileTap={{ scale: 0.98 }}
                className="group flex items-center gap-2 text-[#476640] font-medium hover:text-[#587E4F] transition-colors"
              >
                <span>{cta}</span>
                <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
              </motion.button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
