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

// "$1,200,000.55" -> 120000055. Para lo único que llega en PESOS: las celdas de
// un Excel que llenó una persona. Es la misma regla que pesosACentavos del
// front (client/src/lib.jsx): se parte la cadena en vez de multiplicar un
// float, y los decimales de más se truncan.
//
// A diferencia de la del front, aquí "no se entiende" no es cero: devuelve
// null si está vacío y NaN si trae algo que no es un monto, para que quien
// importa pueda decirle a la persona QUÉ celda está mal en vez de guardar $0.
export function pesosACentavos(valor) {
  if (valor === '' || valor == null) return null;
  const texto = String(valor).trim().replace(/[$,\s]/g, '');
  if (texto === '') return null;
  if (!/^-?\d*(\.\d*)?$/.test(texto) || texto === '-' || texto === '.') return NaN;
  const negativo = texto.startsWith('-');
  const [entero = '', decimales = ''] = texto.replace('-', '').split('.');
  const c = Number(entero || '0') * 100 + Number((decimales + '00').slice(0, 2));
  return negativo ? -c : c;
}
