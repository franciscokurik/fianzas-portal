// El lienzo vivo: el fondo de las pantallas de acceso.
//
// Es el mismo de FortexLink (allá src/components/LienzoVivo.tsx), para que
// entrar a Fianzas se sienta de la misma casa: los cuadros de esquinas
// redondeadas con los que está dibujada la marca, sueltos y a la deriva, sobre
// un fondo que va pasando despacio por los colores de los ramos.
//
// Se dibuja en un canvas y no con elementos: son treinta piezas moviéndose a
// sesenta cuadros por segundo, y treinta divs animados le cuestan al navegador
// mucho más que un solo dibujo. El degradado también va aquí porque uno que
// cambia de color a cada cuadro no se puede animar con CSS.
//
// Una diferencia con FortexLink: de sus ocho tonos se queda fuera el lila,
// porque en este portal no va morado.
import { useEffect, useRef } from 'react';

/** Cuántos cuadros flotan, según el tamaño de la ventana. */
const cuantos = (ancho, alto) => Math.round(Math.min(34, Math.max(12, (ancho * alto) / 52000)));

// Diez segundos en cada tono, mezclándose con el siguiente.
const TONOS = ['#97d8d0', '#a9d8f7', '#f1b5b9', '#dbf4aa', '#fbd0a9', '#f7e7a3', '#dfdac9'];
const SEGUNDOS_POR_TONO = 10;

const aRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const RGB_TONOS = TONOS.map(aRgb);

// Los dos extremos del lienzo son los del fondo de la aplicación; el tono del
// momento tiñe más el de abajo que el de arriba.
const LIENZO = [aRgb('#f7f9fa'), aRgb('#e0edf6')];
const TINTE_ARRIBA = 0.14;
const TINTE_ABAJO = 0.42;
const TINTA = [16, 16, 18];

const entre = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
/** Suaviza los extremos: sin esto, el cambio de un tono al siguiente se nota. */
const suave = (t) => t * t * (3 - 2 * t);
const css = ([r, g, b], alfa = 1) => `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${alfa})`;

function tonoDelMomento(ms) {
  const paso = ms / (SEGUNDOS_POR_TONO * 1000);
  const i = Math.floor(paso) % RGB_TONOS.length;
  return entre(RGB_TONOS[i], RGB_TONOS[(i + 1) % RGB_TONOS.length], suave(paso % 1));
}

