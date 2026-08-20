/**
 * Envio de e-mail.
 *
 * A plataforma anterior mandava o e-mail de recuperação de senha por conta
 * própria. Fora dela, isso passa a ser responsabilidade nossa — e provedor de
 * e-mail é decisão de infraestrutura, não de código.
 *
 * Por isso aqui existe um adaptador:
 *   - sem EMAIL_PROVEDOR configurado, o e-mail é impresso no terminal.
 *     O fluxo funciona e é testável hoje, sem depender de contratar nada.
 *   - com EMAIL_PROVEDOR=resend, envia de verdade.
 *
 * Trocar de provedor é escrever mais um caso no switch.
 */

export interface Mensagem {
  para: string;
  assunto: string;
  texto: string;
}

async function porTerminal(m: Mensagem): Promise<void> {
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

async function porResend(m: Mensagem): Promise<void> {
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
 * Nunca deixa a falha de envio derrubar a operação que a originou: se o e-mail
 * não sair, o usuário não pode descobrir isso pela tela — a resposta da
 * recuperação de senha é sempre a mesma, exista ou não a conta.
 */
export async function enviar(m: Mensagem): Promise<void> {
  try {
    switch (process.env.EMAIL_PROVEDOR) {
      case 'resend': await porResend(m); break;
      default:       await porTerminal(m); break;
    }
  } catch (e) {
    console.error('[email] falha ao enviar', e);
  }
}
