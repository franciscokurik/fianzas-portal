// Nombre legible -> slug para llaves únicas ("Estados Financieros 2025" ->
// "estados-financieros-2025"). Quita acentos descomponiendo en NFD y tirando
// los diacríticos combinantes (U+0300–U+036F).
export function slugify(texto) {
  return String(texto)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
