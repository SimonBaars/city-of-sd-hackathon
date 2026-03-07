/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        navy: {
          900: "#0c1222",
          800: "#111827",
          700: "#1e293b",
        },
      },
    },
  },
  plugins: [],
};
