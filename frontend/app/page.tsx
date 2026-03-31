"use client";
import { useEffect } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Navigation } from '@/components/custom/Navigation';
import { HeroSection } from '@/sections/HeroSection';
import { FeatureSection } from '@/sections/FeatureSection';
import { PillarsSection } from '@/sections/PillarsSection';
import { FullBleedSection } from '@/sections/FullBleedSection';
import { TwoUpSection } from '@/sections/TwoUpSection';
import { ClosingSection } from '@/sections/ClosingSection';
import { 
  trustConfig, 
  securityConfig, 
  onchainConfig,
  scaleConfig,
  controlConfig,
  complianceConfig,
  insightsConfig 
} from '@/config';

gsap.registerPlugin(ScrollTrigger);

function App() {
  // Global Scroll Snap for pinned sections
  useEffect(() => {
    // Wait for all ScrollTriggers to be created
    const timer = setTimeout(() => {
      const pinned = ScrollTrigger.getAll()
        .filter((st: ScrollTrigger) => st.vars.pin)
        .sort((a: ScrollTrigger, b: ScrollTrigger) => a.start - b.start);
      
      const maxScroll = ScrollTrigger.maxScroll(window);
      if (!maxScroll || pinned.length === 0) return;

      // Build ranges and snap targets from pinned sections
      interface PinnedRange {
        start: number;
        end: number;
        center: number;
      }

      const pinnedRanges: PinnedRange[] = pinned.map((st: ScrollTrigger) => ({
        start: st.start / maxScroll,
        end: (st.end ?? st.start) / maxScroll,
        center: (st.start + ((st.end ?? st.start) - st.start) * 0.5) / maxScroll,
      }));

      // Create global snap
      ScrollTrigger.create({
        snap: {
          snapTo: (value: number) => {
            // Check if within any pinned range (with buffer)
            const inPinned = pinnedRanges.some(
              (r: PinnedRange) => value >= r.start - 0.02 && value <= r.end + 0.02
            );
            
            // If not in a pinned section, allow free scroll
            if (!inPinned) return value;

            // Find nearest pinned center
            const target = pinnedRanges.reduce(
              (closest: number, r: PinnedRange) =>
                Math.abs(r.center - value) < Math.abs(closest - value)
                  ? r.center
                  : closest,
              pinnedRanges[0]?.center ?? 0
            );

            return target;
          },
          duration: { min: 0.15, max: 0.35 },
          delay: 0,
          ease: 'power2.out',
        },
      });
    }, 500);

    return () => {
      clearTimeout(timer);
    };
  }, []);

  return (
    <main className="relative w-full overflow-x-hidden bg-[#FFFFFF] text-[#111A12] antialiased">
      {/* Grain Overlay */}
      <div className="grain-overlay" />
      
      {/* Vignette Overlay */}
      <div className="vignette-overlay" />

      {/* Section 1: Hero - z-10 */}
      <HeroSection />
      <h1 href="youtu.be/8C7_VqVijEs?si=YLXNdKIV42DgtmP2">demo link</h1>
      {/* Section 2: Feature - z-20 */}
      <FeatureSection />

      {/* Section 3: Pillars - z-30 (flowing) */}
      <PillarsSection />

      {/* Section 4: Trust (Full-bleed) - z-40 */}
      <FullBleedSection
        {...trustConfig}
        zIndex={40}
      />

      {/* Section 5: Scale (Two-up) - z-50 */}
      <TwoUpSection
        {...scaleConfig}
        zIndex={50}
      />

      {/* Section 6: Control (Two-up reversed) - z-60 */}
      <TwoUpSection
        {...controlConfig}
        zIndex={60}
        id="security"
      />

      {/* Section 7: Security (Full-bleed) - z-70 */}
      <FullBleedSection
        {...securityConfig}
        zIndex={70}
      />

      {/* Section 8: Compliance (Two-up) - z-80 */}
      <TwoUpSection
        {...complianceConfig}
        zIndex={80}
      />

      {/* Section 9: Insights (Two-up reversed) - z-90 */}
      <TwoUpSection
        {...insightsConfig}
        zIndex={90}
      />

      {/* Section 10: On-chain (Full-bleed) - z-100 */}
      <FullBleedSection
        {...onchainConfig}
        zIndex={100}
      />

      {/* Section 11: Closing CTA - z-110 */}
      <ClosingSection />
    </main>
  );
}

export default App;
