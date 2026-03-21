import { useRef, useLayoutEffect } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { pillarsConfig } from '../config';
import { motion } from 'framer-motion';

gsap.registerPlugin(ScrollTrigger);

export function PillarsSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const headlineRef = useRef<HTMLHeadingElement>(null);
  const cardsRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const section = sectionRef.current;
    const headline = headlineRef.current;
    const cards = cardsRef.current;
    if (!section || !headline || !cards) return;

    const ctx = gsap.context(() => {
      // Headline animation
      gsap.fromTo(headline,
        { y: 40, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          duration: 0.8,
          ease: 'power2.out',
          scrollTrigger: {
            trigger: headline,
            start: 'top 80%',
            end: 'top 40%',
            scrub: true,
          },
        }
      );

      // Cards animation with stagger
      const cardElements = cards.querySelectorAll('.pillar-card');
      gsap.fromTo(cardElements,
        { y: 80, opacity: 0, scale: 0.98 },
        {
          y: 0,
          opacity: 1,
          scale: 1,
          duration: 0.8,
          stagger: 0.12,
          ease: 'power2.out',
          scrollTrigger: {
            trigger: cards,
            start: 'top 75%',
            end: 'top 35%',
            scrub: true,
          },
        }
      );

      // Subtle parallax on card images
      cardElements.forEach((card) => {
        const img = card.querySelector('.card-image');
        if (img) {
          gsap.fromTo(img,
            { y: -12 },
            {
              y: 12,
              ease: 'none',
              scrollTrigger: {
                trigger: card,
                start: 'top bottom',
                end: 'bottom top',
                scrub: true,
              },
            }
          );
        }
      });
    }, section);

    return () => ctx.revert();
  }, []);

  return (
    <section
      ref={sectionRef}
      id="product"
      className="relative w-full py-24 lg:py-32 bg-[#FFFFFF] z-30"
    >
      <div className="w-full max-w-[1800px] mx-auto px-6 lg:px-12">
        {/* Headline */}
        <h2
          ref={headlineRef}
          className="font-display text-4xl sm:text-5xl lg:text-6xl font-bold text-[#111A12] leading-[1.0] tracking-tight mb-16 lg:mb-20"
        >
          {pillarsConfig.headline.split(' ').slice(0, 2).map((word, i) => (
            <span key={i} className="inline-block mr-[0.2em]">{word}</span>
          ))}
          <br className="hidden sm:block" />
          {pillarsConfig.headline.split(' ').slice(2).map((word, i) => (
            <span key={i} className="inline-block mr-[0.2em] accent-gradient-text">{word}</span>
          ))}
        </h2>

        {/* Cards Grid */}
        <div
          ref={cardsRef}
          className="grid grid-cols-1 md:grid-cols-3 gap-6 lg:gap-8"
        >
          {pillarsConfig.cards.map((card) => (
            <motion.div
              key={card.title}
              className="pillar-card group relative bg-[#F5F7F4] rounded-[28px] overflow-hidden border border-[#476640]/10 hover:border-[#476640]/30 transition-colors duration-300"
              whileHover={{ y: -6 }}
              transition={{ duration: 0.2 }}
            >
              {/* Card Image */}
              <div className="relative h-48 lg:h-56 overflow-hidden">
                <img
                  src={card.image}
                  alt={card.title}
                  className="card-image w-full h-full object-cover scale-110"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-[#F5F7F4] to-transparent" />
              </div>

              {/* Card Content */}
              <div className="p-6 lg:p-8">
                <h3 className="font-display text-xl lg:text-2xl font-bold text-[#111A12] mb-3">
                  {card.title}
                </h3>
                <p className="text-sm lg:text-base text-[#344535] leading-relaxed">
                  {card.body}
                </p>
              </div>

              {/* Hover Accent Line */}
              <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-[#476640] to-[#587E4F] transform scale-x-0 group-hover:scale-x-100 transition-transform duration-300 origin-left" />
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
