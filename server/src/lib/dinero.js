// El dinero se guarda, se transporta y se suma SIEMPRE en centavos enteros.
// Nunca en punto flotante: con montos de millones el float pierde centavos y
// los totales dejan de cuadrar contra los de la afianzadora.
//
// El cliente manda centavos y recibe centavos; el formateo a pesos ocurre
// únicamente en la capa de presentación (client/src/lib.jsx).

// Normaliza lo que venga del request a un entero de centavos.
export function centavos(valor) {
  const n = Number(valor);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n);
}
