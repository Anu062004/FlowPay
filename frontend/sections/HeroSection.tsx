import { useRef, useLayoutEffect } from 'react';
import { motion } from 'framer-motion';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { heroConfig } from '../config';
import { ArrowRight, ChevronDown } from 'lucide-react';
import Link from 'next/link';
import React from 'react';

gsap.registerPlugin(ScrollTrigger);

export function HeroSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const imageRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const section = sectionRef.current;
    const image = imageRef.current;
    const text = textRef.current;
    if (!section || !image || !text) return;

    const ctx = gsap.context(() => {
      // Auto-play entrance animation on load
      const loadTl = gsap.timeline({ delay: 0.3 });
      
      // Image entrance
      loadTl.fromTo(image,
        { x: '-12vw', opacity: 0, scale: 0.98 },
        { x: 0, opacity: 1, scale: 1, duration: 0.9, ease: 'power3.out' },
        0
      );

      // Text entrance (staggered words)
      const words = text.querySelectorAll('.word');
      loadTl.fromTo(words,
        { y: 40, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.6, stagger: 0.05, ease: 'power2.out' },
        0.2
      );

      // Scroll-driven EXIT animation (pinned)
      const scrollTl = gsap.timeline({
        scrollTrigger: {
          trigger: section,
          start: 'top top',
          end: '+=130%',
          pin: true,
          scrub: 0.6,
          onLeaveBack: () => {
            // Reset to visible when scrolling back to top
            gsap.set(image, { x: 0, opacity: 1 });
            gsap.set(text, { x: 0, opacity: 1 });
            gsap.set(text, { x: 0, opacity: 1 });
          },
        },
      });

      // ENTRANCE phase (0-30%): Hold (already visible from load animation)
      // SETTLE phase (30-70%): Static
      
      // EXIT phase (70-100%)
      scrollTl.fromTo(image,
        { x: 0, opacity: 1 },
        { x: '-55vw', opacity: 0, ease: 'power2.in' },
        0.70
      );

      scrollTl.fromTo(text,
        { x: 0, opacity: 1 },
        { x: '18vw', opacity: 0, ease: 'power2.in' },
        0.70
      );
    }, section);

    return () => ctx.revert();
  }, []);

  const titleWords = heroConfig.titleLine2.split(' ');

  return (
    <section
      ref={sectionRef}
      className="relative w-full h-screen overflow-hidden bg-[#FFFFFF] z-10"
    >
      {/* Background Pattern */}
      <div className="absolute inset-0 opacity-30">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `radial-gradient(circle at 20% 30%, rgba(75, 108, 255, 0.12) 0%, transparent 40%),
                             radial-gradient(circle at 80% 70%, rgba(75, 108, 255, 0.08) 0%, transparent 40%)`,
          }}
        />
      </div>

      {/* Main Content */}
      <div className="relative z-10 flex items-center h-full px-6 lg:px-12">
        <div className="w-full max-w-[1800px] mx-auto grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-16 items-center">
          {/* Left Image Card */}
          <div
            ref={imageRef}
            className="image-card relative w-full aspect-[4/5] lg:aspect-[4/5] max-w-lg mx-auto lg:mx-0 lg:ml-[4vw]"
          >
            <img
              src={heroConfig.heroImage}
              alt="FlowPay"
              className="w-full h-full object-cover"
            />
            {/* Subtle gradient overlay */}
            <div className="absolute inset-0 bg-gradient-to-t from-[#FFFFFF]/40 to-transparent" />
          </div>

          {/* Right Text Block */}
          <div
            ref={textRef}
            className="flex flex-col items-start text-left lg:pl-8"
          >
            {/* Logo */}
           
            <div className="word font-display text-4xl lg:text-5xl font-bold text-[#111A12] mb-12">
              FlowPay (click to see the demo video)
            </div>
           
            <a
              href="https://youtu.be/8C7_VqVijEs?si=YLXNdKIV42DgtmP2"
              className="my-link-styles"
            >
              <div className="my-div-content">
              <button>DEMO VIDEO</button> 
              </div>
            </a>

            {/* Eyebrow */}
            <span className="word font-mono text-xs tracking-[0.18em] text-[#476640] mb-4">
              {heroConfig.subtitle}
            </span>

            {/* Headline */}
            <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl xl:text-7xl font-bold text-[#111A12] leading-[0.95] tracking-tight mb-2">
              <span className="word inline-block">{heroConfig.titleLine1}</span>
            </h1>
            <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl xl:text-7xl font-bold leading-[0.95] tracking-tight mb-6">
              {titleWords.map((word, i) => (
                <span key={i} className="word inline-block accent-gradient-text mr-[0.25em]">
                  {word}
                </span>
              ))}
            </h1>

            {/* Tagline */}
            <p className="word text-base lg:text-lg text-[#344535] max-w-md mb-8 leading-relaxed">
              {heroConfig.tagline}
            </p>

            {/* CTAs */}
            <div className="word flex flex-col items-start gap-4">
              <div className="flex flex-wrap items-center gap-4">
                <Link href="/login">
                  <motion.button
                    whileHover={{ scale: 1.02, y: -2 }}
                    whileTap={{ scale: 0.98 }}
                    className="group relative px-6 py-3 bg-[#476640] text-[#FFFFFF] font-semibold rounded-xl overflow-hidden flex items-center gap-2"
                  >
                    <span>{heroConfig.ctaText}</span>
                    <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
                  </motion.button>
                </Link>
                <Link href="/login">
                  <motion.button
                    whileHover={{ scale: 1.02, y: -2 }}
                    whileTap={{ scale: 0.98 }}
                    className="group relative px-6 py-3 border border-[#476640]/30 text-[#344535] hover:text-[#111A12] hover:border-[#476640] font-semibold rounded-xl overflow-hidden flex items-center transition-colors"
                  >
                    <span>{heroConfig.secondaryCta}</span>
                  </motion.button>
                </Link>
              </div>
              <Link href="/login/employee" className="text-[#344535] hover:text-[#111A12] text-sm underline underline-offset-4 mt-2 transition-colors">
                Are you an employee? Login here
              </Link>
            </div>
          </div>
        </div>
      </div>

      <motion.a
        href="#landing-flow"
        className="absolute left-1/2 bottom-8 z-30 flex -translate-x-1/2 flex-col items-center gap-2 rounded-full border border-[#476640]/16 bg-[#FFFFFF]/92 px-4 py-3 text-[#344535] shadow-[0_18px_36px_rgba(17,26,18,0.08)] backdrop-blur-sm transition-colors hover:border-[#476640]/28 hover:text-[#111A12]"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 1, duration: 0.5, ease: 'easeOut' }}
        whileHover={{ y: -2 }}
      >
        <span className="font-mono text-[10px] uppercase tracking-[0.18em]">
          Scroll for more
        </span>
        <motion.span
          animate={{ y: [0, 4, 0] }}
          transition={{ repeat: Infinity, duration: 1.5, ease: 'easeInOut' }}
        >
          <ChevronDown size={16} />
        </motion.span>
      </motion.a>

      {/* Bottom Gradient Fade */}
      <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-[#FFFFFF] to-transparent z-20" />
    </section>
  );
}
