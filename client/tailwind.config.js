/** @type {import('tailwindcss').Config} */
// Las escalas indigo-* y slate-* leen variables CSS en vez de traer el color
// escrito. Por defecto valen exactamente lo de Tailwind (index.css, :root), y
// DENTRO del panel interno (.fx-admin) valen el azul de Fortex y un gris cálido
// que no se ve azulado. Así:
//   - el código sigue escribiendo bg-indigo-600 y text-slate-500, y rebrandear
//     es cambiar los valores en un solo lugar sin tocar un componente;
//   - el portal de los clientes no cambia ni un pixel, porque fuera de
//     .fx-admin las variables valen lo de siempre.
const TONOS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
const deVariables = (nombre) =>
  Object.fromEntries(TONOS.map((t) => [t, `rgb(var(--${nombre}-${t}) / <alpha-value>)`]));

export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        indigo: deVariables('indigo'),
        slate: deVariables('slate'),
      },
    },
  },
  plugins: [],
};
