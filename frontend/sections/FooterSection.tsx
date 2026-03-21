import { useRef, useLayoutEffect, useState } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { footerConfig } from '../config';
import { motion } from 'framer-motion';
import { Mail, MapPin, ArrowRight } from 'lucide-react';

gsap.registerPlugin(ScrollTrigger);

export function FooterSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const linksRef = useRef<HTMLDivElement>(null);

  const [formData, setFormData] = useState({
    name: '',
    email: '',
    company: '',
    message: '',
  });

  useLayoutEffect(() => {
    const section = sectionRef.current;
    const title = titleRef.current;
    const form = formRef.current;
    const links = linksRef.current;
    if (!section || !title || !form || !links) return;

    const ctx = gsap.context(() => {
      // Title animation
      gsap.fromTo(title,
        { y: 30, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          duration: 0.8,
          ease: 'power2.out',
          scrollTrigger: {
            trigger: title,
            start: 'top 85%',
            toggleActions: 'play none none reverse',
          },
        }
      );

      // Form animation
      gsap.fromTo(form,
        { y: 20, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          duration: 0.6,
          delay: 0.2,
          ease: 'power2.out',
          scrollTrigger: {
            trigger: form,
            start: 'top 85%',
            toggleActions: 'play none none reverse',
          },
        }
      );

      // Links animation
      const linkColumns = links.querySelectorAll('.link-column');
      gsap.fromTo(linkColumns,
        { y: 20, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          duration: 0.6,
          stagger: 0.1,
          ease: 'power2.out',
          scrollTrigger: {
            trigger: links,
            start: 'top 85%',
            toggleActions: 'play none none reverse',
          },
        }
      );
    }, section);

    return () => ctx.revert();
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Handle form submission
    alert('Thank you for your message! We will get back to you soon.');
    setFormData({ name: '', email: '', company: '', message: '' });
  };

  return (
    <footer
      ref={sectionRef}
      className="relative w-full py-20 lg:py-28 bg-[#FFFFFF] z-[120]"
    >
      <div className="w-full max-w-[1800px] mx-auto px-6 lg:px-12">
        {/* Main Footer Content */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 lg:gap-24 mb-16">
          {/* Left Column - Contact Info & Form */}
          <div>
            <h2
              ref={titleRef}
              className="font-display text-3xl sm:text-4xl lg:text-5xl font-bold text-[#111A12] leading-[1.1] tracking-tight mb-8"
            >
              {footerConfig.title}
            </h2>

            {/* Contact Details */}
            <div className="flex flex-col gap-4 mb-10">
              <a
                href={`mailto:${footerConfig.email}`}
                className="flex items-center gap-3 text-[#344535] hover:text-[#476640] transition-colors"
              >
                <Mail size={18} />
                <span>{footerConfig.email}</span>
              </a>
              <div className="flex items-center gap-3 text-[#344535]">
                <MapPin size={18} />
                <span>{footerConfig.offices}</span>
              </div>
            </div>

            {/* Contact Form */}
            <form ref={formRef} onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <input
                  type="text"
                  placeholder={footerConfig.formLabels.name}
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-4 py-3 bg-[#F5F7F4] border border-[#476640]/20 rounded-xl text-[#111A12] placeholder:text-[#344535]/60 focus:outline-none focus:border-[#476640]/50 transition-colors"
                  required
                />
                <input
                  type="email"
                  placeholder={footerConfig.formLabels.email}
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="w-full px-4 py-3 bg-[#F5F7F4] border border-[#476640]/20 rounded-xl text-[#111A12] placeholder:text-[#344535]/60 focus:outline-none focus:border-[#476640]/50 transition-colors"
                  required
                />
              </div>
              <input
                type="text"
                placeholder={footerConfig.formLabels.company}
                value={formData.company}
                onChange={(e) => setFormData({ ...formData, company: e.target.value })}
                className="w-full px-4 py-3 bg-[#F5F7F4] border border-[#476640]/20 rounded-xl text-[#111A12] placeholder:text-[#344535]/60 focus:outline-none focus:border-[#476640]/50 transition-colors"
              />
              <textarea
                placeholder={footerConfig.formLabels.message}
                value={formData.message}
                onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                rows={4}
                className="w-full px-4 py-3 bg-[#F5F7F4] border border-[#476640]/20 rounded-xl text-[#111A12] placeholder:text-[#344535]/60 focus:outline-none focus:border-[#476640]/50 transition-colors resize-none"
                required
              />
              <motion.button
                type="submit"
                whileHover={{ scale: 1.02, y: -2 }}
                whileTap={{ scale: 0.98 }}
                className="group flex items-center gap-2 px-6 py-3 bg-[#476640] text-[#FFFFFF] font-semibold rounded-xl"
              >
                <span>{footerConfig.formLabels.submit}</span>
                <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
              </motion.button>
            </form>
          </div>

          {/* Right Column - Navigation Links */}
          <div ref={linksRef} className="grid grid-cols-2 sm:grid-cols-3 gap-8 lg:gap-12">
            {/* Product Links */}
            <div className="link-column">
              <h3 className="font-mono text-xs tracking-[0.18em] text-[#476640] mb-4">
                PRODUCT
              </h3>
              <ul className="space-y-3">
                {footerConfig.navLinks.map((link) => (
                  <li key={link.label}>
                    <a
                      href={link.href}
                      className="text-[#344535] hover:text-[#111A12] transition-colors text-sm"
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>

            {/* Company Links */}
            <div className="link-column">
              <h3 className="font-mono text-xs tracking-[0.18em] text-[#476640] mb-4">
                COMPANY
              </h3>
              <ul className="space-y-3">
                <li>
                  <a href="#about" className="text-[#344535] hover:text-[#111A12] transition-colors text-sm">
                    About
                  </a>
                </li>
                <li>
                  <a href="#careers" className="text-[#344535] hover:text-[#111A12] transition-colors text-sm">
                    Careers
                  </a>
                </li>
                <li>
                  <a href="#blog" className="text-[#344535] hover:text-[#111A12] transition-colors text-sm">
                    Blog
                  </a>
                </li>
              </ul>
            </div>

            {/* Legal Links */}
            <div className="link-column">
              <h3 className="font-mono text-xs tracking-[0.18em] text-[#476640] mb-4">
                LEGAL
              </h3>
              <ul className="space-y-3">
                {footerConfig.legalLinks.map((link) => (
                  <li key={link.label}>
                    <a
                      href={link.href}
                      className="text-[#344535] hover:text-[#111A12] transition-colors text-sm"
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="pt-8 border-t border-[#476640]/10 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-sm text-[#344535]">
            {footerConfig.copyright}
          </p>
          <div className="flex items-center gap-6">
            {footerConfig.legalLinks.map((link) => (
              <a
                key={link.label}
                href={link.href}
                className="text-sm text-[#344535] hover:text-[#111A12] transition-colors"
              >
                {link.label}
              </a>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}
