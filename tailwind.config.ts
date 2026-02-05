import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0C0B10",
        paper: "#F7F3E9",
        gold: "#C7A34A",
        wine: "#7B2031",
        sea: "#1B5B6A"
      },
      fontFamily: {
        display: ["\"Playfair Display\"", "serif"],
        body: ["\"Source Sans 3\"", "sans-serif"]
      },
      backgroundImage: {
        "paper-texture": "radial-gradient(circle at 20% 20%, rgba(199,163,74,0.08), transparent 40%), radial-gradient(circle at 80% 10%, rgba(123,32,49,0.07), transparent 40%), linear-gradient(180deg, #F7F3E9, #F2EFE7)"
      }
    }
  },
  plugins: []
};

export default config;
