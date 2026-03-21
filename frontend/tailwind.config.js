/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: [
    './app/**/*.{js,ts,jsx,tsx}',
    './components/**/*.{js,ts,jsx,tsx}',
    './sections/**/*.{js,ts,jsx,tsx}',
    './lib/**/*.{js,ts,jsx,tsx}',
  ],
  corePlugins: {
    preflight: false,
  },
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--tw-border, var(--border)))",
        input: "hsl(var(--tw-input, var(--input)))",
        ring: "hsl(var(--tw-ring, var(--ring)))",
        background: "hsl(var(--tw-background, var(--background)))",
        foreground: "hsl(var(--tw-foreground, var(--foreground)))",
        primary: {
          DEFAULT: "hsl(var(--tw-primary, var(--primary)))",
          foreground: "hsl(var(--tw-primary-foreground, var(--primary-foreground)))",
        },
        secondary: {
          DEFAULT: "hsl(var(--tw-secondary, var(--secondary)))",
          foreground: "hsl(var(--tw-secondary-foreground, var(--secondary-foreground)))",
        },
        destructive: {
          DEFAULT: "hsl(var(--tw-destructive) / <alpha-value>)",
          foreground: "hsl(var(--tw-destructive-foreground) / <alpha-value>)",
        },
        muted: {
          DEFAULT: "hsl(var(--tw-muted, var(--muted)))",
          foreground: "hsl(var(--tw-muted-foreground, var(--muted-foreground)))",
        },
        accent: {
          DEFAULT: "hsl(var(--tw-accent, var(--accent)))",
          foreground: "hsl(var(--tw-accent-foreground, var(--accent-foreground)))",
        },
        popover: {
          DEFAULT: "hsl(var(--tw-popover, var(--popover)))",
          foreground: "hsl(var(--tw-popover-foreground, var(--popover-foreground)))",
        },
        card: {
          DEFAULT: "hsl(var(--tw-card, var(--card)))",
          foreground: "hsl(var(--tw-card-foreground, var(--card-foreground)))",
        },
      },
      borderRadius: {
        xl: "calc(var(--radius, 8px) + 4px)",
        lg: "var(--radius, 8px)",
        md: "calc(var(--radius, 8px) - 2px)",
        sm: "calc(var(--radius, 8px) - 4px)",
        xs: "calc(var(--radius, 8px) - 6px)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "caret-blink": {
          "0%,70%,100%": { opacity: "1" },
          "20%,50%": { opacity: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "caret-blink": "caret-blink 1.25s ease-out infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
}
