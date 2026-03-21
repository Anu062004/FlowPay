import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { navConfig } from '../../config';

export function Navigation() {
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 100);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <motion.nav
      initial={{ y: -100, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        isScrolled 
          ? 'bg-[#FFFFFF]/90 backdrop-blur-md border-b border-[#476640]/10' 
          : 'bg-transparent'
      }`}
    >
      <div className="w-full px-6 lg:px-12">
        <div className="flex items-center justify-center h-16 lg:h-20">
          {/* Logo */}
          <a href="#" className="font-display text-xl lg:text-2xl font-bold text-[#111A12]">
            {navConfig.logo}
          </a>
        </div>
      </div>
    </motion.nav>
  );
}
