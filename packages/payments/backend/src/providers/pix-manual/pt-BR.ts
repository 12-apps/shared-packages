import type { PixManualCopy } from './copy';

export const PT_BR_PIX_MANUAL_COPY: PixManualCopy = {
  displayName: 'Pix manual',
  unreachable: 'Não foi possível conferir a configuração agora. Tente de novo em instantes.',
  fields: {
    pixKey: 'Chave Pix da loja',
    pixKeyHelp: 'CPF, CNPJ, e-mail, celular com +55 ou chave aleatória. O dinheiro cai na conta dessa chave.',
    merchantName: 'Nome do recebedor',
    merchantNameHelp: 'Aparece no app do banco do cliente antes de ele pagar. Até 25 caracteres.',
    merchantCity: 'Cidade',
    merchantCityHelp: 'Cidade da conta da chave Pix. Até 15 caracteres.',
    confirmWithinMinutes: 'Prazo para confirmar (minutos)',
    confirmWithinMinutesHelp:
      'Quanto tempo o pedido espera você confirmar que o Pix caiu. Passado o prazo, o pedido expira e o cliente é avisado. Em branco: 30 minutos.',
  },
  checks: {
    pixKeyValid: 'Chave Pix com formato válido.',
    pixKeyInvalid:
      'Isso não parece uma chave Pix. Use CPF (11 números), CNPJ (14 números), e-mail, celular com +55 ou a chave aleatória.',
    merchantNameValid: 'Nome do recebedor preenchido.',
    merchantNameInvalid: 'Preencha o nome do recebedor, com até 25 caracteres.',
    merchantCityValid: 'Cidade preenchida.',
    merchantCityInvalid: 'Preencha a cidade, com até 15 caracteres.',
    windowValid: (minutes) => `Os pedidos esperam até ${minutes} minutos pela sua confirmação.`,
    windowInvalid: 'O prazo precisa ser um número de minutos entre 5 e 1440.',
  },
  invalid: 'Confira os campos marcados antes de ativar o Pix manual.',
  ready: 'Pronto: o cliente vê um QR Pix com o valor do pedido, e você confirma quando o dinheiro cair.',
};