export default function LienzoVivo() {
  const lienzo = useRef(null);

  useEffect(() => {
    const canvas = lienzo.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return undefined;

    // A quien le molesta el movimiento se le deja la pantalla quieta, y eso
    // incluye el color: un fondo que muta también es movimiento.
    const quieto = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let cuadros = [];
    let ancho = 0;
    let alto = 0;

    const nace = (dentro) => ({
      x: Math.random() * ancho,
      y: dentro ? Math.random() * alto : alto + 120,
      lado: 18 + Math.random() * 122,
      giro: Math.random() * Math.PI,
      vx: (Math.random() - 0.5) * 0.22,
      vy: -0.06 - Math.random() * 0.22,
      vg: (Math.random() - 0.5) * 0.0035,
      alfa: 0.06 + Math.random() * 0.1,
      // Dos de cada tres van del tono en turno; el resto en tinta, que es lo
      // que le da profundidad al fondo.
      tono: Math.random(),
    });

    // Grano finísimo encima de todo. Un degradado tan suave como este, en una
    // pantalla de laptop común (de 6 u 8 bits por color), no alcanza a pasar de
    // un tono al siguiente sin escalones: se ve en franjas, como pixeleado. Un
    // poco de ruido —cuatro por ciento, invisible a la vista— revuelve los
    // bordes de esas franjas y el ojo vuelve a ver un degradado liso. Es lo que
    // hacen los programas de diseño al exportar un degradado.
    const grano = document.createElement('canvas');
    grano.width = 160;
    grano.height = 160;
    const g = grano.getContext('2d');
    const ruido = g.createImageData(grano.width, grano.height);
    for (let i = 0; i < ruido.data.length; i += 4) {
      const v = Math.random() * 255;
      ruido.data[i] = v; ruido.data[i + 1] = v; ruido.data[i + 2] = v;
      ruido.data[i + 3] = 10;
    }
    g.putImageData(ruido, 0, 0);
    const patronGrano = ctx.createPattern(grano, 'repeat');

    const medir = () => {
      // Hasta 3 y no 2: en un teléfono o un monitor 4K al 300% con tope en 2 el
      // dibujo se escalaba y se veía suave de más.
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      ancho = canvas.clientWidth;
      alto = canvas.clientHeight;
      canvas.width = Math.round(ancho * dpr);
      canvas.height = Math.round(alto * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = cuantos(ancho, alto);
      if (cuadros.length !== n) cuadros = Array.from({ length: n }, () => nace(true));
    };

    // El cuadro de esquinas redondeadas de la marca: el radio crece con el lado
    // para que todos se vean de la misma familia.
    const cuadroRedondo = (lado) => {
      const r = lado * 0.26;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(-lado / 2, -lado / 2, lado, lado, r);
      else ctx.rect(-lado / 2, -lado / 2, lado, lado);
    };

    const dibuja = (ms) => {
      const tono = tonoDelMomento(ms);
      const grad = ctx.createLinearGradient(0, 0, ancho, alto);
      grad.addColorStop(0, css(entre(LIENZO[0], tono, TINTE_ARRIBA)));
      grad.addColorStop(1, css(entre(LIENZO[1], tono, TINTE_ABAJO)));
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, ancho, alto);

      for (const c of cuadros) {
        ctx.save();
        ctx.translate(c.x, c.y);
        ctx.rotate(c.giro);
        ctx.fillStyle = css(c.tono < 0.66 ? tono : TINTA, c.alfa);
        cuadroRedondo(c.lado);
        ctx.fill();
        ctx.restore();
      }

      // El velo del centro va AQUÍ y no en CSS encima del canvas: como otra
      // capa con su propio degradado, sumaba un segundo juego de franjas. Le
      // baja el contraste al fondo justo detrás de la tarjeta, para que un
      // cuadro grande no le gane al formulario.
      ctx.save();
      ctx.translate(ancho / 2, alto * 0.48);
      ctx.scale(ancho * 0.58, alto * 0.44);
      const velo = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      velo.addColorStop(0, 'rgba(245, 249, 252, 0.6)');
      velo.addColorStop(0.72, 'rgba(245, 249, 252, 0)');
      ctx.fillStyle = velo;
      ctx.fillRect(-1.5, -1.5, 3, 3);
      ctx.restore();

      ctx.fillStyle = patronGrano;
      ctx.fillRect(0, 0, ancho, alto);
    };

    let cuadro = 0;
    const paso = (ms) => {
      for (const c of cuadros) {
        c.x += c.vx;
        c.y += c.vy;
        c.giro += c.vg;
        // Al salir por arriba vuelve a nacer abajo; por los lados se asoma por
        // el contrario. Nunca hay un hueco en la pantalla.
        if (c.y < -c.lado) Object.assign(c, nace(false));
        if (c.x < -c.lado) c.x = ancho + c.lado;
        if (c.x > ancho + c.lado) c.x = -c.lado;
      }
      dibuja(ms);
      cuadro = requestAnimationFrame(paso);
    };

    medir();
    if (quieto) dibuja(0);
    else cuadro = requestAnimationFrame(paso);

    const alRedimensionar = () => { medir(); if (quieto) dibuja(0); };
    window.addEventListener('resize', alRedimensionar);
    return () => {
      cancelAnimationFrame(cuadro);
      window.removeEventListener('resize', alRedimensionar);
    };
  }, []);

  return <canvas ref={lienzo} className="acceso-lienzo" aria-hidden="true" />;
}
