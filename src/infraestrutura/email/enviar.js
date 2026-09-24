/**
 * Envio de e-mail, com adaptador por provedor.
 * Sem EMAIL_PROVEDOR, imprime no terminal; com `resend`, envia de verdade.
 */

/**
 * @typedef {object} Mensagem
 * @property {string} para
 * @property {string} assunto
 * @property {string} texto
 */

/**
 * @param {Mensagem} m
 * @returns {Promise<void>}
 */
async function porTerminal(m) {
  console.log(
    ['', '='.repeat(72),
     'E-MAIL NÃO ENVIADO — nenhum provedor configurado (EMAIL_PROVEDOR)',
     `Para:    ${m.para}`,
     `Assunto: ${m.assunto}`,
     '-'.repeat(72),
     m.texto,
     '='.repeat(72), ''].join('\n'),
  );
}

/**
 * @param {Mensagem} m
 * @returns {Promise<void>}
 */
async function porResend(m) {
  const chave = process.env.RESEND_API_KEY;
  const remetente = process.env.EMAIL_REMETENTE;
  if (!chave || !remetente) {
    throw new Error('RESEND_API_KEY e EMAIL_REMETENTE precisam estar definidas.');
  }

  const resposta = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: remetente, to: m.para, subject: m.assunto, text: m.texto }),
  });

  if (!resposta.ok) {
    throw new Error(`Resend respondeu ${resposta.status}: ${await resposta.text()}`);
  }
}

/**
 * Falha de envio nunca derruba a operação: a resposta da recuperação de senha é
 * sempre a mesma, exista ou não a conta.
 *
 * @param {Mensagem} m
 * @returns {Promise<void>}
 */
export async function enviar(m) {
  try {
    switch (process.env.EMAIL_PROVEDOR) {
      case 'resend': await porResend(m); break;
      default:       await porTerminal(m); break;
    }
  } catch (e) {
    console.error('[email] falha ao enviar', e);
  }
}
