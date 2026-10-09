/** @type {import('tailwindcss').Config} */
// Algunas escalas leen variables CSS en vez de traer el color escrito. Por
// defecto valen exactamente lo de Tailwind (index.css, :root), y DENTRO del
// panel interno (.fx-admin) valen el sistema de diseño de FortexLink, el de
// hr-system: azul acero, grises neutros y cuatro colores de estado. Así:
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
      // Las que el panel interno cambia: marca (indigo), gris (slate), y las
      // que su sistema funde en uno de sus cuatro estados —violeta, púrpura y
      // cielo en el azul; rosa en el rojo; esmeralda en el verde—.
      colors: Object.fromEntries(
        ['indigo', 'slate', 'violet', 'purple', 'sky', 'rose', 'emerald']
          .map((nombre) => [nombre, deVariables(nombre)])
      ),
    },
  },
  plugins: [],
};
