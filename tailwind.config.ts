import type { Config } from "tailwindcss";

export default {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        navy: {
          950: "#060b18",
          900: "#0b1329",
          850: "#0f172a",
          800: "#131d36",
          700: "#1e293b",
          600: "#334155",
        },
        nirmaan: {
          blue: "#0284c7",
          hover: "#0369a1",
          teal: "#0d9488",
          tealLight: "#ccfbf1",
          bg: "#f8fafc",
          card: "#ffffff",
          border: "#e2e8f0",
          accent: "#0ea5e9",
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
