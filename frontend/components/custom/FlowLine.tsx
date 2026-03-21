import { useRef, useEffect } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

interface FlowLineProps {
  path: string;
  className?: string;
}

export function FlowLine({ path, className = '' }: FlowLineProps) {
  const pathRef = useRef<SVGPathElement>(null);
  const containerRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!pathRef.current || !containerRef.current) return;

    const pathElement = pathRef.current;
    const pathLength = pathElement.getTotalLength();

    // Set up initial state
    gsap.set(pathElement, {
      strokeDasharray: pathLength,
      strokeDashoffset: pathLength,
    });

    // Create scroll-driven animation
    const trigger = ScrollTrigger.create({
      trigger: containerRef.current,
      start: 'top 80%',
      end: 'bottom 20%',
      scrub: 0.5,
      onUpdate: (self: ScrollTrigger) => {
        const progress = self.progress;
        gsap.set(pathElement, {
          strokeDashoffset: pathLength * (1 - progress),
        });
      },
    });

    return () => {
      trigger.kill();
    };
  }, []);

  return (
    <svg
      ref={containerRef}
      className={`absolute inset-0 w-full h-full pointer-events-none z-[5] ${className}`}
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
    >
      <path
        ref={pathRef}
        d={path}
        className="flow-line animate-flow-pulse"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

// Pre-defined flow line paths for different section layouts
export const flowPaths = {
  // Hero: curves from left to right
  hero: "M 5 50 Q 25 30 45 45 T 95 40",
  
  // Feature: curves from left text to right card
  feature: "M 5 45 Q 30 35 50 50 T 95 55",
  
  // Two-up (left image, right text): curves from image to text
  twoUpLeft: "M 5 50 Q 25 40 45 45 T 95 45",
  
  // Two-up reversed (left text, right image): curves from text to image
  twoUpRight: "M 5 45 Q 30 55 50 50 T 95 50",
  
  // Closing CTA
  closing: "M 5 50 Q 25 35 45 45 T 95 40",
};
