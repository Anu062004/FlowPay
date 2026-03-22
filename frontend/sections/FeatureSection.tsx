import { useRef, useLayoutEffect } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { featureConfig } from '../config';

gsap.registerPlugin(ScrollTrigger);

export function FeatureSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const section = sectionRef.current;
    const text = textRef.current;
    const card = cardRef.current;
    if (!section || !text || !card) return;

    const ctx = gsap.context(() => {
      // Scroll-driven animation (pinned, three-phase)
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
      scrollTl.fromTo(text,
        { x: '-18vw', opacity: 0 },
        { x: 0, opacity: 1, ease: 'power2.out' },
        0
      );

      scrollTl.fromTo(card,
        { x: '55vw', opacity: 0, scale: 0.96 },
        { x: 0, opacity: 1, scale: 1, ease: 'power2.out' },
        0
      );

      // SETTLE (30-70%): Hold positions

      // EXIT (70-100%)
      scrollTl.fromTo(text,
        { x: 0, opacity: 1 },
        { x: '-10vw', opacity: 0, ease: 'power2.in' },
        0.70
      );

      scrollTl.fromTo(card,
        { x: 0, opacity: 1, scale: 1 },
        { x: '-28vw', opacity: 0, ease: 'power2.in' },
        0.70
      );
    }, section);

    return () => ctx.revert();
  }, []);

  return (
    <section
      ref={sectionRef}
      id="landing-flow"
      className="relative w-full h-screen overflow-hidden bg-[#FFFFFF] z-20"
    >
      {/* Main Content */}
      <div className="relative z-10 flex items-center h-full px-6 lg:px-12">
        <div className="w-full max-w-[1800px] mx-auto grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-16 items-center">
          {/* Left Text Block */}
          <div
            ref={textRef}
            className="flex flex-col items-start text-left lg:pl-[4vw] order-2 lg:order-1"
          >
            <h2 className="font-display text-4xl sm:text-5xl lg:text-6xl font-bold text-[#111A12] leading-[1.0] tracking-tight mb-6">
              {featureConfig.headline.split(' ').map((word, i) => (
                <span key={i} className="inline-block mr-[0.2em]">
                  {word}
                </span>
              ))}
            </h2>
            <p className="text-base lg:text-lg text-[#344535] max-w-md leading-relaxed">
              {featureConfig.body}
            </p>
          </div>

          {/* Right Image Card */}
          <div
            ref={cardRef}
            className="image-card relative w-full aspect-[4/5] lg:aspect-[4/5] max-w-lg mx-auto lg:mx-0 lg:ml-auto order-1 lg:order-2"
          >
            <img
              src={featureConfig.featureImage}
              alt="Smart Execution"
              className="w-full h-full object-cover"
            />
            {/* Card Content Overlay */}
            <div className="absolute inset-0 bg-gradient-to-t from-[#FFFFFF]/90 via-[#FFFFFF]/40 to-transparent" />
            <div className="absolute bottom-0 left-0 right-0 p-6 lg:p-8">
              <span className="font-mono text-xs tracking-[0.18em] text-[#476640] mb-2 block">
                {featureConfig.cardLabel}
              </span>
              <h3 className="font-display text-xl lg:text-2xl font-bold text-[#111A12] mb-2">
                {featureConfig.cardTitle}
              </h3>
              <p className="text-sm text-[#344535]">
                {featureConfig.cardBody}
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
