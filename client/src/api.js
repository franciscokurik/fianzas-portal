// Cliente HTTP minimalista sobre fetch. Adjunta el token JWT automáticamente.
const TOKEN_KEY = 'fortex_token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(t) {
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
}

async function request(method, path, body) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  const res = await fetch(`/api${path}`, { method, headers, body: payload });
  if (res.status === 401) {
    setToken(null);
    if (!path.startsWith('/auth/login')) window.location.href = '/login';
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Error en la solicitud');
  return data;
}

// Sube un archivo SIN pasarlo por nuestra API: Vercel corta el cuerpo de cada
// petición en ~4.5 MB, así que un escaneo de 8 MB no llegaría nunca. En vez de
// eso se pide una firma, se sube directo a Cloudinary, y a la API solo se le
// avisa dónde quedó — que es lo que devuelve esta función para que quien la llama
// lo registre donde corresponda.
export async function subirACloudinary(clientId, file) {
  const firma = await request('POST', '/subidas/firma', {
    client_id: clientId,
    nombre: file.name,
    mime: file.type,
  });

  const datos = new FormData();
  datos.append('file', file);
  for (const [campo, valor] of Object.entries(firma.campos)) datos.append(campo, valor);

  const res = await fetch(firma.subir_a, { method: 'POST', body: datos });
  if (!res.ok) {
    // Cloudinary contesta con su propio formato de error; se rescata su mensaje
    // porque suele decir exactamente qué pasó (formato, tamaño, firma vencida).
    let detalle = '';
    try { detalle = (await res.json())?.error?.message || ''; } catch { /* noop */ }
    throw new Error(detalle || `No se pudo subir el archivo (${res.status}).`);
  }

  const subido = await res.json();
  return { public_id: subido.public_id, nombre: file.name };
}

export const api = {
  get: (p) => request('GET', p),
  post: (p, b) => request('POST', p, b),
  put: (p, b) => request('PUT', p, b),
  // El DELETE acepta cuerpo: las bajas que no se pueden deshacer piden una
  // confirmación explícita (ver el borrado de clientes).
  del: (p, b) => request('DELETE', p, b),
};
