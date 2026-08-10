// Envío de correo.
//
// En 'console' solo imprime, que es lo que se quiere en local y en las pruebas.
// En 'smtp' manda de verdad desde una dirección de no-reply: los avisos del
// portal son de ida, y contestarlos no le llega a nadie.
import nodemailer from 'nodemailer';

const modo = () => (process.env.EMAIL_MODE || 'console').toLowerCase();

// El remitente lleva nombre además de dirección: un correo que llega solo como
// "no-reply@fortex.mx" parece spam, y el fiado tiene que reconocer de quién es
// antes de abrirlo.
function remitente() {
  const direccion = process.env.EMAIL_FROM || 'no-reply@fortex.mx';
  const nombre = process.env.EMAIL_FROM_NAME || 'Portal de Fianzas Fortex';
  return `"${nombre}" <${direccion}>`;
}

// Perezoso, como el SDK de Cloudinary: una configuración incompleta no debe
// tumbar el arranque de toda la función, solo el envío que la necesita.
let transporte = null;
function conectar() {
  if (transporte) return transporte;

  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    throw new Error(
      'Falta configurar el correo saliente: define SMTP_HOST, SMTP_USER y SMTP_PASS '
      + '(o deja EMAIL_MODE=console para no mandar nada).'
    );
  }

  const puerto = Number(SMTP_PORT || 587);
  transporte = nodemailer.createTransport({
    host: SMTP_HOST,
    port: puerto,
    // 465 es SSL desde el saludo; 587 arranca en claro y sube a TLS con STARTTLS.
    secure: puerto === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  return transporte;
}

export async function sendEmail({ to, subject, text, html }) {
  if (modo() !== 'smtp') {
    console.log('\n📧 [EMAIL simulado]');
    console.log(`   Para:    ${to}`);
    console.log(`   Asunto:  ${subject}`);
    console.log(`   Mensaje: ${text}\n`);
    return { simulated: true };
  }

  return conectar().sendMail({ from: remitente(), to, subject, text, html });
}

// Comprueba que las credenciales sirvan, sin mandarle nada a nadie. Se usa
// desde /api/setup para no descubrir que el correo está mal configurado el día
// que alguien de verdad olvide su contraseña.
export async function probarCorreo() {
  if (modo() !== 'smtp') {
    return { modo: 'console', ok: true, detalle: 'No se manda nada; los correos se imprimen en el log.' };
  }
  try {
    await conectar().verify();
    return { modo: 'smtp', ok: true, remitente: remitente() };
  } catch (e) {
    return { modo: 'smtp', ok: false, detalle: e.message };
  }
}
