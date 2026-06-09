// Servicio de email. En modo 'console' solo imprime (ideal para MVP).
// Para producción: EMAIL_MODE=smtp + credenciales SMTP de SendGrid en .env.
import nodemailer from 'nodemailer';

const MODE = process.env.EMAIL_MODE || 'console';
const FROM = process.env.EMAIL_FROM || 'fianzas@fortex.mx';

let transporter = null;
if (MODE === 'smtp') {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: false,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

export async function sendEmail({ to, subject, text }) {
  if (MODE === 'console' || !transporter) {
    console.log('\n📧 [EMAIL simulado]');
    console.log(`   Para:    ${to}`);
    console.log(`   Asunto:  ${subject}`);
    console.log(`   Mensaje: ${text}\n`);
    return { simulated: true };
  }
  return transporter.sendMail({ from: FROM, to, subject, text });
}
