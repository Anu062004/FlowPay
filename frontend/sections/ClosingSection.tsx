import { useRef, useLayoutEffect } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { closingConfig } from '../config';
import { motion } from 'framer-motion';

gsap.registerPlugin(ScrollTrigger);

export function ClosingSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const imageRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const section = sectionRef.current;
    const image = imageRef.current;
    const text = textRef.current;
    if (!section || !image || !text) return;

    const ctx = gsap.context(() => {
      const scrollTl = gsap.timeline({
        scrollTrigger: {
          trigger: section,
          start: 'top 70%',
          toggleActions: "play none none reverse",
        },
      });

      // ENTRANCE 
      scrollTl.fromTo(image,
        { x: '-15vw', opacity: 0, scale: 0.95 },
        { x: 0, opacity: 1, scale: 1, duration: 1, ease: 'power3.out' },
        0
      );

      scrollTl.fromTo(text,
        { x: '10vw', opacity: 0 },
        { x: 0, opacity: 1, duration: 1, ease: 'power3.out' },
        0.2
      );
    }, section);

    return () => ctx.revert();
  }, []);

  const headlineWords = closingConfig.headline.split(' ');
  const firstLine = headlineWords.slice(0, 2).join(' ');
  const secondLine = headlineWords.slice(2).join(' ');

  return (
    <section
      ref={sectionRef}
      className="relative w-full h-screen overflow-hidden bg-[#FFFFFF] z-[110]"
    >
      {/* Main Content */}
      <div className="relative z-10 flex items-center h-full px-6 lg:px-12">
        <div className="w-full max-w-[1800px] mx-auto grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-16 items-center">
          {/* Left Image Card */}
          <div
            ref={imageRef}
            className="image-card relative w-full aspect-[4/5] lg:aspect-[4/5] max-w-lg mx-auto lg:mx-0 lg:ml-[4vw]"
          >
            <img
              src={closingConfig.image}
              alt="Closing"
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[#FFFFFF]/30 to-transparent" />
          </div>

          {/* Right Text Block */}
          <div
            ref={textRef}
            className="flex flex-col items-start text-left lg:pl-8"
          >
            <h2 className="font-display text-4xl sm:text-5xl lg:text-6xl xl:text-7xl font-bold text-[#111A12] leading-[0.95] tracking-tight mb-6">
              <span className="block">{firstLine}</span>
              <span className="block accent-gradient-text">{secondLine}</span>
            </h2>
            <p className="text-base lg:text-lg text-[#344535] max-w-md leading-relaxed mb-8">
              {closingConfig.body}
            </p>
            <div className="flex flex-wrap items-center gap-4">
              <motion.button
                whileHover={{ scale: 1.02, y: -2 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                className="group relative px-6 py-3 bg-[#476640] text-[#FFFFFF] font-semibold rounded-xl overflow-hidden flex items-center justify-center min-w-[160px]"
              >
                <span>{closingConfig.ctaText}</span>
              </motion.button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
